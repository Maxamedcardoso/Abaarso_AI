import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
} catch {}

/**
 * Broadcast-grade FFmpeg vocal mastering chain (verified against bundled @ffmpeg-installer/ffmpeg):
 * - Highpass 75Hz removes low-end rumble
 * - Warm vocal body boost (+2.2dB @ 180Hz)
 * - Presence/clarity boost (+2.0dB @ 3.2kHz) for crystal-clear Somali consonants
 * - Micro Studio Booth Ambience (18ms tiny acoustic room reflection putting Safa & Mohamed in the same room)
 * - Gentle broadcast compressor + brickwall peak limiter (zero clipping)
 */
export const STUDIO_VOICE_MASTER_FILTER =
  'highpass=f=75,equalizer=f=180:t=q:w=1.2:g=2.2,equalizer=f=3200:t=q:w=1.4:g=2.0,aecho=0.8:0.88:18:0.055,acompressor=threshold=-18dB:ratio=2.8:attack=15:release=140:makeup=2,alimiter=limit=0.95';

/**
 * Creates a pure-Node 16-bit PCM WAV buffer (mono or stereo) from Float32 samples (-1..1).
 */
export function encodePcmWav(
  leftSamples: Float32Array,
  sampleRate: number = 48000,
  rightSamples?: Float32Array
): Buffer {
  const channels = rightSamples ? 2 : 1;
  const numFrames = leftSamples.length;
  const dataSize = numFrames * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, leftSamples[i]));
    buf.writeInt16LE(Math.round(l * 32767), offset);
    offset += 2;
    if (rightSamples) {
      const r = Math.max(-1, Math.min(1, rightSamples[i]));
      buf.writeInt16LE(Math.round(r * 32767), offset);
      offset += 2;
    }
  }
  return buf;
}

/**
 * Generates pure-Node silent WAV buffer of exact duration (compatible with all FFmpeg versions).
 */
export function createSilentWav(durationMs: number, sampleRate: number = 48000): Buffer {
  const numSamples = Math.max(1, Math.round((sampleRate * Math.max(10, durationMs)) / 1000));
  return encodePcmWav(new Float32Array(numSamples), sampleRate);
}

export function createStudioChimeSamples(kind: 'intro' | 'outro', sampleRate: number = 48000): {
  left: Float32Array;
  right: Float32Array;
} {
  const durationSec = kind === 'intro' ? 1.85 : 2.1;
  const totalSamples = Math.round(sampleRate * durationSec);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  // Warm Cmaj9 ascending radio signature for Intro; resolving Gmaj7 -> Cmaj7 for Outro
  const notes =
    kind === 'intro'
      ? [
          { freq: 261.63, start: 0.0, dur: 1.5, amp: 0.14, pan: -0.25 }, // C4
          { freq: 329.63, start: 0.12, dur: 1.4, amp: 0.12, pan: 0.2 }, // E4
          { freq: 392.0, start: 0.24, dur: 1.35, amp: 0.11, pan: -0.15 }, // G4
          { freq: 493.88, start: 0.36, dur: 1.3, amp: 0.09, pan: 0.3 }, // B4
          { freq: 587.33, start: 0.5, dur: 1.25, amp: 0.08, pan: 0.0 }, // D5
        ]
      : [
          { freq: 587.33, start: 0.0, dur: 1.1, amp: 0.09, pan: 0.25 }, // D5
          { freq: 493.88, start: 0.14, dur: 1.2, amp: 0.1, pan: -0.2 }, // B4
          { freq: 392.0, start: 0.28, dur: 1.4, amp: 0.11, pan: 0.15 }, // G4
          { freq: 329.63, start: 0.42, dur: 1.5, amp: 0.12, pan: -0.25 }, // E4
          { freq: 261.63, start: 0.56, dur: 1.5, amp: 0.15, pan: 0.0 }, // C4
        ];

  for (const n of notes) {
    const startIdx = Math.floor(n.start * sampleRate);
    const len = Math.min(totalSamples - startIdx, Math.floor(n.dur * sampleRate));
    const leftGain = Math.sqrt((1 - n.pan) * 0.5);
    const rightGain = Math.sqrt((1 + n.pan) * 0.5);

    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.025);
      const decay = Math.exp(-t * 2.6);
      const env = attack * decay * n.amp;
      // Soft Rhodes electric-piano timbre (fundamental + gentle 2nd & 3rd overtone)
      const val =
        (Math.sin(2 * Math.PI * n.freq * t) +
          0.22 * Math.sin(2 * Math.PI * n.freq * 2 * t) * Math.exp(-t * 4.5) +
          0.07 * Math.sin(2 * Math.PI * n.freq * 3 * t) * Math.exp(-t * 7.0)) *
        env;
      const idx = startIdx + i;
      left[idx] += val * leftGain;
      right[idx] += val * rightGain;
    }
  }

  // Smooth master fade-out at tail so transition into/out of voice is seamless
  const fadeSamples = Math.floor(0.28 * sampleRate);
  for (let i = 0; i < fadeSamples; i++) {
    const idx = totalSamples - fadeSamples + i;
    if (idx >= 0 && idx < totalSamples) {
      const g = 1 - i / fadeSamples;
      left[idx] *= g;
      right[idx] *= g;
    }
  }

  return { left, right };
}

