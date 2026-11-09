import { Readable } from 'stream';

/**
 * MediaProcessorService — Downloads WhatsApp media and converts to base64
 * for Gemini multimodal (Vision + Audio) analysis. 100% free.
 */
export class MediaProcessorService {
  /**
   * Converts a Node.js Readable stream (from Baileys download) to base64 string.
   */
  public static async streamToBase64(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      stream.on('error', reject);
    });
  }

  /**
   * Returns the correct Gemini-compatible MIME type for a given WhatsApp message type.
   * Strips codec parameters (e.g. "audio/ogg; codecs=opus" -> "audio/ogg")
   * because Gemini API strictly rejects MIME types with parameters!
   */
  public static getMimeType(waMessageType: string, mimetype?: string): string {
    if (mimetype) {
      const clean = mimetype.split(';')[0].trim().toLowerCase();
      if (clean === 'audio/ogg' || clean === 'audio/opus') return 'audio/ogg';
      if (clean === 'audio/mp4' || clean === 'audio/m4a' || clean === 'audio/aac') return 'audio/aac';
      if (clean === 'audio/mp3' || clean === 'audio/mpeg') return 'audio/mp3';
      if (clean.startsWith('audio/')) return 'audio/ogg';
      return clean;
    }

    switch (waMessageType) {
      case 'audioMessage':
      case 'ptvMessage':
        return 'audio/ogg'; // Clean MIME for Gemini API
      case 'imageMessage':
        return 'image/jpeg';
      case 'documentMessage':
        return 'application/pdf';
      case 'stickerMessage':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }
}

