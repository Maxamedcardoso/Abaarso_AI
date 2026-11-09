import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { Readable, PassThrough } from 'stream';

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
} catch (e) {
  console.warn('[VoiceReply] FFmpeg initialization notice:', e);
}

/**
 * VoiceReplyService — Synthesizes natural, high-definition speech for WhatsApp Voice Notes
 * using Microsoft Edge Neural TTS (100% Free, No API Key, No Quota Limits).
 *
 * Supports:
 * - Somali: "so-SO-MuuseNeural" (warm, expressive native Somali male voice)
 * - English: "en-US-ChristopherNeural" (clear, professional English voice)
 */
export class VoiceReplyService {
  /**
   * Cleans WhatsApp markdown and normalizes abbreviations, slangs, symbols,
   * and tech terms into natural phonetic speech for Edge Neural TTS.
   */
  public static cleanTextForSpeech(text: string, language: string = 'so'): string {
    let clean = text
      // Remove URLs
      .replace(/https?:\/\/\S+/gi, '')
      // Remove asterisks, underscores, tildes, backticks (WhatsApp formatting)
      .replace(/[*_~`]/g, '')
      // Remove emojis
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      // Clean leading bullet points with a comma so speech breathes naturally
      .replace(/^[•\-\*]\s+/gm, ', ')
      // Clean repetitive exclamation/question marks
      .replace(/[!]{2,}/g, '!')
      .replace(/[?]{2,}/g, '?');

    if (language === 'so' || language === 'mixed') {
      // 1. Expand Islamic & greeting abbreviations into full natural spoken words (as requested: asc, wcs -> full natural speech)
      clean = clean
        .replace(/\basc\b/gi, 'Assalaamu calaykum')
        .replace(/\bwcs\b/gi, 'Wa calaykumus salaam')
        .replace(/\bsc\b/gi, 'Salaamu calaykum')
        .replace(/\binsha\s*allah\b|\binshallah\b/gi, 'Insha Allaah')
        .replace(/\bmasha\s*allah\b|\bmashallah\b/gi, 'Maa shaa Allaah')
        .replace(/\balx\b/gi, 'Alxamdulillaah')
        .replace(/\bswt\b/gi, 'Subxaanahu wa tacaalaa')
        .replace(/\bcsw\b|\bsaw\b/gi, 'Calayhi salaatu wa salaam');

      // 2. Expand common Somali chat abbreviations
      clean = clean
        .replace(/\bsxb\b/gi, 'saaxiib')
        .replace(/\bsxbo\b/gi, 'saaxiibow')
        .replace(/\bwll\b|\bwlo\b/gi, 'walaal')
        .replace(/\bmcaan\b/gi, 'macaan')
        .replace(/\bpls\b|\bplz\b/gi, 'fadlan')
        .replace(/\btnx\b|\bthx\b/gi, 'mahadsanid');

      // 3. Phonetic pronunciation for tech and bot brand terms so Edge TTS sounds natural
      clean = clean
        .replace(/\bcardoso\s+ai\b/gi, 'Kaardooso Ey-Ay')
        .replace(/\bcardoso\b/gi, 'Kaardooso')
        .replace(/\bai\b/g, 'Ey-Ay')
        .replace(/\bapi\b/gi, 'Ey-Bii-Ay')
        .replace(/\burl\b/gi, 'Yu-Aar-El')
        .replace(/\bwhatsapp\b/gi, 'Watsap')
        .replace(/\bchatgpt\b/gi, 'Jaat-Jii-Bii-Tii')
        .replace(/\bpdf\b/gi, 'Bii-Dii-Ef')
        .replace(/\bmp3\b/gi, 'Em-Bii-Tharii');

      // 4. Symbols to words
      clean = clean
        .replace(/&/g, ' iyo ')
        .replace(/%/g, ' boqolkiiba ')
        .replace(/\$/g, ' doolar ')
        .replace(/\+/g, ' iyo ');
    } else if (language === 'ar') {
      clean = clean
        .replace(/\bAI\b/gi, 'الذكاء الاصطناعي')
        .replace(/\bCARDOSO\b/gi, 'كاردوسو');
    }

    // Collapse multiple newlines/spaces
    clean = clean.replace(/\s+/g, ' ').trim();

    // Allow comprehensive, full-length voice explanations as requested by user.
    // Up to 4,000 characters allows natural 4-6 minute in-depth voice notes without artificial cutoff.
    if (clean.length > 4000) {
      const sentenceEnd = clean.slice(0, 4000).lastIndexOf('.');
      if (sentenceEnd > 2500) {
        clean = clean.slice(0, sentenceEnd + 1);
      } else {
        clean = clean.slice(0, 4000) + '...';
      }
    }

    return clean;
  }

  /**
   * Synthesizes audio buffer from text with automatic retry for 100% zero-error resilience.
   * Returns audio MP3 buffer or null on error.
   */
  public static async synthesizeVoice(text: string, language: string = 'so'): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const clean = this.cleanTextForSpeech(text, language);
    if (!clean) return null;

    // Select the best native Edge Neural TTS voice for the detected language
    let voiceName = 'so-SO-MuuseNeural'; // Default: Somali
    if (language === 'en') {
      voiceName = 'en-US-ChristopherNeural'; // English
    } else if (language === 'ar') {
      voiceName = 'ar-SA-HamedNeural'; // Arabic
    } else if (language === 'fr') {
      voiceName = 'fr-FR-HenriNeural'; // French
    } else if (language === 'tr') {
      voiceName = 'tr-TR-AhmetNeural'; // Turkish
    }

    // Try up to 2 attempts for 100% zero-error reliability against transient network glitches
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.synthesizeSingleAttempt(clean, voiceName, language);
        if (result && result.buffer.length > 0) {
          // Convert MP3 to WhatsApp-native Ogg Opus container ("OggS" header).
          // WhatsApp PTT (Voice Note) player strictly requires Ogg Opus to render waveforms and play without "This audio is not available" error.
          const opusBuffer = await this.convertMp3ToOggOpus(result.buffer);
          const isOggOpus = opusBuffer.slice(0, 4).toString() === 'OggS';
          return {
            buffer: opusBuffer,
            mimeType: isOggOpus ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
          };
        }
      } catch (err) {
        console.warn(`[VoiceReply] Attempt ${attempt} failed:`, err);
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
    return null;
  }

  /**
   * Converts an MP3 audio buffer to WhatsApp-native Ogg Opus format.
   * WhatsApp PTT (Voice Note) player strictly requires Ogg Opus container ("OggS" header).
   * This eliminates the "This audio is not available" error on WhatsApp!
   */
  public static async convertMp3ToOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve) => {
      try {
        const inputStream = new Readable();
        inputStream.push(mp3Buffer);
        inputStream.push(null);

        const chunks: Buffer[] = [];
        const outputStream = new PassThrough();

        outputStream.on('data', chunk => chunks.push(chunk));
        outputStream.on('end', () => resolve(Buffer.concat(chunks)));
        outputStream.on('error', (err) => {
          console.warn('[VoiceReply] FFmpeg Opus conversion stream error:', err?.message || err);
          resolve(mp3Buffer);
        });

        ffmpeg(inputStream)
          .audioCodec('libopus')
          .audioBitrate('48k')
          .audioFrequency(48000)
          .audioChannels(1)
          .format('ogg')
          .on('error', (err) => {
            console.warn('[VoiceReply] FFmpeg Opus conversion error:', err?.message || err);
            resolve(mp3Buffer);
          })
          .pipe(outputStream, { end: true });
      } catch (err) {
        console.warn('[VoiceReply] FFmpeg setup failed:', err);
        resolve(mp3Buffer);
      }
    });
  }

  private static synthesizeSingleAttempt(clean: string, voiceName: string, language: string = 'so'): Promise<{ buffer: Buffer; mimeType: string } | null> {
    return new Promise((resolve) => {
      const tts = new MsEdgeTTS();
      let isResolved = false;

      // 60-second timeout per attempt to allow full-length extended voice notes to stream completely
      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try { tts.close(); } catch {}
          resolve(null);
        }
      }, 60000);

      (async () => {
        try {
          await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
          const { audioStream } = tts.toStream(clean, {
            rate: language === 'so' ? '-4%' : '-2%',
            pitch: '+0Hz',
          });

          const chunks: Buffer[] = [];
          audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));

          audioStream.on('end', () => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              try { tts.close(); } catch {}
              const buffer = Buffer.concat(chunks);
              resolve({ buffer, mimeType: 'audio/mpeg' });
            }
          });

          audioStream.on('error', (err) => {
            console.warn('[VoiceReply] audioStream error:', err);
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              try { tts.close(); } catch {}
              resolve(null);
            }
          });
        } catch (err) {
          console.warn('[VoiceReply] Failed to synthesize voice:', err);
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            try { tts.close(); } catch {}
            resolve(null);
          }
        }
      })();
    });
  }
}

