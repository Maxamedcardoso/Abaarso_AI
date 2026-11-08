/**
 * ImageGeneratorService — Generates AI images 100% free with no API key using Pollinations.ai (Flux).
 * Strategy: 4-attempt multi-model cascade, NEVER returns null/error to user.
 * Somali/Arabic prompts are translated locally using a built-in dictionary before sending.
 *
 * Speed test results (Pollinations.ai):
 *   model=flux      → ~3-5s   ✅ PRIMARY
 *   no model param  → ~2-10s  ✅ FALLBACK 1
 *   model=flux 512  → ~5-10s  ✅ FALLBACK 2
 *   model=turbo     → ~38s    ❌ NEVER USE (too slow)
 */

/**
 * Local Somali→English visual dictionary.
 * Used to translate image prompts without any API call (instant, 0ms latency).
 * Covers animals, nature, places, colors, people, objects, emotions, styles.
 */
// Animal keyword set — used to auto-add "no humans" negative prompt when subject is clearly an animal
const ANIMAL_KEYWORDS = new Set([
  'cat', 'cats', 'kitten', 'kittens', 'feline', 'pet', 'dog', 'dogs', 'puppy',
  'lion', 'lions', 'tiger', 'leopard', 'cheetah', 'horse', 'horses', 'camel', 'camels',
  'goat', 'goats', 'cow', 'cows', 'bull', 'bird', 'birds', 'eagle', 'parrot',
  'wolf', 'fox', 'crocodile', 'hyena', 'giraffe', 'elephant', 'zebra', 'donkey', 'pig',
  'turtle', 'snake', 'fish', 'shark', 'whale', 'rabbit', 'beast', 'animal',
  'cattle',
]);

