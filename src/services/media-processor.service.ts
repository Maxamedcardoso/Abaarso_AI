import { Readable } from 'stream';

export interface UnwrappedWhatsAppMessage {
  /** The inner proto.IMessage object with viewOnce / ephemeral wrappers peeled off */
  message: any;
  /** Primary content key (e.g. 'audioMessage', 'imageMessage', 'videoMessage', 'ptvMessage', 'documentMessage') */
  msgType: string;
  /** True if the message was sent as WhatsApp View Once ("one-click" / 1️⃣) */
  isViewOnce: boolean;
  /** Normalized media category for AdvisorEngine & Gemini multimodal */
  mediaKind: 'audio' | 'image' | 'video' | 'document' | null;
  /** Exact Baileys downloadContentFromMessage stream type */
  baileysMediaType: 'audio' | 'image' | 'video' | 'document' | 'sticker' | null;
  /** The inner media payload object (audioMessage, imageMessage, videoMessage, etc.) */
  mediaContent: any | null;
}

/**
 * MediaProcessorService — Downloads WhatsApp media (including View Once / "one-click" 1️⃣
 * voice notes, photos, and videos) and converts to base64 for Gemini multimodal
 * (Vision + Audio + Video) analysis. 100% free.
 */
export class MediaProcessorService {
  /**
   * Unwraps nested WhatsApp message containers (viewOnceMessage, viewOnceMessageV2,
   * viewOnceMessageV2Extension, ephemeralMessage, documentWithCaptionMessage, editedMessage)
   * and reliably extracts the primary content type even when messageContextInfo is key [0].
   */
  public static unwrapMessage(rawMessage: any): UnwrappedWhatsAppMessage {
    let current = rawMessage;
    let isViewOnce = false;

    for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
      if (current.viewOnceMessage?.message) {
        isViewOnce = true;
        current = current.viewOnceMessage.message;
        continue;
      }
      if (current.viewOnceMessageV2?.message) {
        isViewOnce = true;
        current = current.viewOnceMessageV2.message;
        continue;
      }
      if (current.viewOnceMessageV2Extension?.message) {
        isViewOnce = true;
        current = current.viewOnceMessageV2Extension.message;
        continue;
      }
      if (current.ephemeralMessage?.message) {
        current = current.ephemeralMessage.message;
        continue;
      }
      if (current.documentWithCaptionMessage?.message) {
        current = current.documentWithCaptionMessage.message;
        continue;
      }
      if (current.editedMessage?.message?.protocolMessage?.editedMessage) {
        current = current.editedMessage.message.protocolMessage.editedMessage;
        continue;
      }
      if (current.editedMessage?.message) {
        current = current.editedMessage.message;
        continue;
      }
      if (current.protocolMessage?.editedMessage) {
        current = current.protocolMessage.editedMessage;
        continue;
      }
      break;
    }

    if (!current || typeof current !== 'object') {
      return {
        message: {},
        msgType: '',
        isViewOnce,
        mediaKind: null,
        baileysMediaType: null,
        mediaContent: null,
      };
    }

    const priorityKeys = [
      'audioMessage',
      'ptvMessage',
      'imageMessage',
      'videoMessage',
      'documentMessage',
      'stickerMessage',
      'contactMessage',
      'contactsArrayMessage',
      'extendedTextMessage',
      'conversation',
    ];

    let msgType = '';
    for (const key of priorityKeys) {
      if (current[key]) {
        msgType = key;
        break;
      }
    }

    if (!msgType) {
      const ignoredMetaKeys = new Set([
        'messageContextInfo',
        'senderKeyDistributionMessage',
        'keepInChatMessage',
      ]);
      const fallbackKey = Object.keys(current).find(k => !ignoredMetaKeys.has(k) && current[k] != null);
      msgType = fallbackKey || Object.keys(current)[0] || '';
    }

    const mediaContent =
      current.audioMessage ||
      current.imageMessage ||
      current.videoMessage ||
      current.ptvMessage ||
      current.documentMessage ||
      current.stickerMessage ||
      null;

    if (mediaContent?.viewOnce === true) {
      isViewOnce = true;
    }

    let mediaKind: 'audio' | 'image' | 'video' | 'document' | null = null;
    let baileysMediaType: 'audio' | 'image' | 'video' | 'document' | 'sticker' | null = null;

    if (msgType === 'audioMessage') {
      mediaKind = 'audio';
      baileysMediaType = 'audio';
    } else if (msgType === 'imageMessage') {
      mediaKind = 'image';
      baileysMediaType = 'image';
    } else if (msgType === 'stickerMessage') {
      mediaKind = 'image';
      baileysMediaType = 'sticker';
    } else if (msgType === 'videoMessage' || msgType === 'ptvMessage') {
      mediaKind = 'video';
      baileysMediaType = 'video';
    } else if (msgType === 'documentMessage') {
      mediaKind = 'document';
      baileysMediaType = 'document';
    }

    return {
      message: current,
      msgType,
      isViewOnce,
      mediaKind,
      baileysMediaType,
      mediaContent,
    };
  }

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
      if (clean.startsWith('video/')) return 'video/mp4';
      if (clean.startsWith('image/')) return clean;
      return clean;
    }

    switch (waMessageType) {
      case 'audioMessage':
        return 'audio/ogg'; // Clean MIME for Gemini API
      case 'videoMessage':
      case 'ptvMessage':
        return 'video/mp4';
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

