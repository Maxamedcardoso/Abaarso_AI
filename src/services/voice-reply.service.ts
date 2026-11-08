import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

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
   * Cleans WhatsApp markdown and formatting before passing to TTS engine.
   */
  public static cleanTextForSpeech(text: string): string {
    let clean = text
      // Remove URLs
      .replace(/https?:\/\/\S+/gi, '')
      // Remove asterisks, underscores, tildes (WhatsApp formatting)
      .replace(/[*_~`]/g, '')
      // Remove bullet points
      .replace(/^[•\-\*]\s+/gm, '')
      // Remove emojis
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      // Collapse multiple newlines/spaces
      .replace(/\s+/g, ' ')
      .trim();

    // Limit length for snappy, fast-loading WhatsApp voice notes (~350 characters max)
    if (clean.length > 350) {
      const sentenceEnd = clean.slice(0, 350).lastIndexOf('.');
      if (sentenceEnd > 150) {
        clean = clean.slice(0, sentenceEnd + 1);
      } else {
        clean = clean.slice(0, 350) + '...';
      }
    }

    return clean;
  }

  /**
   * Synthesizes audio buffer from text.
   * Returns audio MP3 buffer or null on error.
   */
  public static async synthesizeVoice(text: string, language: string = 'so'): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const clean = this.cleanTextForSpeech(text);
    if (!clean) return null;

    const voiceName = language === 'en' ? 'en-US-ChristopherNeural' : 'so-SO-MuuseNeural';

    return new Promise((resolve) => {
      const tts = new MsEdgeTTS();
      let isResolved = false;

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try { tts.close(); } catch {}
          resolve(null);
        }
      }, 15000);

      (async () => {
        try {
          await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
          const { audioStream } = tts.toStream(clean);

          const chunks: Buffer[] = [];
          audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));

          audioStream.on('end', () => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              try { tts.close(); } catch {}
              const buffer = Buffer.concat(chunks);
              resolve({ buffer, mimeType: 'audio/mp4' });
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

