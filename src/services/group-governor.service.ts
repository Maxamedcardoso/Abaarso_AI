import fs from 'fs';
import path from 'path';
import { ImageGeneratorService } from './image-generator.service.js';

export type GroupNiche = 'tech' | 'education' | 'business' | 'islamic' | 'community' | 'general';

export interface GroupNicheProfile {
  category: GroupNiche;
  categoryLabel: string;
  tone: string;
  suggestedSubject?: string;
  customRules: string[];
  enhancedDescription: string;
  logoPrompt: string;
  engagingTopic: string;
  pollQuestion?: string;
  pollOptions?: string[];
}

export interface CurfewConfig {
  enabled: boolean;
  startHour: number; // 23 (11:00 PM)
  endHour: number;   // 6 (06:00 AM)
  lastAppliedState?: 'locked' | 'unlocked';
}

export interface StrikeDetail {
  timestamp: number;
  word?: string;
  reason: string;
}

export interface ParticipantStrikeRecord {
  count: number;
  lastStrikeAt: number;
  history: StrikeDetail[];
}

export interface StrikeResult {
  strikes: number;
  action: 'warn_1' | 'warn_2' | 'kick';
  reason: string;
}

/**
 * GroupGovernorService — The Autonomous AI Super-Admin & Community Governor.
 *
 * Capabilities:
 * 1. AI Group Intelligence: Automatically profiles and understands group niche, purpose, and audience.
 * 2. Zero-Tolerance Profanity & Toxic Speech Guardian (3-Strike Escalation System).
 * 3. Dynamic Custom Rules Engine tailored to the group's exact niche.
 * 4. Autonomous Group Branding: Auto-updates description, generates AI logo & updates group picture.
 * 5. Autonomous Community Value Drops: Posts engaging topics, debate starters, and wisdom drops.
 * 6. Group Info Security: Locks/unlocks group settings to protect branding.
 */
export class GroupGovernorService {
  private readonly storagePath: string;
  // Map<groupJid, Map<participantJid, ParticipantStrikeRecord>>
  private strikes: Map<string, Map<string, ParticipantStrikeRecord>> = new Map();

  // Somali & multi-lingual profanity regex list
  private readonly profanityPatterns: RegExp[] = [
    // Severe Somali curses & insults
    /\b(?:dillo|dhillo|dhilow|dhillada|wasmo|was|waso|qooq|gus|guska|siil|siilka|futo|futada|futadisa|futadeda)\b/i,
    /\b(?:hooyadaa\s*was|aabahaa\s*was|ku\s*was|waso|faro\s*xun|naago\s*raac)\b/i,
    /\b(?:doqon|doqomo|doqoniimo|nacas|nacasnimo|dulin|qashin|kharash|dampeer|cawaan)\b/i,
    /\b(?:khaniis|khaniisi|khaniisad|qaniis|kufsasho|xaar|jaad|qaad)\b/i,
    // Severe insults & tribal slurs
    /\b(?:midgaan|yibir|tumaal|laangaab|laangab|aflagaado|habar\s*gidir|daarod|hawiye|isaaq|reer\s*hebel)\b/i,
    // English vulgarities
    /\b(?:fuck|fucking|fucker|bitch|bastard|asshole|pussy|dick|cunt|slut|whore|motherfucker)\b/i,
    // Arabic vulgarities & insults (Unicode-aware word boundaries)
    /(?:^|[^\p{L}\p{N}])(?:شرموطة|قحبة|كس|طيز|عرص|منيك|قواد|زب|يلعن|ابن\s*الكلب|ابن\s*الحرام|خرا|طز|كل\s*خرا)(?=[^\p{L}\p{N}]|$)/ui,
  ];

  private userMessageHistory: Map<string, number[]> = new Map();
  private lastDailyTopicTimestamps: Map<string, number> = new Map();
  private lastEveningSummaryTimestamps: Map<string, number> = new Map();
  private memberActivityHistory: Map<string, Map<string, number>> = new Map();
  private readonly curfewStoragePath: string;
  private curfewConfigs: Map<string, CurfewConfig> = new Map();

  constructor(options?: { authDir?: string; storagePath?: string; curfewStoragePath?: string }) {
    const authDir = options?.authDir || path.join(process.cwd(), 'baileys_auth_info');
    this.storagePath = options?.storagePath || path.join(authDir, 'group-governor-strikes.json');
    this.curfewStoragePath = options?.curfewStoragePath || path.join(authDir, 'group-governor-curfew.json');
    this.loadPersistedStrikes();
    this.loadPersistedCurfew();
  }

  // ─── 1. PROFANITY & TOXICITY DETECTION ────────────────────────────────────

  /**
   * Scans a message for vulgarity, insults, slurs, or toxic language.
   */
  public detectProfanity(text: string): { isViolating: boolean; word?: string; reason?: string } {
    if (!text || typeof text !== 'string') {
      return { isViolating: false };
    }

    const clean = text.toLowerCase().trim();

    for (const pattern of this.profanityPatterns) {
      const match = clean.match(pattern);
      if (match) {
        return {
          isViolating: true,
          word: match[0],
          reason: 'Hadallo anshax-xumo ah ama cay la mamnuucay',
        };
      }
    }

    return { isViolating: false };
  }

  /**
   * Anti-Flood / Anti-Spam Detector:
   * Triggers if a user sends 5 or more messages within a 5-second burst.
   */
  public checkFlood(groupJid: string, participantJid: string): { isFlooding: boolean; count: number } {
    const now = Date.now();
    const cleanUser = participantJid.split('@')[0].split(':')[0];
    const key = `${groupJid}:${cleanUser}`;
    const history = (this.userMessageHistory.get(key) || []).filter(ts => now - ts < 5000);
    history.push(now);
    this.userMessageHistory.set(key, history);

    if (history.length >= 5) {
      return { isFlooding: true, count: history.length };
    }
    return { isFlooding: false, count: history.length };
  }

  // ─── 2. STRIKE ESCALATION ENGINE (3 STRIKES) ──────────────────────────────

  /**
   * Records a strike against a participant in a group and determines enforcement action.
   */
  public addStrike(groupJid: string, participantJid: string, reason: string, word?: string): StrikeResult {
    let groupMap = this.strikes.get(groupJid);
    if (!groupMap) {
      groupMap = new Map();
      this.strikes.set(groupJid, groupMap);
    }

    const cleanUser = participantJid.split('@')[0].split(':')[0];
    let record = groupMap.get(cleanUser);
    if (!record) {
      record = {
        count: 0,
        lastStrikeAt: Date.now(),
        history: [],
      };
      groupMap.set(cleanUser, record);
    }

    record.count += 1;
    record.lastStrikeAt = Date.now();
    record.history.push({
      timestamp: Date.now(),
      word,
      reason,
    });

    this.savePersistedStrikes();

    let action: 'warn_1' | 'warn_2' | 'kick';
    if (record.count === 1) {
      action = 'warn_1';
    } else if (record.count === 2) {
      action = 'warn_2';
    } else {
      action = 'kick';
    }

    return {
      strikes: record.count,
      action,
      reason,
    };
  }

  /**
   * Retrieves strike count and history for a participant or the entire group.
   */
  public getStrikes(groupJid: string, participantJid?: string): Record<string, ParticipantStrikeRecord> {
    const groupMap = this.strikes.get(groupJid);
    if (!groupMap) return {};

    if (participantJid) {
      const cleanUser = participantJid.split('@')[0].split(':')[0];
      const record = groupMap.get(cleanUser);
      return record ? { [cleanUser]: record } : {};
    }

    const out: Record<string, ParticipantStrikeRecord> = {};
    for (const [user, rec] of groupMap.entries()) {
      out[user] = rec;
    }
    return out;
  }

  /**
   * Clears strikes for a participant or whole group.
   */
  public clearStrikes(groupJid: string, participantJid?: string): boolean {
    const groupMap = this.strikes.get(groupJid);
    if (!groupMap) return false;

    if (participantJid) {
      const cleanUser = participantJid.split('@')[0].split(':')[0];
      const deleted = groupMap.delete(cleanUser);
      this.savePersistedStrikes();
      return deleted;
    } else {
      this.strikes.delete(groupJid);
      this.savePersistedStrikes();
      return true;
    }
  }

  // ─── 3. AI GROUP INTELLIGENCE & PROFILING ─────────────────────────────────

