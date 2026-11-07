import { SOMALI_SLANG_MAP } from './somali-dictionary.js';

export type DetectedLanguage = 'so' | 'en' | 'mixed';

export interface LanguageDetectionResult {
  language: DetectedLanguage;
  confidence: number;
  somaliScore: number;
  englishScore: number;
  normalizedText: string;
  hasSomaliSlang: boolean;
  detectedSlang: string[];
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
   * Analyzes text and returns whether it is Somali, English, or Mixed code-switching.
   */
  public detect(rawText: string): LanguageDetectionResult {
    if (!rawText || rawText.trim().length === 0) {
      return {
        language: 'so', // Default to Somali for empty or minimal inputs
        confidence: 0.5,
        somaliScore: 0,
        englishScore: 0,
        normalizedText: rawText,
        hasSomaliSlang: false,
        detectedSlang: [],
      };
    }

    const { normalized, detectedSlang } = this.normalizeSlang(rawText);
    const words = rawText.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean);

    let somaliHits = 0;
    let englishHits = 0;

    // Check against vocabulary markers
    for (const w of words) {
      if (SOMALI_MARKERS.has(w) || SOMALI_SLANG_MAP[w]) {
        somaliHits++;
      }
      if (TECH_AND_ENGLISH_MARKERS.has(w)) {
        englishHits++;
      }
    }

    // Boost Somali score if Somali greetings or slang were detected
    if (detectedSlang.length > 0) {
      somaliHits += detectedSlang.length * 1.5;
    }

    const totalHits = somaliHits + englishHits;
    let language: DetectedLanguage = 'so';
    let confidence = 0.6;

    if (totalHits === 0) {
      // Fallback: If no markers found, check letter combinations or default
      language = 'so';
      confidence = 0.5;
    } else if (somaliHits > 0 && englishHits > 0) {
      // Both languages present in significant amounts -> Mixed code-switching!
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
      language,
      confidence,
      somaliScore: somaliHits,
      englishScore: englishHits,
      normalizedText: normalized,
      hasSomaliSlang: detectedSlang.length > 0,
      detectedSlang,
    };
  }
}
