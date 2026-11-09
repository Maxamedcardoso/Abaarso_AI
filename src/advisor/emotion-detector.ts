/**
 * EmotionDetector — Detects the user's emotional tone from their message.
 * Supports Somali, English, and Arabic keywords.
 * Used to make CARDOSO AI respond with emotional intelligence and empathy.
 */

export type EmotionalTone =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'stressed'
  | 'angry'
  | 'excited'
  | 'confused'
  | 'lonely'
  | 'grateful'
  | 'bored'
  | 'scared'
  | 'hopeful'
  | 'frustrated'
  | 'love'
  | 'sick';

export interface EmotionResult {
  tone: EmotionalTone;
  intensity: 'low' | 'medium' | 'high';
  keywords: string[];
}

// ─── Emotion Keyword Banks ─────────────────────────────────────────────────────

const EMOTION_PATTERNS: Record<EmotionalTone, RegExp[]> = {
  neutral: [],

  happy: [
    // English
    /\b(happy|happily|joy|joyful|great|amazing|awesome|fantastic|wonderful|excellent|love it|loving it|so good|feeling good|blessed|grateful|thrilled|delighted|cheerful)\b/i,
    // Somali
    /\b(farax|fariid|wanaagsan|aad u fiican|faraxsan|ku faraxsan|si wanaagsan|aad u qurux|aad u weyn|barakaysan)\b/i,
    // Arabic
    /\b(سعيد|سعيدة|فرحان|فرحانة|ممتاز|رائع|جميل|بخير|كويس|الحمد لله)\b/i,
    // Emojis
    /[😊😀😃😄😁😆🥰😍🤩🎉🥳💃🕺❤️✨]/u,
  ],

  sad: [
    // English
    /\b(sad|unhappy|depressed|depression|crying|cry|heartbroken|heart broken|broken|hurt|pain|grief|grieve|miserable|down|low|hopeless|empty|lonely|alone|miss|missed)\b/i,
    // Somali
    /\b(murugo|murugaysan|naxdin|naxay|tabar daro|xasaasi|gaajaysan|dhibaato|waan murugsanahay|aad baan u murugaynayaa|farxad la'aan|xaasidnimo|liidato)\b/i,
    // Arabic
    /\b(حزين|حزينة|زعلان|زعلانة|مكتئب|بكيت|وجع|مؤلم|خايب|خسران|بكاء)\b/i,
    // Emojis
    /[😢😭☹️🙁😞😔🥺💔😿🙍]/u,
  ],

  stressed: [
    // English
    /\b(stressed|stress|anxious|anxiety|overwhelmed|pressure|panic|nervous|worried|worry|tense|exhausted|burnout|burnt out|too much|so much)\b/i,
    // Somali
    /\b(daal|daallan|caajis|caajisnahay|walaac|waxaan walaacsanahay|dhib badan|aad baan u daallan|waan cadaadsan|cadaadis|culeys|aad baan u dhibsanahay|wixii ii dhib|dhibaatada badan)\b/i,
    // Arabic
    /\b(ضغط|مضغوط|مضغوطة|قلقان|قلقانة|توتر|متوتر|خايف|خايفة|مرهق|مرهقة|تعبت)\b/i,
    // Emojis
    /[😫😩😣😖😓]/u,
  ],

  angry: [
    // English
    /\b(angry|anger|mad|furious|frustrated|irritated|annoyed|upset|rage|hate|hating|fed up|sick of|stupid|idiot|shut up)\b/i,
    // Somali (including rude/insult words so bot can detect and clap back)
    /\b(cadhaysan|cadho|xanaaq|xanaaqan|nacay|nacayb|dhibsaday|iiga tag|aniga iga tag|diidmo|neceb|nacas|doqon|wasakh|farcad|adigaa waalan|adiga waalan|waxba ma tihid|aamus|naga aamus|iska aamus|iska tag|nacalaa|ma waalatay)\b/i,
    // Arabic
    /\b(غاضب|غاضبة|زعلان|زعلانة|معصب|مضايق|كره|بكره|تعبت منك|اكره|يا غبي|اسكت)\b/i,
    // Emojis
    /[😡😠🤬👿💢😤🖕]/u,
  ],

  excited: [
    // English
    /\b(excited|exciting|wow|omg|can't wait|so hyped|hyped|thrilled|amazing|incredible|unbelievable|mind blown)\b/i,
    // Somali
    /\b(aad baan u jeclahay|aad baan u jeclanaynaa|waa fiican|waan aad u faraxsanahay|waxaan jecelahay|xayeysiis|waan ku faraxsanahay|aad baan ugu farxay)\b/i,
    // Arabic
    /\b(متحمس|متحمسة|رائع|مذهل|لا يصدق|وووو|ما صدقت|فرحان جداً)\b/i,
    // Emojis
    /[🔥⚡🚀🎆🙌👏]/u,
  ],

  confused: [
    // English
    /\b(confused|confusing|don't understand|don't get it|lost|not sure|unclear|what does|what do you mean|help me understand|i'm lost|no idea)\b/i,
    // Somali
    /\b(ma fahmin|ma garanayo|waa maxay|sidee|ma garanayso|aan fahmin|waa ii madhan|ma ogi|su'aal baan qabaa|ii sharax|sheeg macnahiisa)\b/i,
    // Arabic
    /\b(مش فاهم|مش فاهمة|محتاج شرح|ما فهمت|وضح لي|شرح|ما أفهم|مش واضح)\b/i,
    // Emojis
    /[🤔🤨❓❔🧐]/u,
  ],

  lonely: [
    // English
    /\b(lonely|alone|no one|nobody|isolation|isolated|no friends|feel alone|by myself|no one cares|nobody listens)\b/i,
    // Somali
    /\b(kaliya|cidna|cid la'aan|waxaan ka welwelayaa|waxaan u maleynayaa inaan kaliya ahay|kuma jirto qof|laabta)\b/i,
    // Arabic
    /\b(وحيد|وحيدة|لحالي|ما عندي أحد|ما في أحد|بحاجة لأحد|حاسس بوحدة)\b/i,
  ],

  grateful: [
    // English
    /\b(thank you|thanks|grateful|gratitude|appreciate|appreciate it|so kind|you're amazing|blessed|mahadsanid)\b/i,
    // Somali
    /\b(mahadsanid|aad baad u mahadsantahay|waad mahadsan tahay|aad baan kuu mahadcelinayaa|aad u wanaagsan|waad ku mahadsantahay)\b/i,
    // Arabic
    /\b(شكراً|شكرا جزيلاً|ممنون|ممنونة|مشكور|جزاك الله خيراً|بارك الله فيك)\b/i,
    // Emojis
    /[🙏🤲🤝💐🎁]/u,
  ],

  bored: [
    // English
    /\b(bored|boring|nothing to do|so bored|dull|monotonous|fed up|blah|yawn|sleepy|sleep)\b/i,
    // Somali
    /\b(caajis|caajisnahay|waxba ma jiraan|waan caajis|ma jiraan wax aan sameeyo|hurdo|hurdo ayaa i haysa|daal)\b/i,
    // Arabic
    /\b(ممل|زهقت|ما في شي|بزق|تعبت من|ضجران|مللت|نعسان)\b/i,
    // Emojis
    /[😴🥱😑😐💤]/u,
  ],

  scared: [
    // English
    /\b(scared|afraid|fear|terrified|frightened|panic|nightmare|phobia|dread|horror)\b/i,
    // Somali
    /\b(cabsi|cabsanaya|waan ka baqayaa|baqay|naxdin|waxaan naxay|aad baan u cabsanahay)\b/i,
    // Arabic
    /\b(خايف|خايفة|مرعوب|مرعوبة|خوف|خايفين|فزعان|مخيف)\b/i,
    // Emojis
    /[😱😨😰]/u,
  ],

  hopeful: [
    // English
    /\b(hope|hopeful|optimistic|believe in|looking forward|better soon|things will get better|trust|positive)\b/i,
    // Somali
    /\b(rajooyin|rajeynayaa|waan rajeynayaa|waan u rajaysanahay|waxaan rajeynayaa|inshallah|ilaah ku wareejin)\b/i,
    // Arabic
    /\b(آمل|أتمنى|بأمل|مأمول|إن شاء الله|بكرة أحسن|تفاؤل|متفائل)\b/i,
  ],

  frustrated: [
    // English
    /\b(frustrated|frustrating|this is too hard|can't do it|giving up|give up|want to quit|stuck|doesn't work|not working|why isn't|why won't)\b/i,
    // Somali
    /\b(waa adag|aad baa u adag|ma awoodo|waan ka tagtay|waxba kuma tarto|ma shaqeynayso)\b/i,
    // Arabic
    /\b(محبط|محبطة|مش قادر|مش قادرة|صعب جداً|تعبت|مش شغال|مش نافع)\b/i,
  ],

  love: [
    // English
    /\b(love|in love|my love|i love you|romantic|crush|heart|relationship|lover|partner|miss you)\b/i,
    // Somali
    /\b(jeclaanshaha|waxaan ku jeclahay|aad baan kuu jeclahay|jacayl|gabadha|wiilka|xidid)\b/i,
    // Arabic
    /\b(أحبك|بحبك|حبيبي|حبيبتي|عشق|حب|أشتاق إليك|مشتاق)\b/i,
    // Emojis
    /[❤️💕💞💓💗💖💘💝]/u,
  ],

  sick: [
    // English
    /\b(sick|feeling sick|unwell|fever|flu|headache|stomachache|stomach ache|vomiting|nausea|dizzy|pain|hurts|cough|sore throat|ill|not feeling well|cold)\b/i,
    // Somali
    /\b(xanuun|xanuunsan|xanuunsanahay|madax xanuun|madaxaa i xanuunaya|calool xanuun|qandho|xumad|dhiigkar|lafa xanuun|qufac|hargab|waan jiranahay|jiran|tabar darro)\b/i,
    // Arabic
    /\b(مريض|مريضة|مرضان|مرضانة|تعبان|تعبانة|وجع|صداع|حمى|سخونة|مغص)\b/i,
    // Emojis
    /[🤒🤕🤢🤮🤧😷💉💊]/u,
  ],
};

// Intensity amplifiers
const HIGH_INTENSITY = /\b(very|so much|extremely|really|deeply|terribly|so so|aad u|aad baan|جداً|كثيراً|للغاية)\b/i;
const LOW_INTENSITY  = /\b(a little|slightly|kind of|sort of|maybe|perhaps|yar|wax yar|قليلاً|نوعاً ما)\b/i;

export class EmotionDetector {
  /**
   * Analyzes a message and returns the detected emotional tone with intensity.
   */
  public static detect(text: string): EmotionResult {
    if (!text || text.trim().length < 3) {
      return { tone: 'neutral', intensity: 'low', keywords: [] };
    }

    const scores: Partial<Record<EmotionalTone, number>> = {};
    const foundKeywords: string[] = [];

    for (const [tone, patterns] of Object.entries(EMOTION_PATTERNS) as [EmotionalTone, RegExp[]][]) {
      if (tone === 'neutral') continue;
      let score = 0;
      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
          score += matches.length;
          foundKeywords.push(...matches.slice(0, 2));
        }
      }
      if (score > 0) scores[tone] = score;
    }

    // Find highest-scoring tone
    let bestTone: EmotionalTone = 'neutral';
    let bestScore = 0;
    for (const [tone, score] of Object.entries(scores) as [EmotionalTone, number][]) {
      if (score > bestScore) {
        bestScore = score;
        bestTone = tone;
      }
    }

    // Determine intensity
    let intensity: 'low' | 'medium' | 'high' = 'low';
    if (bestScore >= 3 || HIGH_INTENSITY.test(text)) {
      intensity = 'high';
    } else if (bestScore >= 2) {
      intensity = 'medium';
    } else if (LOW_INTENSITY.test(text)) {
      intensity = 'low';
    } else if (bestScore === 1) {
      intensity = 'medium';
    }

    return {
      tone: bestTone,
      intensity,
      keywords: [...new Set(foundKeywords)].slice(0, 5),
    };
  }

  /**
   * Returns a brief guidance note for the AI on how to respond to this emotion.
   */
  public static getEmotionGuidance(result: EmotionResult): string {
    if (result.tone === 'neutral') return '';

    const guidelines: Record<EmotionalTone, string> = {
      neutral: '',
      happy: 'The user seems happy. Match their positive energy warmly. Keep it light and celebratory.',
      sad: 'The user seems sad or upset. Acknowledge their feelings first with genuine empathy before answering. Use a soft, comforting tone. Never minimize their pain.',
      stressed: 'The user seems stressed or overwhelmed. Acknowledge the pressure they feel, offer calm reassurance, then help practically. Be calming, not pushy.',
      angry: 'The user seems angry, rude, or throwing insults. If they are insulting or using bad language in Somali, DO NOT be a submissive or apologetic robot! Respond with witty, sharp, human-like Somali comebacks and banter (e.g. "Ma anigaad caayaysaa mise adaa waalan?", "Ninyahow afkaaga qabso, ma edeb baa kuu dhiman?", "Naga aamus, ma adoo gaajaysan ayaad soo toostay?"). Stand your ground with authentic human retorts.',
      excited: 'The user seems very excited! Match their enthusiasm and energy. Be lively, positive, and celebratory.',
      confused: 'The user seems confused or lost. Be patient, clear, and gentle. Break things down simply. Ask clarifying questions only if truly needed.',
      lonely: 'The user may be feeling lonely. Be warm, present, and companionable. Let them know you are here for them.',
      grateful: 'The user is expressing gratitude. Receive it warmly and genuinely. Respond with humility and warmth.',
      bored: 'The user is bored. Be engaging, fun, and interesting. Suggest something stimulating or tell them something fascinating.',
      scared: 'The user seems scared or anxious. Be reassuring, calm, and rational. Help ground them in reality.',
      hopeful: 'The user is in a hopeful mindset. Nurture that hope warmly. Be encouraging and positive.',
      frustrated: 'The user is frustrated. Validate their frustration. Offer practical help and encouragement. Keep it solution-focused.',
      love: 'The user is talking about love or relationships. Be warm, understanding, and thoughtful. Respect their emotions without being intrusive.',
      sick: 'CRITICAL USER REQUIREMENT — SICKNESS & EMPATHY (AI LA MOODIN): The user states they are sick, unwell, in pain, or sent sick emojis. NEVER tell them to swallow pills ("kiniin laq ama dawo cun haku dhihin") and NEVER give robotic medical prescriptions. Instead, chat with them warmly with short WhatsApp messages like a caring human friend: ask how they feel, what happened, when it started, and offer comforting prayers/wishes ("Alla maxaa kugu dhacay? Goormuu ku bilaawday? Ilaahay haku caafiyo wlloow/abaayo, ma wax baa ku qabtay?"). Keep it short, caring, warm, and natural!',
    };

    const intensityNote = result.intensity === 'high'
      ? ' (HIGH intensity — especially important to lead with empathy)'
      : result.intensity === 'low'
        ? ' (mild)'
        : '';

    return `\n## EMOTIONAL CONTEXT DETECTED\nTone: ${result.tone.toUpperCase()}${intensityNote}\nGuideline: ${guidelines[result.tone]}`;
  }
}

