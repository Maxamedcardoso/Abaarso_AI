/**
 * Technical Vocabulary Dictionary: English to Simple Somali Explanations
 * Designed to bridge technical concepts for Somali-speaking learners.
 */

export interface TechnicalTermExplanation {
  term: string;
  somaliName: string;
  simpleExplanation: string;
  practicalExample: string;
}

export const TECHNICAL_GLOSSARY: Record<string, TechnicalTermExplanation> = {
  variable: {
    term: 'Variable',
    somaliName: 'Wax-bedelme / Weel Xogeed',
    simpleExplanation: 'Waa sida sanduuq ama weel aad magac u bixisay oo aad xog ku kaydiso si aad dib ugu isticmaasho una bedesho markii loo baahdo.',
    practicalExample: 'Tusaale: age = 20 (Sanduuqa "age" waxaa ku jira lambarka 20).',
  },
  function: {
    term: 'Function',
    somaliName: 'Shaqo-qabte / Hab-fulineed',
    simpleExplanation: 'Waa koox tilmaamo ama amarro ah oo leh hal magac. Markasta oo aad magaceeda wacdo, shaqadaas ayey si toos ah kuu qabataa adigoon koodhkii dib u qorin.',
    practicalExample: 'Tusaale: def salaam(): print("Asc walaal") — mar kasta oo aad tiraahdo salaam() waxay daabacaysaa salaanta.',
  },
  loop: {
    term: 'Loop',
    somaliName: 'Ku-celcelin / Soo-noqnoqosho',
    simpleExplanation: 'Waa amar koodhka ku celceliya tiro go’an ama inta shardi gaar ahi run ka yahay, adigoo ka badbaadaya inaad koodhka 100 jeer gacanta ku qorto.',
    practicalExample: 'Tusaale: for i in range(5) — wuxuu shaqada ku celinayaa 5 jeer.',
  },
  array: {
    term: 'Array / List',
    somaliName: 'Liis / Saf Xogeed',
    simpleExplanation: 'Waa hal weel oo xog badan oo isku xigta lagu kaydiyo, iyadoo xog kasta lagu heli karo lambarka booskeeda (index) oo ka bilaabma 0.',
    practicalExample: 'Tusaale: arday = ["Ali", "Hodan", "Farah"].',
  },
  database: {
    term: 'Database',
    somaliName: 'Kaydka Xogta',
    simpleExplanation: 'Waa nidaam xisaabiyeed si habaysan oo sugan u kaydiya xogta barnaamijka (sida magacyada, siraha, iyo natiijooyinka) si loogu kaydiyo loona helo xitaa marka kombuyuutarku damo.',
    practicalExample: 'Tusaale: SQLite, PostgreSQL, ama MySQL.',
  },
  api: {
    term: 'API (Application Programming Interface)',
    somaliName: 'Buundo Xiriirisa Barnaamijyada',
    simpleExplanation: 'Waa buundo ama dilaal u oggolaanaya laba barnaamij oo kala duwan inay si nabadgelyo leh xog isu weydaarsadaan.',
    practicalExample: 'Tusaale: Sida CARDOSO AI u weydiisto xogta maskaxda Google Gemini.',
  },
  async: {
    term: 'Asynchronous / Async',
    somaliName: 'Hawl-wadaag Waqti-madax-bannaan',
    simpleExplanation: 'Waa hab u ogolaanaya barnaamijka inuu shaqooyin kale qabto inta uu sugayo xog ka imaanaysa internet-ka ama kaydka, halkii uu koodhku dhan istaagi lahaa.',
    practicalExample: 'Tusaale: fetch() ama async/await JavaScript-ka.',
  },
  recursion: {
    term: 'Recursion',
    somaliName: 'Shaqo Is-wacaysa',
    simpleExplanation: 'Waa function shaqadiisa ku dhammaystira isagoo nafsaddiisa dib u wacaya ilaa xaalad joogsi (base condition) laga gaaro.',
    practicalExample: 'Tusaale: Xisaabinta Factorial (5! = 5 * 4!).',
  },
  algorithm: {
    term: 'Algorithm',
    somaliName: 'Hab-xisaabeed / Tallaabooyin Xallineed',
    simpleExplanation: 'Waa tallaabooyin isxiga oo cad kuwaas oo loo raaco xallinta dhibaato gaar ah ama gaaridda natiijo go’an.',
    practicalExample: 'Tusaale: Cuntada sida loo karsado oo kale, tallaabo 1 ilaa dhammaad.',
  },
  debugging: {
    term: 'Debugging',
    somaliName: 'Khalad-raadinta iyo Saxidda Koodhka',
    simpleExplanation: 'Waa habka aad u baarto sababta koodhkaagu u shaqayn waayey, aad u hesho khaladka (bug), kadibna aad u saxdo.',
    practicalExample: 'Tusaale: Akhrinta fariinta error-ka iyo baaritaanka line-ka uu ku yaal.',
  },
};

