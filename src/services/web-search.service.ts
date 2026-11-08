/**
 * WebSearchService — 100% Free, Zero-Cost Real-Time Web Search.
 * Fetches verified live web snippets without requiring any paid API keys.
 */
export class WebSearchService {
  private static SEARCH_TRIGGER_PATTERNS = [
    /\b(maanta|shalay|xalay|hadda|wakhtigan)\b/i,
    /\b(latest|current|news|breaking|update|today|yesterday|tonight)\b/i,
    /\b(wararka|warka|dhacdooyinka|heshiiska)\b/i,
    /\b(cayaar(ta)?|ciyaar(ta)?|match|score|natiijad(a|ii)|koobka|champions league|premier league|laliga)\b/i,
    /\b(sarifka|qiimaha|dollar|zaad|edahab|sahal|shilin)\b/i,
    /\b(weather|cimilada|roobka|kulaylka)\b/i,
    /\b(who won|yaa badiyay|yaa ku guulaystay)\b/i,
  ];

  /**
   * Determines if a user query requires real-time web retrieval.
   */
  public static shouldSearch(query: string): boolean {
    const clean = query.trim().toLowerCase();
    // Do not search for casual greetings or bot status commands
    if (/^(asc|wcs|salaan|iwaran|iska warran|hi|hello|who are you|yaa ku sameeyey)/i.test(clean)) {
      return false;
    }
    return this.SEARCH_TRIGGER_PATTERNS.some(pattern => pattern.test(clean));
  }

  /**
   * Performs an ultra-fast live search and returns top snippets.
   * Gracefully falls back to empty array if network is offline.
   */
  public static async search(query: string, maxSnippets: number = 3): Promise<string[]> {
    try {
      const cleanQuery = query
        .replace(/@(cardoso|abaarso|abarso)\b/gi, '')
        .replace(/^[!/]\w+\s*/, '')
        .trim();

      if (!cleanQuery) return [];

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5 second max limit

      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const matches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
      
      const snippets = matches
        .map(m => m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()
        )
        .filter(s => s.length > 20)
        .slice(0, maxSnippets);

      return snippets;
    } catch {
      // Offline, network sandbox, or timeout — return empty array safely
      return [];
    }
  }
}

