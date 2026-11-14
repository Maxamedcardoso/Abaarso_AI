import fs from 'fs';
import path from 'path';
import { proto } from '@whiskeysockets/baileys';
import { MediaProcessorService } from './media-processor.service.js';
import { broadcastService } from './broadcast.service.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { config } from '../config/env.js';
import { UserProfiler } from './user-profiler.service.js';

export type StatusReactorMode = 'reaction' | 'comment' | 'both';

export interface StatusReactorConfig {
  enabled: boolean;
  autoReact: boolean;
  autoComment: boolean;
  mode: StatusReactorMode;
  cooldownHours: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  aiEnhanced: boolean;
}

export type StatusCategory =
  | 'graduation'
  | 'wedding'
  | 'business'
  | 'funny'
  | 'islamic_friday'
  | 'islamic_duco'
  | 'condolence'
  | 'illness'
  | 'travel'
  | 'style_selfie'
  | 'general_quote'
  | 'video'
  | 'media_only';

export interface StatusAnalysisResult {
  category: StatusCategory;
  suggestedEmojis: string[];
  suggestedComments: string[];
  extractedText: string;
  hasMedia: boolean;
  mediaKind?: string;
  gender?: 'male' | 'female' | 'unknown';
  confidence: number;
}

export interface StatusInteractionLog {
  id: string;
  senderJid: string;
  senderName: string;
  type: 'reaction' | 'comment';
  content: string;
  category: StatusCategory;
  statusText: string;
  timestamp: number;
}

export interface SentStatusCommentContext {
  senderJid: string;
  senderName: string;
  gender: 'male' | 'female' | 'unknown';
  commentText: string;
  category: StatusCategory;
  statusText: string;
  timestamp: number;
  messageId?: string;
}

export class StatusReactorService {
  private configPath: string;
  private config: StatusReactorConfig;
  private lastContactInteraction: Map<string, number> = new Map();
  private interactionLogs: StatusInteractionLog[] = [];
  private aiOrchestrator: AIOrchestrator | null = null;
  private pendingTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // Context tracking for conversational follow-ups and reply continuity
  private recentCommentsByContact: Map<string, SentStatusCommentContext> = new Map();
  private commentByMsgId: Map<string, SentStatusCommentContext> = new Map();
  private recentCommentHistory: string[] = [];

  constructor(customConfigPath?: string) {
    this.configPath = customConfigPath || path.resolve(process.cwd(), 'data', 'status_reactor_config.json');
    this.config = this.loadConfig();
  }

  public setAIOrchestrator(ai: AIOrchestrator): void {
    this.aiOrchestrator = ai;
  }

