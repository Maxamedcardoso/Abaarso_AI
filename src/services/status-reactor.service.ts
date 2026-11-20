import fs from 'fs';
import path from 'path';
import { proto } from '@whiskeysockets/baileys';
import { MediaProcessorService } from './media-processor.service.js';
import { BroadcastService, broadcastService, normalizePhoneNumber } from './broadcast.service.js';
import { WhatsAppManagerService, whatsappManagerService } from './whatsapp-manager.service.js';
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
  | 'media_only'
  | 'emoji_only'
  | 'link_status'
  | 'phone_number_status';

export interface StatusAnalysisResult {
  category: StatusCategory;
  suggestedEmojis: string[];
  suggestedComments: string[];
  extractedText: string;
  hasMedia: boolean;
  mediaKind?: string | null;
  gender?: 'male' | 'female' | 'unknown';
  confidence: number;
  extractedDescription?: string;
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
  private processedStatusIds: Set<string> = new Set();
  private readonly broadcast: BroadcastService;
  private whatsappManager: WhatsAppManagerService = whatsappManagerService;
  private configuredAdminPhones: string[] | null = null;
  private ownerName: string = 'Mohamed';
  private pendingSaveMeNumbers: Map<string, number> = new Map();
  private linkOcrTimestamps: number[] = [];

  constructor(
    customConfigPath?: string,
    broadcast?: BroadcastService,
    adminPhones?: string[],
    whatsappManager?: WhatsAppManagerService
  ) {
    this.configPath = customConfigPath || path.resolve(process.cwd(), 'data', 'status_reactor_config.json');
    this.broadcast = broadcast || broadcastService;
    if (whatsappManager) {
      this.whatsappManager = whatsappManager;
    }
    if (adminPhones) {
      this.configuredAdminPhones = adminPhones;
    }
    this.config = this.loadConfig();
  }

  public setWhatsAppManager(manager: WhatsAppManagerService): void {
    if (manager) {
      this.whatsappManager = manager;
    }
  }

  public setOwnerName(name: string): void {
    if (name && name.trim()) {
      this.ownerName = name.trim();
    }
  }

  public getOwnerName(): string {
    return this.ownerName;
  }

  public markSaveMeSent(phoneOrJid: string): void {
    const clean = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (clean) {
      this.pendingSaveMeNumbers.set(clean, Date.now());
    }
  }

