import { SOMALI_SLANG_MAP } from './somali-dictionary.js';

// Supported language codes.
// 'so'    = Somali        'en' = English     'mixed' = Somali+English code-switch
// 'ar'    = Arabic        'fr' = French      'tr'    = Turkish
// 'other' = Any other language (Gemini will auto-mirror it)
export type DetectedLanguage = 'so' | 'en' | 'mixed' | 'ar' | 'fr' | 'tr' | 'other';

export interface LanguageDetectionResult {
  language: DetectedLanguage;
  confidence: number;
  somaliScore: number;
  englishScore: number;
  normalizedText: string;
  hasSomaliSlang: boolean;
  detectedSlang: string[];
  script: 'latin' | 'arabic' | 'devanagari' | 'cyrillic' | 'other';
}

// Characteristic Somali words (grammatical particles, common verbs, student vocabulary)
const SOMALI_MARKERS = new Set([
  'waxaan', 'waxan', 'waa', 'baa', 'ayaa', 'iyo', 'oo', 'ee', 'ku', 'ka', 'u',
  'la', 'ma', 'ha', 'si', 'haddii', 'hadii', 'markii', 'laakiin', 'laakin',
  'sidee', 'sideen', 'maxaa', 'maxay', 'waa maxay', 'yaa', 'xaggee', 'goorma', 'fadlan',
  'i caawi', 'ii sharax', 'ii faahfaahi', 'ma fahmin', 'ma garanayo', 'i bar', 'qoraa', 'ugu',
  'arday', 'ardayda', 'jaamacad', 'iskuul', 'cashar', 'imtixaan', 'suaal',
  'walaal', 'saaxiib', 'baro', 'barashada', 'shaqo', 'faham', 'talo',
  'saxib', 'qof', 'walba', 'koodh', 'koodhka', 'barnaamij', 'xog', 'galabta',
]);

// Common programming and technical terms that indicate English/tech context
const TECH_AND_ENGLISH_MARKERS = new Set([
  'the', 'is', 'are', 'was', 'were', 'how', 'what', 'why', 'who', 'when', 'where',
  'can', 'could', 'would', 'should', 'help', 'me', 'with', 'explain', 'please',
  'homework', 'study', 'exam', 'programming', 'code', 'error', 'write', 'learn',
  'understand', 'create', 'build', 'difference', 'between', 'best', 'way', 'to',
  'solution', 'guide', 'give', 'show', 'example',
  // Programming languages and tech keywords
  'python', 'javascript', 'js', 'react', 'node', 'nodejs', 'flutter', 'dart',
  'html', 'css', 'sql', 'loop', 'function', 'variable', 'array', 'api', 'database',
  'class', 'object', 'async', 'await', 'algorithm', 'binary', 'search', 'debug',
  'usestate', 'useeffect', 'component', 'props', 'state', 'git', 'github', 'bug',
]);

// Arabic markers — common words
const ARABIC_MARKERS = new Set([
  'من', 'في', 'إلى', 'على', 'هذا', 'هذه', 'مع', 'كيف', 'ما', 'لماذا', 'أين',
  'أنا', 'أنت', 'هو', 'هي', 'نحن', 'هم', 'يا', 'هل', 'لا', 'نعم', 'شكرا',
  'مرحبا', 'السلام', 'عليكم', 'وعليكم', 'عندي', 'عندك', 'تعال', 'ممكن',
  'اريد', 'أريد', 'ساعدني', 'ماذا', 'كيف', 'متى', 'احتاج', 'أحتاج',
]);

// French markers
const FRENCH_MARKERS = new Set([
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'est', 'sont',
  'avec', 'pour', 'dans', 'sur', 'les', 'des', 'une', 'qui', 'que', 'pas',
  'ne', 'se', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'bonjour', 'merci',
  'oui', 'non', 'aussi', 'très', 'mais', 'parce', 'comment', 'quoi', 'quand',
]);

// Turkish markers
const TURKISH_MARKERS = new Set([
  've', 'bir', 'bu', 'için', 'ile', 'değil', 'ama', 'da', 'de', 'ben', 'sen',
  'o', 'biz', 'siz', 'onlar', 'ne', 'nasıl', 'neden', 'kim', 'nerede', 'merhaba',
  'teşekkür', 'evet', 'hayır', 'tamam', 'olur', 'olmaz', 'var', 'yok',
]);

export class LanguageDetector {
  /**
   * Normalizes informal Somali contractions and slang in the student message.
   */
  public normalizeSlang(text: string): { normalized: string; detectedSlang: string[] } {
    let normalized = text;
    const detectedSlang: string[] = [];

    // Check multi-word slang first
    for (const [slang, full] of Object.entries(SOMALI_SLANG_MAP)) {
      const regex = new RegExp(`\\b${slang}\\b`, 'gi');
      if (regex.test(normalized)) {
        detectedSlang.push(slang);
        normalized = normalized.replace(regex, full);
      }
    }

    return { normalized, detectedSlang };
  }

