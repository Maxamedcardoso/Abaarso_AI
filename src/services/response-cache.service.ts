interface CacheEntry {
  response: string;
  expiresAt: number;
}

/**
 * ResponseCacheService — Fast in-memory cache for common general knowledge queries.
 * Saves Gemini API quota and provides instant (<5ms) responses for high-volume questions.
 */
export class ResponseCacheService {
  private static cache: Map<string, CacheEntry> = new Map();
  private static DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
  private static MAX_ENTRIES = 500;

  /**
   * Normalizes a prompt to create a deterministic cache key.
   */
  public static normalizeKey(prompt: string, lang: string): string {
    const clean = prompt
      .toLowerCase()
      .replace(/[^\w\s\u00C0-\u024F\u0600-\u06FF]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${lang}:${clean}`;
  }

  /**
   * Retrieves cached response if present and not expired.
   */
  public static get(prompt: string, lang: string): string | null {
    const key = this.normalizeKey(prompt, lang);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  /**
   * Stores a response in the cache with expiration.
   */
  public static set(prompt: string, lang: string, response: string, ttlMs: number = this.DEFAULT_TTL_MS): void {
    if (this.cache.size >= this.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const key = this.normalizeKey(prompt, lang);
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Determines if a query is safe to cache (general queries vs personal/interactive ones).
   */
  public static isCacheable(prompt: string): boolean {
    const lower = prompt.toLowerCase().trim();
    if (lower.length < 4 || lower.length > 250) return false;

    // Do not cache personal profiles, reminders, image generations, or commands
    if (
      /(?:magac|magacaygu|my\s+name|i\s+am|waxaan\s+ahay|xusuusi|remind|sawir|image|picture|!tirtir|!clear)/i.test(lower)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Returns current cache size.
   */
  public static size(): number {
    return this.cache.size;
  }

  /**
   * Clears entire cache.
   */
  public static clear(): void {
    this.cache.clear();
  }
}

