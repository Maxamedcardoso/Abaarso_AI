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
 * - Gentle broadcast compressor + brickwall peak limiter (zero clipping)
 */
export const STUDIO_VOICE_MASTER_FILTER =
  'highpass=f=75,equalizer=f=180:t=q:w=1.2:g=2.2,equalizer=f=3200:t=q:w=1.4:g=2.0,acompressor=threshold=-18dB:ratio=2.8:attack=15:release=140:makeup=2,alimiter=limit=0.95';

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

/**
 * Synthesizes a warm, modern, broadcast-quality Podcast Intro / Outro Studio Chime
 * (soft Rhodes/marimba harmonic chord progression, zero copyright, zero network).
 */
export function createStudioChimeWav(kind: 'intro' | 'outro', sampleRate: number = 48000): Buffer {
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