/**
 * Synthesizes a warm, modern, broadcast-quality Podcast Intro / Outro Studio Chime
 * (soft Rhodes/marimba harmonic chord progression, zero copyright, zero network).
 */
export function createStudioChimeWav(kind: 'intro' | 'outro', sampleRate: number = 48000): Buffer {
  const { left, right } = createStudioChimeSamples(kind, sampleRate);
  return encodePcmWav(left, sampleRate, right);
}

/**
 * Generates an ultra-subtle, velvety warm studio ambient bed (~ -29dB) that gives the podcast
 * rich radio atmosphere without ever competing with Safa & Mohamed's Somali speech.
 */
export function createAmbientPadWav(durationSec: number, sampleRate: number = 48000): Buffer {
  const safeDur = Math.max(2, Math.min(340, durationSec));
  const totalSamples = Math.round(sampleRate * safeDur);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  // Subtle Cmaj7 warm pad frequencies (low amplitude ~0.024 total RMS -> ~ -29dB under dialogue)
  const chord = [130.81, 196.0, 246.94, 329.63];
  const fadeIn = Math.floor(Math.min(1.5, safeDur * 0.2) * sampleRate);
  const fadeOut = Math.floor(Math.min(2.0, safeDur * 0.2) * sampleRate);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const breath = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.14 * t);
    let lVal = 0;
    let rVal = 0;
    for (let c = 0; c < chord.length; c++) {
      const f = chord[c];
      const w = Math.sin(2 * Math.PI * f * t + c * 0.9);
      const wDetune = Math.sin(2 * Math.PI * (f * 1.002) * t + c * 1.3);
      lVal += w * 0.0085;
      rVal += wDetune * 0.0085;
    }
    let env = breath;
    if (i < fadeIn) env *= i / fadeIn;
    if (i > totalSamples - fadeOut) env *= (totalSamples - i) / fadeOut;
    left[i] = lVal * env;
    right[i] = rVal * env;
  }

  return encodePcmWav(left, sampleRate, right);
}

// ─── Zero-Dependency Pure-Node Studio Audiogram Cover PNG Renderer ────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function blendPx(rgba: Uint8Array, idx: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  if (a >= 1) {
    rgba[idx] = r;
    rgba[idx + 1] = g;
    rgba[idx + 2] = b;
    rgba[idx + 3] = 255;
    return;
  }
  const inv = 1 - a;
  rgba[idx] = Math.round(r * a + rgba[idx] * inv);
  rgba[idx + 1] = Math.round(g * a + rgba[idx + 1] * inv);
  rgba[idx + 2] = Math.round(b * a + rgba[idx + 2] * inv);
  rgba[idx + 3] = 255;
}

/**
 * Generates a sleek 9:16 portrait (540x960) CARDOSO AI Podcast Studio PNG backdrop
 * featuring dual glowing host orbs (Safa emerald/cyan & Mohamed violet/blue) and a clean waveform stage.
 */
