import fs from 'fs';
import path from 'path';
import { proto } from '@whiskeysockets/baileys';
import { MediaProcessorService } from './media-processor.service.js';
import { broadcastService } from './broadcast.service.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';

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
  | 'media_only';

export interface StatusAnalysisResult {
  category: StatusCategory;
  suggestedEmojis: string[];
  suggestedComments: string[];
  extractedText: string;
  hasMedia: boolean;
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

export class StatusReactorService {
  private configPath: string;
  private config: StatusReactorConfig;
  private lastContactInteraction: Map<string, number> = new Map();
  private interactionLogs: StatusInteractionLog[] = [];
  private aiOrchestrator: AIOrchestrator | null = null;
  private pendingTimeouts: Map<string, NodeJS.Timeout> = new Map();

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
      cooldownHours: 4,
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
   * Checks whether a contact is currently in cooldown to prevent spamming
   */
  public isCooldownActive(jid: string): boolean {
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
   * Intelligently analyzes WhatsApp Status text & media to determine category, emojis, and comments.
   */
  public analyzeStatus(text: string, hasMedia: boolean = false): StatusAnalysisResult {
    const clean = (text || '').trim();
    const lower = clean.toLowerCase();

    // 1. Condolence / Tacsi / Geeri (HIGHEST PRIORITY - must never receive celebratory reactions)
    if (
      /\b(innalillahi|inaa lilaahi|geeri|geeriyooday|geeriyootay|tacsiyo|tacsi|samir|allaha u naxariisto|ilaahay ha u naxariisto|marxuum|marxuumad)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'condolence',
        suggestedEmojis: ['🤲'],
        suggestedComments: [
          'Innaa Lillaahi wa innaa Ilayhi Raajicuun. Samir iyo iimaan Ilaahay ha idinka siiyo, marxuumkana jannadii fardowsa 🤲',
          'Ilaahay ha u naxariisto, qabrigana ha u nuuro, samir iyo iimaanna ha idinka siiyo walaal 🤲',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.99,
      };
    }

    // 2. Illness / Xanuun / Caafimaad-darro
    if (
      /\b(xanuunsan|isbitaal|hospital|caafimaad darro|shifa|ilaahay ha caafiyo|allaha caafiyo|bogsasho)\b/i.test(lower)
    ) {
      return {
        category: 'illness',
        suggestedEmojis: ['🤲'],
        suggestedComments: [
          'Ilaahay shifa taam ah iyo caafimaad degdeg ah ha siiyo, aamiin yaa rabbi 🤲',
          'Rabi xanuunka ha ka qaado, caafimaad degdeg ahna ha ugu beddelo 🤲✨',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.95,
      };
    }

    // 3. Graduation / Qalinjabin / Guul Waxbarasho
    if (
      /\b(qalin|qalinjabin|graduation|bachelor|master|phd|shahaado|diploma|congrats|congratulations|hambalyo|jaamacad|jaamacadda|degree|alxamdulilah dhameeyay|graduated)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'graduation',
        suggestedEmojis: ['🎓', '👏', '🎉', '🌟'],
        suggestedComments: [
          "Masha'Allah, hambalyo walaal! Guul iyo mustaqbal wanaagsan ayaan kuu rajaynayaa 🎓🎉",
          "Masha'Allah hambalyo guusha weyn, waxaad tahay qof ku dayasho mudan! 👏✨",
          'Hambalyo qalinjabinta walaal, Rabi cilmigaaga ha kuu barakeeyo! 🎓✨',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.95,
      };
    }

    // 4. Wedding / Aroos / Meher
    if (
      /\b(aroos|arooska|meher|meherka|meherkii|arooskii|guri gal|guri-gal|wedding|is calfada|barakallahu lakuma|aroosad)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'wedding',
        suggestedEmojis: ['💍', '❤️', '💐', '🤲'],
        suggestedComments: [
          'Barakallahu lakumaa wa baaraka calaykumaa, Masha\'Allah guri nagi iyo bash-bash! 💍🤲',
          'Masha\'Allah hambalyo meherka/arooska qaali, nolol barako leh iyo ubad khayr qaba! ❤️✨',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.95,
      };
    }

    // 5. Islamic Friday / Jimco
    if (/\b(jimce|jimco|jummah|jumah|juma)\b/i.test(lower)) {
      return {
        category: 'islamic_friday',
        suggestedEmojis: ['🤲', '🕌', '🤍', '✨'],
        suggestedComments: [
          'Jimco barakaysan walaal, Rabi ducada iyo camalka wanaagsan ha inaga aqbalo 🤲✨',
          'Jimco mubaarak, naxariis iyo dambi-dhaaf Rabi ha inagu mannaysto 🤲🤍',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.95,
      };
    }

    // 6. Islamic Duco / Praise
    if (
      /\b(aamiin|amiin|alxamdullilah|alxamdulillah|subxaanallah|subhanallah|astaghfirullah|nabi|scw|saliga|salawaat|ducada|duco)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'islamic_duco',
        suggestedEmojis: ['🤲', '🤍', '✨'],
        suggestedComments: [
          'Aamiin yaa Rabbi, aamiin yaa kareem 🤲🤍',
          'Aamiin yaa Hayyu yaa Qayuum, Rabi ha inaga aqbalo 🤲✨',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.9,
      };
    }

    // 7. Funny / Kaftan / Qosol / Meme
    if (
      /\b(hahaha|kkkk|qosol|funny|lol|walaahi|kaftan|meeday|yaab|ciil|dhacdo|bashaal)\b/i.test(lower) ||
      /(🤣|😂|😭|😹)/.test(clean)
    ) {
      return {
        category: 'funny',
        suggestedEmojis: ['😂', '🤣', '🔥', '💀'],
        suggestedComments: [
          'Hahaha xaqiiq weeye walaahi 😂🤣',
          'Hahaha waar yaabka, meeday kkkk 😭😂',
          'Hahaha qosol badanaa runti 🤣',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.9,
      };
    }

    // 8. Business / Ganacsi / Sale / Products
    if (
      /\b(iib|qiimo|qiimaha|dalbo|delivery|order|discount|sale|furniture|dhar|kabo|stock|meherad|dukaan|xafiis|kirada|commission|kala soo xiriir)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'business',
        suggestedEmojis: ['💼', '🔥', '🤲', '✨'],
        suggestedComments: [
          'Masha\'Allah, Rabi meheradda iyo ganacsigaaga ha kuu barakeeyo walaal! 🤲💼',
          'Masha\'Allah alaab aad u qurux badan, suuq khayr leh iyo macaamiil badan! ✨🔥',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.88,
      };
    }

    // 9. Travel / Safar / Tourism / Airport
    if (
      /\b(safar|safarka|airport|plane|flight|dalxiis|magaalo|travel|nairobi|dubai|muqdisho|hargeysa|bosaaso|garowe|berbera|kismaayo|turkey)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'travel',
        suggestedEmojis: ['✈️', '🌍', '🌴', '✨'],
        suggestedComments: [
          'Masha\'Allah safar khayr iyo nabad qab leh walaal! ✈️🌍',
          'Masha\'Allah meel aad u bilic san, soo bashaal! 🌴✨',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.88,
      };
    }

    // 10. Style / Selfie / Outfit
    if (/\b(style|outfit|fashion|dhar|shidan|vibe|mood|aniga|selfie|pose)\b/i.test(lower)) {
      return {
        category: 'style_selfie',
        suggestedEmojis: ['🔥', '👏', '❤️', '✨'],
        suggestedComments: [
          'Masha\'Allah aad baad u shidan tahay walaal! 🔥✨',
          'Masha\'Allah style aad u qurux badan! 👏',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.85,
      };
    }

    // 11. General Quote / Deep thought
    if (clean.length > 20) {
      return {
        category: 'general_quote',
        suggestedEmojis: ['❤️', '👏', '✨', '👍'],
        suggestedComments: [
          'Masha\'Allah runti, xikmad aad u qiimo badan! ✨',
          'Masha\'Allah, hadal aad u miisaan culus walaal 👏',
        ],
        extractedText: clean,
        hasMedia,
        confidence: 0.8,
      };
    }

    // 12. Media only (Photo or Video without specific caption)
    return {
      category: 'media_only',
      suggestedEmojis: ['🔥', '❤️', '👏', '✨'],
      suggestedComments: [
        'Masha\'Allah aad u qurux badan! ✨',
        'Masha\'Allah wax aad u heer sarreeya walaal 🔥',
      ],
      extractedText: clean,
      hasMedia,
      confidence: 0.7,
    };
  }

  /**
   * Generates a tailored comment, leveraging Gemini AI if available and quota allows.
   */
  public async generateComment(analysis: StatusAnalysisResult, senderName: string = ''): Promise<string> {
    // If AI is available and enabled, try generating a nuanced short Somali comment
    if (this.config.aiEnhanced && this.aiOrchestrator && analysis.extractedText.length > 10) {
      try {
        const prompt = `Waxaad tahay saaxiib asluub badan oo WhatsApp ku arkaya status uu qof saaxiibka ahi soo dhigay.
Magaca qofka: "${senderName || 'Walaal'}"
Qoraalka status-ka: "${analysis.extractedText}"
Nooca/Dulucda: ${analysis.category}

Qor hal weedh (fariin gaaban oo 5 ilaa 10 eray ah) oo aad ugu hambalyaynayso, ugu ducaynayso, ama kula qoslayso si dabiici ah oo qof caadi ah oo kale ah.
Shuruucda:
1. Ha u hadlin sidii robot ama AI.
2. Ha dhihin wax dawo ah ama talo caafimaad ah.
3. Luuqadda waa inay noqotaa Somali saafi ah, diirran, oo xushmad leh.
4. Ha bilaabin "Asc" ama "Wcs", toos u qor faallada.`;

        const res = await this.aiOrchestrator.generateResponse(prompt, [], { maxOutputTokens: 50 });
        if (res && res.text && !res.text.includes('mashquulsan') && res.text.trim().length > 3) {
          return res.text.trim();
        }
      } catch (err: any) {
        console.warn(`[StatusReactor] AI comment generation fallback to rule: ${err?.message}`);
      }
    }

    // Reliable fallback from rule-based suggested comments
    const list = analysis.suggestedComments;
    return list[Math.floor(Math.random() * list.length)];
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

    // Enforce cooldown so we never spam someone uploading multiple stories in a row
    if (this.isCooldownActive(senderJid)) {
      console.log(`⏳ [StatusReactor] Skipped ${senderJid}: Cooldown active.`);
      return false;
    }

    // Unwrap message and extract content
    const unwrapped = MediaProcessorService.unwrapMessage(msg.message);
    const innerMsg = unwrapped.message;
    const hasMedia = Boolean(unwrapped.mediaKind);
    const text =
      innerMsg.conversation ||
      innerMsg.extendedTextMessage?.text ||
      innerMsg.imageMessage?.caption ||
      innerMsg.videoMessage?.caption ||
      innerMsg.documentMessage?.caption ||
      '';

    const senderName = msg.pushName || '';
    const analysis = this.analyzeStatus(text, hasMedia);

    // Calculate natural human delay (e.g. 10 to 30 seconds)
    const minDelay = Math.max(0, this.config.minDelaySeconds);
    const maxDelay = Math.max(minDelay, this.config.maxDelaySeconds);
    const delayMs = Math.floor(Math.random() * ((maxDelay - minDelay) * 1000 + 1)) + minDelay * 1000;

    console.log(
      `🎯 [StatusReactor] Scheduled interaction with ${senderName || senderJid} (${analysis.category}) in ${Math.round(
        delayMs / 1000
      )}s...`
    );

    // Schedule the interaction
    const timer = setTimeout(async () => {
      try {
        await this.executeInteraction(msg, socket, senderJid, senderName, analysis, text);
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
    rawText: string
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

        console.log(`❤️ [StatusReactor] Reacted "${emoji}" to status of ${senderName || senderJid}`);
      } catch (err: any) {
        console.warn(`[StatusReactor] Failed to react to status: ${err?.message}`);
      }
    }

    // 2. Send Smart Comment / Reply
    if (shouldComment) {
      try {
        const comment = await this.generateComment(analysis, senderName);

        // Natural short typing indicator before delivering comment
        await socket.sendPresenceUpdate('composing', senderJid).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 600));
        await socket.sendPresenceUpdate('paused', senderJid).catch(() => {});

        // Send direct reply quoting the status message
        await socket.sendMessage(
          senderJid,
          { text: comment },
          { quoted: msg }
        );

        this.recordInteraction({
          id: `comment_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          senderJid,
          senderName,
          type: 'comment',
          content: comment,
          category: analysis.category,
          statusText: rawText,
          timestamp: Date.now(),
        });

        console.log(`💬 [StatusReactor] Commented on status of ${senderName || senderJid}: "${comment}"`);
      } catch (err: any) {
        console.warn(`[StatusReactor] Failed to send status comment: ${err?.message}`);
      }
    }
  }
}

export const statusReactorService = new StatusReactorService();