  private loadConfig(): StatusReactorConfig {
    const defaults: StatusReactorConfig = {
      enabled: true,
      autoReact: true,
      autoComment: true,
      mode: 'both',
      cooldownHours: 0, // Cooldown removed per user request (0 = disabled)
      minDelaySeconds: 10,
      maxDelaySeconds: 30,
      aiEnhanced: true,
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...defaults, ...parsed };
      }
    } catch (e: any) {
      console.warn(`[StatusReactor] Could not read config file, using defaults: ${e?.message}`);
    }
    return defaults;
  }

  public saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[StatusReactor] Failed to save config: ${e?.message}`);
    }
  }

  public getConfig(): StatusReactorConfig {
    return { ...this.config };
  }

  public setConfig(updates: Partial<StatusReactorConfig>): StatusReactorConfig {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
    return this.getConfig();
  }

  public getRecentInteractions(): StatusInteractionLog[] {
    return [...this.interactionLogs].reverse().slice(0, 30);
  }

  /**
   * Determines if the status author is the bot owner or an admin.
   * Per user requirement: "status waxaan soo dhigan bot yaanu wax jawaaba ka bixin dadka kale haka bixiyo"
   */
  public isAdminOrSelf(senderJid: string, isFromMe?: boolean, socket?: any): boolean {
    if (isFromMe) return true;
    if (!senderJid) return false;

    const cleanSender = senderJid.replace(/[^0-9]/g, '');

    // Check against connected bot user JID and LID
    const socketOwnJid = socket?.user?.id ? socket.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
    const socketOwnLid = (socket?.user as any)?.lid ? (socket.user as any).lid.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
    if (socketOwnJid && (cleanSender.endsWith(socketOwnJid) || socketOwnJid.endsWith(cleanSender))) {
      return true;
    }
    if (socketOwnLid && (cleanSender.endsWith(socketOwnLid) || socketOwnLid.endsWith(cleanSender))) {
      return true;
    }

    // Check configured admin phone numbers
    const adminNumbers = config.security.adminPhoneNumbers || [];
    if (adminNumbers.some(admin => cleanSender.endsWith(admin) || admin.endsWith(cleanSender))) {
      return true;
    }

    return false;
  }

  /**
   * Checks whether a contact is currently in cooldown to prevent spamming.
   * If cooldownHours is 0, cooldown is disabled and returns false immediately.
   */
  public isCooldownActive(jid: string): boolean {
    if (this.config.cooldownHours <= 0) return false;
    const last = this.lastContactInteraction.get(jid);
    if (!last) return false;
    const cooldownMs = this.config.cooldownHours * 3600 * 1000;
    return Date.now() - last < cooldownMs;
  }

  public recordInteraction(log: StatusInteractionLog): void {
    this.lastContactInteraction.set(log.senderJid, log.timestamp);
    this.interactionLogs.push(log);
    if (this.interactionLogs.length > 200) {
      this.interactionLogs.shift();
    }
  }

  public resetCooldowns(): void {
    this.lastContactInteraction.clear();
  }

  /**
   * Context memory for status replies and gratitude continuity
   */
  public recordSentStatusComment(context: SentStatusCommentContext): void {
    this.recentCommentsByContact.set(context.senderJid, context);
    if (context.messageId) {
      this.commentByMsgId.set(context.messageId, context);
    }
    this.recentCommentHistory.push(context.commentText);
    if (this.recentCommentHistory.length > 50) {
      this.recentCommentHistory.shift();
    }
  }

  public getRecentCommentForContact(contactJid: string): SentStatusCommentContext | undefined {
    const cleanJid = contactJid.split('@')[0].replace(/[^0-9]/g, '');
    for (const [key, val] of this.recentCommentsByContact.entries()) {
      const cleanKey = key.split('@')[0].replace(/[^0-9]/g, '');
      if (cleanKey === cleanJid || cleanKey.endsWith(cleanJid) || cleanJid.endsWith(cleanKey)) {
        // Valid within 45 minutes
        if (Date.now() - val.timestamp < 45 * 60 * 1000) {
          return val;
        }
      }
    }
    return undefined;
  }

  public getCommentByMsgId(msgId: string): SentStatusCommentContext | undefined {
    return this.commentByMsgId.get(msgId);
  }

  /**
   * Intelligently analyzes WhatsApp Status text & media to determine category, emojis, and comments.
   * Differentiates gender (raga vs dumarka) and media type (qoraal, sawir, video).
   */
  public analyzeStatus(
    text: string,
    hasMedia: boolean = false,
    mediaKind?: string,
    gender: 'male' | 'female' | 'unknown' = 'unknown'
  ): StatusAnalysisResult {
    const clean = (text || '').trim();
    const lower = clean.toLowerCase();

    // 1. Condolence / Tacsi / Geeri (HIGHEST PRIORITY - must never receive celebratory reactions)
    if (
      /\b(innalillahi|inaa lilaahi|geeri|geeriyooday|geeriyootay|tacsiyo|tacsi|samir|allaha u naxariisto|ilaahay ha u naxariisto|marxuum|marxuumad)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Allaha idinka siiyo sxb, marxuumkana jannadii fardowsa 🤲',
        'Ilaahay ha u naxariisto sxb qaali, qabrigana ha u nuuro, samir iyo iimaanna Allaha idinka siiyo 🤲',
        'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Allaha kaa siiyo walaal 🤲',
      ];
      const femaleList = [
        'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Allaha idinka siiyo abaayo, marxuumkana jannadii fardowsa 🤲',
        'Ilaahay ha u naxariisto abaayo macaan, samir iyo iimaanna Allaha kugu arzuqo 🤲',
        'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Allaha kaa siiyo abaayo 🤲',
      ];
      const neutralList = [
        'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Ilaahay ha idinka siiyo, marxuumkana jannadii fardowsa 🤲',
        'Ilaahay ha u naxariisto, qabrigana ha u nuuro, samir iyo iimaanna ha idinka siiyo walaal 🤲',
      ];

      return {
        category: 'condolence',
        suggestedEmojis: ['🤲'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.99,
      };
    }

    // 2. Illness / Xanuun / Caafimaad-darro
    if (
      /\b(xanuunsan|isbitaal|hospital|caafimaad darro|shifa|ilaahay ha caafiyo|allaha caafiyo|bogsasho)\b/i.test(lower)
    ) {
      const maleList = [
        'Ilaahay shifa taam ah iyo caafimaad degdeg ah ha siiyo sxb, aamiin yaa rabbi 🤲',
        'Rabi xanuunka ha ka qaado bro, caafimaad taam ahna ha ugu beddelo 🤲✨',
        'Allaha caafiyo sxb qaali, shifa degdeg ah ayaan u rajaynayaa 🤲',
      ];
      const femaleList = [
        'Ilaahay shifa degdeg ah iyo caafimaad taam ah ha siiyo abaayo macaan 🤲🌸',
        'Rabi xanuunka ha ka fududeeyo abaayo, caafimaad khayr lehna ha ugu beddelo 🤲✨',
        'Allaha caafiyo abaayo qaali, aamiin yaa rabbi 🤲',
      ];
      const neutralList = [
        'Ilaahay shifa taam ah iyo caafimaad degdeg ah ha siiyo, aamiin yaa rabbi 🤲',
        'Rabi xanuunka ha ka qaado, caafimaad degdeg ahna ha ugu beddelo 🤲✨',
      ];

      return {
        category: 'illness',
        suggestedEmojis: ['🤲'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.95,
      };
    }

    // 3. Graduation / Qalinjabin / Guul Waxbarasho
    if (
      /\b(qalin[\w-]*|graduation|bachelor|master|phd|shahaado|diploma|congrats|congratulations|hambalyo|jaamacad[\w-]*|degree|alxamdulilah dhameeyay|graduated)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        "Masha'Allah hambalyo sxb qaali! Guul iyo mustaqbal ifaya ayaan kuu rajaynayaa 🎓👏",
        "Hambalyo guusha weyn geesi! Waxaad tahay nin ku dayasho mudan bro! 🎓🔥",
        "Masha'Allah hambalyo qalinjabinta sxb! Cilmigaaga Allaha kuu barakeeyo 🎓✨",
        "Aad baad u dadaashay ninyahow, hambalyo guusha weyn! 👏🎉",
        "Guul weyn weeye bro, hambalyo mar labaad iyo mar saddexaadba! 🎓🌟",
      ];
      const femaleList = [
        "Masha'Allah hambalyo abaayo macaan! Guul iyo mustaqbal ifaya ayaan kuu rajaynayaa 🎓🌸",
        "Hambalyo qalinjabinta abaayo! Allaha kuu barakeeyo shahaadada qaaliga ah 🎓✨",
        "Masha'Allah aad baad u dadaashay walaashay, guul mar kasta! 👏💐",
        "Hambalyo weyn abaayo qaali, waxaad tahay qof lagu faano! 🎓🎉",
        "Masha'Allah bash-bash iyo guul joogto ah abaayo! 🎓❤️",
      ];
      const neutralList = [
        "Masha'Allah, hambalyo walaal! Guul iyo mustaqbal wanaagsan ayaan kuu rajaynayaa 🎓🎉",
        "Masha'Allah hambalyo guusha weyn, waxaad tahay qof ku dayasho mudan! 👏✨",
        "Hambalyo qalinjabinta walaal, Rabi cilmigaaga ha kuu barakeeyo! 🎓✨",
      ];

      return {
        category: 'graduation',
        suggestedEmojis: ['🎓', '👏', '🎉', '🌟'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.95,
      };
    }

    // 4. Wedding / Aroos / Meher
    if (
      /\b(aroos|arooska|meher|meherka|meherkii|arooskii|guri gal|guri-gal|wedding|is calfada|barakallahu lakuma|aroosad)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        "Barakallahu lakumaa sxb qaali! Guri nagi, nolol barako leh iyo ubad khayr qaba! 💍🤲",
        "Masha'Allah hambalyo arooska bro! Bash-bash iyo barako Allaha idinku mannaysto! ❤️🔥",
        "Hambalyo meherka ninyahow! Reerkii lagu nastee lagu nagaado Allaha idinka dhigo! 💍✨",
        "Masha'Allah reer barakaysan iyo nolol macaan sxb! 💐🤲",
      ];
      const femaleList = [
        "Barakallahu lakumaa abaayo macaan! Guri nagi iyo nolol farxad leh! 💍🌸",
        "Masha'Allah hambalyo arooska qaali! Ubad khayr qaba iyo barako Allaha idin siiyo! ❤️💐",
        "Hambalyo meherka abaayo! Farxad iyo barako joogto ah Allaha kugu arzuqo! 💍✨",
        "Masha'Allah aroosad aad u qurux badan, guri nagi iyo bash-bash abaayo! 🌸🤲",
      ];
      const neutralList = [
        "Barakallahu lakumaa wa baaraka calaykumaa, Masha'Allah guri nagi iyo bash-bash! 💍🤲",
        "Masha'Allah hambalyo meherka/arooska qaali, nolol barako leh iyo ubad khayr qaba! ❤️✨",
      ];

      return {
        category: 'wedding',
        suggestedEmojis: ['💍', '❤️', '💐', '🤲'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.95,
      };
    }

    // 5. Islamic Friday / Jimco
    if (/\b(jimce|jimco|jummah|jumah|juma)\b/i.test(lower)) {
      const maleList = [
        'Jimco barakaysan sxb qaali! Ducada iyo camalka wanaagsan Rabi ha inaga aqbalo 🤲✨',
        'Jimco mubaarak bro! Naxariis iyo dambi-dhaaf Allaha inagu mannaysto 🤲🤍',
        'Jimco wanaagsan ninyahow! Ducada ha iska illaawin maanta 🤲🕌',
      ];
      const femaleList = [
        'Jimco barakaysan abaayo macaan! Rabi ducada iyo cibaadada ha inaga aqbalo 🤲🌸',
        'Jimco mubaarak abaayo qaali! Dambi-dhaaf iyo naxariis Allaha inagu arzuqo 🤲🤍',
        'Jimco wanaagsan abaayo! Barako iyo khayr Allaha kugu mannaysto 🤲✨',
      ];
      const neutralList = [
        'Jimco barakaysan walaal, Rabi ducada iyo camalka wanaagsan ha inaga aqbalo 🤲✨',
        'Jimco mubaarak, naxariis iyo dambi-dhaaf Rabi ha inagu mannaysto 🤲🤍',
      ];

      return {
        category: 'islamic_friday',
        suggestedEmojis: ['🤲', '🕌', '🤍', '✨'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.95,
      };
    }

    // 6. Islamic Duco / Praise
    if (
      /\b(aamiin|amiin|alxamdullilah|alxamdulillah|subxaanallah|subhanallah|astaghfirullah|nabi|scw|saliga|salawaat|ducada|duco)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        'Aamiin yaa Rabbi sxb! Rabi ducada ha inaga aqbalo 🤲🤍',
        'Aamiin yaa Hayyu yaa Qayuum! Khayr badan Allaha ku siiyo bro 🤲✨',
        'Aamiin sxb qaali, ducadaada mid la ajiibo Allaha ka dhigo 🤲',
      ];
      const femaleList = [
        'Aamiin yaa Rabbi abaayo macaan! Rabi ducada ha aqbalo 🤲🌸',
        'Aamiin yaa kareem abaayo qaali! Khayr iyo caafimaad Allaha ku siiyo 🤲🤍',
        'Aamiin abaayo, ducadaada mid la aqbalo Allaha ka dhigo 🤲✨',
      ];
      const neutralList = [
        'Aamiin yaa Rabbi, aamiin yaa kareem 🤲🤍',
        'Aamiin yaa Hayyu yaa Qayuum, Rabi ha inaga aqbalo 🤲✨',
      ];

      return {
        category: 'islamic_duco',
        suggestedEmojis: ['🤲', '🤍', '✨'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.9,
      };
    }

    // 7. Funny / Kaftan / Qosol / Meme
    if (
      /\b(hahaha|kkkk|qosol|funny|lol|walaahi|kaftan|meeday|yaab|ciil|dhacdo|bashaal)\b/i.test(lower) ||
      /(🤣|😂|😭|😹)/.test(clean)
    ) {
      const maleList = [
        'Hahaha waar ninyahow yaabka kkkk 😂🤣',
        'Hahaha xaqiiq weeye walaahi sxb, meeday kkkk 😭😂',
        'Hahaha qosol badanaa bro, runti waad igu heshay 🤣🔥',
        'Hahaha waar waxan maxaa keenay sxb 😂💀',
        'Kkkk walaahi waa qosol dhab ah ninyahow! 🤣👏',
      ];
      const femaleList = [
        'Hahaha yaabka walaahi abaayo kkkk 😂🤣',
        'Hahaha aad baan ugu qoslay abaayo runti 😭😂',
        'Hahaha xaqiiq weeye abaayo macaan kkkk 🤣✨',
        'Kkkk qosol badanaa abaayo walaahi 😂❤️',
      ];
      const neutralList = [
        'Hahaha xaqiiq weeye walaahi 😂🤣',
        'Hahaha waar yaabka, meeday kkkk 😭😂',
        'Hahaha qosol badanaa runti 🤣',
      ];

      return {
        category: 'funny',
        suggestedEmojis: ['😂', '🤣', '🔥', '💀'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.9,
      };
    }

    // 8. Business / Ganacsi / Sale / Products
    if (
      /\b(iib|qiimo|qiimaha|dalbo|delivery|order|discount|sale|furniture|dhar|kabo|stock|meherad|dukaan|xafiis|kirada|commission|kala soo xiriir)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        "Masha'Allah sxb ganacsi barakaysan iyo suuq khayr leh Allaha kaaga dhigo! 💼🤲",
        "Alaab aad u heer saraysa weeye bro! Macaamiil badan iyo barako Allaha kugu arzuqo! ✨🔥",
        "Masha'Allah ganacsi horumar leh ninyahow, suuq wanaagsan! 👏💼",
        "Dadaal fiican weeye sxb, Rabi shaqadaada iyo hantidaada ha kuu barakeeyo! 🤲💼",
      ];
      const femaleList = [
        "Masha'Allah abaayo meherad barakaysan iyo suuq khayr leh Allaha kaaga dhigo! 💼🌸",
        "Alaab aad u qurux badan weeye abaayo macaan! Macaamiil badan iyo barako! ✨💐",
        "Masha'Allah horumar joogto ah abaayo qaali, suuq wanaagsan! 👏💼",
        "Rabi ganacsigaaga iyo dadaalkaaga ha kuu barakeeyo abaayo! 🤲💼",
      ];
      const neutralList = [
        "Masha'Allah, Rabi meheradda iyo ganacsigaaga ha kuu barakeeyo walaal! 🤲💼",
        "Masha'Allah alaab aad u qurux badan, suuq khayr leh iyo macaamiil badan! ✨🔥",
      ];

      return {
        category: 'business',
        suggestedEmojis: ['💼', '🔥', '🤲', '✨'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.88,
      };
    }

    // 9. Travel / Safar / Tourism / Airport
    if (
      /\b(safar|safarka|airport|plane|flight|dalxiis|magaalo|travel|nairobi|dubai|muqdisho|hargeysa|bosaaso|garowe|berbera|kismaayo|turkey)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        "Masha'Allah safar khayr iyo nabad qab leh sxb! Soo bashaal ✈️🌍",
        "Safar nabad qab leh bro qaali! Meel aad u bilicsan weeye, soo raaxayso! 🌴✨",
        "Masha'Allah ninyahow safar badhaadhe leh Allaha kaaga dhigo! ✈️🔥",
      ];
      const femaleList = [
        "Masha'Allah safar nabad qab iyo farxad leh abaayo macaan! ✈️🌸",
        "Safar khayr leh abaayo qaali! Soo bashaal oo nolosha ku raaxayso! 🌴✨",
        "Masha'Allah meel aad u qurux badan, soo badhaadh abaayo! ✈️💖",
      ];
      const neutralList = [
        "Masha'Allah safar khayr iyo nabad qab leh walaal! ✈️🌍",
        "Masha'Allah meel aad u bilic san, soo bashaal! 🌴✨",
      ];

      return {
        category: 'travel',
        suggestedEmojis: ['✈️', '🌍', '🌴', '✨'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.88,
      };
    }

    // 10. Style / Selfie / Outfit
    if (/\b(style|outfit|fashion|dhar|shidan|vibe|mood|aniga|selfie|pose)\b/i.test(lower)) {
      const maleList = [
        "Masha'Allah aad baad u shidan tahay sxb qaali! Style aad u heer sarreeya 🔥👏",
        "Nin rag ah oo shidan weeye ninyahow! Masha'Allah aad u xarrago badan! ✨🔥",
        "Vibe aad u fiican bro! Style qurux badan mar kasta! 👏🕶️",
      ];
      const femaleList = [
        "Masha'Allah aad baad u qurux badan tahay abaayo macaan! Style aad u shidan 🌸✨",
        "Masha'Allah xarrago iyo qurux dabiici ah abaayo qaali! 💖👏",
        "Masha'Allah style aad u bilic san abaayo, aad baad u shidan tahay! ✨💐",
      ];
      const neutralList = [
        "Masha'Allah aad baad u shidan tahay walaal! 🔥✨",
        "Masha'Allah style aad u qurux badan! 👏",
      ];

      return {
        category: 'style_selfie',
        suggestedEmojis: ['🔥', '👏', '❤️', '✨'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.85,
      };
    }

    // 11. Video Status (Visual clips or recordings)
    if (mediaKind === 'video') {
      const maleList = [
        "Masha'Allah muuqaal aad u qurux badan sxb! 🔥👏",
        "Muuqaal aad u shidan weeye bro, heer sare! ✨🎥",
        "Masha'Allah ninyahow vibe-ka muuqaalka aad buu u fiican yahay! 🔥👌",
      ];
      const femaleList = [
        "Masha'Allah muuqaal aad u qurux badan abaayo macaan! 🌸✨",
        "Muuqaal aad u bilic san abaayo qaali! 💖🎥",
        "Masha'Allah vibe aad u macaan abaayo! ✨👏",
      ];
      const neutralList = [
        "Masha'Allah muuqaal aad u qurux badan walaal! ✨🔥",
        "Muuqaal aad u heer sarreeya! 🎥👏",
      ];

      return {
        category: 'video',
        suggestedEmojis: ['🔥', '🎥', '👏', '✨'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.85,
      };
    }

    // 12. General Quote / Deep thought (clean text > 20 chars)
    if (clean.length > 20) {
      const maleList = [
        "Masha'Allah xikmad aad u miisaan culus sxb qaali! Runti waa runtaa 👏✨",
        "Hadal aad u qiimo badan weeye bro, xaqiiq! 💯🔥",
        "Masha'Allah ninyahow aragti aad u qoto dheer! 👏💡",
      ];
      const femaleList = [
        "Masha'Allah xikmad aad u qiimo badan abaayo macaan! Runti waa hadal miisaan leh 🌸✨",
        "Aad baad ugu mahadsantahay hadalka qaaliga ah abaayo! 💖💡",
        "Masha'Allah hadal aad u qurux badan abaayo! 👏✨",
      ];
      const neutralList = [
        "Masha'Allah runti, xikmad aad u qiimo badan! ✨",
        "Masha'Allah, hadal aad u miisaan culus walaal 👏",
      ];

      return {
        category: 'general_quote',
        suggestedEmojis: ['❤️', '👏', '✨', '👍'],
        suggestedComments: gender === 'male' ? maleList : gender === 'female' ? femaleList : neutralList,
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.8,
      };
    }

    // 13. Media only (Photo without specific caption)
    const maleMedia = [
      "Masha'Allah sawir aad u qurux badan sxb qaali! 🔥✨",
      "Masha'Allah nin shidan bro, sawir aad u heer sarreeya! 👏📸",
      "Masha'Allah ninyahow sawirkaagu waa mid aad u bilic san! 🔥👌",
    ];
    const femaleMedia = [
      "Masha'Allah sawir aad u qurux badan abaayo macaan! 🌸✨",
      "Masha'Allah sawir aad u bilic san abaayo qaali! 💖📸",
      "Masha'Allah aad baad u shidan tahay abaayo! ✨👏",
    ];
    const neutralMedia = [
      "Masha'Allah aad u qurux badan! ✨",
      "Masha'Allah wax aad u heer sarreeya walaal 🔥",
    ];

    return {
      category: 'media_only',
      suggestedEmojis: ['🔥', '❤️', '👏', '✨'],
      suggestedComments: gender === 'male' ? maleMedia : gender === 'female' ? femaleMedia : neutralMedia,
      extractedText: clean,
      hasMedia,
      mediaKind,
      gender,
      confidence: 0.7,
    };
  }

  /**
   * Generates a tailored comment, leveraging Gemini AI if available and quota allows.
   * Adheres strictly to the authentic young Somali male friend persona.
   */
  public async generateComment(
    analysis: StatusAnalysisResult,
    senderName: string = '',
    gender: 'male' | 'female' | 'unknown' = 'unknown',
    mediaKind?: string
  ): Promise<string> {
    const effectiveGender = gender || analysis.gender || 'unknown';

    // If AI is available and enabled, try generating a nuanced short Somali comment
    if (this.config.aiEnhanced && this.aiOrchestrator && (analysis.extractedText.length > 5 || analysis.hasMedia)) {
      try {
        const genderDirective =
          effectiveGender === 'male'
            ? 'QOFKU WAA WIIL / NIN: Ula hadal sidii saaxiib/walaal qaali ah adoo adeegsanaya ereyada: "sxb", "walaal", "bro", "geesi", "ninyahow". QOF NIN AH WELIGAA HA KU ODHAN "abaayo" ama erayo dheddig ah!'
            : effectiveGender === 'female'
            ? 'QOFKU WAA GABADH: Ula hadal si xushmad, asluub iyo qaddarin dheddig leh: "abaayo", "walaashay", "huuno", "qaali". Weligaa ha ku odhan "ninyahow" ama "wiilka"!'
            : 'JINSIGA LAMA HUBO: U adeegso ereyo xushmad leh oo dhexdhexaad ah sida "walaal", "qaali".';

        const prompt = `Waxaad tahay nin dhallinyaro ah oo Soomaali ah, caqli badan, asluub leh, furfuran (nin saaxiib dhow ah oo WhatsApp ku arkaya status uu saaxiibkii soo dhigay).