export function generatePodcastCoverPng(width: number = 540, height: number = 960): Buffer {
  const rgba = new Uint8Array(width * height * 4);

  const orb1X = width * 0.31;
  const orb1Y = height * 0.34;
  const orb2X = width * 0.69;
  const orb2Y = height * 0.34;
  const orbR = width * 0.145;

  const boxLeft = Math.floor(width * 0.07);
  const boxRight = Math.floor(width * 0.93);
  const boxTop = Math.floor(height * 0.56);
  const boxBottom = Math.floor(height * 0.78);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const idx = (y * width + x) * 4;

      // Deep midnight studio gradient
      const bgR = Math.round(8 + ny * 10);
      const bgG = Math.round(13 + ny * 14);
      const bgB = Math.round(28 + (1 - ny) * 24);
      rgba[idx] = bgR;
      rgba[idx + 1] = bgG;
      rgba[idx + 2] = bgB;
      rgba[idx + 3] = 255;

      // Ambient top cyan glow
      const topGlow = Math.max(0, 1 - Math.hypot(nx - 0.5, ny - 0.18) * 1.9);
      if (topGlow > 0) {
        blendPx(rgba, idx, 6, 182, 212, topGlow * 0.18);
      }

      // Host 1 orb (Safa - emerald/cyan)
      const d1 = Math.hypot(x - orb1X, y - orb1Y);
      if (d1 < orbR * 1.45) {
        const halo = Math.max(0, 1 - d1 / (orbR * 1.45));
        blendPx(rgba, idx, 16, 185, 129, halo * halo * 0.35);
      }
      if (d1 <= orbR) {
        blendPx(rgba, idx, 12, 34, 48, 0.92);
        if (d1 >= orbR - 5) {
          blendPx(rgba, idx, 52, 211, 153, 0.95);
        }
      }

      // Host 2 orb (Mohamed - cyan/violet)
      const d2 = Math.hypot(x - orb2X, y - orb2Y);
      if (d2 < orbR * 1.45) {
        const halo = Math.max(0, 1 - d2 / (orbR * 1.45));
        blendPx(rgba, idx, 139, 92, 246, halo * halo * 0.35);
      }
      if (d2 <= orbR) {
        blendPx(rgba, idx, 22, 24, 56, 0.92);
        if (d2 >= orbR - 5) {
          blendPx(rgba, idx, 34, 211, 238, 0.95);
        }
      }

      // Waveform stage glass box
      if (x >= boxLeft && x <= boxRight && y >= boxTop && y <= boxBottom) {
        const isBorder =
          x <= boxLeft + 2 || x >= boxRight - 2 || y <= boxTop + 2 || y >= boxBottom - 2;
        if (isBorder) {
          blendPx(rgba, idx, 34, 211, 238, 0.45);
        } else {
          blendPx(rgba, idx, 10, 18, 36, 0.65);
        }
      }
    }
  }

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function findDrawtextFontPath(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function escapeDrawtext(text: string): string {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Renders a 9:16 portrait MP4 Video Audiogram (WhatsApp Status & TikTok ready!)
 * with a crisp CARDOSO AI Safa & Mohamed studio background + animated live waveform!
 * 100% Free & local via FFmpeg (zero external paid rendering APIs).
 */
export async function renderPodcastVideoAudiogram(
  audioBuffer: Buffer,
  options?: { title?: string; styleLabel?: string }
): Promise<Buffer> {
  if (!audioBuffer || audioBuffer.length < 128) {
    throw new Error('Codka podcast-ka ee muuqaalka loo beddelayo wuu madhan yahay');
  }

  const tmpBase = `cardoso_audiogram_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const bgPath = path.join(os.tmpdir(), `${tmpBase}_bg.png`);
  const audioPath = path.join(os.tmpdir(), `${tmpBase}_audio.input`);
  const outPath = path.join(os.tmpdir(), `${tmpBase}_video.mp4`);

  const width = 540;
  const height = 960;

  try {
    await fs.promises.writeFile(bgPath, generatePodcastCoverPng(width, height));
    await fs.promises.writeFile(audioPath, audioBuffer);

    const fontPath = findDrawtextFontPath();
    const safeTitle = escapeDrawtext(options?.title || 'CARDOSO AI PODCAST').slice(0, 38);
    const safeStyle = escapeDrawtext(options?.styleLabel || 'SAFA & MOHAMED STUDIO').slice(0, 36);

    const runFfmpegVideo = (useDrawtext: boolean): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const filters: string[] = [
          `[1:a]showwaves=s=440x150:mode=cline:rate=24:colors=0x22d3ee|0x34d399[waves]`,
          `[0:v][waves]overlay=x=(W-w)/2:y=${Math.floor(height * 0.59)}[vbase]`,
        ];

        let finalVideoLabel = 'vbase';
        if (useDrawtext && fontPath) {
          const escapedFont = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');
          filters.push(
            `[vbase]` +
              `drawtext=fontfile='${escapedFont}':text='CARDOSO AI PODCAST':fontcolor=0x22d3ee:fontsize=28:x=(w-text_w)/2:y=96,` +
              `drawtext=fontfile='${escapedFont}':text='SAFA':fontcolor=0x34d399:fontsize=24:x=${Math.floor(width * 0.31)}-text_w/2:y=${Math.floor(height * 0.34)}-12,` +
              `drawtext=fontfile='${escapedFont}':text='MOHAMED':fontcolor=0x67e8f9:fontsize=22:x=${Math.floor(width * 0.69)}-text_w/2:y=${Math.floor(height * 0.34)}-12,` +
              `drawtext=fontfile='${escapedFont}':text='${safeTitle}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=468,` +
              `drawtext=fontfile='${escapedFont}':text='${safeStyle}':fontcolor=0x94a3b8:fontsize=18:x=(w-text_w)/2:y=820` +
              `[vtxt]`
          );
          finalVideoLabel = 'vtxt';
        }

        ffmpeg()
          .input(bgPath)
          .inputOptions(['-loop', '1', '-framerate', '24'])
          .input(audioPath)
          .complexFilter(filters)
          .outputOptions([
            '-map',
            `[${finalVideoLabel}]`,
            '-map',
            '1:a:0',
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-tune',
            'stillimage',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            '-shortest',
          ])
          .format('mp4')
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outPath);
      });

    try {
      await runFfmpegVideo(Boolean(fontPath));
    } catch (drawErr: any) {
      if (fontPath) {
        console.warn('[PodcastStudio] drawtext fallback (rendering clean audiogram without text overlay):', drawErr?.message || drawErr);
        await runFfmpegVideo(false);
      } else {
        throw drawErr;
      }
    }

    const mp4Buf = await fs.promises.readFile(outPath);
    if (!mp4Buf || mp4Buf.length < 1024) {
      throw new Error('Muuqaalka Podcast Audiogram-ka wuu madhan yahay');
    }
    return mp4Buf;
  } finally {
    await fs.promises.unlink(bgPath).catch(() => {});
    await fs.promises.unlink(audioPath).catch(() => {});
    await fs.promises.unlink(outPath).catch(() => {});
  }
}