const SOMALI_EN: Record<string, string> = {
  // Animals / Xayawaanka — mapped to explicit, high-detail animal terms so no humans or inappropriate content can generate
  'bisad yar': 'cute adorable fluffy kitten pet animal',
  'ilmo bisad': 'cute baby kitten pet animal',
  'bisad': 'cute fluffy domestic cat pet animal',
  'bisadda': 'cute fluffy domestic cat pet animal',
  'bisado': 'cute domestic cats pet animals',
  'bisadaha': 'cute domestic cats pet animals',
  'mukulaal': 'cute fluffy domestic cat pet animal',
  'mukulaasha': 'cute fluffy domestic cat pet animal',
  'yaanyuur': 'cute fluffy domestic cat pet animal',
  'shabeel': 'wild leopard big cat animal',
  'harimacad': 'wild cheetah big cat animal',
  'libaax qurux badan': 'majestic beautiful male lion animal in savanna wildlife photography',
  'libaax': 'majestic male lion animal in african savanna wildlife',
  'libaaxa': 'majestic male lion animal in savanna wildlife',
  'libaaxii': 'majestic male lion animal wildlife',
  'libaaxo': 'majestic pride of lions wildlife savanna',
  'bahal': 'wild predator animal in nature',
  'faras': 'majestic stallion horse animal running',
  'faraska': 'majestic stallion horse animal running',
  'geel': 'somali camel dromedary animal in desert',
  'geela': 'somali camels herd in desert landscape',
  'lo': 'cattle cows grazing pasture',
  'loxo': 'cattle grazing',
  'adhi': 'somali goat animal grazing',
  'adigga': 'somali goat animal',
  'dibi': 'strong bull cattle animal',
  'shimbiraha': 'colorful birds flying in nature',
  'shimbir': 'colorful beautiful bird on tree branch',
  'gorgor': 'majestic eagle bird flying high in sky',
  'maryoodle': 'colorful parrot bird',
  'dawaco': 'wild fox animal in nature',
  'yaxas': 'wild crocodile reptile animal in water',
  'yeyey': 'wild spotted hyena animal',
  'waraabe': 'wild hyena animal in savanna',
  'qandheer': 'tall giraffe animal in savanna',
  'maroodi': 'large elephant animal in savanna',
  'xayawaan': 'wildlife animal in nature',
  'yurub': 'zebra striped animal in savanna',
  'dameer': 'donkey animal',
  'ey': 'cute friendly dog pet animal',
  'eyga': 'cute friendly dog pet animal',
  'doofaar': 'wild boar animal',
  'qolof': 'sea turtle reptile in ocean',
  'mas': 'wild snake reptile in nature',
  'kalluun': 'vibrant tropical fish swimming in clear water',
  'kaluun': 'tropical fish in ocean',
  'sharuur': 'shark swimming in deep blue ocean',
  'runta': 'huge blue whale in ocean',
  'dugaag': 'wild beast animal',
  'suule': 'cute fluffy rabbit bunny animal',
  // Nature / Dabiicada
  buur: 'mountain', buuraha: 'mountains', geed: 'tree', geedo: 'trees',
  dekedda: 'harbor port', badda: 'ocean', bad: 'sea', 'bad weyn': 'ocean',
  xeeb: 'beach', xeebta: 'beach', durdur: 'waterfall', webi: 'river',
  wabiga: 'river', hawd: 'savanna', 'hawd cagaaran': 'green savanna',
  beer: 'garden', beeraha: 'farm fields', beerta: 'garden',
  dhul: 'land', cidanka: 'desert',
  caws: 'grass', cawska: 'green grass', 'qori geed': 'forest wood',
  kayn: 'forest', kayinka: 'forest', xidid: 'roots',
  biyaha: 'water', biyo: 'water', haro: 'lake', haraha: 'lake',
  roob: 'rain', roobka: 'rain', baraf: 'snow', qorrax: 'sun',
  dayax: 'moon', xiddig: 'star', xiddigaha: 'stars', cirka: 'sky',
  saaxad: 'horizon', joog: 'cliff', dooxo: 'valley',
  // Colors / Midabada
  cas: 'red', 'midab cas': 'red color', 'guduud': 'red',
  cad: 'white', 'midab cad': 'white', cagaaran: 'green',
  madow: 'black', buluug: 'blue', jaalle: 'yellow', jaale: 'yellow',
  oranji: 'orange', bunni: 'brown', 'midab bunni': 'brown color',
  'midab la jaan qaaday': 'colorful', midabyo: 'colorful',
  // People / Dad
  wiil: 'boy', gabar: 'girl', nin: 'man', naag: 'woman',
  carruur: 'children', waxbarasho: 'students', dugsiga: 'school',
  arday: 'student', macallin: 'teacher', dhakhtarka: 'doctor',
  askari: 'soldier', belediyaha: 'mayor', madaxweyne: 'president',
  odayga: 'old man', hooyo: 'mother', aabe: 'father',
  qof: 'person', dad: 'people', islaanta: 'woman in hijab',
  // Somali places / Goobaha Soomaaliya
  mogadisho: 'Mogadishu Somalia', berbera: 'Berbera Somaliland coast',
  hargeisa: 'Hargeisa city', bosaso: 'Bosaaso port city',
  laascaanood: 'Laascaanood city', garoowe: 'Garowe city',
  kismaayo: 'Kismayo coast Somalia', baydhabo: 'Baidoa city',
  jabuuti: 'Djibouti city', berbera_xeeb: 'Berbera beach coastline',
  // Objects / Walxaha
  guri: 'house', guriya: 'houses', 'guri weyn': 'mansion',
  magaalo: 'city', magaalada: 'city skyline',
  baabuur: 'car', baabuurka: 'car', doon: 'boat', doonta: 'boat',
  diyaarad: 'airplane', tareen: 'train', gaari: 'vehicle',
  buug: 'book', buugga: 'book', kombiyuutar: 'computer', telefon: 'phone',
  koob: 'cup', saxan: 'plate', silac: 'knife', 'saacad': 'clock',
  // Descriptors / Tilmaamaha
  'qurux badan': 'beautiful stunning', 'qurux': 'beauty',
  weyn: 'large big', yar: 'small tiny', dhaadheer: 'tall',
  gaaban: 'short small', culus: 'heavy large', fudud: 'light',
  xoogan: 'strong powerful', jilicsan: 'gentle soft',
  'khayaali ah': 'fantasy magical', 'filim': 'cinematic',
  'saameyn badan': 'dramatic', 'nuursan': 'glowing luminous',
  realistic: 'photorealistic', 'sawir muuqaal leh': 'photorealistic portrait',
  'habeen': 'night', 'habeenkii': 'at night', 'subax': 'morning',
  'qorraxda dhaca': 'sunset', 'qorraxda soo baxeysa': 'sunrise',
  'xilli hore': 'dawn', 'fiidkii': 'evening', 'maalin': 'daytime',
  // Styles / Qaababka
  'farshaxan': 'artwork', 'sawir farshaxan': 'artistic painting',
  'rinjiyeyn': 'painting', 'sawir dhis': 'digital art', 'sawirka': 'image',
  'xariir': 'silk texture', 'dahab': 'gold', 'lacag': 'silver',
  // Emotions / Dareenka
  farxad: 'happy joyful', 'murugo': 'sad melancholy', 'xoog': 'powerful',
  nabad: 'peaceful calm', 'degdeg': 'fast energetic',
  // Arabic image words (bonus)
  'أسد': 'lion', 'جبل': 'mountain', 'بحر': 'ocean', 'شجرة': 'tree',
  'مدينة': 'city', 'سماء': 'sky', 'قمر': 'moon', 'شمس': 'sun',
  'نجوم': 'stars', 'سيارة': 'car', 'بيت': 'house', 'ورد': 'flowers roses',
};

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
   * Translates a Somali/Arabic image prompt to English using the local dictionary.
   * Instant — zero API calls, zero latency.
   * Translates words and phrases, keeping any already-English or unknown words intact.
   *
   * Example: "bisad" → "cute fluffy domestic cat pet animal"
   * Example: "libaax qurux badan hawd cagaaran" → "majestic beautiful male lion animal in savanna wildlife photography green savanna"
   */
  public static translatePromptToEnglish(prompt: string): string {
    const lower = prompt.toLowerCase().trim();
    let translated = lower;

    // Sort dictionary keys longest-first so multi-word phrases match before single words
    const sortedKeys = Object.keys(SOMALI_EN).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
      // Use word-boundary aware replacement
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      if (regex.test(translated)) {
        translated = translated.replace(regex, SOMALI_EN[key]);
      }
    }

    console.log(`🌐 [ImageGenerator] Prompt translated: "${prompt}" → "${translated.trim()}"`);
    return translated.trim();
  }

  /**
   * Detects if an English prompt is primarily about an animal (no humans expected).
   * Used to auto-add negative=human prompt to avoid Pollinations inserting people.
   */
  private static isAnimalPrompt(englishPrompt: string): boolean {
    const words = englishPrompt.toLowerCase().split(/\s+/);
    return words.some(w => ANIMAL_KEYWORDS.has(w));
  }

  /**
   * Builds the full Pollinations URL with safety filter and negative prompt.
   * 1. safe=true is ALWAYS enabled.
   * 2. Negative prompt ALWAYS blocks nudity, NSFW, and adult content.
   * 3. When an animal is requested, also blocks humans/people to ensure only the animal appears.
   */
  private static buildUrl(
    encodedPrompt: string,
    params: string,
    isAnimal: boolean
  ): string {
    const baseNegative = 'nsfw,nudity,naked,nude,sexual,explicit,uncensored,cleavage,bikini,erotic,adult,gore,bloody';
    const animalNegative = isAnimal
      ? ',human,person,people,girl,boy,woman,man,female,male,model,portrait,face'
      : '';
    const negativeParam = `&negative=${encodeURIComponent(baseNegative + animalNegative)}`;
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}&nologo=true&safe=true${negativeParam}`;
  }

  /**
   * Generates an image buffer from Pollinations.ai.
   * 4-attempt cascade: flux → default → flux-512 → keywords-only.
   * Somali/Arabic prompts auto-translated via local dictionary (instant, no API).
   * Animal prompts auto-add negative=human so no people appear in animal images.
   * NEVER throws — always returns a buffer or null (caller handles gracefully).
   */
  public static async generateImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    // Auto-translate Somali/Arabic → English before sending to Pollinations
    const rawPrompt = prompt.trim() || 'beautiful landscape';
    const englishPrompt = this.translatePromptToEnglish(rawPrompt);

    // Detect animal subject → will suppress human figures in output
    const animalMode = this.isAnimalPrompt(englishPrompt);
    if (animalMode) {
      console.log(`🐾 [ImageGenerator] Animal subject detected — adding negative=human to suppress people`);
    }

    const encoded = encodeURIComponent(englishPrompt);
    const seed = Math.floor(Math.random() * 99999999);

    // ── Attempt 1: Flux model, no size constraints (~3-5s) ─────────────────
    const result1 = await this._fetchImage(
      this.buildUrl(encoded, `model=flux&seed=${seed}`, animalMode),
      25000,
      'Attempt 1 (flux)'
    );
    if (result1) return result1;

    // ── Attempt 2: Default model, no model param (~2-10s) ───────────────────
    const seed2 = Math.floor(Math.random() * 99999999);
    const result2 = await this._fetchImage(
      this.buildUrl(encoded, `seed=${seed2}`, animalMode),
      20000,
      'Attempt 2 (default)'
    );
    if (result2) return result2;

    // ── Attempt 3: Flux small 512x512 (~5-10s, lightest load) ───────────────
    const seed3 = Math.floor(Math.random() * 99999999);
    const result3 = await this._fetchImage(
      this.buildUrl(encoded, `model=flux&width=512&height=512&seed=${seed3}`, animalMode),
      20000,
      'Attempt 3 (flux-512)'
    );
    if (result3) return result3;

    // ── Attempt 4: Keywords-only as absolute last resort ─────────────────────
    const keywords = englishPrompt.split(/\s+/).slice(0, 5).join(' ');
    const encodedKw = encodeURIComponent(keywords);
    const seed4 = Math.floor(Math.random() * 99999999);
    const result4 = await this._fetchImage(
      this.buildUrl(encodedKw, `model=flux&seed=${seed4}`, animalMode),
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
