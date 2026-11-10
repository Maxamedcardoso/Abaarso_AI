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

  /**
   * Detects whether the user is male or female from their name or explicit self-identification.
   * Returns 'male' | 'female' | 'unknown'.
   * 
   * CRITICAL RULE: When a user writes "abaayo ii sheeg", they are addressing the bot,
   * NOT identifying themselves! Do NOT assume the user is female just because they wrote "abaayo".
   * Only explicit self-identification ("gabadh baan ahay") or verified female names qualify.
   */
  public static detectGender(name?: string, text?: string): 'male' | 'female' | 'unknown' {
    // 1. Check EXPLICIT self-identification in text (not mere address words like 'abaayo ii sheeg')
    if (text) {
      const lowerText = text.toLowerCase();
      // Female self-identification
      if (/\b(gabadh\s+baan\s+ahay|naag\s+baan\s+ahay|anigoo\s+gabadh\s+ah|anigu\s+waxaan\s+ahay\s+gabadh|i\s+am\s+(?:a\s+)?(?:girl|woman|female))\b/i.test(lowerText)) {
        return 'female';
      }
      // Male self-identification
      if (/\b(nin\s+baan\s+ahay|wiil\s+baan\s+ahay|anigoo\s+wiil\s+ah|anigoo\s+nin\s+ah|anigu\s+waxaan\s+ahay\s+(?:wiil|nin)|i\s+am\s+(?:a\s+)?(?:boy|man|male))\b/i.test(lowerText)) {
        return 'male';
      }
    }

    // 2. Check name if available
    if (name) {
      const firstName = name.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (!firstName) return 'unknown';

      const femaleNames = new Set([
        'fadumo', 'faadumo', 'fatima', 'fatuma', 'amina', 'aamina', 'sahra', 'zara', 'hodan', 'maryan',
        'marian', 'xaawo', 'hawo', 'leyla', 'laila', 'layla', 'hani', 'deeqa', 'deqa', 'fardowsa',
        'fardowso', 'asma', 'nimco', 'nimca', 'muna', 'safiya', 'safia', 'samsam', 'zamzam', 'nasra',
        'ruun', 'raxma', 'rahma', 'khadra', 'ubax', 'canab', 'idil', 'hibaaq', 'hibo', 'fartuun',
        'shukri', 'ikraan', 'ikran', 'sacdiyo', 'sadiya', 'suhuur', 'shamsi', 'yasmiin', 'yasmin',
        'falxado', 'kaltuun', 'shankaroon', 'warsan', 'barni', 'barno', 'cibaado', 'saynab', 'zainab',
        'xamdi', 'hamdi', 'naciimo', 'naima', 'najma', 'hinda', 'najax', 'rooda', 'rhoda', 'leylo',
        'sharmuuke', 'sumaya', 'sumayo', 'samira', 'samiiro', 'hafsa', 'marwa', 'salma', 'asmaa'
      ]);

      const maleNames = new Set([
        'maxamed', 'mohamed', 'muhamed', 'ahmed', 'axmed', 'cali', 'ali', 'xasan', 'hassan', 'cabdi',
        'abdi', 'liibaan', 'liban', 'farxan', 'farhan', 'mustafe', 'mustafa', 'jaamac', 'jama', 'yuusuf',
        'yusuf', 'khalid', 'khaalid', 'cumar', 'omar', 'sakariye', 'zakaria', 'zakariya', 'guuleed', 'guleed',
        'sharmarke', 'sharmaarke', 'warsame', 'mahad', 'bile', 'daahir', 'dahir', 'hamse', 'xamze', 'faysal',
        'feisal', 'ibraahim', 'ibrahim', 'ismaciil', 'ismail', 'rooble', 'roble', 'cabdiraxmaan', 'abdirahman',
        'cabdirisaaq', 'abdirizak', 'ayaanle', 'ayanle', 'nasir', 'naasir', 'cabdillahi', 'abdullahi',
        'cabdullaahi', 'khadar', 'muse', 'muuse', 'said', 'siciid', 'saacid', 'yaasiin', 'yasin', 'bashiir',
        'bashir', 'xuseen', 'hussein', 'cusmaan', 'osman', 'cabdinaasir', 'abdinasir', 'cabdifataax',
        'abdifatah', 'cabdishakuur', 'abdishakur', 'cabdiwali', 'abdiwali', 'nuur', 'nur', 'maxamuud',
        'mohamud', 'mahamud', 'ridwaan', 'ridwan', 'mukhtaar', 'mukhtar', 'aadan', 'adan', 'illyaas',
        'ilyas', 'haruun', 'harun', 'tariq', 'sayid', 'sayidcali'
      ]);

      if (femaleNames.has(firstName)) return 'female';
      if (maleNames.has(firstName)) return 'male';
    }

    return 'unknown';
  }
}