/**
 * Splits any audio buffer into sequential WhatsApp-Status-safe Ogg Opus clips (default <= 55s each,
 * safely inside WhatsApp's 60-second Voice Status limit) so long podcasts play completely without cutoff!
 */
export async function splitAudioIntoVoiceStatusClips(
  inputBuffer: Buffer,
  totalSeconds: number,
  maxChunkSeconds: number = 55
): Promise<Buffer[]> {
  if (!inputBuffer || inputBuffer.length < 128) {
    throw new Error('Faylka codka ee Status-ka wuu madhan yahay');
  }
  const safeMax = Math.max(15, Math.min(58, maxChunkSeconds));
  const isAlreadyOgg = inputBuffer.slice(0, 4).toString('ascii') === 'OggS';
  if (isAlreadyOgg && totalSeconds > 0 && totalSeconds <= safeMax) {
    return [inputBuffer];
  }

  const tmpBase = `cardoso_status_split_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const inPath = path.join(os.tmpdir(), `${tmpBase}.input`);
  const chunkPaths: string[] = [];

  try {
    await fs.promises.writeFile(inPath, inputBuffer);
    const effectiveTotal = Math.max(1, Math.ceil(totalSeconds || safeMax));
    const chunkCount = Math.min(6, Math.max(1, Math.ceil(effectiveTotal / safeMax)));
    const clips: Buffer[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const startSec = i * safeMax;
      if (startSec >= effectiveTotal && i > 0) break;
      const outPath = path.join(os.tmpdir(), `${tmpBase}_part_${i}.ogg`);
      chunkPaths.push(outPath);

      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg(inPath);
        if (chunkCount > 1) {
          cmd.setStartTime(startSec).setDuration(safeMax);
        }
        cmd
          .noVideo()
          .audioCodec('libopus')
          .audioBitrate('48k')
          .audioFrequency(48000)
          .audioChannels(1)
          .outputOptions(['-application', 'voip', '-vbr', 'on'])
          .format('ogg')
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outPath);
      });

      const partBuf = await fs.promises.readFile(outPath);
      if (partBuf && partBuf.length >= 256 && partBuf.slice(0, 4).toString('ascii') === 'OggS') {
        clips.push(partBuf);
      }
    }

    if (clips.length === 0) {
      throw new Error('Codka Status-ka lama diyaarin karin');
    }
    return clips;
  } finally {
    await fs.promises.unlink(inPath).catch(() => {});
    for (const p of chunkPaths) {
      await fs.promises.unlink(p).catch(() => {});
    }
  }
}

// ─── Human-Realism Audio Engine (Trim Dead TTS Gaps + Real Voice Overlap + Studio Room Tone + Sidechain Ducking) ───

function parseMono16BitPcmWav(wavBuf: Buffer): Float32Array {
  if (!wavBuf || wavBuf.length < 44) return new Float32Array(0);
  // Locate the "data" subchunk cleanly (FFmpeg WAV headers may include a LIST/INFO chunk before "data")
  let offset = 12;
  let dataOffset = 44;
  let dataSize = wavBuf.length - 44;
  while (offset + 8 <= wavBuf.length) {
    const chunkId = wavBuf.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(chunkSize, wavBuf.length - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  const numSamples = Math.floor(Math.max(0, dataSize) / 2);
  const out = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    out[i] = wavBuf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return out;
}

/**
 * Decodes ANY audio turn (MP3/WAV/OGG) to 48kHz mono Float32 PCM while trimming
 * Edge TTS's artificial leading & trailing dead silence (~350-450ms) via FFmpeg
 * `silenceremove` + `areverse` (preserving mid-sentence pauses 100%).
 */
export async function decodeTrimmedMonoPcm48k(audioBuffer: Buffer): Promise<Float32Array> {
  const tmpBase = `cardoso_turn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const inPath = path.join(os.tmpdir(), `${tmpBase}.in`);
  const trimmedPath = path.join(os.tmpdir(), `${tmpBase}_trim.wav`);
  const rawPath = path.join(os.tmpdir(), `${tmpBase}_raw.wav`);

  const runDecode = (outPath: string, trimSilence: boolean): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inPath).noVideo().audioFrequency(48000).audioChannels(1).audioCodec('pcm_s16le').format('wav');
      if (trimSilence) {
        cmd.audioFilters(
          'silenceremove=start_periods=1:start_duration=0.015:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_duration=0.015:start_threshold=-40dB,areverse'
        );
      }
      cmd.on('end', () => resolve()).on('error', (err) => reject(err)).save(outPath);
    });

  try {
    await fs.promises.writeFile(inPath, audioBuffer);
    try {
      await runDecode(trimmedPath, true);
      const trimmedWav = await fs.promises.readFile(trimmedPath);
      const samples = parseMono16BitPcmWav(trimmedWav);
      // Guard: if clip was super short/quiet and got over-trimmed (<120ms), fall back to raw untrimmed decode
      if (samples.length >= 48000 * 0.12) {
        return samples;
      }
    } catch {}

    await runDecode(rawPath, false);
    const rawWav = await fs.promises.readFile(rawPath);
    return parseMono16BitPcmWav(rawWav);
  } finally {
    await fs.promises.unlink(inPath).catch(() => {});
    await fs.promises.unlink(trimmedPath).catch(() => {});
    await fs.promises.unlink(rawPath).catch(() => {});
  }
}