  /**
   * Analyzes group subject and description to understand what the group is about.
   */
  public analyzeGroup(subject: string, desc?: string): GroupNicheProfile {
    const combined = `${subject || ''} ${desc || ''}`.toLowerCase();

    // 1. Tech & Programming
    if (/(?:tech|it\b|code|coding|software|python|javascript|web|developer|computer|ai\b|data|cyber|hacker)/i.test(combined)) {
      return {
        category: 'tech',
        categoryLabel: 'Tiknoolojiyadda & Programming-ka 💻',
        tone: 'innovative & practical',
        suggestedSubject: subject.includes('💻') ? subject : `${subject} 💻🚀`,
        customRules: [
          '1. 🚫 *Anti-Link Firfircoon:* Lama oggola xayeysiis iyo link-yo kooxo kale.',
          '2. 🤝 *Ixtiraam & Wadashaqayn:* Barashada iyo wadaagga xogta IT-ga ku koobnow.',
          '3. 🛑 *Zero-Tolerance Profanity:* Ereyada xun, aflagaadada iyo buuqa waa mamnuuc.',
          '4. 💡 *Code & Caawinaad:* Markaad su\'aal IT ah weydiinayso, soo dhig sharaxaad cad.',
          '5. 🤖 *24/7 Super-Admin:* Waxaa si toos ah u maamula Cardoso AI Governor.',
        ],
        enhancedDescription:
          `🚀 *BARAHA KOOXDA — ${subject.toUpperCase()}* 💻\n\n` +
          `🎯 *Hadafka:* Kobcinta aqoonta tiknoolojiyadda, xalinta mushkilaadka programming-ka, iyo dhiirrigelinta jiilka mustaqbalka.\n\n` +
          `📌 *Xeerarka Degdegga ah:*\n` +
          `• Waxbarasho & wada-tashi kaliya\n` +
          `• Link-yada & spam-ka waa mamnuuc (Auto-Kick)\n` +
          `• Dhaqan wanaag & xushmad dhexdiinna ah\n\n` +
          `🤖 *Maamulaha Sare:* Waxaa si toos ah u ilaaliya Cardoso AI Super-Admin.`,
        logoPrompt:
          `A futuristic high-tech 3D emblem badge logo for "${subject}", neon cyan and metallic dark blue, glowing circuitry, code brackets, elegant modern professional community icon, 8k resolution, minimalist, clean background`,
        engagingTopic:
          `💡 *[CARDOSO AI — DOODDA & CAQLIGA IT-GA EE MAANTA]* 💻\n\n` +
          `Asxaabta kooxda salaan diiran! 👋\n` +
          `Maxaad u malaynaysaa luuqadda ugu fiican ee qof bilaabaya programming-ka maanta uu ku bilaabi karo (Python mise JavaScript)? Maxaase sabab u ah doorashadaada? 🤔🚀`,
        pollQuestion: '💻 Codbixinta Tech-ka: Luuqadee koodhka ugu fiican in lagu bilaabo 2026?',
        pollOptions: ['JavaScript / TypeScript', 'Python', 'Go / Rust', 'Flutter / Dart'],
      };
    }

    // 2. Academic & Education
    if (/(?:arday|student|jaamacad|university|faculty|school|waxbarasho|exam|study|lecture|cashir)/i.test(combined)) {
      return {
        category: 'education',
        categoryLabel: 'Waxbarashada & Jaamacadda 🎓',
        tone: 'scholarly & encouraging',
        suggestedSubject: subject.includes('🎓') ? subject : `${subject} 🎓📚`,
        customRules: [
          '1. 🚫 *Anti-Link & Anti-Spam:* Link-yada aan waxbarashada ahayn waa mamnuuc.',
          '2. 📚 *Ujeeddo Waxbarasho:* Fariin kasta ha la xiriirto casharrada iyo jaamacadda.',
          '3. 🛑 *Zero-Tolerance Profanity:* Cayda iyo erayada xun ciqaab toos ah ayay leeyihiin.',
          '4. 🤝 *Gacan-siinta Ardayda:* Is-weydiinta su\'aalaha imtixaanaadka iyo qoraallada.',
          '5. 🤖 *Ilaalada Kooxda:* Cardoso AI ayaa kormeere guud ka ah kooxdan.',
        ],
        enhancedDescription:
          `🎓 *BARAHA WAXBARASHADA — ${subject.toUpperCase()}* 📚\n\n` +
          `🎯 *Hadafka:* Kaalmaynta ardayda, wadaagga jadwallada iyo casharrada, iyo is-kaashiga waxbarashada.\n\n` +
          `📌 *Xeerarka:*\n` +
          `• Wada-hadal cilmiyeysan oo edeb leh\n` +
          `• Xayeysiisyada & link-yada qalaad waa mamnuuc\n` +
          `• Qof kasta oo caytama si toos ah ayaa looga saarayaa\n\n` +
          `🤖 *Maamulaha Sare:* Cardoso AI Autonomous Governor.`,
        logoPrompt:
          `An inspiring golden academic crest emblem logo for "${subject}", open book of knowledge, graduation cap, glowing starlight, sleek modern educational branding icon, 8k resolution, photorealistic, elegant white background`,
        engagingTopic:
          `📖 *[CARDOSO AI — DHIIRRIGELINTA & WAXBARASHADA MAANTA]* 🎓\n\n` +
          `"Aqoontu waa hubka kaliya ee aad ku beddeli karto noloshaada iyo dalkaaga." ✨\n\n` +
          `Muxuu ahaa casharkii ama fikraddii ugu qiimaha badnayd ee aad baratay toddobaadkan? Nala wadaag si dhammaanteen uga faa'iidaysanno! 🤝📝`,
        pollQuestion: '📚 Codbixinta Ardayda: Wakhtigee ugu fiican wax-akhriskaaga?',
        pollOptions: ['Subaxdii hore (Fajir ka dib)', 'Galabti (Casar ka dib)', 'Habeenkii dambe', 'Dhammaadka todobaadka'],
      };
    }

    // 3. Business & Trade
    if (/(?:ganacsi|suuq|market|crypto|forex|invest|iib|badeeco|business|lacag|dollar|online)/i.test(combined)) {
      return {
        category: 'business',
        categoryLabel: 'Ganacsiga & Suuqgeynta 💼',
        tone: 'entrepreneurial & professional',
        suggestedSubject: subject.includes('💼') ? subject : `${subject} 💼📈`,
        customRules: [
          '1. 🚫 *Anti-Scam & Anti-Link:* Link-yada beenta ah iyo spam-ka toos ayaa looga saarayaa.',
          '2. 💼 *Daacadnimo Ganacsi:* Wax kasta oo la xayeysiinayo waa inay yihiin dhab.',
          '3. 🛑 *Ixtiraam Buuxa:* Aflagaadada ganacsatada iyo macaamiisha waa mamnuuc.',
          '4. 🤝 *Is-Dhaafsiga Khibradaha:* Ka wada-hadalka fursadaha cusub ee maalgashiga.',
          '5. 🤖 *Auto-Moderator:* Cardoso AI ayaa nidaamka suuqa ilaalinaya 24/7.',
        ],
        enhancedDescription:
          `💼 *SHABAKADDA GANACSIGA — ${subject.toUpperCase()}* 📈\n\n` +
          `🎯 *Hadafka:* Isku xirka ganacsatada, kobcinta maalgashiga, iyo wadaagga fursadaha maaliyadeed.\n\n` +
          `📌 *Xeerarka:*\n` +
          `• Ganacsi dhab ah iyo kalsooni buuxda\n` +
          `• Link-yada spam-ka iyo tuugada waa mamnuuc (Immediate Kick)\n` +
          `• Anshax iyo xirfad sarreysa\n\n` +
          `🤖 *Maamulaha Kooxda:* Cardoso AI Business Governor.`,
        logoPrompt:
          `A prestigious luxury corporate finance and business logo for "${subject}", metallic gold and emerald green rising chart arrows, modern sleek minimal 3D branding symbol, 8k resolution, premium aesthetic`,
        engagingTopic:
          `💼 *[CARDOSO AI — XIKMADDA GANACSIGA EE MAANTA]* 📈\n\n` +
          `"Macaamiilku ma iibsado badeecadda kaliya; wuxuu iibsadaa kalsoonida iyo xalka aad u haysid dhibaatadiisa." 🤝\n\n` +
          `Maxay kula tahay caqabadda ugu weyn ee haysata dadka doonaya inay ganacsi online ah bilaabaan dalkeena? 💬💵`,
        pollQuestion: '💼 Codbixinta Ganacsiga: Noocee ugu faa\'iidada badan ganacsiyada cusub?',
        pollOptions: ['Online Store (E-Commerce)', 'Tech & Agency', 'Real Estate & Dhulalka', 'Import & Export'],
      };
    }

    // 4. Islamic, Faith & Hayaanka Nolosha (Diinta & Aqoonta Guud)
    if (/(?:hayaan|hayaanka|nolosha|waano|tarbiyad|xikmad|wacdi|diin|islaam|islam|quraan|xadiis|sunnah|culimo|dawa|khayr|akhlaaq)/i.test(combined)) {
      const isHayaan = /(?:hayaan|hayaanka|nolosha)/i.test(combined);
      return {
        category: 'islamic',
        categoryLabel: isHayaan ? 'Diinta, Aqoonta Guud & Hayaanka Nolosha 🌙📚' : 'Diinta & Akhlaaqda Islaamka 🌙',
        tone: 'spiritual, inspiring & educational',
        suggestedSubject: subject.includes('🌙') ? subject : `${subject} 🌙✨`,
        customRules: [
          '1. 🚫 *Anti-Link:* Link-yada aan khuseyn khayrka, aqoonta iyo diinta waa mamnuuc.',
          '2. 🌙 *Edeb & Akhlaaq:* Qof kasta waa inuu ku hadlaa hadal wanaagsan oo xikmad leh.',
          '3. 🛑 *Zero-Tolerance:* Aflagaadada iyo muranka xun isla markiiba waa la saarayaa (3-Strike System).',
          '4. 📖 *Cilmiga:* Wadaagista Quraanka, Axaadiista saxiixa ah iyo aqoonta guud.',
          '5. 🤖 *Auto-Guard:* Cardoso AI ayaa ilaalinaya xasiloonida iyo nidaamka kooxda.',
        ],
        enhancedDescription: isHayaan
          ? `🌙 *BARAHA HAYAANKA NOLOSHA — DIINTA, AQOONTA GUUD & AKHLAAQDA* ✨\n\n` +
            `🎯 *Hadafka Kooxda:* Kobcinta garaadka iyo aqoonta guud, barashada diinta Islaamka, xikmadda nolosha, iyo dhisidda akhlaaq suubban iyo mustaqbal toosan.\n\n` +
            `📌 *Xeerarka Kooxda:*\n` +
            `• Wadaagista xogta diiniga ah, aqoonta guud iyo waayo-aragnimada nolosha\n` +
            `• Ixtiraam, is-qadarin iyo hadal wanaagsan oo xikmad leh\n` +
            `• Link-yada spam-ka, xayeysiisyada qalaad iyo buuqa waa mamnuuc (Auto-Kick)\n` +
            `• Zero tolerance aflagaadada iyo cayda (3-Strike System)\n\n` +
            `🤖 *Kormeeraha Kooxda:* Waxaa 24/7 ilaaliya oo nidaamiya Cardoso AI Autonomous Governor.`
          : `🌙 *KOOXDA KHAYRKA — ${subject.toUpperCase()}* ✨\n\n` +
            `🎯 *Hadafka:* Faafinta dacwada, barashada shareecada, iyo is-xusuusinta wanaagga iyo sabarka.\n\n` +
            `📌 *Xeerarka:*\n` +
            `• Hadal wanaagsan ama aamusnaan\n` +
            `• Ka fogaanshaha muranka iyo kala fogaanshaha\n` +
            `• Link-yada qalaad waa mamnuuc\n\n` +
            `🤖 *Ilaalada:* Cardoso AI Islamic Community Governor.`,
        logoPrompt:
          `An exquisite Islamic calligraphy crescent moon and lantern logo for "${subject}", golden geometric Arabesque patterns, serene royal green and gold, 3D modern clean emblem, 8k resolution, peaceful divine aesthetic`,
        engagingTopic:
          `🌙 *[CARDOSO AI — XIKMADDA & HAYAANKA NOLOSHA EE MAANTA]* ✨\n\n` +
          `Rasuulku (NNKH) wuxuu yidhi: "Qofka dadka ugu khayrka badan waa kan ugu anshaxa wanaagsan uguna faa'iidada badan dadka kale." 🤲\n\n` +
          `Muxuu ahaa qodobkii ama waanadii ugu qiimaha badnayd ee noloshaada wax ka beddeshay oo aad jeceshahay inaad asxaabta la wadaagto? 💬📖`,
        pollQuestion: '🌙 Codbixinta Hayaanka Nolosha: Qodobkee ugu muhiimsan xasiloonida nafta?',
        pollOptions: ['Ducada & Xuska Alle', 'Dadaalka & Shaqada', 'Dulqaadka & Samirka', 'Akhriska & Cilmiga'],
      };
    }

    // 5. Youth & Personal Development (Dhalinyarada & Jiilka Cusub)
    if (/(?:dhalinyaro|dhalinyarada|youth|jiilka|horumar|yool|mustaqbal)/i.test(combined)) {
      return {
        category: 'community',
        categoryLabel: 'Dhalinyarada, Yoolalka & Horumarka Jiilka 🌟',
        tone: 'motivational, dynamic & ambitious',
        suggestedSubject: subject.includes('🌟') ? subject : `${subject} 🌟`,
        customRules: [
          '1. 🚫 *Anti-Link & Anti-Spam:* Link-yada aan khuseyn dhalinyarada waa mamnuuc.',
          '2. 💡 *Dhiirrigelin & Yoolal:* Wadaagista qorshayaasha guusha, waxbarashada iyo xirfadaha.',
          '3. 🛑 *Zero-Tolerance:* Aflagaadada, qabyaaladda iyo cayda ciqaab toos ah ayay leeyihiin.',
          '4. 🤝 *Saaxiibtinimo & Taageero:* Dhalinyaradu inay is-garabsadaan oo is-dhiirrigeliyaan.',
          '5. 🤖 *Auto-Guard:* Cardoso AI ayaa nidaamka iyo dhiirrigelinta kooxda kormeera.',
        ],
        enhancedDescription:
          `🌟 *BARAHA DHALINYARADA & HORUMARKA JIILKA — ${subject.toUpperCase()}* 🚀\n\n` +
          `🎯 *Hadafka:* Dhiirrigelinta dhalinyarada, kobcinta xirfadaha nolosha, hoggaaminta mustaqbalka, iyo isku xirka jiilka cusub.\n\n` +
          `📌 *Xeerarka:*\n` +
          `• Dood cilmiyeed dhaxal-gal ah iyo hadafyo toosan\n` +
          `• Link-yada spam-ka iyo xayeysiiska waa mamnuuc\n` +
          `• Ixtiraam buuxa iyo wadajir dhalinyaro\n\n` +
          `🤖 *Maamulaha Kooxda:* Cardoso AI Youth Governor.`,
        logoPrompt:
          `An inspiring dynamic 3D youth leadership badge logo for "${subject}", rising sun and soaring eagle, vibrant emerald and electric blue, sleek modern icon, 8k resolution, motivational`,
        engagingTopic:
          `🌟 *[CARDOSO AI — DHIIRRIGELINTA DHALINYARADA EE MAANTA]* 🚀\n\n` +
          `"Guushu kuma timaaddo nasiib ee waxay ku timaaddaa go'aan adag iyo dadaal joogto ah oo maalinle ah." ✨\n\n` +
          `Haddii aad hal caado oo xun beddeli lahayd sanadkan, maxay ahaan lahayd? Sideese isu beddelaysaa? 💬💪`,
        pollQuestion: '🌟 Codbixinta Dhalinyarada: Muxuu yahay sirta ugu weyn ee guusha dhalinyarada?',
        pollOptions: ['Dadaal & Joogtayn', 'Barashada Xirfad Cusub', 'Saaxiibo Wanaagsan', 'Qorshe & Samir'],
      };
    }

    // 5. General Community & Youth
    return {
      category: 'community',
      categoryLabel: 'Bulshada & Is-dhexgalka 🌟',
      tone: 'vibrant & friendly',
      suggestedSubject: subject.includes('🌟') ? subject : `${subject} 🌟`,
      customRules: [
        '1. 🚫 *Anti-Link Firfircoon:* Lama oggola wax link ah (fariinta waa la tirtirayaa, qofkana waa la saarayaa).',
        '2. 🤝 *Xushmad & Nidaam:* Ixtiraam dhammaan xubnaha iyo asxaabta kooxda.',
        '3. 🛑 *Zero-Tolerance Profanity:* Ereyada xun, aflagaadada iyo cayda ciqaab degdeg ah ayay leeyihiin.',
        '4. 📢 *Anti-Spam:* Fariimaha xayeysiiska iyo buuqa waa mamnuuc.',
        '5. 🤖 *24/7 Super-Admin:* Waxaa si toos ah u maamula Cardoso AI Governor.',
      ],
      enhancedDescription:
        `🌟 *BULSHADA KOOXDA — ${subject.toUpperCase()}* 💫\n\n` +
        `🎯 *Hadafka:* Is-barasho, dood cilmiyeed wax dhisaysa, iyo wada-sheekaysi xushmad iyo saaxiibtinimo ku dheehan tahay.\n\n` +
        `📌 *Xeerarka Degdegga ah:*\n` +
        `• Ka fogaanshaha qabyaaladda, siyaasadda xun iyo aflagaadada\n` +
        `• Link-yada waa mamnuuc (Auto-Kick)\n` +
        `• Xushmad iyo dareen walaalnimo\n\n` +
        `🤖 *Maamulaha Guud:* Waxaa si toos ah u maamula Cardoso AI Super-Admin.`,
      logoPrompt:
        `A vibrant friendly 3D community shield emblem logo for "${subject}", warm gradient sunset colors, modern stylized human figures holding hands, unity and friendship symbol, minimalist, 8k resolution, clean background`,
      engagingTopic:
        `🌟 *[CARDOSO AI — DOODDA & IS-WAARAYSIKA MAANTA]* 💬\n\n` +
        `Salaamu calaykum asxaabta kooxda! ✨\n` +
        `Haddii maanta lagugu siiyo awood aad hal wax kaga beddesho magaaladaada ama dalkaaga, maxay noqon lahayd waxa ugu horreeya ee aad beddeli lahayd? Sababtana noo sheeg! 🚀🗣️`,
      pollQuestion: '🌟 Codbixinta Bulshada: Muxuu yahay sirta ugu weyn ee guusha dhalinyarada?',
      pollOptions: ['Dadaal & Joogtayn', 'Barashada Xirfad Cusub', 'Saaxiibo Wanaagsan', 'Qorshe & Samir'],
    };
  }

