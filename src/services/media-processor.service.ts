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
   */
  public static getMimeType(waMessageType: string, mimetype?: string): string {
    // If Baileys already reports the mime type, use it
    if (mimetype) return mimetype;

    switch (waMessageType) {
      case 'audioMessage':
        return 'audio/ogg; codecs=opus'; // WhatsApp voice notes
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

