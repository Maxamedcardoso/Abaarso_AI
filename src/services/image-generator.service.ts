/**
 * ImageGeneratorService — Generates AI images 100% free with no API key using Pollinations.ai (Flux/SDXL).
 */
export class ImageGeneratorService {
  /**
   * Checks if a user's message is asking to generate/draw/create an image.
   */
  public static isImageRequest(text: string): boolean {
    const clean = text.toLowerCase().trim();

    // Short command triggers: @sawir, !sawir, @image, !image
    if (/^(?:@?sawir|!sawir|@?image|!image|@?pic|!pic)\b/i.test(clean)) {
      return true;
    }

    // Somali natural language patterns
    if (
      /(?:ii\s*samee\s*sawir|sawir\s*iiga\s*samee|sawir\s*ii\s*samee|sawir\s*samee|sawir\s*soo\s*saar|sawir\s*sameey)/i.test(clean) ||
      /(?:samee\s*sawir|soo\s*saar\s*sawir|sawir\s*ah\s*oo|sawir\s*ku\s*saabsan|sawirka\s+|sawir\s+noo\s*samee)/i.test(clean) ||
      /(?:sawir\s*iisamee|sawir\s*noosamee|iisamee\s*sawir|noosamee\s*sawir|sawir\s*iiga\s*qaad)/i.test(clean) ||
      /^(?:sawir|sawirka)\s+/i.test(clean)
    ) {
      return true;
    }

    // English patterns
    if (
      /(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|photo|illustration)/i.test(clean) ||
      /(?:can\s+you\s+(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture))/i.test(clean) ||
      /^(?:image|picture|photo)\s+(?:of\s+)?/i.test(clean)
    ) {
      return true;
    }

    // Arabic patterns
    if (
      /(?:انشئ\s+صورة|اصنع\s+صورة|صمم\s+صورة|ارسم\s+صورة|صورة\s+لـ?|صورة\s+عن)/i.test(clean)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extracts the core subject/description of the image request from the message text.
   */
  public static extractPrompt(text: string): string {
    let clean = text.trim();

    // Strip common command triggers and prefixes
    const prefixes = [
      /^(?:@?sawir\b\s*|!sawir\b\s*|@?image\b\s*|!image\b\s*|@?pic\b\s*|!pic\b\s*)/i,
      /^(?:ii\s*samee\s*sawir\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*iiga\s*samee\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*ii\s*samee\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*samee\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*soo\s*saar\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:samee\s*sawir\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:soo\s*saar\s*sawir\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*iisamee\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:iisamee\s*sawir\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*noo\s*samee\s*(?:ah\s*)?(?:oo\s*)?)/i,
      /^(?:sawir\s*(?:ah\s*oo|ku\s*saabsan)\s*)/i,
      /^(?:sawirka\s+|sawir\s+)/i,
      /^(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|photo|illustration)(?:\s+of)?/i,
      /^(?:can\s+you\s+(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture)(?:\s+of)?)/i,
      /^(?:image|picture|photo)\s+(?:of\s+)?/i,
      /^(?:انشئ\s+صورة|اصنع\s+صورة|صمم\s+صورة|ارسم\s+صورة|صورة\s+لـ?)\s*/i,
    ];

    for (const prefix of prefixes) {
      clean = clean.replace(prefix, '').trim();
    }

    return clean.replace(/^[,\s:.-]+/, '').trim();
  }

  /**
   * Generates an image buffer from Pollinations.ai.
   * Uses Flux / SDXL, zero cost, no API keys, with fast-fallback on timeout.
   */
  public static async generateImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return null;

    try {
      const seed = Math.floor(Math.random() * 10000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      console.log(`🎨 [ImageGenerator] Requesting Pollinations image for prompt: "${cleanPrompt.substring(0, 70)}..."`);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        console.warn(`[ImageGenerator] 1024x1024 returned HTTP ${res.status}, retrying fast 768x768...`);
        return await this.fetchFastFallback(cleanPrompt, seed);
      }

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length < 5000) {
        console.warn(`[ImageGenerator] Image buffer too small (${buffer.length} bytes), retrying fallback...`);
        return await this.fetchFastFallback(cleanPrompt, seed);
      }

      console.log(`✅ [ImageGenerator] Image successfully generated: ${buffer.length} bytes`);
      return {
        buffer,
        mimeType: res.headers.get('content-type') || 'image/jpeg',
      };
    } catch (err: any) {
      console.warn(`[ImageGenerator] First attempt failed (${err?.message}), trying fast fallback...`);
      return await this.fetchFastFallback(cleanPrompt);
    }
  }

  private static async fetchFastFallback(prompt: string, existingSeed?: number): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const seed = existingSeed ?? Math.floor(Math.random() * 10000000);
      const fastUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&seed=${seed}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(fastUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return null;

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length < 5000) return null;

      console.log(`✅ [ImageGenerator] Fast fallback image successfully generated: ${buffer.length} bytes`);
      return {
        buffer,
        mimeType: res.headers.get('content-type') || 'image/jpeg',
      };
    } catch (fallbackErr) {
      console.error('[ImageGenerator] Fast fallback also failed:', fallbackErr);
      return null;
    }
  }
}