  // ─── 4. AUTONOMOUS BRANDING & TRANSFORMATION ──────────────────────────────

  /**
   * Automatically optimizes and brands the group:
   * 1. Generates and sets a tailored professional group description.
   * 2. Generates a custom AI logo/icon and applies it as the group profile picture.
   * 3. Locks group info so only the bot and owner can modify it.
   */
  public async autoBrandGroup(
    socket: any,
    groupJid: string,
    providedSubject?: string
  ): Promise<{
    success: boolean;
    subject: string;
    descriptionUpdated: boolean;
    pictureUpdated: boolean;
    infoLocked: boolean;
    profile: GroupNicheProfile;
  }> {
    if (!socket) {
      throw new Error('WhatsApp socket is not connected');
    }

    let subject = providedSubject?.trim() || '';
    let currentDesc = '';

    try {
      const meta = await socket.groupMetadata(groupJid);
      if (!subject && meta?.subject) subject = meta.subject;
      if (meta?.desc) currentDesc = meta.desc;
    } catch (e: any) {
      if (!subject) subject = 'Kooxda';
    }

    const profile = this.analyzeGroup(subject, currentDesc);

    let descriptionUpdated = false;
    let pictureUpdated = false;
    let infoLocked = false;

    // 1. Update Group Description
    try {
      if (typeof socket.groupUpdateDescription === 'function') {
        await socket.groupUpdateDescription(groupJid, profile.enhancedDescription);
        descriptionUpdated = true;
      }
    } catch (err: any) {
      console.warn(`[GroupGovernor] Failed to update group description: ${err?.message}`);
    }

    // 2. Generate and Update Group Picture (AI Logo)
    try {
      const aiImage = await ImageGeneratorService.generateImage(profile.logoPrompt);
      if (aiImage?.buffer && typeof socket.updateProfilePicture === 'function') {
        await socket.updateProfilePicture(groupJid, aiImage.buffer);
        pictureUpdated = true;
      }
    } catch (err: any) {
      console.warn(`[GroupGovernor] Failed to update group picture: ${err?.message}`);
    }

    // 3. Lock Group Info so members can't tamper with icon/description
    try {
      if (typeof socket.groupSettingUpdate === 'function') {
        await socket.groupSettingUpdate(groupJid, 'locked');
        infoLocked = true;
      }
    } catch (err: any) {
      console.warn(`[GroupGovernor] Failed to lock group settings: ${err?.message}`);
    }

    return {
      success: true,
      subject,
      descriptionUpdated,
      pictureUpdated,
      infoLocked,
      profile,
    };
  }