/**
 * Generates ultra-quiet velvety pink-filtered studio room tone (~ -48dB)
 * so transitions between speakers feel like a live recording room — zero dead digital vacuum!
 */
export function generateStudioRoomToneSamples(numSamples: number): Float32Array {
  const out = new Float32Array(numSamples);
  // Deterministic Paul Kellet pink-noise approximation (fast, smooth, warm low-end air)
  let seed = 0x13579bdf;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < numSamples; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = (seed / 2147483648) - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.00055; // ~ -48dB warm studio room air
    b6 = white * 0.115926;
    out[i] = pink;
  }
  return out;
}

export interface HumanMixSegment {
  speaker: 'safa' | 'mohamed';
  emotion: 'neutral' | 'laugh' | 'debate' | 'excited' | 'calm' | 'whisper' | 'backchannel';
  samples: Float32Array;
  pauseAfterMs?: number;
}

/**
 * Mixes Safa & Mohamed's trimmed PCM turns onto a sample-accurate 48kHz Studio Timeline with:
 * - REAL HUMAN VOICE OVERLAP (-140ms to -220ms interruption on heated [debate], [laugh], and [backchannel]!)
 * - Smooth 8ms edge micro-fades (zero clicks/pops)
 * - Overlapping Radio Intro/Outro Studio Chimes
 * - Subtle Stereo Host Placement (Safa slightly left, Mohamed slightly right on stereo MP3)
 * - Continuous -48dB Studio Room Tone (zero robotic digital vacuum)
 * - True Sidechain Auto-Ducking Ambient Bed (when soundMode === 'ambient')
 */
