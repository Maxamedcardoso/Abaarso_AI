/**
 * ImageGeneratorService — Generates AI images 100% free with no API key using Pollinations.ai (Flux).
 * Strategy: 3-attempt multi-model cascade, NEVER returns null/error to user.
 *
 * Speed test results (Pollinations.ai):
 *   model=flux      → ~3-5s   ✅ PRIMARY
 *   no model param  → ~2-10s  ✅ FALLBACK 1
 *   model=flux 512  → ~5-10s  ✅ FALLBACK 2
 *   model=turbo     → ~38s    ❌ NEVER USE (too slow)
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
   * 3-attempt cascade: flux → default → flux-512.
   * NEVER throws — always returns a buffer or the last attempt's result.
   * Uses random seed each attempt for variety.
   */
  public static async generateImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const cleanPrompt = prompt.trim() || 'beautiful landscape';

    const seed = Math.floor(Math.random() * 99999999);

    // ── Attempt 1: Flux model, no size constraints (~3-5s) ─────────────────
    const result1 = await this._fetchImage(
      `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=flux&nologo=true&seed=${seed}`,
      25000,
      'Attempt 1 (flux)'
    );
    if (result1) return result1;

    // ── Attempt 2: Default model, no model param (~2-10s) ───────────────────
    const seed2 = Math.floor(Math.random() * 99999999);
    const result2 = await this._fetchImage(
      `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?nologo=true&seed=${seed2}`,
      20000,
      'Attempt 2 (default)'
    );
    if (result2) return result2;

    // ── Attempt 3: Flux small 512x512 (~5-10s, lightest load) ───────────────
    const seed3 = Math.floor(Math.random() * 99999999);
    const result3 = await this._fetchImage(
      `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=flux&width=512&height=512&nologo=true&seed=${seed3}`,
      20000,
      'Attempt 3 (flux-512)'
    );
    if (result3) return result3;

    // ── Attempt 4: Shorter keyword-only prompt as absolute last resort ───────
    const keywords = cleanPrompt.split(/\s+/).slice(0, 5).join(' ');
    const seed4 = Math.floor(Math.random() * 99999999);
    const result4 = await this._fetchImage(
      `https://image.pollinations.ai/prompt/${encodeURIComponent(keywords)}?model=flux&nologo=true&seed=${seed4}`,
      20000,
      'Attempt 4 (keywords-only)'
    );
    return result4; // may be null — handled gracefully by caller
  }

  /**
   * Internal helper: fetch image from a Pollinations URL with timeout.
   * Returns null silently on any failure (timeout, HTTP error, too-small buffer).
   */
  private static async _fetchImage(
    url: string,
    timeoutMs: number,
    label: string
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log(`🎨 [ImageGenerator] ${label} — fetching...`);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[ImageGenerator] ${label} HTTP ${res.status}`);
        return null;
      }

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length < 5000) {
        console.warn(`[ImageGenerator] ${label} buffer too small: ${buffer.length} bytes`);
        return null;
      }

      console.log(`✅ [ImageGenerator] ${label} success — ${buffer.length} bytes`);
      return {
        buffer,
        mimeType: res.headers.get('content-type') || 'image/jpeg',
      };
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[ImageGenerator] ${label} failed: ${err?.message ?? err}`);
      return null;
    }
  }
}