  public shouldPostDailyTopic(groupJid: string): boolean {
    const last = this.lastDailyTopicTimestamps.get(groupJid) || 0;
    return Date.now() - last > 18 * 3600 * 1000;
  }

  public recordDailyTopicPosted(groupJid: string): void {
    this.lastDailyTopicTimestamps.set(groupJid, Date.now());
  }

  /**
   * The Full 100% Autonomous Takeover Execution.
   * Run instantly when admin enables !maamul on:
   * 1. Categorizes group niche.
   * 2. Auto-brands group (generates AI 3D logo & updates picture, writes tailored description).
   * 3. Locks group info so normal members cannot tamper.
   * 4. Returns the official decree announcement to be posted.
   */
  public async executeFullAutonomousTakeover(
    socket: any,
    groupJid: string,
    providedSubject?: string
  ): Promise<{
    success: boolean;
    subject: string;
    profile: GroupNicheProfile;
    announcement: string;
  }> {
    const brandRes = await this.autoBrandGroup(socket, groupJid, providedSubject);
    const profile = brandRes.profile;

    const announcement =
      `🤖👑 *[CARDOSO AI — AWOODDA GUUD & MAAMULKA TOOSKA AH (100% AUTONOMOUS TAKEOVER)]* 👑🤖\n\n` +
      `✅ *Kooxda:* *${brandRes.subject}*\n` +
      `📂 *Qaybta/Niche:* *${profile.categoryLabel}*\n` +
      `👑 *Maamulaha Sare:* Mulkiilaha ayaa Cardoso AI siiyay awoodda buuxda ee maamulka kooxdan!\n\n` +
      `🚀 *ISBEDDELLADA TOOSKA AH EE LA SAMEEYAY:*\n` +
      `🖼️ *AI Logo:* ${brandRes.pictureUpdated ? 'Sawir cusub oo 3D ah ayaa loo sameeyay laguna xidhay Profile Picture-ka!' : 'Muuqaalka kooxda waa la hubiyay!'}\n` +
      `📝 *Description:* Sharaxaad cusub oo heer caalami ah ayaa loo qoray kooxda.\n` +
      `🔒 *Settings:* Xogta kooxda waa la xidhay (Admins Only) si looga hortago qas iyo is-daba-marin.\n\n` +
      `⚡ *ILAALADA TOOSKA AH EE FIRFIRCOON (ACTIVE 24/7):*\n` +
      `🚫 *Anti-Link & Auto-Kick:* Xubin kasta oo link soo dhigta isla ilbiriqsigaas ayaa kooxda looga saarayaa fariinteedana loo tirtirayaa!\n` +
      `🛑 *Anti-Profanity (3-Strikes):* Ereyada xun, cayda iyo aflagaadada (Soomaali, Ingiriis, Carabi) ciqaab adag ayaa ka dhalanaysa.\n` +
      `🌊 *Anti-Flood:* Fariimaha is-daba-jooga ah iyo spam-ka toos ayaa loo tirtirayaa.\n` +
      `👋 *Auto-Welcome:* Qof kasta oo ku soo biira waxaa si toos ah loogu soo dhaweynayaa xeerarka kooxda.\n` +
      `💡 *Autonomous Topics:* Bot-ku wuxuu si toos ah u soo dhigi doonaa xikmado iyo doodo wax dhisaya.\n\n` +
      `📜 *XEERARKA RASMIGA AH EE KOOXDA:*\n` +
      `${profile.customRules.join('\n')}\n\n` +
      `_Kooxdu hadda waxay ku jirtaa gacmo aamin ah oo 100% autonomous ah!_ ✨`;

    return {
      success: true,
      subject: brandRes.subject,
      profile,
      announcement,
    };
  }

  // ─── 5. SMART CURFEW / NIGHT QUIET HOURS ENGINE ────────────────────────────

  /**
   * Sets or toggles smart night curfew for an auto-managed group.
   */
  public setCurfew(groupJid: string, enabled: boolean, startHour: number = 23, endHour: number = 6): CurfewConfig {
    const validStart = Math.min(Math.max(startHour, 0), 23);
    const validEnd = Math.min(Math.max(endHour, 0), 23);
    const existing = this.curfewConfigs.get(groupJid);
    const config: CurfewConfig = {
      enabled,
      startHour: validStart,
      endHour: validEnd,
      lastAppliedState: existing?.lastAppliedState,
    };
    this.curfewConfigs.set(groupJid, config);
    this.savePersistedCurfew();
    return config;
  }