export function mixHumanPodcastTimeline(
  segments: HumanMixSegment[],
  options?: {
    isStereo?: boolean;
    soundMode?: 'chime' | 'ambient' | 'clean';
    defaultPauseMs?: number;
  }
): { wavBuffer: Buffer; totalSeconds: number; overlapCount: number } {
  const sampleRate = 48000;
  const isStereo = Boolean(options?.isStereo);
  const soundMode = options?.soundMode || 'chime';
  const defaultPauseMs = options?.defaultPauseMs ?? 110;
  const useChimes = soundMode === 'chime' || soundMode === 'ambient';

  const intro = useChimes ? createStudioChimeSamples('intro', sampleRate) : null;
  const outro = useChimes ? createStudioChimeSamples('outro', sampleRate) : null;

  // 1. Place each turn on the timeline with organic human overlaps & micro-pauses
  const placements: Array<{ start: number; seg: HumanMixSegment }> = [];
  // Overlap Safa's first word gently into the last 420ms of the intro chime decay (authentic radio feel!)
  let cursor = intro ? Math.max(0, intro.left.length - Math.round(sampleRate * 0.42)) : Math.round(sampleRate * 0.06);
  let overlapCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0) {
      const prev = segments[i - 1];
      const speakerChanged = prev.speaker !== seg.speaker;
      const prevLen = prev.samples.length;

      let gapMs: number;
      if (typeof prev.pauseAfterMs === 'number') {
        gapMs = prev.pauseAfterMs;
      } else if (speakerChanged && seg.emotion === 'backchannel') {
        // Real human quick interruption ("War been badanaa!", "Haa-haa!") overlaps by ~210ms!
        gapMs = -210;
      } else if (speakerChanged && (seg.emotion === 'debate' || seg.emotion === 'laugh')) {
        // Lively debate/laughter jumps in 135-175ms before previous host finishes trailing syllable!
        gapMs = -(135 + ((i * 23) % 45));
      } else if (speakerChanged && seg.emotion === 'excited') {
        gapMs = 35;
      } else if (seg.emotion === 'calm' || seg.emotion === 'whisper') {
        gapMs = 200;
      } else if (!speakerChanged) {
        gapMs = 150;
      } else {
        gapMs = Math.min(130, defaultPauseMs);
      }

      // Never overlap more than 32% of the previous turn so short turns remain 100% intelligible
      const maxOverlapMs = Math.floor(((prevLen / sampleRate) * 1000) * 0.32);
      if (gapMs < 0) {
        gapMs = -Math.min(Math.abs(gapMs), maxOverlapMs);
        if (gapMs <= -40) overlapCount++;
      }

      cursor = Math.max(0, cursor + Math.round((gapMs / 1000) * sampleRate));
    }

    placements.push({ start: cursor, seg });
    cursor += seg.samples.length;
  }

  const speechEndSample = placements.reduce((m, p) => Math.max(m, p.start + p.seg.samples.length), cursor);
  const outroStart = outro ? Math.max(0, speechEndSample - Math.round(sampleRate * 0.30)) : speechEndSample;
  const totalSamples = Math.max(
    sampleRate,
    (outro ? outroStart + outro.left.length : speechEndSample) + Math.round(sampleRate * 0.12)
  );

  const left = new Float32Array(totalSamples);
  const right = isStereo ? new Float32Array(totalSamples) : undefined;
  const voiceActivity = soundMode === 'ambient' ? new Float32Array(totalSamples) : null;

  // 2. Layer continuous subtle Studio Room Tone (-48dB pink air) across full timeline
  const roomTone = generateStudioRoomToneSamples(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    left[i] = roomTone[i];
    if (right) right[i] = roomTone[i];
  }

  // 3. Mix Intro Chime
  if (intro) {
    for (let i = 0; i < intro.left.length && i < totalSamples; i++) {
      if (right) {
        left[i] += intro.left[i];
        right[i] += intro.right[i];
      } else {
        left[i] += (intro.left[i] + intro.right[i]) * 0.5;
      }
    }
  }

  // 4. Mix all speech turns with 8ms click-free fades & studio stereo placement
  const fadeSamples = Math.round(sampleRate * 0.008);
  for (const { start, seg } of placements) {
    const src = seg.samples;
    const len = src.length;
    const gainL = isStereo ? (seg.speaker === 'safa' ? 0.92 : 0.74) : 1.0;
    const gainR = isStereo ? (seg.speaker === 'safa' ? 0.74 : 0.92) : 1.0;

    for (let i = 0; i < len; i++) {
      const dstIdx = start + i;
      if (dstIdx >= totalSamples) break;
      let env = 1.0;
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > len - fadeSamples) env = (len - i) / fadeSamples;
      const s = src[i] * env;
      left[dstIdx] += s * gainL;
      if (right) right[dstIdx] += s * gainR;
      if (voiceActivity) voiceActivity[dstIdx] = Math.max(voiceActivity[dstIdx], Math.abs(s));
    }
  }

  // 5. Mix Outro Chime
  if (outro) {
    for (let i = 0; i < outro.left.length && outroStart + i < totalSamples; i++) {
      const dstIdx = outroStart + i;
      if (right) {
        left[dstIdx] += outro.left[i];
        right[dstIdx] += outro.right[i];
      } else {
        left[dstIdx] += (outro.left[i] + outro.right[i]) * 0.5;
      }
    }
  }

  // 6. Optional Soft Ambient Pad with TRUE Sidechain Auto-Ducking!
  if (soundMode === 'ambient' && voiceActivity) {
    const chord = [130.81, 196.0, 246.94, 329.63];
    const fadeIn = Math.floor(Math.min(1.4, totalSamples / sampleRate * 0.15) * sampleRate);
    const fadeOut = Math.floor(Math.min(1.8, totalSamples / sampleRate * 0.18) * sampleRate);
    let smoothEnv = 0;
    let duckGain = 1.0;

    for (let i = 0; i < totalSamples; i++) {
      const v = voiceActivity[i];
      smoothEnv = v > smoothEnv ? smoothEnv * 0.992 + v * 0.008 : smoothEnv * 0.9996 + v * 0.0004;
      const targetDuck = smoothEnv > 0.018 ? 0.32 : 1.0; // Duck down ~10dB smoothly while speaking!
      duckGain = duckGain * 0.999 + targetDuck * 0.001;

      const t = i / sampleRate;
      const breath = 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.14 * t);
      let aL = 0;
      let aR = 0;
      for (let c = 0; c < chord.length; c++) {
        const f = chord[c];
        aL += Math.sin(2 * Math.PI * f * t + c * 0.9) * 0.011;
        aR += Math.sin(2 * Math.PI * (f * 1.002) * t + c * 1.3) * 0.011;
      }
      let edgeEnv = breath * duckGain;
      if (i < fadeIn) edgeEnv *= i / fadeIn;
      if (i > totalSamples - fadeOut) edgeEnv *= (totalSamples - i) / fadeOut;

      if (right) {
        left[i] += aL * edgeEnv;
        right[i] += aR * edgeEnv;
      } else {
        left[i] += (aL + aR) * 0.5 * edgeEnv;
      }
    }
  }

  // 7. Gentle soft-clip protection before FFmpeg broadcast mastering
  for (let i = 0; i < totalSamples; i++) {
    left[i] = Math.tanh(left[i] * 0.95);
    if (right) right[i] = Math.tanh(right[i] * 0.95);
  }

  return {
    wavBuffer: encodePcmWav(left, sampleRate, right),
    totalSeconds: Math.max(1, Math.round(totalSamples / sampleRate)),
    overlapCount,
  };
}

