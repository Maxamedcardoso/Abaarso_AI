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

    // Allow comprehensive, full-length voice explanations as requested by user.
    // Up to 2,500 characters allows natural 3-4 minute in-depth voice notes without artificial cutoff.
    if (clean.length > 2500) {
      const sentenceEnd = clean.slice(0, 2500).lastIndexOf('.');
      if (sentenceEnd > 1500) {
        clean = clean.slice(0, sentenceEnd + 1);
      } else {
        clean = clean.slice(0, 2500) + '...';
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

    return new Promise((resolve) => {
      const tts = new MsEdgeTTS();
      let isResolved = false;

      // 60-second timeout to allow full-length, detailed voice notes to stream completely
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
          const { audioStream } = tts.toStream(clean);

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