  /**
   * Retrieves curfew config for a group.
   */
  public getCurfew(groupJid: string): CurfewConfig | undefined {
    return this.curfewConfigs.get(groupJid);
  }

  /**
   * Checks whether the group should be locked (night) or unlocked (day) based on curfew rules.
   * Default timezone: UTC+3 (Somalia/East Africa).
   */
  public checkCurfew(
    groupJid: string,
    currentHourOverride?: number
  ): { shouldAct: boolean; targetState?: 'locked' | 'unlocked'; reason?: string } {
    const config = this.curfewConfigs.get(groupJid);
    if (!config || !config.enabled) {
      return { shouldAct: false, reason: 'Curfew disabled or not configured' };
    }

    const d = new Date();
    // UTC+3 (Somali time)
    const somaliHour = currentHourOverride !== undefined ? currentHourOverride : (d.getUTCHours() + 3) % 24;

    const isNight =
      config.startHour > config.endHour
        ? somaliHour >= config.startHour || somaliHour < config.endHour
        : somaliHour >= config.startHour && somaliHour < config.endHour;

    if (isNight) {
      if (config.lastAppliedState !== 'locked') {
        return {
          shouldAct: true,
          targetState: 'locked',
          reason: `Night curfew active (${config.startHour}:00 - ${config.endHour}:00)`,
        };
      }
    } else {
      if (config.lastAppliedState === 'locked') {
        return {
          shouldAct: true,
          targetState: 'unlocked',
          reason: `Morning arrived (${config.endHour}:00). Curfew lift.`,
        };
      }
    }

    return { shouldAct: false, reason: 'State already matches current hour' };
  }

  /**
   * Applies curfew action on WhatsApp group settings and posts appropriate announcement.
   */
  public async applyCurfew(
    socket: any,
    groupJid: string,
    currentHourOverride?: number
  ): Promise<{ changed: boolean; state?: 'locked' | 'unlocked'; notice?: string }> {
    const check = this.checkCurfew(groupJid, currentHourOverride);
    if (!check.shouldAct || !check.targetState) {
      return { changed: false };
    }

    const config = this.curfewConfigs.get(groupJid)!;

    if (check.targetState === 'locked') {
      try {
        if (socket?.groupSettingUpdate) {
          await socket.groupSettingUpdate(groupJid, 'announcement');
        }
      } catch (e: any) {
        console.warn(`[GroupGovernor] Curfew lock failed: ${e?.message}`);
      }

      config.lastAppliedState = 'locked';
      this.savePersistedCurfew();

      const notice =
        `🌙 *[CARDOSO AI — SAACADDA NASASHADA & HURDADA (CURFEW)]* 😴\n\n` +
        `Dhammaan xubnaha sharafta leh, kooxda hadda waa la xidhay si xubnuhu u helaan nasasho iyo hurdo degan.\n\n` +
        `⏰ *Xilliga:* \`${config.startHour}:00 PM\` ilaa \`0${config.endHour}:00 AM\`\n` +
        `🌅 Subaxda hore saacadda 0${config.endHour}:00 AM ayaa dib loo furi doonaa insha'Allah.\n\n` +
        `_Hurdo wacan oo barakeysan dhammaantiin!_ 💤✨`;

      return { changed: true, state: 'locked', notice };
    } else {
      try {
        if (socket?.groupSettingUpdate) {
          await socket.groupSettingUpdate(groupJid, 'not_announcement');
        }
      } catch (e: any) {
        console.warn(`[GroupGovernor] Curfew unlock failed: ${e?.message}`);
      }

      config.lastAppliedState = 'unlocked';
      this.savePersistedCurfew();

      const notice =
        `🌅 *[CARDOSO AI — SUBAX WANAAGSAN & FURITAANKA KOOXDA]* ☀️\n\n` +
        `Asc dhammaan xubnaha kooxda! Xilligii hurdada waa dhammaaday, kooxdii dib ayaa loo furay.\n\n` +
        `🚀 Waxaan idiin rajaynaynaa maalin barakeysan oo nabad, caafimaad iyo guul leh!`;

      return { changed: true, state: 'unlocked', notice };
    }
  }

  // ─── 6. PERSISTENCE ───────────────────────────────────────────────────────

