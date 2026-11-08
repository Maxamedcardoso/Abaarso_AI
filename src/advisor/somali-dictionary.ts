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
  'sxbo': 'saaxiibayaal',
  'wll': 'walaal',
  'wlla': 'walaal',
  'wlo': 'walaalo',
  'i caawi': 'fadlan wax i bar ama i caawi',
  'ii sharax': 'ii faahfaahi',
  'ma garanayo': 'ma fahmin',
  'ma fahmin': 'wax faham ah kama haysto',
  'see tahay': 'sidee tahay',
  'see tahy': 'sidee tahay',
  'khayr': 'khayr Allaha ku siiyo',
  'waxan': 'waxaan',
  'waxaan raba': 'waxaan rabaa',
  'manta': 'maanta',
  'xalay': 'xalay',
};

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