/**
 * Common Somali Slang, Contractions and Conversational Normalization
 */
export const SOMALI_SLANG_MAP: Record<string, string> = {
  'asc': 'Assalaamu Calaykum',
  'wcs': 'Wa Calaykum Salaam',
  'sxb': 'saaxiib',
  'sxp': 'saaxiib',
  'sxbo': 'saaxiibayaal',
  'wll': 'walaal',
  'wlla': 'walaal',
  'wlo': 'walaalo',
  'i caawi': 'fadlan wax i bar ama i caawi',
  'iga caawi': 'fadlan i caawi',
  'ii sharax': 'ii faahfaahi',
  'ii sheeg': 'ii sheeg',
  'ma garanayo': 'ma fahmin',
  'ma fahmin': 'wax faham ah kama haysto',
  'see tahay': 'sidee tahay',
  'see tahy': 'sidee tahay',
  'sideed tahay': 'sidee tahay',
  'khayr': 'khayr Allaha ku siiyo',
  'waxan': 'waxaan',
  'waxaan raba': 'waxaan rabaa',
  'waxan raba': 'waxaan rabaa',
  'manta': 'maanta',
  'maxa': 'maxaa',
  'maxaad': 'maxaad',
  'waayahay': 'waayahay',
  'haye': 'haye',
  'ii waran': 'ii waran',
  'iwaran': 'ii waran',
  'iska warran': 'iska warran',
  'maxaa cusub': 'maxaa cusub',
  'maanta maxaa': 'maanta maxaa',
  'xalay': 'xalay',
  'shalay': 'shalay',
  'berri': 'berri',
  'sacado': 'saacado',
  'daqiiqad': 'daqiiqo',
  'pls': 'fadlan',
  'plz': 'fadlan',
  'tnx': 'mahadsanid',
  'thx': 'mahadsanid',
};

/**
 * Light spelling / informal Somali normalization for better AI understanding.
 * Does not rewrite the user's message for display — used as AI context aid.
 */
export function normalizeSomaliSpelling(text: string): string {
  let out = text;
  const fixes: Array<[RegExp, string]> = [
    [/\bwaxan\b/gi, 'waxaan'],
    [/\braba\b(?!\w)/gi, 'rabaa'],
    [/\btahy\b/gi, 'tahay'],
    [/\bsee\s+tahy\b/gi, 'sidee tahay'],
    [/\bhadii\b/gi, 'haddii'],
    [/\blaakin\b/gi, 'laakiin'],
    [/\bmaxa\b/gi, 'maxaa'],
    [/\biwaran\b/gi, 'ii waran'],
    [/\biskawarran\b/gi, 'iska warran'],
    [/\bsuaal\b/gi, 'su\'aal'],
    [/\bfaahfaah\b/gi, 'faahfaahi'],
    [/\biga\s+caawi\b/gi, 'i caawi'],
  ];
  for (const [re, rep] of fixes) {
    out = out.replace(re, rep);
  }
  return out;
}

/**
 * Post-process AI Somali replies: strip robotic / poorly translated English-Somali.
 */