  private loadPersistedStrikes(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          for (const [groupJid, usersObj] of Object.entries(raw)) {
            const userMap = new Map<string, ParticipantStrikeRecord>();
            if (typeof usersObj === 'object' && usersObj !== null) {
              for (const [user, rec] of Object.entries(usersObj as any)) {
                userMap.set(user, rec as ParticipantStrikeRecord);
              }
            }
            this.strikes.set(groupJid, userMap);
          }
        }
      }
    } catch (e: any) {
      console.warn(`[GroupGovernor] Failed to load strikes: ${e?.message}`);
    }
  }

  private savePersistedStrikes(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const serialized: Record<string, Record<string, ParticipantStrikeRecord>> = {};
      for (const [groupJid, userMap] of this.strikes.entries()) {
        serialized[groupJid] = {};
        for (const [user, rec] of userMap.entries()) {
          serialized[groupJid][user] = rec;
        }
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(serialized, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[GroupGovernor] Failed to save strikes: ${e?.message}`);
    }
  }

  private loadPersistedCurfew(): void {
    try {
      if (fs.existsSync(this.curfewStoragePath)) {
        const raw = JSON.parse(fs.readFileSync(this.curfewStoragePath, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          for (const [groupJid, cfg] of Object.entries(raw)) {
            if (typeof cfg === 'object' && cfg !== null) {
              this.curfewConfigs.set(groupJid, cfg as CurfewConfig);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[GroupGovernor] Failed to load curfew: ${e?.message}`);
    }
  }

  private savePersistedCurfew(): void {
    try {
      const dir = path.dirname(this.curfewStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const serialized: Record<string, CurfewConfig> = {};
      for (const [groupJid, cfg] of this.curfewConfigs.entries()) {
        serialized[groupJid] = cfg;
      }
      fs.writeFileSync(this.curfewStoragePath, JSON.stringify(serialized, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[GroupGovernor] Failed to save curfew: ${e?.message}`);
    }
  }

  // ─── 7. POLYGLOT CODE INTELLIGENCE & AUTO-DEBUGGER ───────────────────────

  /**
   * Detects whether a message contains programming code in any major language:
   * Python, JavaScript, TypeScript, C++, Java, Go, Rust, PHP, SQL, HTML/CSS, Dart.
   */
  public detectCodeSnippet(text: string): { isCode: boolean; language: string; snippet: string } {
    if (!text || typeof text !== 'string') return { isCode: false, language: '', snippet: '' };

    const trimmed = text.trim();

    // 1. Fenced Markdown code blocks
    const fenceMatch = trimmed.match(/```([a-zA-Z0-9_+#-]+)?\s*([\s\S]+?)```/);
    if (fenceMatch) {
      const declaredLang = (fenceMatch[1] || '').toLowerCase().trim();
      const code = fenceMatch[2].trim();
      const lang = this.resolveLanguage(declaredLang || code);
      return { isCode: true, language: lang, snippet: code };
    }

    // 2. Unfenced polyglot language signatures
    const patterns: Array<{ lang: string; regex: RegExp }> = [
      { lang: 'python', regex: /(?:def\s+[a-zA-Z0-9_]+\s*\(|import\s+[a-zA-Z0-9_]+|class\s+[a-zA-Z0-9_]+:|\bprint\s*\(|if\s+__name__\s*==)/ },
      { lang: 'javascript', regex: /(?:const\s+[a-zA-Z0-9_]+\s*=|let\s+[a-zA-Z0-9_]+\s*=|function\s+[a-zA-Z0-9_]*\s*\(|console\.log\s*\(|=>\s*\{|interface\s+[A-Z]|export\s+(?:default\s+)?(?:class|function|const))/ },
      { lang: 'cpp', regex: /(?:#include\s*<[a-zA-Z0-9_.]+>|int\s+main\s*\(|std::cout|std::vector|printf\s*\()/ },
      { lang: 'java', regex: /(?:public\s+class\s+[A-Z]|public\s+static\s+void\s+main|System\.out\.println)/ },
      { lang: 'go', regex: /(?:package\s+main|func\s+[a-zA-Z0-9_]+\s*\(|fmt\.Println)/ },
      { lang: 'rust', regex: /(?:fn\s+main\s*\(|let\s+mut\s+[a-zA-Z0-9_]+|println!\s*\(|impl\s+[A-Z])/ },
      { lang: 'sql', regex: /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO\s+|CREATE\s+TABLE\s+|UPDATE\s+.+\s+SET|DELETE\s+FROM)\b/i },
      { lang: 'php', regex: /(?:<\?php|\$[a-zA-Z0-9_]+\s*=|echo\s+["'])/ },
      { lang: 'html', regex: /(?:<!DOCTYPE\s+html>|<html|<div\s+class=|<body)/i },
      { lang: 'dart', regex: /(?:void\s+main\s*\(|Widget\s+build|StatelessWidget|StatefulWidget)/ },
    ];

    for (const p of patterns) {
      if (p.regex.test(trimmed)) {
        return { isCode: true, language: p.lang, snippet: trimmed };
      }
    }

    return { isCode: false, language: '', snippet: '' };
  }

  private resolveLanguage(hintOrCode: string): string {
    const h = hintOrCode.toLowerCase();
    if (h.includes('py')) return 'python';
    if (h.includes('js') || h.includes('javascript') || h.includes('node')) return 'javascript';
    if (h.includes('ts') || h.includes('typescript')) return 'typescript';
    if (h.includes('c++') || h.includes('cpp')) return 'cpp';
    if (h.includes('java')) return 'java';
    if (h.includes('go') || h.includes('golang')) return 'go';
    if (h.includes('rust') || h.includes('rs')) return 'rust';
    if (h.includes('sql')) return 'sql';
    if (h.includes('php')) return 'php';
    if (h.includes('html')) return 'html';
    if (h.includes('dart') || h.includes('flutter')) return 'dart';
    return 'code';
  }

  /**
   * Generates a Principal Software Architect review & debugging analysis for code shared in the group.
   */
  public async reviewCodeSnippet(snippet: string, language: string, aiOrchestrator?: any): Promise<string> {
    const langLabel = language.toUpperCase();
    if (aiOrchestrator && typeof aiOrchestrator.generateResponse === 'function') {
      try {
        const prompt =
          `You are Cardoso AI, a world-class Principal Polyglot Software Architect moderating a WhatsApp tech community.\n` +
          `A member just shared this ${langLabel} code snippet:\n\n` +
          `\`\`\`${language}\n${snippet}\n\`\`\`\n\n` +
          `Provide an instant, brilliant code review formatted for WhatsApp:\n` +
          `1. 🐞 *Khaladaadka & Bugs:* Point out any bugs, syntax issues, or anti-patterns.\n` +
          `2. ⚡ *Koodhka Saxda ah (Optimized):* Provide the clean, modern corrected version in \`\`\`${language}.\n` +
          `3. ⏱️ *Complexity:* State Big-O Time & Space complexity.\n` +
          `4. 💡 *Xikmad & Talo:* 1-2 sentences of explanation in clear Somali.\n` +
          `Keep it concise and readable on mobile!`;

        const res = await aiOrchestrator.generateResponse(prompt, [], { maxOutputTokens: 600, temperature: 0.2 });
        if (res?.text?.trim()) {
          return `👨‍💻⚡ *[CARDOSO AI — CODE GUARDIAN & ARCHITECT (${langLabel})]* ⚡👨‍💻\n\n` + res.text.trim();
        }
      } catch (err: any) {
        console.warn(`[GroupGovernor] AI code review failed, using fallback: ${err?.message}`);
      }
    }

    // Offline / Fallback Review
    return (
      `👨‍💻⚡ *[CARDOSO AI — CODE GUARDIAN & ARCHITECT (${langLabel})]* ⚡👨‍💻\n\n` +
      `🌐 *Luuqadda:* \`${langLabel}\`\n` +
      `🔍 *Xaaladda Koodhka:* Koodhka waa la aqoonsaday waana la falanqeeyay.\n\n` +
      `💡 *Talada Injineerka:* Hubi syntax-ka, loop boundaries, iyo xogta soo galaysa (input sanitization).\n\n` +
      `_Bot-ku wuxuu si toos ah u taageeraa Python, JS/TS, C++, Java, Go, Rust, SQL, iyo PHP._`
    );
  }

  // ─── 8. AUTONOMOUS MEDIA VISION SAFETY SHIELD ─────────────────────────────

  /**
   * Scans incoming images for adult content, nudity, or graphic gore using Gemini Vision.
   */
  public async screenMediaSafety(
    media: { mimeType: string; dataBase64: string },
    aiOrchestrator?: any
  ): Promise<{ isViolating: boolean; reason?: string }> {
    if (!aiOrchestrator || typeof aiOrchestrator.generateResponse !== 'function') {
      return { isViolating: false };
    }

    try {
      const prompt =
        `You are a strict WhatsApp group content moderator. Inspect this image:\n` +
        `- Does it contain nudity, pornography, explicit adult content, extreme gore, or graphic violence?\n` +
        `Reply strictly with either:\n` +
        `"SAFE"\n` +
        `or\n` +
        `"VIOLATION: <brief 3-5 word reason>"`;

      const res = await aiOrchestrator.generateResponse(prompt, [], {
        maxOutputTokens: 50,
        temperature: 0.1,
        media: {
          mimeType: media.mimeType,
          dataBase64: media.dataBase64,
        },
      });

      const text = res?.text?.trim() || '';
      if (text.startsWith('VIOLATION:')) {
        const reason = text.replace('VIOLATION:', '').trim() || 'Sawir anshax-xumo ah ama mamnuuc ah';
        return { isViolating: true, reason };
      }
      return { isViolating: false };
    } catch (err: any) {
      console.warn(`[GroupGovernor] Media safety screen error: ${err?.message}`);
      return { isViolating: false };
    }
  }

  // ─── 9. AUTONOMOUS COMMUNITY EVENING SUMMARIZER ───────────────────────────

  public shouldPostEveningSummary(groupJid: string, currentHourOverride?: number): boolean {
    const d = new Date();
    const somaliHour = currentHourOverride !== undefined ? currentHourOverride : (d.getUTCHours() + 3) % 24;
    // Evening summary fires at 21:00 (9:00 PM) Somali time
    if (somaliHour !== 21) return false;

    const lastPosted = this.lastEveningSummaryTimestamps.get(groupJid) || 0;
    const now = Date.now();
    // Only post once every 18 hours
    return now - lastPosted > 18 * 60 * 60 * 1000;
  }

  public recordEveningSummaryPosted(groupJid: string): void {
    this.lastEveningSummaryTimestamps.set(groupJid, Date.now());
  }

  public async generateEveningSummary(
    groupSubject: string,
    recentMessages: { sender: string; text: string; timestamp: number }[],
    aiOrchestrator?: any
  ): Promise<string> {
    const cleanSubject = groupSubject || 'Kooxda';
    if (recentMessages.length < 3) {
      return (
        `📝 *[CARDOSO AI — DULMARKA & FAALADA MAANTA]* 🌙✨\n\n` +
        `👥 *Kooxda:* *${cleanSubject}*\n` +
        `📊 *Xaaladda:* Maanta kooxdu waxay ahayd mid deggan oo xasiloon.\n\n` +
        `_Waxaan idiin rajaynaynaa habeen nabad iyo hurdo wacan dhammaantiin!_ 💤`
      );
    }

    if (aiOrchestrator && typeof aiOrchestrator.generateResponse === 'function') {
      try {
        const transcript = recentMessages
          .slice(-30)
          .map(m => `- ${m.text.slice(0, 150)}`)
          .join('\n');

        const prompt =
          `You are Cardoso AI, community moderator for WhatsApp group "${cleanSubject}".\n` +
          `Here are recent messages discussed in the group today:\n${transcript}\n\n` +
          `Write a warm, engaging, and professional 3-bullet point evening summary in Somali:\n` +
          `- Highlight key topics, questions, or ideas discussed\n` +
          `- Wish everyone a restful good night.\n` +
          `Keep it concise, inspirational, and formatted with clean WhatsApp emojis.`;

        const res = await aiOrchestrator.generateResponse(prompt, [], { maxOutputTokens: 350, temperature: 0.5 });
        if (res?.text?.trim()) {
          return `📝 *[CARDOSO AI — DULMARKA & FAALADA DOODDII MAANTA]* 🌙✨\n\n👥 *Kooxda:* *${cleanSubject}*\n\n` + res.text.trim();
        }
      } catch (err: any) {
        console.warn(`[GroupGovernor] AI summary failed, using fallback: ${err?.message}`);
      }
    }

    return (
      `📝 *[CARDOSO AI — DULMARKA & FAALADA DOODDII MAANTA]* 🌙✨\n\n` +
      `👥 *Kooxda:* *${cleanSubject}*\n` +
      `📌 *Nuxurka:* Maanta waxaa kooxda lagu wadaagay fikrado, su'aalo iyo xogo wax-ku-ool ah.\n` +
      `💡 *Xusuusin:* Barashada iyo is-kaashiga ayaa saldhig u ah guusha bulshada.\n\n` +
      `_Hurdo wacan oo barakeysan dhammaantiin!_ 💤✨`
    );
  }

  // ─── 10. MEMBER ACTIVITY AUDITING (INACTIVE PRUNER) ───────────────────────

  public recordMemberActivity(groupJid: string, participantJid: string): void {
    let groupMap = this.memberActivityHistory.get(groupJid);
    if (!groupMap) {
      groupMap = new Map();
      this.memberActivityHistory.set(groupJid, groupMap);
    }
    const cleanUser = participantJid.split('@')[0].split(':')[0];
    groupMap.set(cleanUser, Date.now());
  }

  public getInactiveMembers(groupJid: string, daysThreshold: number = 30): string[] {
    const groupMap = this.memberActivityHistory.get(groupJid);
    if (!groupMap) return [];
    const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const inactives: string[] = [];
    for (const [user, lastActive] of groupMap.entries()) {
      if (now - lastActive > thresholdMs) {
        inactives.push(user);
      }
    }
    return inactives;
  }

  // ─── 11. DAILY QUIZ & GROUP LEADERBOARD ───────────────────────────────────

  /** Quiz scores: Map<groupJid, Map<participantJid, { correct: number; wrong: number; name?: string }>> */
  private quizScores: Map<string, Map<string, { correct: number; wrong: number; name?: string }>> = new Map();

  /** Track the last daily quiz timestamp per group */
  private lastDailyQuizTimestamps: Map<string, number> = new Map();

  /** Current live quiz state per group: question + options + correctIndex + timer + winners tracking */
  private activeQuizzes: Map<
    string,
    {
      question: string;
      options: string[];
      correctIndex: number;
      createdAt: number;
      expiresAt: number;
      announced: boolean;
      correctParticipants: Map<string, { phone: string; name?: string; timestamp: number }>;
    }
  > = new Map();

  /** Track weekly Thursday awards date per group */
  private lastThursdayAwardsDates: Map<string, string> = new Map();

  public shouldPostDailyQuiz(groupJid: string): boolean {
    const now = Date.now();
    const lastPosted = this.lastDailyQuizTimestamps.get(groupJid) || 0;
    return now - lastPosted > 20 * 60 * 60 * 1000; // Once every 20 hours
  }

  public recordDailyQuizPosted(groupJid: string): void {
    this.lastDailyQuizTimestamps.set(groupJid, Date.now());
  }

  /**
   * Generates a multiple-choice quiz question tuned to the group's niche.
   * STRICT RULE: Never asks coding questions in non-coding groups!
   * Returns { pollTitle, options, correctIndex }.
   */
  public async generateDailyQuiz(
    groupJid: string,
    groupSubject: string,
    groupDesc: string,
    aiOrchestrator?: any
  ): Promise<{ pollTitle: string; options: string[]; correctIndex: number }> {
    const profile = this.analyzeGroup(groupSubject, groupDesc);

    const nicheQuizBank: Record<string, { pollTitle: string; options: string[]; correctIndex: number }[]> = {
      tech: [
        { pollTitle: '💻 Su\'aal Tech: Luuqadee JavaScript ayaa loo isticmaalo?', options: ['Dhinac Browser kaliya', 'Server (Node.js)', 'Labadaba (Browser & Node.js)', 'AI Only'], correctIndex: 2 },
        { pollTitle: '🧠 Yuu abuurtay Linux OS?', options: ['Bill Gates', 'Linus Torvalds', 'Steve Jobs', 'Mark Zuckerberg'], correctIndex: 1 },
        { pollTitle: '🔑 HTTP iyo HTTPS waxa kala aha?', options: ['Waxba kala ma ahan', 'HTTPS waa xog sir ah oo secured ah', 'HTTP ayaa ka dhakhso badan', 'HTTPS wax qiimo ah ma leh'], correctIndex: 1 },
      ],
      education: [
        { pollTitle: '📚 Meelma caalamka ugu badan ardayda jaamacadda ah?', options: ['USA', 'China', 'India', 'Brazil'], correctIndex: 1 },
        { pollTitle: '🎓 Jaamacadee adduunka ugu da-weyn ee wali furan?', options: ['Harvard', 'Oxford', 'Jaamacadda Al-Qarawiyyin / Al-Azhar', 'MIT'], correctIndex: 2 },
        { pollTitle: '📖 Luuqaddee adduunka ugu badan ee dad u dhasheen ku hadlaan?', options: ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'], correctIndex: 2 },
      ],
      business: [
        { pollTitle: '💰 Shirkadee caalamka ugu qiimaha sarreeya suuqa?', options: ['Microsoft', 'Apple', 'Google', 'Amazon'], correctIndex: 1 },
        { pollTitle: '📈 Waa maxay macnaha "ROI" ee ganacsiga?', options: ['Rate Of Income', 'Return On Investment (Faa\'iidada Maalgashiga)', 'Risk Of Inflation', 'Revenue Over Index'], correctIndex: 1 },
        { pollTitle: '🏦 Waa maxay hantida loo yaqaan "Digital Asset"?', options: ['Hanti elektaroonig ah sida Software ama Crypto', 'Lacag waraaq ah oo bangi ku jirta', 'Dahab dhab ah oo qasnada yaal', 'Dhul iyo guryo'], correctIndex: 0 },
      ],
      islamic: [
        { pollTitle: '🌙 Suuradda ugu horreysay ee lagu soo dejiyay Nebiga (NNKH)?', options: ['Suuradda Al-Faatixa', 'Suuradda Al-Calaq (Iqra)', 'Suuradda Al-Baqarah', 'Suuradda Al-Mudathir'], correctIndex: 1 },
        { pollTitle: '📿 Quraanka kariimka suuraddee ugu dheer?', options: ['Al-Baqarah', 'Aal-Cimraan', 'An-Nisaa', 'Al-Maa\'idah'], correctIndex: 0 },
        { pollTitle: '🕌 Masaajidkee caalamka Islaamka ugu weyn uguna fadliga badan?', options: ['Masaajidka Al-Aqsa', 'Masaajidka Al-Xaram ee Makkah', 'Masaajidka Nabiga ee Madiina', 'Masaajidka Umawiyiinta'], correctIndex: 1 },
        { pollTitle: '📖 Imisa suuradood ayaa ku jira Quraanka Kariimka ah?', options: ['114 Suuradood', '112 Suuradood', '110 Suuradood', '120 Suuradood'], correctIndex: 0 },
        { pollTitle: '🌍 Buurta ugu dheer dalkeena Soomaaliya magaceeda?', options: ['Buur Hakaba', 'Buurta Shimbiris (Surud Cad)', 'Buuraha Daallo', 'Golis'], correctIndex: 1 },
      ],
      community: [
        { pollTitle: '🌍 Magaalada caasimadda ah ee Soomaaliya waa tee?', options: ['Hargeysa', 'Kismaayo', 'Muqdisho', 'Garoowe'], correctIndex: 2 },
        { pollTitle: '🌟 Muxuu yahay habka ugu fiican ee loo maareeyo waqtiga?', options: ['Jadwal & Yoolal maalinle ah', 'In shaqada la dib dhigo', 'In habeenkii kaliya la shaqeeyo', 'In qof kale laga sugo'], correctIndex: 0 },
        { pollTitle: '🏆 Guusha ugu weyn ee kooxaha bulshada iyo dhalinyarada?', options: ['Lacagta kaliya', 'Is-kaashiga, daacadnimada iyo midnimada', 'Tirada badan oo aan tayo lahayn', 'Admin badan'], correctIndex: 1 },
        { pollTitle: '💪 Astaanta ugu muhiimsan ee dhalinyarada guusha gaarta?', options: ['Dulqaadka & Joogtaynta hawsha', 'Cabsi joogto ah', 'Kalsooni darro', 'In laga quusto fashilka'], correctIndex: 0 },
      ],
    };

    const isTech = profile.category === 'tech';
    const niche = isTech ? 'tech' : (profile.category in nicheQuizBank ? profile.category : 'community');
    const quizBank = nicheQuizBank[niche] || nicheQuizBank['community'];
    const baseQuiz = quizBank[Math.floor(Math.random() * quizBank.length)];

    // Try AI for a fresh dynamic question strictly respecting the group's niche
    if (aiOrchestrator && typeof aiOrchestrator.generateResponse === 'function') {
      try {
        const strictTopicConstraint = isTech
          ? 'Topic: Technical, computer science, software architecture or web programming.'
          : `CRITICAL STRICT RULE: NEVER ask programming, coding, JavaScript, Python or IT developer questions. This group is "${profile.categoryLabel}". Ask strictly about ${profile.category === 'islamic' ? 'Islamic knowledge, Quran, Hadith, Prophets, or Somali cultural wisdom/geography' : 'youth self-development, leadership, habits, general knowledge, or Somali history'}.`;

        const prompt =
          `You are Cardoso AI for WhatsApp group "${groupSubject}" (${profile.categoryLabel}).\n` +
          `${strictTopicConstraint}\n` +
          `Create ONE engaging multiple-choice quiz question relevant to this group's members.\n` +
          `Format exactly as JSON:\n` +
          `{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correctIndex": 0}\n` +
          `- correctIndex is 0-based index of the correct option\n` +
          `- Keep question short (max 80 chars), suitable for WhatsApp poll\n` +
          `- DO NOT include checkmarks (✅) in the options list so the answer is never spoiled before voting\n` +
          `- Language: Somali`;

        const res = await aiOrchestrator.generateResponse(prompt, [], { maxOutputTokens: 200, temperature: 0.7 });
        if (res?.text?.trim()) {
          const jsonMatch = res.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.question && Array.isArray(parsed.options) && parsed.options.length >= 2) {
              const cleanedOptions = parsed.options.slice(0, 4).map((opt: string) => opt.replace(/[✅✔]/g, '').trim());
              return {
                pollTitle: `🧠 ${parsed.question}`,
                options: cleanedOptions,
                correctIndex: typeof parsed.correctIndex === 'number' ? parsed.correctIndex : 0,
              };
            }
          }
        }
      } catch (err: any) {
        console.warn(`[GroupGovernor] AI quiz generation failed, using bank: ${err?.message}`);
      }
    }

    return baseQuiz;
  }

  public setActiveQuiz(
    groupJid: string,
    question: string,
    options: string[],
    correctIndex: number,
    ttlMs: number = 15 * 60 * 1000
  ): void {
    this.activeQuizzes.set(groupJid, {
      question,
      options,
      correctIndex,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      announced: false,
      correctParticipants: new Map(),
    });
  }

  public getActiveQuiz(groupJid: string): { question: string; options: string[]; correctIndex: number; expiresAt: number } | null {
    const quiz = this.activeQuizzes.get(groupJid);
    if (!quiz) return null;
    if (Date.now() > quiz.expiresAt) {
      // Don't auto-delete if not yet announced; checkExpiredQuizToAnnounce will handle it
      if (quiz.announced) {
        this.activeQuizzes.delete(groupJid);
        return null;
      }
    }
    return quiz;
  }

  public recordQuizAnswer(
    groupJid: string,
    participantJid: string,
    selectedIndex: number,
    participantName?: string
  ): { correct: boolean; correctAnswer: string } | null {
    const quiz = this.activeQuizzes.get(groupJid);
    if (!quiz) return null;
    if (Date.now() > quiz.expiresAt && quiz.announced) return null;

    const correct = selectedIndex === quiz.correctIndex;
    const cleanUser = participantJid.split('@')[0].split(':')[0];

    let groupMap = this.quizScores.get(groupJid);
    if (!groupMap) {
      groupMap = new Map();
      this.quizScores.set(groupJid, groupMap);
    }
    const existing = groupMap.get(cleanUser) || { correct: 0, wrong: 0, name: participantName || cleanUser };
    if (participantName && !existing.name) existing.name = participantName;

    if (correct) {
      existing.correct += 1;
      if (quiz.correctParticipants && !quiz.correctParticipants.has(cleanUser)) {
        quiz.correctParticipants.set(cleanUser, {
          phone: cleanUser,
          name: participantName || cleanUser,
          timestamp: Date.now(),
        });
      }
    } else {
      existing.wrong += 1;
    }
    groupMap.set(cleanUser, existing);

    return { correct, correctAnswer: quiz.options[quiz.correctIndex] };
  }

  /**
   * Checks if an active quiz reached its 15-minute expiration and needs its winners announced.
   * Returns quiz details and the list of winners who answered correctly, or null.
   */
  public checkExpiredQuizToAnnounce(groupJid: string): {
    question: string;
    correctAnswer: string;
    winners: Array<{ phone: string; name: string; elapsedSeconds: number }>;
  } | null {
    const quiz = this.activeQuizzes.get(groupJid);
    if (!quiz || quiz.announced) return null;
    if (Date.now() >= quiz.expiresAt) {
      quiz.announced = true;
      const winners: Array<{ phone: string; name: string; elapsedSeconds: number }> = [];
      if (quiz.correctParticipants) {
        for (const [phone, p] of quiz.correctParticipants.entries()) {
          const elapsed = Math.max(1, Math.round((p.timestamp - (quiz.createdAt || (quiz.expiresAt - 15 * 60 * 1000))) / 1000));
          winners.push({ phone, name: p.name || phone, elapsedSeconds: elapsed });
        }
      }
      return {
        question: quiz.question,
        correctAnswer: quiz.options[quiz.correctIndex],
        winners,
      };
    }
    return null;
  }

  /**
   * Checks if Thursday weekly awards should be posted for this group (Every Thursday at 20:00 EAT).
   */
  public shouldPostThursdayAwards(groupJid: string, customDate?: Date): boolean {
    const now = customDate || new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const eat = new Date(utc + 3 * 3600000);

    // Thursday is day 4 (Sunday=0, Thursday=4)
    if (eat.getDay() !== 4) return false;
    // Post at 20:00 (8:00 PM) or after
    if (eat.getHours() < 20) return false;

    const dateKey = `${eat.getFullYear()}-${eat.getMonth() + 1}-${eat.getDate()}`;
    const lastDate = this.lastThursdayAwardsDates.get(groupJid);
    return lastDate !== dateKey;
  }

  public recordThursdayAwardsPosted(groupJid: string, customDate?: Date): void {
    const now = customDate || new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const eat = new Date(utc + 3 * 3600000);
    const dateKey = `${eat.getFullYear()}-${eat.getMonth() + 1}-${eat.getDate()}`;
    this.lastThursdayAwardsDates.set(groupJid, dateKey);
  }

  public getLeaderboard(groupJid: string, topN: number = 10): Array<{ user: string; correct: number; wrong: number; score: number }> {
    const groupMap = this.quizScores.get(groupJid);
    if (!groupMap) return [];
    const entries: Array<{ user: string; correct: number; wrong: number; score: number }> = [];
    for (const [user, s] of groupMap.entries()) {
      entries.push({ user, correct: s.correct, wrong: s.wrong, score: s.correct * 10 - s.wrong * 2 });
    }
    return entries.sort((a, b) => b.score - a.score).slice(0, topN);
  }

  // ─── 12. SCHEDULED ANNOUNCEMENTS ──────────────────────────────────────────

  private scheduledAnnouncements: Map<string, Array<{ hour: number; minute: number; message: string; id: string }>> = new Map();

  public scheduleAnnouncement(groupJid: string, hour: number, minute: number, message: string): string {
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let list = this.scheduledAnnouncements.get(groupJid) || [];
    list.push({ hour, minute, message, id });
    this.scheduledAnnouncements.set(groupJid, list);
    return id;
  }

  public checkScheduledAnnouncements(groupJid: string, currentHour: number, currentMinute: number): Array<{ message: string; id: string }> {
    const list = this.scheduledAnnouncements.get(groupJid) || [];
    const due: Array<{ message: string; id: string }> = [];
    const remaining: typeof list = [];

    for (const ann of list) {
      if (ann.hour === currentHour && ann.minute === currentMinute) {
        due.push({ message: ann.message, id: ann.id });
      } else {
        remaining.push(ann);
      }
    }

    if (due.length > 0) {
      this.scheduledAnnouncements.set(groupJid, remaining);
    }

    return due;
  }

  public listScheduledAnnouncements(groupJid: string): Array<{ hour: number; minute: number; message: string; id: string }> {
    return this.scheduledAnnouncements.get(groupJid) || [];
  }

  public cancelScheduledAnnouncement(groupJid: string, id: string): boolean {
    const list = this.scheduledAnnouncements.get(groupJid) || [];
    const filtered = list.filter(a => a.id !== id);
    const removed = filtered.length < list.length;
    this.scheduledAnnouncements.set(groupJid, filtered);
    return removed;
  }
}

export const groupGovernorService = new GroupGovernorService();