  public isPendingSaveMe(phoneOrJid: string): boolean {
    const clean = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!clean) return false;
    const ts = this.pendingSaveMeNumbers.get(clean);
    if (!ts) return false;
    // Expire pending status after 10 minutes so re-testing and follow-ups work smoothly
    if (Date.now() - ts > 10 * 60 * 1000) {
      this.pendingSaveMeNumbers.delete(clean);
      return false;
    }
    return true;
  }

  public resolvePendingSaveMe(phoneOrJid: string): void {
    const clean = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (clean) {
      this.pendingSaveMeNumbers.delete(clean);
    }
  }

  public setAdminPhones(phones: string[]): void {
    this.configuredAdminPhones = phones;
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

    // Check against connected bot user JID and LID (must be at least 7 digits for safety)
    const socketOwnJid = socket?.user?.id ? socket.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
    const socketOwnLid = (socket?.user as any)?.lid ? (socket.user as any).lid.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
    if (socketOwnJid && socketOwnJid.length >= 7 && (cleanSender === socketOwnJid || cleanSender.endsWith(socketOwnJid) || socketOwnJid.endsWith(cleanSender))) {
      return true;
    }
    if (socketOwnLid && socketOwnLid.length >= 7 && (cleanSender === socketOwnLid || cleanSender.endsWith(socketOwnLid) || socketOwnLid.endsWith(cleanSender))) {
      return true;
    }

    // Check configured admin phone numbers (use exact suffix match only when lengths differ significantly, else exact)
    const adminNumbers = this.configuredAdminPhones !== null
      ? this.configuredAdminPhones
      : (config.security.adminPhoneNumbers || []);
    if (adminNumbers.some(admin => {
      const cleanAdmin = admin.replace(/[^0-9]/g, '');
      if (!cleanAdmin) return false;
      // Exact match, or the sender's number ends with the full admin number (handles country-code variants)
      // but only when admin number is at least 7 digits to avoid false partial matches
      return cleanSender === cleanAdmin ||
        (cleanAdmin.length >= 7 && cleanSender.endsWith(cleanAdmin)) ||
        (cleanSender.length >= 7 && cleanAdmin.endsWith(cleanSender));
    })) {
      return true;
    }

    return false;
  }

  /**
   * Normalizes a raw extracted phone candidate into clean international digits (e.g. 252634949642).
   */
  private normalizeExtractedPhone(raw: string): string {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }
    // Somali local with leading 0: 06x-xxxxxxx, 07x-xxxxxxx, 090-xxxxxxx
    if (/^0(?:6\d{8}|7\d{8}|90\d{7})$/.test(digits)) {
      digits = '252' + digits.slice(1);
    }
    // Bare 9-digit Somali number without country code or leading 0 (e.g. wa.me/634949642)
    else if (/^(?:6\d{8}|7\d{8}|90\d{7})$/.test(digits)) {
      digits = '252' + digits;
    }
    if (digits.length < 8 || digits.length > 15) return '';
    // Reject obvious 8-digit calendar dates like 20261120
    if (digits.length === 8 && /^20[2-3]\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(digits)) {
      return '';
    }
    return digits;
  }

  /**
   * Extracts all valid phone numbers from a text, URL, or status caption.
   * Supports:
   *  - wa.me/252634949642, wa.me/+252 63 494 9642, wa.me/0634949642, wa.me/634949642
   *  - api.whatsapp.com/send?phone=...
   *  - Somali formats with/without spaces or dashes: 063 494 9642, +252-61-512-3456, 090 712 3456, 077...
   *  - International numbers with + or 00 (e.g. +254 712 345 678, +44 7700 900123)
   */
  public extractPhoneNumbersFromText(text: string): string[] {
    if (!text) return [];
    const results = new Set<string>();

    // 1. wa.me or api.whatsapp.com links with digits (allows spaces/dashes/plus inside URL text)
    const waMatches = text.matchAll(
      /(?:(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\?(?:[^\s"'<>]*&)?phone=))(\+?[0-9][0-9\s\-().]{6,19})/gi
    );
    for (const m of waMatches) {
      const norm = this.normalizeExtractedPhone(m[1]);
      if (norm) results.add(norm);
    }

    // 2. Somali phone numbers (with or without spaces, dashes, dots): +252 / 00252 / 252 / 0 / bare 6x, 7x, 90
    const somaliMatches = text.matchAll(
      /(?<![0-9])(?:\+?252|00252|0)?[\s.\-]*((?:6[0-9]|7[0-9]|90)(?:[\s.\-]*\d){7})(?!\d)/g
    );
    for (const m of somaliMatches) {
      const norm = this.normalizeExtractedPhone(m[1]);
      if (norm) results.add(norm);
    }

    // 3. International phone numbers starting with + or 00 (spaces/dashes/parentheses allowed)
    const intlMatches = text.matchAll(/(?:\+|(?<![0-9])00)([1-9](?:[\s.\-()]*\d){7,14})(?!\d)/g);
    for (const m of intlMatches) {
      const norm = this.normalizeExtractedPhone(m[1]);
      if (norm) results.add(norm);
    }

    return Array.from(results);
  }

  /**
   * Attempts to resolve WhatsApp Business short links (https://wa.me/message/XXXX or wa.me/qr/XXXX)
   * by following redirects and checking the final URL or HTML for embedded phone numbers.
   */
  public async resolveWaMeShortLinks(text: string): Promise<string[]> {
    if (!text) return [];
    const shortLinks = Array.from(
      text.matchAll(/(?:https?:\/\/)?wa\.me\/(?:message|qr)\/[A-Za-z0-9_-]+/gi)
    ).map((m) => (m[0].startsWith('http') ? m[0] : `https://${m[0]}`));

    if (shortLinks.length === 0) return [];

    const found = new Set<string>();
    for (const link of shortLinks.slice(0, 3)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(link, {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (res.url) {
          for (const n of this.extractPhoneNumbersFromText(res.url)) found.add(n);
        }
        const html = await res.text().catch(() => '');
        const phoneHints = html.matchAll(/(?:phone=|tel:|whatsapp:\/\/send\?phone=)(\+?[0-9]{8,15})/gi);
        for (const m of phoneHints) {
          const norm = this.normalizeExtractedPhone(m[1]);
          if (norm) found.add(norm);
        }
      } catch {
        // Ignore network errors / timeouts on short-link resolution
      } finally {
        clearTimeout(timer);
      }
    }
    return Array.from(found);
  }

  /**
   * Uses Gemini Vision (rate-limited to 25/hour) to read WhatsApp links or phone numbers
   * printed inside a status flyer/screenshot image when no caption number was present.
   */
  private async extractPhoneNumbersFromImage(media: { mimeType: string; dataBase64: string }): Promise<string[]> {
    if (!this.aiOrchestrator) return [];
    const now = Date.now();
    this.linkOcrTimestamps = this.linkOcrTimestamps.filter((t) => now - t < 60 * 60 * 1000);
    if (this.linkOcrTimestamps.length >= 25) return [];
    this.linkOcrTimestamps.push(now);

    try {
      const prompt =
        'Look at this WhatsApp Status image. Does it show a WhatsApp link (wa.me/...) or a phone number asking people to contact/save/chat? ' +
        'If YES, reply ONLY with the exact phone number(s) or wa.me link(s) visible on the image. ' +
        'If NO phone number or WhatsApp link is visible, reply ONLY with: NONE';
      const res = await this.aiOrchestrator.generateResponse(prompt, [], {
        maxOutputTokens: 80,
        media: { mimeType: media.mimeType, dataBase64: media.dataBase64 },
      });
      if (!res?.text || /^\s*NONE\s*$/i.test(res.text)) return [];
      return this.extractPhoneNumbersFromText(res.text);
    } catch {
      return [];
    }
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
    mediaKind?: string | null,
    gender: 'male' | 'female' | 'unknown' = 'unknown',
    visualCategory?: StatusCategory | null,
    visualDescription?: string
  ): StatusAnalysisResult {
    const clean = (text || '').trim();
    const lower = clean.toLowerCase();

    // 00. Strict Visual Business Override:
    // If AI vision inspected image/video and found clothes (dhar), shoes (kabo), merchandise,
    // or products for sale, immediately mark as 'business' with ZERO comments per user request!
    if (visualCategory === 'business') {
      return {
        category: 'business',
        suggestedEmojis: ['💚', '💼'],
        suggestedComments: [], // NO REPLY: Business status only gets official Status Like 💚
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.99,
        extractedDescription: visualDescription,
      };
    }

    // 0a. Emoji-only detection — if text has ONLY emojis/whitespace, skip comment
    if (clean.length > 0 && /^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}\s]+$/u.test(clean)) {
      return {
        category: 'emoji_only',
        suggestedEmojis: ['💚'],
        suggestedComments: [],
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 1.0,
      };
    }

    // 0b. Phone number & WhatsApp link detection (HIGHEST PRIORITY before generic URLs)
    // Supports: wa.me/25263..., https://wa.me/..., api.whatsapp.com/send?phone=..., or raw phone numbers (063..., +25263...)
    const detectedPhones = this.extractPhoneNumbersFromText(clean);
    if (detectedPhones.length > 0) {
      return {
        category: 'phone_number_status',
        suggestedEmojis: ['💚'],
        suggestedComments: [],
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.98,
      };
    }

    // 0c. URL / external link detection (TikTok, YouTube, IG, external websites) — skip comment (react only)
    if (/https?:\/\/|tiktok\.com|youtube\.com|youtu\.be|instagram\.com|twitter\.com|facebook\.com|t\.me/i.test(clean)) {
      return {
        category: 'link_status',
        suggestedEmojis: ['💚'],
        suggestedComments: [],
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 1.0,
      };
    }

    // 1. Condolence / Tacsi / Geeri (HIGHEST PRIORITY - must never receive celebratory reactions)
    if (
      /\b(innalillahi|inaa lilaahi|geeri|geeriyooday|geeriyootay|tacsiyo|tacsi|samir|allaha u naxariisto|ilaahay ha u naxariisto|marxuum|marxuumad)\b/i.test(
        lower
      )
    ) {
      const maleList = [
        'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Allaha idinka siiyo sxb, marxuumkana jannadii fardowsa 🤲',
        'Ilaahay ha u naxariisto sxb, qabrigana ha u nuuro, samir iyo iimaanna Allaha idinka siiyo 🤲',
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
        'Allaha caafiyo sxb, shifa degdeg ah ayaan u rajaynayaa 🤲',
      ];
      const femaleList = [
        'Ilaahay shifa degdeg ah iyo caafimaad taam ah ha siiyo abaayo macaan 🤲🌸',
        'Rabi xanuunka ha ka fududeeyo abaayo, caafimaad khayr lehna ha ugu beddelo 🤲✨',
        'Allaha caafiyo abaayo, aamiin yaa rabbi 🤲',
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
        "Masha'Allah hambalyo sxb! Guul iyo mustaqbal ifaya ayaan kuu rajaynayaa 🎓👏",
        "Hambalyo guusha weyn geesi! Waxaad tahay nin ku dayasho mudan bro! 🎓🔥",
        "Masha'Allah hambalyo qalinjabinta sxb! Cilmigaaga Allaha kuu barakeeyo 🎓✨",
        "Aad baad u dadaashay ninyahow, hambalyo guusha weyn! 👏🎉",
        "Guul weyn weeye bro, hambalyo mar labaad iyo mar saddexaadba! 🎓🌟",
      ];
      const femaleList = [
        "Masha'Allah hambalyo abaayo macaan! Guul iyo mustaqbal ifaya ayaan kuu rajaynayaa 🎓🌸",
        "Hambalyo qalinjabinta abaayo! Allaha kuu barakeeyo shahaadada 🎓✨",
        "Masha'Allah aad baad u dadaashay walaashay, guul mar kasta! 👏💐",
        "Hambalyo weyn abaayo, waxaad tahay qof lagu faano! 🎓🎉",
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
        "Barakallahu lakumaa sxb! Guri nagi, nolol barako leh iyo ubad khayr qaba! 💍🤲",
        "Masha'Allah hambalyo arooska bro! Bash-bash iyo barako Allaha idinku mannaysto! ❤️🔥",
        "Hambalyo meherka ninyahow! Reerkii lagu nastee lagu nagaado Allaha idinka dhigo! 💍✨",
        "Masha'Allah reer barakaysan iyo nolol macaan sxb! 💐🤲",
      ];
      const femaleList = [
        "Barakallahu lakumaa abaayo macaan! Guri nagi iyo nolol farxad leh! 💍🌸",
        "Masha'Allah hambalyo arooska abaayo! Ubad khayr qaba iyo barako Allaha idin siiyo! ❤️💐",
        "Hambalyo meherka abaayo! Farxad iyo barako joogto ah Allaha kugu arzuqo! 💍✨",
        "Masha'Allah aroosad aad u qurux badan, guri nagi iyo bash-bash abaayo! 🌸🤲",
      ];
      const neutralList = [
        "Barakallahu lakumaa wa baaraka calaykumaa, Masha'Allah guri nagi iyo bash-bash! 💍🤲",
        "Masha'Allah hambalyo meherka/arooska, nolol barako leh iyo ubad khayr qaba! ❤️✨",
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
        'Jimco barakaysan sxb! Ducada iyo camalka wanaagsan Rabi ha inaga aqbalo 🤲✨',
        'Jimco mubaarak bro! Naxariis iyo dambi-dhaaf Allaha inagu mannaysto 🤲🤍',
        'Jimco wanaagsan ninyahow! Ducada ha iska illaawin maanta 🤲🕌',
      ];
      const femaleList = [
        'Jimco barakaysan abaayo macaan! Rabi ducada iyo cibaadada ha inaga aqbalo 🤲🌸',
        'Jimco mubaarak abaayo! Dambi-dhaaf iyo naxariis Allaha inagu arzuqo 🤲🤍',
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
        'Aamiin sxb, ducadaada mid la ajiibo Allaha ka dhigo 🤲',
      ];
      const femaleList = [
        'Aamiin yaa Rabbi abaayo macaan! Rabi ducada ha aqbalo 🤲🌸',
        'Aamiin yaa kareem abaayo macaan! Khayr iyo caafimaad Allaha ku siiyo 🤲🤍',
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

    // 8. Business / Ganacsi / Sale / Products / Clothes (Dhar, Kabo, Badeeco, Dukaan)
    if (
      /\b(iib|qiimo|qiimaha|dalbo|delivery|order|discount|sale|furniture|dhar|kabo|stock|meherad|dukaan|xafiis|kirada|commission|kala soo xiriir|dharka|dhar\s+cusub|cadarka|perfume|badeeco|badeecad|shaati|surwaal|dirac|bacweyne|garbasaar|jalbaab|dahab|saacad|mobile|laptop|computer|qiimo\s+jaban|free\s+delivery|nagala\s+soo\s+xiriir)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'business',
        suggestedEmojis: ['💚', '💼'],
        suggestedComments: [], // STRICT: No reply/comment for business statuses per user request! Only official Status Like 💚
        extractedText: clean,
        hasMedia,
        mediaKind,
        gender,
        confidence: 0.98,
        extractedDescription: visualDescription,
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
        "Safar nabad qab leh bro! Meel aad u bilicsan weeye, soo raaxayso! 🌴✨",
        "Masha'Allah ninyahow safar badhaadhe leh Allaha kaaga dhigo! ✈️🔥",
      ];
      const femaleList = [
        "Masha'Allah safar nabad qab iyo farxad leh abaayo macaan! ✈️🌸",
        "Safar khayr leh abaayo! Soo bashaal oo nolosha ku raaxayso! 🌴✨",
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
        "Masha'Allah aad baad u shidan tahay sxb! Style aad u fiican 🔥👏",
        "Nin rag ah oo shidan weeye ninyahow! Masha'Allah aad u xarrago badan! ✨🔥",
        "Vibe aad u fiican bro! Style qurux badan mar kasta! 👏🕶️",
      ];
      const femaleList = [
        "Masha'Allah aad baad u qurux badan tahay abaayo macaan! Style aad u shidan 🌸✨",
        "Masha'Allah xarrago iyo qurux dabiici ah abaayo! 💖👏",
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
        "Muuqaal aad u bilic san abaayo! 💖🎥",
        "Masha'Allah vibe aad u macaan abaayo! ✨👏",
      ];
      const neutralList = [
        "Masha'Allah muuqaal aad u qurux badan walaal! ✨🔥",
        "Muuqaal aad u bilic san! 🎥👏",
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
        "Masha'Allah xikmad aad u miisaan culus sxb! Runti waa runtaa 👏✨",
        "Hadal aad u qiimo badan weeye bro, xaqiiq! 💯🔥",
        "Masha'Allah ninyahow aragti aad u qoto dheer! 👏💡",
      ];
      const femaleList = [
        "Masha'Allah xikmad aad u qiimo badan abaayo macaan! Runti waa hadal miisaan leh 🌸✨",
        "Aad baad ugu mahadsantahay hadalka xikmadda leh abaayo! 💖💡",
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

    // 13. Visual Category Honor / Media Only (Photo or Video analyzed by AI Vision)
    const effectiveCategory: StatusCategory = visualCategory || (mediaKind === 'video' ? 'video' : 'media_only');
    const maleMedia = [
      "Masha'Allah sawir aad u qurux badan sxb! 🔥✨",
      "Masha'Allah nin shidan bro, sawir aad u wanaagsan! 👏📸",
      "Masha'Allah ninyahow sawirkaagu waa mid aad u bilic san! 🔥👌",
    ];
    const femaleMedia = [
      "Masha'Allah sawir aad u qurux badan abaayo macaan! 🌸✨",
      "Masha'Allah sawir aad u bilic san abaayo! 💖📸",
      "Masha'Allah aad baad u shidan tahay abaayo! ✨👏",
    ];
    const neutralMedia = [
      "Masha'Allah sawir aad u qurux badan! ✨",
      "Masha'Allah muuqaal/sawir aad u bilic san! ✨👏",
    ];

    return {
      category: effectiveCategory,
      suggestedEmojis: ['💚', '🔥', '👏', '✨'],
      suggestedComments: gender === 'male' ? maleMedia : gender === 'female' ? femaleMedia : neutralMedia,
      extractedText: clean,
      hasMedia,
      mediaKind,
      gender,
      confidence: visualCategory ? 0.95 : 0.7,
      extractedDescription: visualDescription,
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
    mediaKind?: string | null
  ): Promise<string> {
    const effectiveGender = gender || analysis.gender || 'unknown';

    // If AI is available and enabled, try generating a nuanced short Somali comment with highest intelligence
    if (this.config.aiEnhanced && this.aiOrchestrator && (analysis.extractedText.trim().length > 0 || analysis.hasMedia)) {
      try {
        const genderDirective =
          effectiveGender === 'male'
            ? 'QOFKU WAA WIIL / NIN: Ula hadal sidii saaxiib dhow oo rag ah adoo adeegsanaya ereyada: "sxb", "walaal", "bro", "geesi", "ninyahow". QOF NIN AH WELIGAA HA KU ODHAN "abaayo" ama "qaali"!'
            : effectiveGender === 'female'
            ? 'QOFKU WAA GABADH: Ula hadal si xushmad, asluub iyo qaddarin leh: "abaayo", "walaashay", "huuno". Weligaa ha ku odhan "ninyahow" ama "qaali"!'
            : 'JINSIGA LAMA HUBO: U adeegso ereyo xushmad leh oo dhexdhexaad ah sida "walaal". Weligaa ha isticmaalin "qaali".';

        const mediaTypeLabel = mediaKind === 'video'
          ? 'Muuqaal/Video (waa video, ka jawaab si dabiici ah oo kooban)'
          : (mediaKind === 'image' || analysis.hasMedia)
            ? 'Sawir/Image'
            : 'Qoraal/Text';

        const prompt = `Waxaad tahay CARDOSO (Maxamed Daahir oo ah xafiiskiisa), qof Soomaali ah oo dhalinyaro ah, aad u casri ah, oo WhatsApp isticmaala. Waxaad ku arkaysaa status uu saaxiibkaa ama saaxiibtaada soo dhigtay.
Magaca qofka: "${senderName || 'Walaal'}"
${genderDirective}
Nooca status-ka: ${mediaTypeLabel}
Qoraalka status-ka: "${analysis.extractedText || (mediaKind === 'video' ? 'Video' : 'Sawir')}"
Nooca la falanqeeyay: ${analysis.category}

HAWSHAADA:
${mediaKind === 'video'
  ? 'Waa video. Ka jawaab si dabiici ah oo kooban — 1 ilaa 2 weedh keliya, sidii saaxiib WhatsApp ah.'
  : (mediaKind === 'image' || analysis.hasMedia)
    ? "Qiimee waxa sawirka ku jira: ma qof ayuu leeyahay? ma alaab la iibinayo (ganacsato)? ma dabiici/meel? Ka jawaab si gaagaaban oo dabiici ah. Haddii alaab la iibinayo: \"Masha'Allah alaab qurux badan, qiimaheedu ma yahay? 🔥\". Haddii selfie/qof: ka jawaab sida saaxiib."
    : 'Fahan qoraalka si qoto dheer oo caqli badan. Qor hal weedh kooban oo toos u socota waxa uu qofku ka hadlayo.'}

SHURUUCO ADAG (MAMNUUC):
1. MAMNUUC ADAG: WELIGAA ha sheegin inaad AI tahay. Hadal sidii qof bani'aadam ah oo WhatsApp isticmaalaya.
2. MAMNUUC ADAG: WELIGAA qofna ha ku odhan "qaali" ama "qaaliga ah".
3. Hadalkaagu ha ahaado mid gaagaaban, dabiici ah — 1 ilaa 2 weedh oo keliya.
4. MAMNUUC: Ha dhihin "Maxaan kugu caawin karaa", "Waxaan ahay AI", "Sida xogta", ama wax la mid ah.
5. Haddii sawirku yahay mid gacan-siis (handshake) ama salaambixin oo keliya, REPLY HA BIXIN — soo celi eray kooban oo ay la jaan qaadays.
6. MAMNUUC: Ha u hadlin sidii robot, AI, bot. Weligaa ha bilaabin "Asc", "Wcs", "Kusoo dhawoow", ama "Maxaan kaa caawiyaa".
7. Haddii uu qofku soo dhigay tacsi ama xanuun, duco qiiro leh u dir.
8. Luuqad Soomaali saafi ah oo dhalinyaronimo iyo xushmad leh.`;

        const res = await this.aiOrchestrator.generateResponse(prompt, [], { maxOutputTokens: 60 });
        if (res && res.text && !res.text.includes('mashquulsan') && res.text.trim().length > 3) {
          let cleanComment = res.text.trim().replace(/^["']|["']$/g, '');
          // Enforce 100% ban on the word "qaali"
          cleanComment = cleanComment.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();
          if (cleanComment.length > 3) {
            this.recentCommentHistory.push(cleanComment);
            return cleanComment;
          }
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
    let chosen = finalList[Math.floor(Math.random() * finalList.length)];
    chosen = chosen.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();
    this.recentCommentHistory.push(chosen);
    return chosen;
  }

  /**
   * Downloads and inspects status media (image/video) using Gemini multimodal vision.
   * Accurately detects business products (clothes/dhar, shoes, merchandise, sales ads)
   * vs personal moments (selfies, wedding, graduation, travel, funny clips, tacsi).
   */
  public async inspectStatusMediaWithAI(
    media: { mimeType: string; dataBase64: string },
    caption: string,
    mediaKind: string
  ): Promise<{ isBusiness: boolean; category: StatusCategory; description: string }> {
    if (!this.aiOrchestrator) {
      return { isBusiness: false, category: mediaKind === 'video' ? 'video' : 'media_only', description: '' };
    }

    const visionPrompt = `You are a visual and contextual social media inspector for WhatsApp stories.
Analyze this status media (${mediaKind}) and optional caption: "${caption || 'none'}".

RULES FOR CLASSIFICATION:
1. "isBusiness": TRUE if this image or video shows commercial merchandise, goods for sale, clothes/fashion/dhar/kabo/abaya, electronics, phones, cars for sale, furniture, perfume, shop advertisements, flyers, pricing, or product promotion.
2. "category":
   - "business": if isBusiness is true (clothes, shoes, goods, sales, products).
   - "style_selfie": if it is a personal photo of a person (selfie, outfit, portrait, posing, friends).
   - "wedding": if it shows a wedding, bride, groom, aroos, marriage ceremony.
   - "graduation": if it shows graduation, gown, diploma, qalin-jabin, university celebration.
   - "travel": if it shows travel, airport, airplane, beautiful scenery, tourist destination, beach, foreign city.
   - "condolence": if it is a funeral, mourning, or condolence notice.
   - "funny": if it is a meme, comedy clip, or humorous situation.
   - "islamic_friday" or "islamic_duco": if it is religious Quran verse, Friday greeting, or Islamic reminder.
   - "general_quote": if it is inspirational quotes or text on background.
   - "media_only": if general image.

Respond with ONLY valid JSON:
{"isBusiness": boolean, "category": string, "description": "brief description in 10 words"}`;

    try {
      const res = await this.aiOrchestrator.generateResponse(visionPrompt, [], {
        maxOutputTokens: 100,
        media: { mimeType: media.mimeType, dataBase64: media.dataBase64 },
      });
      if (res && res.text) {
        const cleaned = res.text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const cat = parsed.category as StatusCategory;
          const isBiz = Boolean(parsed.isBusiness || parsed.category === 'business');
          return {
            isBusiness: isBiz,
            category: isBiz ? 'business' : cat || (mediaKind === 'video' ? 'video' : 'media_only'),
            description: parsed.description || '',
          };
        }
      }
    } catch (e: any) {
      console.warn(`[StatusReactor] Vision status inspection error: ${e?.message}`);
    }

    return { isBusiness: false, category: mediaKind === 'video' ? 'video' : 'media_only', description: '' };
  }

  /**
   * Handles an incoming WhatsApp status event from Baileys transport.
   */
  public async handleIncomingStatus(
    msg: proto.IWebMessageInfo,
    socket: any,
    manager?: WhatsAppManagerService
  ): Promise<boolean> {
    if (!socket) return false;
    const activeManager = manager || this.whatsappManager;
    const isLinkMode = activeManager.isLinkCampaignMode();

    if (!isLinkMode) {
      if (!this.config.enabled) {
        console.log(`⚠️ [StatusReactor] SKIPPED: enabled=${this.config.enabled}`);
        return false;
      }
      if (!this.config.autoReact && !this.config.autoComment) {
        console.log(`⚠️ [StatusReactor] SKIPPED: autoReact=${this.config.autoReact}, autoComment=${this.config.autoComment}`);
        return false;
      }
    }

    const senderJid = msg.key.participant || msg.participant || '';
    if (!senderJid || !this.broadcast.isValidIndividualJid(senderJid)) {
      console.log(`⚠️ [StatusReactor] SKIPPED: invalid senderJid="${senderJid}"`);
      return false;
    }

    // Suppress status interactions if AI is specifically disabled for this person (!off <number>)
    if (activeManager.isAIDisabledForNumber(senderJid)) {
      return false;
    }

    // 1. Deduplication guard: ignore if this specific status was already processed or queued
    if (msg.key?.id && (this.processedStatusIds.has(msg.key.id) || this.pendingTimeouts.has(msg.key.id))) {
      return false;
    }

    // 2. Ignore protocol messages, revokes, edits, or reaction stanzas (not actual status posts!)
    if (
      msg.message?.protocolMessage ||
      msg.message?.reactionMessage ||
      (msg.message?.senderKeyDistributionMessage && Object.keys(msg.message).length === 1)
    ) {
      return false;
    }

    // 3. Status Freshness Guard:
    // Status stories last up to 24 hours on WhatsApp.
    const nowSec = Math.floor(Date.now() / 1000);
    const msgTimestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : typeof (msg.messageTimestamp as any)?.toNumber === 'function'
      ? (msg.messageTimestamp as any).toNumber()
      : Number(msg.messageTimestamp) || 0;

    const maxAgeSec = isLinkMode ? 86400 : 3600; // 24h in link mode, 1h in normal mode
    if (msgTimestamp > 0 && nowSec - msgTimestamp > maxAgeSec) {
      console.log(`⏳ [StatusReactor] Ignored old status from ${senderJid} (posted ${nowSec - msgTimestamp}s ago).`);
      return false;
    }

    // Unwrap message and extract ALL text/link fields (including matchedText & canonicalUrl!)
    const unwrapped = MediaProcessorService.unwrapMessage(msg.message);
    const innerMsg = unwrapped.message;
    const mediaKind = unwrapped.mediaKind || undefined;
    const hasMedia = Boolean(mediaKind && (innerMsg.imageMessage || innerMsg.videoMessage || innerMsg.audioMessage || innerMsg.documentMessage));
    const textParts = [
      innerMsg.conversation,
      innerMsg.extendedTextMessage?.text,
      innerMsg.extendedTextMessage?.matchedText,
      innerMsg.extendedTextMessage?.canonicalUrl,
      innerMsg.extendedTextMessage?.title,
      innerMsg.extendedTextMessage?.description,
      innerMsg.imageMessage?.caption,
      innerMsg.videoMessage?.caption,
      innerMsg.documentMessage?.caption,
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    const combinedText = Array.from(new Set(textParts.map((s) => s.trim()))).join(' ');
    const text = (
      innerMsg.conversation ||
      innerMsg.extendedTextMessage?.text ||
      innerMsg.imageMessage?.caption ||
      innerMsg.videoMessage?.caption ||
      innerMsg.documentMessage?.caption ||
      combinedText
    ).trim();

    // 4. Strict Content Guard:
    // Status MUST have actual content (either non-empty text or real media).
    // Never interact with empty, ghost, or deleted stanzas!
    if (!combinedText && !hasMedia) {
      console.log(`⚠️ [StatusReactor] Ignored empty status stanza from ${senderJid} (no text or media).`);
      return false;
    }

    if (msg.key?.id) {
      this.processedStatusIds.add(msg.key.id);
      if (this.processedStatusIds.size > 1000) {
        const first = this.processedStatusIds.values().next().value;
        if (first) this.processedStatusIds.delete(first);
      }
    }

    const senderName = msg.pushName || '';
    const gender = UserProfiler.detectGender(senderName);

    // ─── 5. LINK CAMPAIGN MODE (!link on) ──────────────────────────────
    // USER RULE: "!link on markuu yahay bot ha eego dhamaaan status yaanu jaawabin status reply u galin kaliya status link soo dhigo numbers hala hadlo number lasoo dhigo status link ooo kaliya"
    // 1. All statuses are marked as seen (auto-viewed in transport via sendReceipts('read')).
    // 2. Do NOT react or comment/reply to the status story itself.
    // 3. ONLY if a status contains a link / phone number (in text, caption, wa.me/message, or flyer image),
    //    message ONLY the extracted number(s) directly via private DM.
    if (isLinkMode) {
      const numberSet = new Set<string>(this.extractPhoneNumbersFromText(combinedText));

      // Also resolve WhatsApp Business short links (wa.me/message/... or wa.me/qr/...)
      if (/wa\.me\/(?:message|qr)\//i.test(combinedText)) {
        const resolved = await this.resolveWaMeShortLinks(combinedText);
        for (const n of resolved) numberSet.add(n);
      }

      // If image flyer/screenshot has no number in caption, try OCR via Gemini Vision
      if (
        numberSet.size === 0 &&
        hasMedia &&
        mediaKind === 'image' &&
        unwrapped.mediaContent &&
        unwrapped.baileysMediaType &&
        this.aiOrchestrator
      ) {
        try {
          const imgBuf = await MediaProcessorService.downloadMediaBuffer(
            unwrapped.mediaContent,
            unwrapped.baileysMediaType
          );
          if (imgBuf && imgBuf.length > 50) {
            const rawMime = (unwrapped.mediaContent as any)?.mimetype || '';
            const mimeType = MediaProcessorService.getMimeType(unwrapped.msgType, rawMime);
            const ocrNums = await this.extractPhoneNumbersFromImage({
              mimeType,
              dataBase64: imgBuf.toString('base64'),
            });
            for (const n of ocrNums) numberSet.add(n);
          }
        } catch (ocrErr: any) {
          console.warn(`[StatusLinkMode] Flyer OCR skipped: ${ocrErr?.message}`);
        }
      }

      const extractedNumbers = Array.from(numberSet);
      let sentAnyDm = false;
      if (extractedNumbers.length > 0) {
        console.log(`🔍 [StatusLinkMode] Found ${extractedNumbers.length} number(s) in status from ${senderJid}: ${extractedNumbers.join(', ')}`);
        const socketOwnJid = socket?.user?.id ? socket.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';

        for (const phone of extractedNumbers) {
          // Never message the bot's own connected WhatsApp session number (loop prevention)
          if (socketOwnJid && phone === socketOwnJid) {
            console.log(`ℹ️ [StatusLinkMode] Skipping bot's own number (${phone}).`);
            continue;
          }
          if (this.isPendingSaveMe(phone)) {
            console.log(`ℹ️ [StatusLinkMode] Already messaged ${phone} recently (within cooldown). Skipping duplicate DM.`);
            continue;
          }

          let targetJid = `${phone}@s.whatsapp.net`;
          // Verify number exists on WhatsApp and get exact official JID when onWhatsApp is available
          if (typeof socket.onWhatsApp === 'function') {
            try {
              const checkRes = await socket.onWhatsApp(phone);
              const first = Array.isArray(checkRes) ? checkRes[0] : null;
              if (first && first.exists === false) {
                console.log(`ℹ️ [StatusLinkMode] Skipping ${phone}: not registered on WhatsApp.`);
                continue;
              }
              if (first?.jid) {
                targetJid = first.jid;
              }
            } catch {
              // Fall back to standard JID if onWhatsApp query errors
            }
          }

          const saveMsg = `save me ${this.ownerName || 'Mohamed'}`;
          try {
            await socket.sendMessage(targetJid, { text: saveMsg });
            this.markSaveMeSent(phone);
            sentAnyDm = true;
            console.log(`📲 [StatusLinkMode] Sent DM "${saveMsg}" to extracted number ${phone} (${targetJid}) from status of ${senderName || senderJid}`);
            this.recordInteraction({
              id: `dm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              senderJid,
              senderName,
              type: 'comment',
              content: `${saveMsg} (DM to extracted number ${phone} from status link)`,
              category: 'phone_number_status',
              statusText: combinedText || '[Image Flyer]',
              timestamp: Date.now(),
            });
          } catch (sendErr: any) {
            console.warn(`[StatusLinkMode] Failed to send DM to ${phone}: ${sendErr?.message}`);
          }
        }
      } else {
        console.log(`ℹ️ [StatusLinkMode] Status from ${senderJid} viewed (seen). No link/number found; status reply/react suppressed per user rule.`);
      }
      return sentAnyDm;
    }

    // ─── 6. NORMAL MODE (!link off): Owner Guard & Cooldown ──────────────
    // Enforce owner / admin guard: never react or comment on admin's or self personal status stories!
    if (this.isAdminOrSelf(senderJid, Boolean(msg.key?.fromMe), socket)) {
      console.log(`🛡️ [StatusReactor] Ignored status from owner/admin (${senderJid}). Bot only interacts with other contacts.`);
      return false;
    }

    // Cooldown check (only active if cooldownHours is configured > 0):
    if (this.config.cooldownHours > 0 && this.isCooldownActive(senderJid)) {
      console.log(`⏳ [StatusReactor] Skipped ${senderJid}: Cooldown active.`);
      return false;
    }

    // ─── 7. INSTANT Love Cagaaran (💚) Reaction ──────────────────────────────
    // Dispatched within ~500ms so "Liked your status" appears immediately on WhatsApp!
    // Contacts will see the green heart on their story right away, without waiting
    // for AI media vision download or 10-30s typing delay.
    const shouldReact =
      this.config.autoReact &&
      (this.config.mode === 'reaction' || this.config.mode === 'both');

    if (shouldReact) {
      let instantEmoji = '💚';
      const lower = text.toLowerCase();
      if (
        lower.includes('geeriyooday') ||
        lower.includes('innaa lillaahi') ||
        lower.includes('tacsi') ||
        lower.includes('xanuun') ||
        lower.includes('isbitaal')
      ) {
        instantEmoji = '🤲';
      } else if (lower.includes('jimco') || lower.includes('duco') || lower.includes('aamiin')) {
        instantEmoji = '✨';
      }

      setTimeout(async () => {
        try {
          await this.sendStatusReaction(msg, socket, senderJid, instantEmoji);
          this.recordInteraction({
            id: `react_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            senderJid,
            senderName,
            type: 'reaction',
            content: instantEmoji,
            category: 'media_only',
            statusText: text,
            timestamp: Date.now(),
          });
          console.log(`💚 [StatusReactor] Instant Love Cagaaran (${instantEmoji}) applied for ${senderName || senderJid}`);
        } catch (rErr: any) {
          console.warn(`[StatusReactor] Instant reaction error: ${rErr?.message}`);
        }
      }, 500);
    }

    // 8. Download status media & perform AI Vision inspection if media is present
    let visualCategory: StatusCategory | null = null;
    let visualDescription: string | undefined = undefined;
    if (hasMedia && unwrapped.mediaContent && unwrapped.baileysMediaType && this.aiOrchestrator) {
      try {
        const buf = await MediaProcessorService.downloadMediaBuffer(unwrapped.mediaContent, unwrapped.baileysMediaType);
        if (buf && buf.length > 50) {
          const rawMime = (unwrapped.mediaContent as any)?.mimetype || '';
          const mimeType = MediaProcessorService.getMimeType(unwrapped.msgType, rawMime);
          const visionResult = await this.inspectStatusMediaWithAI(
            { mimeType, dataBase64: buf.toString('base64') },
            text,
            mediaKind || 'image'
          );
          visualCategory = visionResult.category;
          visualDescription = visionResult.description;
          console.log(`👁️ [StatusReactor] Vision inspected ${mediaKind || 'media'} from ${senderName || senderJid}: category=${visualCategory}, isBusiness=${visionResult.isBusiness} ("${visualDescription}")`);
        }
      } catch (err: any) {
        console.warn(`[StatusReactor] Media vision inspection failed: ${err?.message}`);
      }
    }

    const analysis = this.analyzeStatus(text, hasMedia, mediaKind, gender, visualCategory, visualDescription);

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
   * Dispatches the official WhatsApp Status Like (Love Cagaaran 💚).
   * Uses multiple fail-safe parallel delivery paths so it reliably shows up in the contact's status viewers list.
   */
  public async sendStatusReaction(
    msg: proto.IWebMessageInfo,
    socket: any,
    senderJid: string,
    emoji: string = '💚'
  ): Promise<boolean> {
    if (!socket || !msg?.key?.id) return false;

    const rawParticipant = msg.key.participant || (msg as any).participant || senderJid;
    const cleanSender      = senderJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';
    const cleanParticipant = rawParticipant.split('@')[0].split(':')[0] + '@s.whatsapp.net';

    // The reaction key targeting the status update
    const reactionKey: proto.IMessageKey = {
      remoteJid: 'status@broadcast',
      id: msg.key.id,
      participant: cleanParticipant,
      fromMe: Boolean(msg.key.fromMe),
    };

    const statusJidList: string[] = [cleanParticipant];
    if (socket.user?.id) {
      const myClean = socket.user.id.split('@')[0].split(':')[0] + '@s.whatsapp.net';
      if (myClean !== cleanParticipant) statusJidList.push(myClean);
    }

    let delivered = false;

    // Pathway 1: Direct peer sendMessage to cleanSender (Standard mechanism for WhatsApp mobile "liked your status")
    try {
      await socket.sendMessage(cleanSender, {
        react: {
          text: emoji,
          key: reactionKey,
        },
      });
      delivered = true;
      console.log(`💚 [StatusReactor] Direct peer reaction "${emoji}" sent to ${cleanSender} (id: ${msg.key.id})`);
    } catch (err: any) {
      console.warn(`[StatusReactor] Peer reaction attempt 1 error: ${err?.message}`);
    }

    // Pathway 2: Send to status@broadcast with statusJidList (WhatsApp server-side status like registration)
    try {
      await socket.sendMessage(
        'status@broadcast',
        {
          react: {
            text: emoji,
            key: reactionKey,
          },
        },
        {
          statusJidList,
        }
      );
      delivered = true;
      console.log(`💚 [StatusReactor] Broadcast reaction "${emoji}" delivered to status@broadcast`);
    } catch (err: any) {
      console.warn(`[StatusReactor] Broadcast reaction attempt 2 notice: ${err?.message}`);
    }

    // Pathway 3: Fallback using original msg.key to cleanSender if different
    if (!delivered) {
      try {
        await socket.sendMessage(cleanSender, {
          react: {
            text: emoji,
            key: msg.key,
          },
        });
        delivered = true;
        console.log(`💚 [StatusReactor] Fallback msg.key peer reaction delivered to ${cleanSender}`);
      } catch (err: any) {
        console.warn(`[StatusReactor] Fallback reaction attempt 3 error: ${err?.message}`);
      }
    }

    // Pathway 4: If senderJid differs from cleanSender (e.g. LID variant), notify senderJid directly
    if (senderJid && senderJid !== cleanSender) {
      try {
        await socket.sendMessage(senderJid, {
          react: {
            text: emoji,
            key: reactionKey,
          },
        });
      } catch {}
    }

    return delivered;
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
    mediaKind?: string | null
  ): Promise<void> {
    if (!socket) return;

    // --- Handle phone_number_status: skip both react and comment, send DM directly to the phone owner ---
    if (analysis.category === 'phone_number_status') {
      try {
        const extracted = this.extractPhoneNumbersFromText(rawText);
        for (const targetPhone of extracted) {
          if (this.isAdminOrSelf(`${targetPhone}@s.whatsapp.net`, false, socket)) continue;
          if (this.isPendingSaveMe(targetPhone)) continue;

          const phoneJid = `${targetPhone}@s.whatsapp.net`;
          const saveMsg = `save me ${this.ownerName || 'Mohamed'}`;
          await socket.sendMessage(phoneJid, { text: saveMsg });
          this.markSaveMeSent(targetPhone);
          console.log(`📲 [StatusReactor] Sent DM "${saveMsg}" directly to contact ${targetPhone} (extracted from status of ${senderName || senderJid})`);
          this.recordInteraction({
            id: `dm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            senderJid,
            senderName,
            type: 'comment',
            content: `${saveMsg} (DM sent directly to ${targetPhone})`,
            category: analysis.category,
            statusText: rawText,
            timestamp: Date.now(),
          });
        }
      } catch (err: any) {
        console.warn(`[StatusReactor] Failed to send phone-number DM: ${err?.message}`);
      }
      return;
    }

    // Decide whether to react, comment, or both
    const shouldReact =
      this.config.autoReact &&
      (this.config.mode === 'reaction' || this.config.mode === 'both' || !this.config.autoComment);
    // emoji_only, link_status, and business: react only (Love Cagaaran 💚), never comment per user requirement!
    const skipComment =
      analysis.category === 'emoji_only' ||
      analysis.category === 'link_status' ||
      analysis.category === 'business' ||
      analysis.suggestedComments.length === 0;
    const shouldComment =
      !skipComment &&
      this.config.autoComment &&
      (this.config.mode === 'comment' || this.config.mode === 'both' || !this.config.autoReact);

    // 1. Send Emoji Reaction (Love Cagaaran 💚 / Green Heart / Contextual Emoji)
    if (shouldReact) {
      // Determine appropriate emoji: 💚 (Love Cagaaran / Green Heart) for general/positive/media, 🤲 for tacsi/xanuun
      let emoji = '💚';
      if (analysis.category === 'condolence' || analysis.category === 'illness') {
        emoji = '🤲';
      } else if (analysis.category === 'islamic_friday' || analysis.category === 'islamic_duco') {
        const islamic = ['🤲', '🤍', '✨'];
        emoji = islamic[Math.floor(Math.random() * islamic.length)];
      } else {
        // Default to Green Heart 💚 (Love Cagaaran - WhatsApp Status Like)
        emoji = '💚';
      }

      try {
        await this.sendStatusReaction(msg, socket, senderJid, emoji);
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
        console.log(`💚 [StatusReactor] Reacted "${emoji}" (Love Cagaaran) to status of ${senderName || senderJid} (${gender})`);
      } catch (err: any) {
        console.warn(`[StatusReactor] Failed to react to status: ${err?.message}`);
      }
    }

    // 2. Send Smart Comment / Reply
    if (shouldComment) {
      try {
        let comment = await this.generateComment(analysis, senderName, gender, mediaKind);
        // Absolute safety guard: ensure the word "qaali" NEVER appears in comments sent to contacts
        comment = comment.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();

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