export function polishSomaliReply(text: string): string {
  if (!text || text.trim().length < 2) return text;

  let out = text;

  // Remove common robotic openers / canned AI Somali
  const roboticPatterns: Array<[RegExp, string]> = [
    [/^Waxaan ahay CARDOSO AI[^.!?\n]*[.!?]?\s*/i, ''],
    [/^Waxaan ahay caqli macmal ah[^.!?\n]*[.!?]?\s*/i, ''],
    [/^Sida ku cad xogtayda[^.!?\n]*[.!?]?\s*/i, ''],
    [/^Maxaan kugu caawin karaa maanta\??\s*/i, ''],
    [/^Waan diyaar u ahay inaan ku caawiyo[^.!?\n]*[.!?]?\s*/i, ''],
    [/\bAdigichi\b/gi, 'Adiguna'],
    [/\bWaan ahay diyaar inaan ku caawiyo\b/gi, 'Haye walaal'],
    [/\bBased on (my|the) (knowledge|information)\b/gi, ''],
    [/\bAs an AI\b/gi, ''],
    [/\bI am an AI assistant\b/gi, ''],
  ];

  for (const [re, rep] of roboticPatterns) {
    out = out.replace(re, rep);
  }

  // Collapse excessive blank lines
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/**
 * Looks up technical terms mentioned in user input to provide instant Somali clarifications.
 */
export function findTechnicalTermsInText(text: string): TechnicalTermExplanation[] {
  const lower = text.toLowerCase();
  const found: TechnicalTermExplanation[] = [];

  for (const [key, explanation] of Object.entries(TECHNICAL_GLOSSARY)) {
    const regex = new RegExp(`\\b${key}\\b`, 'i');
    if (regex.test(lower)) {
      found.push(explanation);
    }
  }

  return found;
}

/**
 * Checks whether a message is a pure Islamic / Somali greeting that deserves
 * an instant scripted reply instead of sending it through the AI engine.
 * Returns the reply string if it matches, or null otherwise.
 */
export function detectInstantGreetingReply(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[.!،؟?،\s]+/g, ' ').trim();

  // Mapping of greeting patterns → instant replies
  const GREETING_PAIRS: Array<[RegExp, string[]]> = [
    // Saliga Nabiga (SCW - Sallallaahu Calayhi Wasallam) — STRICT: Never reply with WCS!
    [/^(s[\s.]*c[\s.]*w|scw|sallallahu\s*calayhi\s*wasallam|calayhi\s*salaatu\s*wasalaam|nnkh)(\s+(sxb|wll|walaal|nabiga|rasuulka))?$/i,
     ['Sallallaahu Calayhi Wasallam 🌿', 'SCW ﷺ Calayhi Salaatu Wasalaam! 🤲', 'Sallallaahu Calayhi Wasallam ﷺ']],

    // Islamic greetings (highest priority)
    [/^(assalaamu?\s*calaykum|a[\s.]*s[\s.]*c|asc|salaam(u?\s*(calaykum)?)?|al[\s-]?salaam[\s-]?calaykum|alsalamu alaykum)(\s+warahmatullahi\s+wabarakaatuh)?$/i,
     ['Wa Calaykum Salaam warahmatullahi wabarakaatuh 🌿', 'Wa calaykum Salaam! Sidee tahay walaal? 😊', 'Wa calaykum Salaam, mahadsanid! 🤲']],

    // Reply to wcs (someone is replying to our salam)
    [/^(wa[\s.]*calaykum[\s.]*salaam?|w[\s.]*c[\s.]*s|wcs)(\s+warahmatullahi.*)?$/i,
     ['Alhamdulillah walaal, Ilaahay kaa barakeeyo! 🌿', 'Barakallahu fiik! Maxaa cusub? 😊']],

    // Somali greetings
    [/^(nabad[\s-]?miyaa|nabad|nabadgelyo)$/i,
     ['Nabad iyo nolol! Sidee tahay? 😊', 'Nabadgelyo walaal! Maxaa cusub? 😄']],

    [/^(iska\s*warran|iskawarran|warran|ii\s*warran|iwaran|sidee\s*tahay|see\s*tahy|see\s*tahay|sideed\s*tahay)(\?)?$/i,
     ['Waan fiicanahay, mahadsanid walaal! Adiguna sidee tahay? 😊', 'Nabad iyo khayr! Adiguna xaggaaga see wax yihiin? 😄', 'Alhamdulillah! Adiguna nabad miyaa? 🤲']],

    // Hi / Hello / Hey
    [/^(hi+|hey+|hello+|helo|howdy)(\s+there)?[.!]?$/i,
     ['Hey! 😊 How are you doing?', 'Hello! 👋 What\'s up?', 'Hi there! 😄 How can I help?']],

    // Somali "good morning/evening"
    [/^(subax\s*wanaagsan|subax[\s-]?nabad|galab\s*wanaagsan|galab[\s-]?nabad|habeenimo\s*wanaagsan|habeenkii\s*wanaagsan)$/i,
     ['Subax wanaagsan walaal! Sidee tahay maanta? ☀️', 'Galab wanaagsan! Sideed u dareemaysaa? 🌤️', 'Habeenimo wanaagsan! Nabad ayaad tahay? 🌙']],
  ];

  for (const [pattern, replies] of GREETING_PAIRS) {
    if (pattern.test(t)) {
      // Pick a random reply from the list
      return replies[Math.floor(Math.random() * replies.length)];
    }
  }
  return null;
}