Magaca qofka: "${senderName || 'Walaal'}"
${genderDirective}
Nooca status-ka: ${mediaKind === 'video' ? 'Muuqaal/Video' : mediaKind === 'image' || analysis.hasMedia ? 'Sawir/Image' : 'Qoraal/Text'}
Qoraalka status-ka: "${analysis.extractedText || (mediaKind === 'video' ? 'Muuqaal qurux badan' : 'Sawir qurux badan')}"
Nooca/Dulucda: ${analysis.category}

Qor hal weedh oo faallo gaaban ah (3 ilaa 8 eray) oo aad ugu hambalyaynayso, ugu ducaynayso, u bogaadinayso, ama kula qoslayso si dabiici ah oo aad u heer saraysa.
SHURUUCO ADAG:
1. Ha u hadlin sidii robot, AI, ama shirkad ganacsi. Noqo qof dhab ah oo la nool asxaabtiisa.
2. Weligaa ha bilaabin "Asc", "Wcs", "Kusoo dhawoow", ama "Maxaan kaa caawiyaa".
3. Ha ku celin isla ereyadii uu qoray; u jawaab adoo dareenka ama dhacdada la qaybsanaya.
4. Ha bixin wax talo caafimaad ama dawo ah.
5. Luuqadda waa inay noqotaa Somali saafi ah, diirran, dhalinyaronimo leh oo asluubaysan.`;

        const res = await this.aiOrchestrator.generateResponse(prompt, [], { maxOutputTokens: 50 });
        if (res && res.text && !res.text.includes('mashquulsan') && res.text.trim().length > 3) {
          const cleanComment = res.text.trim().replace(/^["']|["']$/g, '');
          // Register in history to avoid repetition
          this.recentCommentHistory.push(cleanComment);
          return cleanComment;
        }
      } catch (err: any) {
        console.warn(`[StatusReactor] AI comment generation fallback to rule: ${err?.message}`);
      }
    }

    // Reliable non-repetitive fallback from rule-based suggested comments
    const list = analysis.suggestedComments;
    // Prefer comments not used in the last 15 interactions
    const unusedList = list.filter(c => !this.recentCommentHistory.includes(c));
    const finalList = unusedList.length > 0 ? unusedList : list;
    const chosen = finalList[Math.floor(Math.random() * finalList.length)];
    this.recentCommentHistory.push(chosen);
    return chosen;
  }

  /**
   * Handles an incoming WhatsApp status event from Baileys transport.
   */
  public async handleIncomingStatus(msg: proto.IWebMessageInfo, socket: any): Promise<boolean> {
    if (!this.config.enabled || !socket) return false;
    if (!this.config.autoReact && !this.config.autoComment) return false;

    const senderJid = msg.key.participant || msg.participant || '';
    if (!senderJid || !broadcastService.isValidIndividualJid(senderJid)) {
      return false;
    }

    // 1. Enforce owner / admin guard: never react or comment on admin's or self status!
    // Per user requirement: "status waxaan soo dhigan bot yaanu wax jawaaba ka bixin dadka kale haka bixiyo"
    if (this.isAdminOrSelf(senderJid, Boolean(msg.key?.fromMe), socket)) {
      console.log(`🛡️ [StatusReactor] Ignored status from owner/admin (${senderJid}). Bot only interacts with other contacts.`);
      return false;
    }

    // 2. Cooldown check (only active if cooldownHours is configured > 0):
    if (this.config.cooldownHours > 0 && this.isCooldownActive(senderJid)) {
      console.log(`⏳ [StatusReactor] Skipped ${senderJid}: Cooldown active.`);
      return false;
    }

    // Unwrap message and extract content
    const unwrapped = MediaProcessorService.unwrapMessage(msg.message);
    const innerMsg = unwrapped.message;
    const mediaKind = unwrapped.mediaKind;
    const hasMedia = Boolean(mediaKind);
    const text =
      innerMsg.conversation ||
      innerMsg.extendedTextMessage?.text ||
      innerMsg.imageMessage?.caption ||
      innerMsg.videoMessage?.caption ||
      innerMsg.documentMessage?.caption ||
      '';

    const senderName = msg.pushName || '';
    const gender = UserProfiler.detectGender(senderName);
    const analysis = this.analyzeStatus(text, hasMedia, mediaKind, gender);

    // Calculate natural human delay (e.g. 10 to 30 seconds)
    const minDelay = Math.max(0, this.config.minDelaySeconds);
    const maxDelay = Math.max(minDelay, this.config.maxDelaySeconds);
    const delayMs = Math.floor(Math.random() * ((maxDelay - minDelay) * 1000 + 1)) + minDelay * 1000;

    console.log(
      `🎯 [StatusReactor] Scheduled interaction with ${senderName || senderJid} (${gender}, ${analysis.category}) in ${Math.round(
        delayMs / 1000
      )}s...`
    );

    // Schedule the interaction
    const timer = setTimeout(async () => {
      try {
        await this.executeInteraction(msg, socket, senderJid, senderName, analysis, text, gender, mediaKind);
      } catch (err: any) {
        console.error(`[StatusReactor] Error executing interaction: ${err?.message}`);
      } finally {
        this.pendingTimeouts.delete(msg.key.id || senderJid);
      }
    }, delayMs);

    if (msg.key.id) {
      this.pendingTimeouts.set(msg.key.id, timer);
    }

    return true;
  }

  /**
   * Executes the actual reaction or comment
   */
  public async executeInteraction(
    msg: proto.IWebMessageInfo,
    socket: any,
    senderJid: string,
    senderName: string,
    analysis: StatusAnalysisResult,
    rawText: string,
    gender: 'male' | 'female' | 'unknown' = 'unknown',
    mediaKind?: string
  ): Promise<void> {
    if (!socket) return;

    // Decide whether to react, comment, or both
    const shouldReact =
      this.config.autoReact &&
      (this.config.mode === 'reaction' || this.config.mode === 'both' || !this.config.autoComment);
    const shouldComment =
      this.config.autoComment &&
      (this.config.mode === 'comment' || this.config.mode === 'both' || !this.config.autoReact);

    // 1. Send Emoji Reaction
    if (shouldReact) {
      const emoji = analysis.suggestedEmojis[Math.floor(Math.random() * analysis.suggestedEmojis.length)];
      try {
        // Send status reaction to status@broadcast with statusJidList
        await socket.sendMessage(
          'status@broadcast',
          {
            react: {
              text: emoji,
              key: msg.key,
            },
          },
          {
            statusJidList: [senderJid],
          }
        );

        // Also notify direct sender for standard client compatibility
        await socket.sendMessage(senderJid, {
          react: {
            text: emoji,
            key: msg.key,
          },
        }).catch(() => {});

        this.recordInteraction({
          id: `react_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          senderJid,
          senderName,
          type: 'reaction',
          content: emoji,
          category: analysis.category,
          statusText: rawText,
          timestamp: Date.now(),
        });

        console.log(`❤️ [StatusReactor] Reacted "${emoji}" to status of ${senderName || senderJid} (${gender})`);
      } catch (err: any) {
        console.warn(`[StatusReactor] Failed to react to status: ${err?.message}`);
      }
    }

    // 2. Send Smart Comment / Reply
    if (shouldComment) {
      try {
        const comment = await this.generateComment(analysis, senderName, gender, mediaKind);

        // Natural short typing indicator before delivering comment
        await socket.sendPresenceUpdate('composing', senderJid).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 600));
        await socket.sendPresenceUpdate('paused', senderJid).catch(() => {});

        // Send direct reply quoting the status message
        const sentMsg = await socket.sendMessage(
          senderJid,
          { text: comment },
          { quoted: msg }
        );

        const commentLog: StatusInteractionLog = {
          id: `comment_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          senderJid,
          senderName,
          type: 'comment',
          content: comment,
          category: analysis.category,
          statusText: rawText,
          timestamp: Date.now(),
        };
        this.recordInteraction(commentLog);

        // Persist comment context for reply continuity and gratitude recognition
        this.recordSentStatusComment({
          senderJid,
          senderName,
          gender,
          commentText: comment,
          category: analysis.category,
          statusText: rawText,
          timestamp: Date.now(),
          messageId: sentMsg?.key?.id,
        });

        console.log(`💬 [StatusReactor] Commented on status of ${senderName || senderJid} (${gender}): "${comment}"`);
      } catch (err: any) {
        console.warn(`[StatusReactor] Failed to send status comment: ${err?.message}`);
      }
    }
  }
}

export const statusReactorService = new StatusReactorService();
