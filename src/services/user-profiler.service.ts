/**
 * UserProfiler — Extracts personal information the user voluntarily shares
 * (name, occupation, interests) from their messages.
 * All extraction is regex-based, 100% free, no external API calls.
 */
export class UserProfiler {
  /**
   * Extracts the user's first name if they mention it.
   * Handles Somali ("magacaygu waa X") and English ("my name is X") patterns.
   */
  public static extractName(text: string): string | null {
    const patterns = [
      // Somali
      /magacaygu\s+(?:waa|waxaa\s+la\s+yidhaa|waxaa\s+la\s+dhahaa)\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i,
      /magacaygu\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i,
      /waxaa\s+la\s+ii\s+yidhaa\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i,
      /waxaa\s+la\s+yidhaa\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i,
      // English
      /my\s+name\s+is\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i,
      /(?:call\s+me|i\s+am\s+called|i\s+go\s+by)\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i,
      /(?:i'?m|i\s+am)\s+([A-Z][a-z]{1,29})(?:\s|$|,)/,  // "I'm Ahmed" — capitalized name only
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Filter out common words that are not names
        const stopWords = new Set(['a', 'an', 'the', 'going', 'not', 'just', 'very', 'really', 'student', 'doctor', 'teacher', 'engineer']);
        if (!stopWords.has(name.toLowerCase()) && name.length >= 2) {
          return name.charAt(0).toUpperCase() + name.slice(1);
        }
      }
    }
    return null;
  }

  /**
   * Extracts the user's occupation/profession if they mention it.
   */
  public static extractOccupation(text: string): string | null {
    const patterns = [
      // Somali
      /waxaan\s+ahay\s+([a-zA-ZÀ-ÖØ-öø-ÿ\s]{3,40}?)(?:\.|,|$)/i,
      /shaqadaydu\s+waa\s+([a-zA-ZÀ-ÖØ-öø-ÿ\s]{3,40}?)(?:\.|,|$)/i,
      // English
      /i\s+(?:am\s+a|am\s+an|work\s+as\s+a|work\s+as\s+an|'?m\s+a|'?m\s+an)\s+([a-zA-ZÀ-ÖØ-öø-ÿ\s]{3,40}?)(?:\.|,|$|\s+at\s+)/i,
      /(?:my\s+job|my\s+profession|my\s+career|my\s+work)\s+is\s+([a-zA-ZÀ-ÖØ-öø-ÿ\s]{3,40}?)(?:\.|,|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const occupation = match[1].trim();
        if (occupation.length >= 3 && occupation.length <= 40) {
          return occupation;
        }
      }
    }
    return null;
  }

  /**
   * Merges a new topic/interest keyword into the existing interests string.
   * Keeps the total under 200 characters to avoid bloat.
   */
  public static mergeInterests(existingInterests: string | undefined, newTopics: string[]): string {
    const existing = existingInterests ? existingInterests.split(',').map(s => s.trim()).filter(Boolean) : [];
    const all = [...existing];

    for (const topic of newTopics) {
      const clean = topic.trim().toLowerCase();
      if (clean.length > 1 && !all.some(e => e.toLowerCase() === clean)) {
        all.push(clean);
      }
    }

    // Keep under 200 chars
    let result = all.join(', ');
    while (result.length > 200 && all.length > 1) {
      all.shift(); // remove oldest
      result = all.join(', ');
    }
    return result;
  }

  /**
   * Detects broad topic keywords mentioned in a message for interest tracking.
   */
  public static detectTopics(text: string): string[] {
    const topicMap: Record<string, string> = {
      // Tech
      'python|javascript|java|coding|programming|software|developer|code': 'programming',
      'ai|artificial intelligence|machine learning|robot': 'AI',
      // Science & academia
      'math|xisaab|mathematics|algebra|calculus': 'mathematics',
      'physics|fiziks|chemistry|biology': 'science',
      // Health
      'health|caafimaad|doctor|dhakhtarka|medicine': 'health',
      // Sports
      'football|soccer|basketball|sports|cayaar': 'sports',
      // Business
      'business|business|ganacsi|money|lacag|investment|invest': 'business',
      // Religion
      'quran|quraan|islam|religion|diinta|prayer|salah': 'religion',
      // Travel
      'travel|safar|country|dalka|city': 'travel',
    };

    const detected: string[] = [];
    const lowerText = text.toLowerCase();
    for (const [pattern, topic] of Object.entries(topicMap)) {
      if (new RegExp(pattern, 'i').test(lowerText)) {
        detected.push(topic);
      }
    }
    return detected;
  }
}