/**
 * Encodes a mixed Studio WAV buffer through the Broadcast Mastering chain (Warm EQ +
 * 18ms Studio Booth Ambience + Broadcast Compressor + Limiter) to Stereo MP3 or strict OggS Opus PTT.
 */
export async function encodeMasteredPodcastAudio(
  mixedWavBuffer: Buffer,
  options: { outputFormat: 'mp3' | 'ogg'; masterAudio?: boolean }
): Promise<Buffer> {
  const fmt = options.outputFormat === 'ogg' ? 'ogg' : 'mp3';
  const master = options.masterAudio !== false;
  const tmpBase = `cardoso_master_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const inPath = path.join(os.tmpdir(), `${tmpBase}.wav`);
  const outPath = path.join(os.tmpdir(), `${tmpBase}.${fmt}`);

  try {
    await fs.promises.writeFile(inPath, mixedWavBuffer);
    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inPath).noVideo();
      if (master) {
        cmd.audioFilters(STUDIO_VOICE_MASTER_FILTER);
      }
      if (fmt === 'ogg') {
        cmd
          .audioCodec('libopus')
          .audioBitrate('48k')
          .audioFrequency(48000)
          .audioChannels(1)
          .outputOptions(['-application', 'voip', '-vbr', 'on'])
          .format('ogg');
      } else {
        cmd
          .audioCodec('libmp3lame')
          .audioBitrate('128k')
          .audioFrequency(44100)
          .audioChannels(2)
          .format('mp3');
      }
      cmd.on('end', () => resolve()).on('error', (err) => reject(err)).save(outPath);
    });

    const outBuf = await fs.promises.readFile(outPath);
    if (!outBuf || outBuf.length < 256) {
      throw new Error('Faylka podcast-ka ee mastered-ka ah wuu madhan yahay');
    }
    return outBuf;
  } finally {
    await fs.promises.unlink(inPath).catch(() => {});
    await fs.promises.unlink(outPath).catch(() => {});
  }
}

/**
 * Human Phone-Mic Mastering for single-speaker WhatsApp Voice Note replies:
 * 1. Trims Edge TTS's dead ~400ms leading & trailing silence (`silenceremove`)
 * 2. Adds smooth 6ms fades + ultra-subtle -50dB natural room air (eliminates digital vacuum)
 * 3. Applies warm vocal mic EQ + 12ms micro room reflection + compressor + peak limiter
 * 4. Encodes to strict WhatsApp-native 48kHz Mono Ogg Opus ("OggS")
 */
export async function masterHumanVoiceReplyToOggOpus(rawAudioBuffer: Buffer): Promise<Buffer> {
  if (!rawAudioBuffer || rawAudioBuffer.length < 128) {
    throw new Error('Codka jawaabta wuu madhan yahay');
  }

  const trimmed = await decodeTrimmedMonoPcm48k(rawAudioBuffer);
  if (trimmed.length === 0) {
    throw new Error('Codka la nadiifiyay wuu madhan yahay');
  }

  const sampleRate = 48000;
  const padStart = Math.round(sampleRate * 0.04); // 40ms natural breath lead-in
  const padEnd = Math.round(sampleRate * 0.07); // 70ms natural tail
  const totalLen = padStart + trimmed.length + padEnd;
  const samples = generateStudioRoomToneSamples(totalLen); // ~ -48dB subtle natural air

  // Dial room air down slightly further (-51dB) for intimate phone-mic feel
  for (let i = 0; i < totalLen; i++) {
    samples[i] *= 0.72;
  }

  const fadeSamples = Math.round(sampleRate * 0.006);
  for (let i = 0; i < trimmed.length; i++) {
    let env = 1.0;
    if (i < fadeSamples) env = i / fadeSamples;
    else if (i > trimmed.length - fadeSamples) env = (trimmed.length - i) / fadeSamples;
    samples[padStart + i] += trimmed[i] * env;
  }

  for (let i = 0; i < totalLen; i++) {
    samples[i] = Math.tanh(samples[i] * 0.96);
  }

  const wavBuf = encodePcmWav(samples, sampleRate);
  const tmpBase = `cardoso_human_vn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const inPath = path.join(os.tmpdir(), `${tmpBase}.wav`);
  const outPath = path.join(os.tmpdir(), `${tmpBase}.ogg`);

  const phoneMicFilter =
    'highpass=f=80,equalizer=f=185:t=q:w=1.2:g=2.0,equalizer=f=3100:t=q:w=1.4:g=1.8,aecho=0.8:0.88:12:0.04,acompressor=threshold=-18dB:ratio=2.6:attack=15:release=140:makeup=2,alimiter=limit=0.95';

  try {
    await fs.promises.writeFile(inPath, wavBuf);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .noVideo()
        .audioFilters(phoneMicFilter)
        .audioCodec('libopus')
        .audioBitrate('48k')
        .audioFrequency(48000)
        .audioChannels(1)
        .outputOptions(['-application', 'voip', '-vbr', 'on'])
        .format('ogg')
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(outPath);
    });

    const outBuf = await fs.promises.readFile(outPath);
    if (!outBuf || outBuf.length < 64 || outBuf.slice(0, 4).toString('ascii') !== 'OggS') {
      throw new Error('FFmpeg ma soo saarin fayl OggS sax ah');
    }
    return outBuf;
  } finally {
    await fs.promises.unlink(inPath).catch(() => {});
    await fs.promises.unlink(outPath).catch(() => {});
  }
}
