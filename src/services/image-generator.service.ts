/**
 * ImageGeneratorService — Generates AI images 100% free with no API key using Pollinations.ai (Flux/SDXL).
 */
export class ImageGeneratorService {
  /**
   * Checks if a user's message is asking to generate/draw/create an image.
   */
  public static isImageRequest(text: string): boolean {
    const clean = text.toLowerCase().trim();
    // Somali patterns
    if (
      /(?:ii\s+samee\s+sawir|sawir\s+iiga\s+samee|sawir\s+ii\s+samee|sawir\s+samee|sawir\s+soo\s+saar)/i.test(clean) ||
      /(?:samee\s+sawir|soo\s+saar\s+sawir|sawir\s+ah\s+oo|sawir\s+ku\s+saabsan)/i.test(clean)
    ) {
      return true;
    }
    // English patterns
    if (
      /(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|photo|illustration)/i.test(clean) ||
      /(?:can\s+you\s+(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture))/i.test(clean)
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

    // Strip common command prefixes
    const prefixes = [
      /^(?:ii\s+samee\s+sawir\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:sawir\s+iiga\s+samee\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:sawir\s+ii\s+samee\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:sawir\s+samee\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:sawir\s+soo\s+saar\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:samee\s+sawir\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:soo\s+saar\s+sawir\s+(?:ah\s+)?(?:oo\s+)?)/i,
      /^(?:sawir\s+(?:ah\s+oo|ku\s+saabsan)\s+)/i,
      /^(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|photo|illustration)(?:\s+of)?/i,
      /^(?:can\s+you\s+(?:draw|create|generate|make)\s+(?:an?\s+)?(?:image|picture)(?:\s+of)?)/i,
    ];

    for (const prefix of prefixes) {
      clean = clean.replace(prefix, '').trim();
    }

    return clean.replace(/^[,\s:.-]+/, '').trim();
  }

  /**
   * Generates an image buffer from Pollinations.ai.
   * Uses Flux / SDXL, 1024x1024, zero cost, no API keys.
   */
  public static async generateImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const seed = Math.floor(Math.random() * 10000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        console.warn(`[ImageGenerator] Pollinations returned HTTP ${res.status}`);
        return null;
      }

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      return {
        buffer,
        mimeType: res.headers.get('content-type') || 'image/jpeg',
      };
    } catch (err) {
      console.error('[ImageGenerator] Error generating image:', err);
      return null;
    }
  }
}