  /**
   * Detects which Unicode script the text predominantly uses.
   */
  private detectScript(text: string): 'latin' | 'arabic' | 'devanagari' | 'cyrillic' | 'other' {
    const arabicCount  = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    const latinCount   = (text.match(/[a-zA-Z]/g) || []).length;
    const devanagari   = (text.match(/[\u0900-\u097F]/g) || []).length;
    const cyrillic     = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const total = arabicCount + latinCount + devanagari + cyrillic;
    if (total === 0) return 'other';
    if (arabicCount / total > 0.4) return 'arabic';
    if (devanagari / total > 0.4) return 'devanagari';
    if (cyrillic / total > 0.4)   return 'cyrillic';
    return 'latin';
  }

  /**
   * Analyzes text and returns the detected language (Somali, English, Arabic, French, Turkish, mixed, or other).
   * Also detects the Unicode script for non-Latin languages.
   */
  public detect(rawText: string): LanguageDetectionResult {
    if (!rawText || rawText.trim().length === 0) {
      return {
        language: 'so',
        confidence: 0.5,
        somaliScore: 0,
        englishScore: 0,
        normalizedText: rawText,
        hasSomaliSlang: false,
        detectedSlang: [],
        script: 'latin',
      };
    }

    // ── Script-based fast detection (non-Latin scripts) ────────────────────────
    const script = this.detectScript(rawText);

    if (script === 'arabic') {
      const { normalized, detectedSlang } = this.normalizeSlang(rawText);
      return { language: 'ar', confidence: 0.97, somaliScore: 0, englishScore: 0,
        normalizedText: normalized, hasSomaliSlang: false, detectedSlang: [], script: 'arabic' };
    }
    if (script === 'devanagari') {
      return { language: 'other', confidence: 0.95, somaliScore: 0, englishScore: 0,
        normalizedText: rawText, hasSomaliSlang: false, detectedSlang: [], script: 'devanagari' };
    }
    if (script === 'cyrillic') {
      return { language: 'other', confidence: 0.95, somaliScore: 0, englishScore: 0,
        normalizedText: rawText, hasSomaliSlang: false, detectedSlang: [], script: 'cyrillic' };
    }

    // ── Latin-script marker scoring ────────────────────────────────────────────
    const { normalized, detectedSlang } = this.normalizeSlang(rawText);
    const words = rawText.toLowerCase().replace(/[^\w\s\u00C0-\u024F-]/g, ' ').split(/\s+/).filter(Boolean);

    let somaliHits  = 0;
    let englishHits = 0;
    let frenchHits  = 0;
    let turkishHits = 0;
    let arabicWordHits = 0;

    for (const w of words) {
      if (SOMALI_MARKERS.has(w) || SOMALI_SLANG_MAP[w])   somaliHits++;
      if (TECH_AND_ENGLISH_MARKERS.has(w))                 englishHits++;
      if (FRENCH_MARKERS.has(w))                           frenchHits++;
      if (TURKISH_MARKERS.has(w))                          turkishHits++;
      if (ARABIC_MARKERS.has(w))                           arabicWordHits++;
    }

    if (detectedSlang.length > 0) somaliHits += detectedSlang.length * 1.5;

    // Arabic words written with Latin transliteration are rare; check Unicode markers first
    if (arabicWordHits >= 2) {
      return { language: 'ar', confidence: 0.85, somaliScore: 0, englishScore: 0,
        normalizedText: normalized, hasSomaliSlang: false, detectedSlang: [], script: 'latin' };
    }

    // French detection (must beat English/Somali by clear margin)
    if (frenchHits >= 2 && frenchHits > somaliHits && frenchHits > englishHits) {
      return { language: 'fr', confidence: Math.min(0.95, 0.6 + frenchHits * 0.08),
        somaliScore: somaliHits, englishScore: englishHits,
        normalizedText: normalized, hasSomaliSlang: false, detectedSlang: [], script: 'latin' };
    }

    // Turkish detection
    if (turkishHits >= 2 && turkishHits > somaliHits && turkishHits > englishHits) {
      return { language: 'tr', confidence: Math.min(0.95, 0.6 + turkishHits * 0.08),
        somaliScore: somaliHits, englishScore: englishHits,
        normalizedText: normalized, hasSomaliSlang: false, detectedSlang: [], script: 'latin' };
    }

    const totalHits = somaliHits + englishHits;
    let language: DetectedLanguage = 'so';
    let confidence = 0.6;

    if (totalHits === 0) {
      language = 'so';
      confidence = 0.5;
    } else if (somaliHits > 0 && englishHits > 0) {
      const ratio = Math.min(somaliHits, englishHits) / Math.max(somaliHits, englishHits);
      if (ratio > 0.25 || (somaliHits >= 1 && englishHits >= 1)) {
        language = 'mixed';
        confidence = 0.85;
      } else if (somaliHits > englishHits) {
        language = 'so';
        confidence = somaliHits / totalHits;
      } else {
        language = 'en';
        confidence = englishHits / totalHits;
      }
    } else if (somaliHits > 0) {
      language = 'so';
      confidence = Math.min(0.95, 0.6 + (somaliHits * 0.1));
    } else {
      language = 'en';
      confidence = Math.min(0.95, 0.6 + (englishHits * 0.1));
    }

    return {
      language, confidence, somaliScore: somaliHits, englishScore: englishHits,
      normalizedText: normalized, hasSomaliSlang: detectedSlang.length > 0,
      detectedSlang, script: 'latin',
    };
  }
}
