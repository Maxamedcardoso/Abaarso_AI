import { IncomingMessage, IMessagingTransport, OutgoingMedia } from '../transports/transport.interface.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { MessageDeduplicator } from './deduplicator.js';
import { RateLimiter } from './rate-limiter.js';
import { AppConfig } from '../config/env.js';
import { broadcastService, BroadcastService } from '../services/broadcast.service.js';
import { whatsappManagerService, WhatsAppManagerService } from '../services/whatsapp-manager.service.js';
import { statusReactorService, StatusReactorService } from '../services/status-reactor.service.js';
import {
  DEFAULT_CARDOSO_PROMO_DIALOGUE,
  VoiceReplyService,
} from '../services/voice-reply.service.js';
import { IStudentMemory } from '../memory/memory.interface.js';
import { UserProfiler } from '../services/user-profiler.service.js';
import { PlanGuard } from '../tenants/plan-catalog.js';
import { codeRunnerService } from '../services/code-runner.service.js';
import { errorLogService, formatClock, formatDuration } from '../services/error-log.service.js';
import { ViewsHubError, ViewsHubService, normalizeViewsPhone } from '../services/views-hub.service.js';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';

export interface MessageRouterOptions {
  /** Tenant id (used to scope `!info` error output for subscribers). Defaults to 'owner'. */
  tenantId?: string;
  broadcast?: BroadcastService;
  whatsappManager?: WhatsAppManagerService;
  statusReactor?: StatusReactorService;
  planGuard?: PlanGuard;
  subscriptionCheck?: () => { active: boolean; reason?: string };
  getExtraAdmins?: () => string[];
  onboardingHandler?: (
    message: IncomingMessage,
    transport: IMessagingTransport,
    isAdminUser: boolean
  ) => Promise<{ handled: boolean; reason?: string }>;
  sendGuidePdfHandler?: (chatId: string, transport: IMessagingTransport) => Promise<boolean>;
  publicBaseUrl?: string;
  viewsHub?: ViewsHubService;
}

export class MessageRouter {
  private engine: StudentAdvisorEngine;
  private deduplicator: MessageDeduplicator;
  private rateLimiter: RateLimiter;
  private config: AppConfig;
  private isBotActiveGlobally: boolean = true;
  private inactiveGroups: Set<string> = new Set();
  private memory?: IStudentMemory;
  private broadcast: BroadcastService;
  private whatsappManager: WhatsAppManagerService;
  private statusReactor: StatusReactorService;
  private planGuard?: PlanGuard;
  private subscriptionCheck?: () => { active: boolean; reason?: string };
  private getExtraAdmins?: () => string[];
  private onboardingHandler?: MessageRouterOptions['onboardingHandler'];
  private sendGuidePdfHandler?: MessageRouterOptions['sendGuidePdfHandler'];
  private publicBaseUrl: string;
  private viewsHub?: ViewsHubService;
  private groupVcfCooldown: Map<string, { sentAt: number; joinsSince: number }> = new Map();
  private tenantId: string;
  private isOwnerTenant: boolean;

  constructor(
    engine: StudentAdvisorEngine,
    config: AppConfig,
    deduplicator?: MessageDeduplicator,
    rateLimiter?: RateLimiter,
    memory?: IStudentMemory,
    options?: MessageRouterOptions
  ) {
    this.engine = engine;
    this.config = config;
    this.deduplicator = deduplicator || new MessageDeduplicator();
    this.rateLimiter = rateLimiter || new RateLimiter();
    this.memory = memory;
    this.broadcast = options?.broadcast || broadcastService;
    this.whatsappManager = options?.whatsappManager || whatsappManagerService;
    this.statusReactor = options?.statusReactor || statusReactorService;
    this.planGuard = options?.planGuard;
    this.subscriptionCheck = options?.subscriptionCheck;
    this.getExtraAdmins = options?.getExtraAdmins;
    this.onboardingHandler = options?.onboardingHandler;
    this.sendGuidePdfHandler = options?.sendGuidePdfHandler;
    this.publicBaseUrl = (
      options?.publicBaseUrl ||
      process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      ''
    ).replace(/\/+$/, '');
    this.tenantId = options?.tenantId || 'owner';
    this.isOwnerTenant = this.tenantId === 'owner';
    if (options?.viewsHub) {
      this.viewsHub = options.viewsHub;
    } else if (this.isOwnerTenant && memory instanceof SQLiteStudentMemory) {
      this.viewsHub = new ViewsHubService(
        () => memory.getDatabase(),
        config.security.adminPhoneNumbers[0] || ''
      );
    }
    if (this.engine?.getAIOrchestrator) {
      this.whatsappManager.setAIOrchestrator(this.engine.getAIOrchestrator());
    }
  }

  public isAdmin(senderNumber: string, isGroup: boolean = false): boolean {
    const clean = senderNumber.replace(/[^0-9]/g, '');
    if (!clean) return false;
    const extra = this.getExtraAdmins ? this.getExtraAdmins() : [];
    const allAdmins = [...this.config.security.adminPhoneNumbers, ...extra]
      .map((a) => String(a || '').replace(/[^0-9]/g, ''))
      .filter(Boolean);
    if (allAdmins.length === 0) {
      // If no admin whitelist is configured, strictly only host phone (isFromMe) has admin privileges
      return false;
    }
    return allAdmins.some((admin) => clean.endsWith(admin) || admin.endsWith(clean));
  }

  public isGroupAllowed(groupJid: string): boolean {
    if (this.config.security.allowedGroups.length === 0) {
      return true; // No whitelist means all groups allowed
    }
    return this.config.security.allowedGroups.includes(groupJid);
  }

  /**
   * Resolves a target participant from mentions, text argument, or quoted message.
   */
  private extractTargetParticipant(message: IncomingMessage, rawArg?: string): string {
    // 1. If an explicit WhatsApp @mention was captured in mentionedJids
    if (message.mentionedJids && message.mentionedJids.length > 0) {
      return message.mentionedJids[0];
    }
    // 2. If an argument was provided in the command text (e.g. "@252634949642", "252634949642", or "0634949642")
    if (rawArg && rawArg.trim()) {
      return rawArg.trim();
    }
    // 3. If the command was a reply/quote to another participant's message
    if (message.quotedParticipant) {
      return message.quotedParticipant;
    }
    return '';
  }

  /**
   * Resolves the owner's private Self-Chat JID so Broadcast List teasers, errors,
   * and delivery reports are sent ONLY to the owner and NEVER spam list recipients.
   */
  private resolveOwnerFeedbackChatId(message: IncomingMessage, transport: IMessagingTransport): string {
    if (!this.whatsappManager.isBroadcastListJid(message.chatId)) {
      return message.chatId;
    }
    const sockUserId: string = transport.getSocket?.()?.user?.id || '';
    if (sockUserId) {
      const num = sockUserId.split(':')[0].split('@')[0].replace(/\D/g, '');
      if (num.length >= 7) return `${num}@s.whatsapp.net`;
    }
    const mgrSelf = this.whatsappManager.getOwnerSelfChatJid();
    if (mgrSelf) return mgrSelf;
    const firstAdmin = (this.config.security.adminPhoneNumbers || [])
      .map(p => String(p || '').replace(/\D/g, ''))
      .find(p => p.length >= 7);
    if (firstAdmin) return `${firstAdmin}@s.whatsapp.net`;
    if (message.senderId && !this.whatsappManager.isBroadcastListJid(message.senderId)) {
      return message.senderId;
    }
    return message.chatId;
  }

  /**
   * Resolves authentic recipients of a WhatsApp Broadcast List (<id>@broadcast)
   * and dispatches playable media (Ogg Opus PTT or MP4 video) individually with
   * safe natural pacing, avoiding Baileys 6.7.9's @broadcast -> @s.whatsapp.net bug.
   */
  private async dispatchMediaToBroadcastList(
    broadcastJid: string,
    media: OutgoingMedia,
    transport: IMessagingTransport
  ): Promise<{ delivered: number; failed: number; total: number; listName: string }> {
    const resolved = await this.whatsappManager.resolveBroadcastListRecipients(broadcastJid, true);
    if (resolved.recipients.length === 0 || typeof transport.sendMedia !== 'function') {
      return { delivered: 0, failed: 0, total: 0, listName: resolved.name };
    }
    let delivered = 0;
    let failed = 0;
    for (let i = 0; i < resolved.recipients.length; i++) {
      try {
        const ok = await transport.sendMedia(resolved.recipients[i], media);
        if (ok) delivered++;
        else failed++;
      } catch {
        failed++;
      }
      if (i < resolved.recipients.length - 1) {
        await new Promise(r => setTimeout(r, 350 + Math.floor(Math.random() * 250)));
      }
    }
    return {
      delivered,
      failed,
      total: resolved.recipients.length,
      listName: resolved.name,
    };
  }

  private buildEmptyBroadcastListNotice(broadcastJid: string, label: string): string {
    return (
      `📢 *Broadcast List Sync Loo Baahan Yahay*\n` +
      `WhatsApp mobile weli ma soo gudbin liiska dadka ku jira Broadcast List-kan (\`${broadcastJid}\`), sidaas darteed ${label} waxaan kuugu soo diray halkan (Self-Chat) si uusan kuu lumin.\n\n` +
      `✅ *Hal mar xidhi liiskan (midkood samee):*\n` +
      `1️⃣ Gudaha Broadcast List-kaas hal mar dir fariin gaaban (sida \`Salaam\`) — marka receipts-ku soo dhacaan CARDOSO AI si toos ah ayuu dadka liiska u kaydinayaa!\n` +
      `2️⃣ Ama hal mar ku dar lambarada adigoo qoraya:\n` +
      `\`!bclist add ${broadcastJid} 25263xxxxxxx, 25263yyyyyyy\`\n\n` +
      `_Marka xubnaha la kaydiyo, \`!podcast\` iyo \`!cod\` toos bay liiskan ugu wada gaadhayaan!_ 🎙️✨`
    );
  }

  /**
   * Handles continuity ONLY when a contact genuinely replies to a WhatsApp status/story
   * or explicitly quotes a status comment.
   * NEVER intercepts normal private chats!
   */
  private async handleStatusInteractionContinuity(
    message: IncomingMessage,
    transport: IMessagingTransport
  ): Promise<boolean> {
    if (message.isGroup || message.isFromMe) return false;

    const lower = message.content.toLowerCase().trim();
    const contactJid = message.chatId || message.senderId;
    const isStoryReply = Boolean(message.isStoryReply || message.quotedParticipant === 'status@broadcast');
    const quotedComment = message.quotedMessageId
      ? this.statusReactor.getCommentByMsgId(message.quotedMessageId)
      : undefined;
    const recentComment = this.statusReactor.getRecentCommentForContact(contactJid);

    // Short explicit gratitude / duco detection
    const isGratitude =
      /^(?:mahadsanid|waad\s+ku\s+mahadsantahay|waad\s+mahadsantahay|thanks|thx|thank\s+you|aamiin|amiin|aamiin\s+yaa\s+rabbi|shukran|shukran\s+jaziilan|jazaakallahu\s+khayr|jazakallah|adigaa\s+mudan|mar\s+kasta|haye\s+sxb|ok\s+sxb|khayr\s+allaha\s+ku\s+siiyo|ilaahay\s+haku\s+dhowro|walaahi\s+waad\s+mahadsantahay)[.!،\s]*$/i.test(
        lower
      ) || (/^(?:aamiin|amiin|mahadsanid|thanks)\b/i.test(lower) && lower.length <= 35);

    const isRecentGratitudeReply = isGratitude && Boolean(quotedComment || (recentComment && (Date.now() - recentComment.timestamp < 15 * 60 * 1000)));

    // STRICT GUARD: If this is NOT a story reply, NOT quoting a status comment, and NOT short status gratitude:
    // It is a NORMAL PRIVATE CHAT! Must never intercept normal conversations.
    if (!isStoryReply && !quotedComment && !isRecentGratitudeReply) {
      return false;
    }

    // Never intercept explicit bot commands (e.g., "!maamul", "!status", "!view", "@cardoso", "!help")
    if (
      /^[!./#]/.test(lower) ||
      lower.startsWith('@cardoso') ||
      lower.startsWith('!cardoso')
    ) {
      return false;
    }

    // Never intercept formal academic/course queries
    if (
      /\b(diiwaangelin|admission|kulliyad|faculties|kharashka|tuition|shuruudaha|requirements|course kee|shahaado)\b/i.test(
        lower
      )
    ) {
      return false;
    }

    const effectiveStatusContext = quotedComment || recentComment;
    const gender = UserProfiler.detectGender(message.senderName || effectiveStatusContext?.senderName);

    // ── CASE 1: Gratitude / Thanks / Duco acknowledgement ("ku mahadnaqo") ──
    if (isRecentGratitudeReply) {
      const maleGratitudeReplies = [
        'Adigaa mudan sxb! Mar kasta guul iyo bash-bash ayaan kuu rajaynayaa 🙌✨',
        'Waa waxba sxb! Farxad ayaan kula qaybsanaynaa mar kasta! 💪',
        'Aamiin yaa Rabbi sxb! Adna khayr iyo caafimaad Allaha ku siiyo! 🤲✨',
        'Adigaa mudan bro! Iska waran see tahay xagaaga? 😊',
      ];
      const femaleGratitudeReplies = [
        'Adigaa mudan abaayo! Mar kasta bash-bash iyo khayr baan kuu rajaynayaa 🌸✨',
        'Aamiin yaa Rabbi abaayo macaan! Adigana Allaha ku dhowro! 🤲🤍',
        'Waa waxba abaayo macaan, mar kasta nolosha ku farax! ✨',
        'Adigaa mudan abaayo! See tahay xagaaga iyo caafimaadka? 🌸',
      ];
      const neutralGratitudeReplies = [
        'Adigaa mudan walaal! Mar kasta guul iyo barako ayaan kuu rajaynayaa ✨',
        'Waa waxba walaal, nolosha iyo mustaqbalka ku raaxayso! 🤲✨',
      ];

      const pool =
        gender === 'male'
          ? maleGratitudeReplies
          : gender === 'female'
            ? femaleGratitudeReplies
            : neutralGratitudeReplies;
      let reply = pool[Math.floor(Math.random() * pool.length)];
      reply = reply.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();

      await transport.sendMessage(message.chatId, reply, { replyToMessageId: message.id });
      console.log(`🤝 [Status Continuity] Responded with friendly gratitude to ${message.senderName || contactJid} (${gender})`);
      return true;
    }

    // ── CASE 2: Story Reply to WhatsApp Status ──
    if (isStoryReply) {
      if (!this.whatsappManager.isAIEnabled()) {
        return false;
      }
      const ai = this.engine.getAIOrchestrator();
      if (ai) {
        try {
          const prompt = `Waxaad tahay nin dhallinyaro ah oo Soomaali ah oo status soo dhigtay WhatsApp.
Saaxiibkaaga (${message.senderName || 'Walaal'}, Jinsiga: ${gender === 'male' ? 'Wiil/Nin' : gender === 'female' ? 'Gabadh' : 'Lama hubo'}) ayaa reply kasoo bixiyay status-kaaga.
Qoraalka status-kaaga: "${message.quotedText || 'Status'}"
Fariinta uu qofku kusoo qoray: "${message.content}"

Uga jawaab si dabiici ah oo saaxiibtinimo leh (1 ilaa 2 weedhood oo gaagaaban), fahan hadalkiisa oo toos uga jawaab.
SHURUUCO ADAG:
1. MAMNUUC ADAG: WELIGAA qofna ha ku odhan "qaali" ama "qaaliga ah". Ereyga "qaali" gabi ahaanba waa mamnuuc!
2. WELIGAA ha odhan "Maxaan kaa caawiyaa?", "Sideen kuu caawin karaa?", "Kusoo dhawoow", ama "Waxaan ahay AI". U hadal sidii nin dhab ah oo saaxiibkiis la hadlaya!`;

          const res = await ai.generateResponse(prompt, [], { maxOutputTokens: 60 });
          if (res && res.text && res.text.trim().length > 3) {
            let replyText = res.text.trim().replace(/^["']|["']$/g, '');
            replyText = replyText.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();
            await transport.sendMessage(message.chatId, replyText, { replyToMessageId: message.id });
            return true;
          }
        } catch (e: any) {
          console.warn(`[Status Continuity] AI story reply fallback: ${e?.message}`);
        }
      }

      const fallback =
        gender === 'male'
          ? "Masha'Allah sxb! Waad ku mahadsantahay inaad status-ka soo booqatay 🙌"
          : gender === 'female'
            ? "Masha'Allah abaayo macaan! Waad ku mahadsantahay inaad status-ka soo booqatay 🌸"
            : "Masha'Allah walaal! Waad ku mahadsantahay inaad status-ka soo booqatay ✨";
      await transport.sendMessage(message.chatId, fallback, { replyToMessageId: message.id });
      return true;
    }

    // ── CASE 3: Explicit Quoted Status Comment Follow-Up (User quoted the comment to ask/chat) ──
    if (quotedComment) {
      if (!this.whatsappManager.isAIEnabled()) {
        return false;
      }
      const ai = this.engine.getAIOrchestrator();
      if (ai) {
        try {
          const genderDirective =
            gender === 'male'
              ? 'QOFKU WAA WIIL / NIN: Ula hadal sidii saaxiib dhow oo rag ah adoo adeegsanaya ereyada: "sxb", "walaal", "bro", "geesi", "ninyahow". QOF NIN AH WELIGAA HA KU ODHAN "abaayo" ama "qaali"!'
              : gender === 'female'
                ? 'QOFKU WAA GABADH: Ula hadal si xushmad, asluub iyo qaddarin leh: "abaayo", "walaashay", "huuno". Weligaa ha ku odhan "ninyahow" ama "qaali"!'
                : 'JINSIGA LAMA HUBO: U adeegso ereyo xushmad leh oo dhexdhexaad ah sida "walaal". Weligaa ha isticmaalin "qaali".';

          const prompt = `Waxaad tahay nin dhallinyaro ah oo Soomaali ah, caqli badan, asluub leh, furfuran (nin saaxiib dhow ah oo WhatsApp ku sheekaysanaya).
Dhowaan waxaad faallo (comment) ku dhigtay status uu soo dhigay: "${quotedComment.commentText}" (Dulucda status-ka: "${quotedComment.statusText || quotedComment.category}").
Magaca saaxiibkaaga: "${message.senderName || quotedComment.senderName || 'Walaal'}"
${genderDirective}
Fariinta uu hadda kuusoo diray saaxiibkaagu isagoo reply ku haya faalladaadii: "${message.content}"

Uga jawaab si dabiici ah oo saaxiibtinimo leh, fahan wuxuu ku yidhi oo si toos ah uga jawaab (1 ilaa 2 weedhood oo gaagaaban).
SHURUUCDA DUGSIIYA:
1. MAMNUUC ADAG: WELIGAA qofna ha ku odhan "qaali" ama "qaaliga ah". Ereyga "qaali" gabi ahaanba waa mamnuuc!
2. WELIGAA ha odhan "Maxaan kaa caawiyaa?", "Sideen kuu caawin karaa?", "Kusoo dhawoow", ama "Waxaan ahay AI".
3. Ha u hadlin sidii bot ama shirkad, u hadal sidii nin dhab ah oo saaxiibkiis la hadlaya.
4. Luuqad Soomaali saafi ah oo diirran.`;

          const res = await ai.generateResponse(prompt, [], { maxOutputTokens: 60 });
          if (res && res.text && res.text.trim().length > 3) {
            let replyText = res.text.trim().replace(/^["']|["']$/g, '');
            replyText = replyText.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();
            await transport.sendMessage(message.chatId, replyText, { replyToMessageId: message.id });
            console.log(`💬 [Status Continuity] Responded contextually to status follow-up from ${message.senderName || contactJid}`);
            return true;
          }
        } catch (e: any) {
          console.warn(`[Status Continuity] AI contextual continuity fallback: ${e?.message}`);
        }
      }

      const fallback =
        gender === 'male'
          ? 'Waa caadi sxb, mar kasta waan kula socdaa! See tahay adigu xaalkaaga?'
          : gender === 'female'
            ? 'Waa caadi abaayo macaan, mar kasta waan kula socdaa! See tahay adigu xaalkaaga?'
            : 'Waa caadi walaal, mar kasta waan kula socdaa! See tahay adigu xaalkaaga?';
      await transport.sendMessage(message.chatId, fallback, { replyToMessageId: message.id });
      return true;
    }

    return false;
  }

  private chatQueues: Map<string, Promise<any>> = new Map();
  private pendingLinkCampaignPhotos: Map<
    string,
    { buffer: Buffer; mimeType: string; type: 'image' | 'video'; timestamp: number }
  > = new Map();
  private recentLinkCampaignTextPosts: Map<
    string,
    { linkText: string; timestamp: number }
  > = new Map();

  private getFreshPendingLinkPhoto(senderKey: string): {
    buffer: Buffer;
    mimeType: string;
    type: 'image' | 'video';
    timestamp: number;
  } | null {
    const entry = this.pendingLinkCampaignPhotos.get(senderKey);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 10 * 60 * 1000) {
      this.pendingLinkCampaignPhotos.delete(senderKey);
      return null;
    }
    return entry;
  }

  private getFreshRecentLinkText(senderKey: string): { linkText: string; timestamp: number } | null {
    const entry = this.recentLinkCampaignTextPosts.get(senderKey);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 3 * 60 * 1000) {
      this.recentLinkCampaignTextPosts.delete(senderKey);
      return null;
    }
    return entry;
  }

  /**
   * Builds the `!info` report: live bot health + registered errors with their origin (file:line).
   * Subscriber tenants only see errors tagged with their own tenant id; the owner sees everything.
   */
  private buildInfoReport(sub: string, transport: IMessagingTransport): string {
    const scope = this.isOwnerTenant ? undefined : this.tenantId;
    const MAX = 3400;

    if (sub === 'clear' || sub === 'tirtir' || sub === 'reset') {
      const n = errorLogService.clear(scope);
      return `🧹 *[CARDOSO AI — INFO]*: Diiwaanka khaladaadka waa la nadiifiyay (${n} nooc oo la tirtiray). ✅`;
    }

    const all = errorLogService.getEntries({ scopeText: scope });
    const errors = all.filter((e) => e.level === 'error');
    const warns = all.filter((e) => e.level === 'warn');

    if (sub === 'errors' || sub === 'error' || sub === 'khalad' || sub === 'khaladaad' || sub === 'full') {
      const list = (errors.length > 0 ? errors : all).slice(0, 8);
      if (list.length === 0) {
        return `✅ *[CARDOSO AI — INFO]*: Wax khalad ah lama diiwaangelin. Bot-ku waa nadiif!`;
      }
      const lines = list.map((e, i) => {
        const frames = e.stack.length > 0 ? e.stack.slice(0, 3).join(' ← ') : e.origin;
        return (
          `*${i + 1}. ${e.level === 'error' ? '🔴' : '🟡'} [${e.source}]* ×${e.count}\n` +
          `   ❝${e.message.slice(0, 230)}❞\n` +
          `   📍 Halka uu ka yimid: \`${frames}\`\n` +
          (e.hint ? `   💡 ${e.hint}\n` : '') +
          `   🕒 Ugu horeysay ${formatClock(e.firstSeen)} • Ugu dambeysay ${formatClock(e.lastSeen)}`
        );
      });
      const out = `🔎 *[CARDOSO AI — INFO: KHALAADAADKA FAAHFAAHINTA]*\n\n${lines.join('\n\n')}\n\n_!info_ (guud) • _!info clear_ (nadiifi)`;
      return out.length > MAX ? out.slice(0, MAX) + '…' : out;
    }

    // ── Default: health snapshot + top errors summary ──
    const anyTransport: any = transport;
    const connected = Boolean(transport.isConnected);
    const botNumber = typeof anyTransport.getBotNumber === 'function' ? anyTransport.getBotNumber() : '';
    const cfg = this.statusReactor.getConfig();
    const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const stStats = typeof anyTransport.getStatusTelemetry === 'function' ? anyTransport.getStatusTelemetry() : null;
    const srStats = this.statusReactor.getStats();

    const privacyLine =
      stStats?.readReceiptsPrivacy === 'none'
        ? `\n• ⚠️ *Read Receipts Privacy (Taleefanka)*: OFF! Fur Settings > Privacy > Read Receipts oo shid si dadku u arkaan View-gaaga!`
        : stStats?.readReceiptsPrivacy === 'all'
          ? `\n• 🔒 Read Receipts Privacy: ✅ ON (all)`
          : '';

    const statusTelemetryLine = stStats
      ? `\n• 👁️ Status Engine: Helay ${stStats.received} • Seen ✅ ${stStats.viewed} • React 💚 ${srStats.reacted} • Reply 💬 ${srStats.commented}` +
      `${stStats.ciphertextRetries > 0 ? ` • Retry 🔄 ${stStats.ciphertextRetries}` : ''}` +
      `${stStats.viewFailed > 0 ? ` • Failed ❌ ${stStats.viewFailed}` : ''}`
      : '';

    const health =
      `⚙️ *XAALADDA BOT-KA*\n` +
      `• WhatsApp: ${connected ? '✅ Waa ku xidhan yahay' : '🛑 Ma xidhna'}${botNumber ? ` (+${botNumber})` : ''}\n` +
      `• Uptime: ${formatDuration(Date.now() - errorLogService.getStartedAt())} • RAM: ${memMb} MB\n` +
      `• AI Jawaab: ${this.whatsappManager.isAIEnabled() ? '✅ ON' : '🛑 OFF'}\n` +
      `• Auto-View (Seen): ${this.whatsappManager.isAutoViewStatusEnabled() ? '✅ ON' : '🛑 OFF'}\n` +
      `• Auto-React: ${cfg.autoReact ? '✅ ON' : '🛑 OFF'} • Auto-Comment: ${cfg.autoComment ? '✅ ON' : '🛑 OFF'} • Mode: ${cfg.mode.toUpperCase()}\n` +
      `• Link Campaign (!link on): ${this.whatsappManager.isLinkCampaignMode() ? '✅ ON' : '🛑 OFF'}` +
      statusTelemetryLine +
      privacyLine;

    let errBlock: string;
    if (all.length === 0) {
      errBlock = `✅ *KHALAADAAD:* Wax khalad ah lama diiwaangelin — bot-ku waa nadiif!`;
    } else {
      const top = (errors.length > 0 ? errors : warns).slice(0, 5).map((e, i) => {
        return (
          `${i + 1}. ${e.level === 'error' ? '🔴' : '🟡'} *[${e.source}]* ×${e.count} — ${formatClock(e.lastSeen)}\n` +
          `   ${e.message.slice(0, 110)}\n` +
          `   📍 \`${e.origin}\`` +
          (e.hint ? `\n   💡 ${e.hint.slice(0, 140)}` : '')
        );
      });
      errBlock =
        `🚨 *KHALAADAAD:* ${errors.length} error 🔴 • ${warns.length} digniin 🟡\n` + top.join('\n');
    }

    const out =
      `🩺 *[CARDOSO AI — INFO & BOT HEALTH]* 🩺\n\n${health}\n\n${errBlock}\n\n` +
      `_Amarrada:_ \`!info errors\` (faahfaahin + halka uu ka yimid) • \`!info clear\` (nadiifi)`;
    return out.length > MAX ? out.slice(0, MAX) + '…' : out;
  }

  public async handleIncomingMessage(
    message: IncomingMessage,
    transport: IMessagingTransport
  ): Promise<{ handled: boolean; reason?: string }> {
    const queueKey = message.chatId || message.senderId;
    const previousPromise = this.chatQueues.get(queueKey) || Promise.resolve();

    const task = previousPromise
      .catch(() => { })
      .then(() => this.processMessageInternal(message, transport))
      .catch((err) => {
        errorLogService.record(`MessageRouter${this.isOwnerTenant ? '' : ':' + this.tenantId}`, err, 'error');
        throw err;
      });

    this.chatQueues.set(queueKey, task);

    task.finally(() => {
      if (this.chatQueues.get(queueKey) === task) {
        this.chatQueues.delete(queueKey);
      }
    });

    return task;
  }

  private async processMessageInternal(
    message: IncomingMessage,
    transport: IMessagingTransport
  ): Promise<{ handled: boolean; reason?: string }> {
    // 1. Deduplication check: drop duplicate webhooks or reconnected messages
    if (this.deduplicator.isDuplicate(message.id)) {
      return { handled: false, reason: 'Duplicate message ID dropped' };
    }

    const text = message.content.trim();
    // Allow empty-text messages that carry a media attachment (e.g. a voice note reply in a group).
    // Only drop truly empty messages with NO media.
    if (!text && !(message as any).media) {
      return { handled: false, reason: 'Empty message' };
    }

    const lowerText = text.toLowerCase();

    // 1b. Echo & Bot Self-Message Guard: Drop bot signatures, rate limit notices, and system errors
    if (
      lowerText.includes('[cardoso ai]') ||
      lowerText.includes('[cardoso ai —') ||
      lowerText.includes('[cardoso ai contacts') ||
      lowerText.includes('[cardoso ai smart broadcast') ||
      lowerText.includes('[smart broadcast') ||
      lowerText.includes('[anti-ban emergency stop]') ||
      lowerText.includes('[cardoso ai cooldown]') ||
      lowerText.includes('xadkii daqiiqada') ||
      lowerText.includes('server-ku wuxuu gaadhay xadkii') ||
      lowerText.includes('gemini api request failed')
    ) {
      console.log(`⚠️ [Router Ignored] Bot-generated notice/echo detected ("${text.substring(0, 45)}..."). Discarding.`);
      return { handled: false, reason: 'Bot echo discarded' };
    }

    // 1b-sub. Tenant subscription status check (expired / suspended / pending)
    if (this.subscriptionCheck) {
      const sub = this.subscriptionCheck();
      if (!sub.active) {
        return { handled: false, reason: sub.reason || 'Subscription inactive or expired' };
      }
    }

    // 1c. Record contact for smart broadcasting (individual chats only, skip host's own fromMe messages)
    if (!message.isGroup && !message.isFromMe) {
      this.broadcast.recordContact(message.chatId, message.senderName, false, true);
    }

    // Host phone's own outgoing commands (isFromMe), whitelisted ADMIN_PHONE_NUMBERS, or tenant extraAdmins are Admin
    const isAdminUser = Boolean(message.isFromMe) || this.isAdmin(message.senderId, message.isGroup);

    // 1c.1. Autonomous Group Takeover & Anti-Link Protection (24/7 Auto-Guard)
    if (message.isGroup && this.whatsappManager.isAutoGroupManaged(message.chatId)) {
      const isSenderAdmin = isAdminUser || (await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId));
      if (!isSenderAdmin && this.whatsappManager.containsForbiddenLink(text)) {
        console.log(`🚨 [Auto-Group Anti-Link] Link laga dhex helay ${message.senderId} ee group-ka ${message.chatId}. Tirtirid + Kick bilowday...`);
        // 1. Delete message immediately
        if (message.id) {
          await this.whatsappManager.deleteMessage(message.chatId, {
            remoteJid: message.chatId,
            id: message.id,
            fromMe: false,
            participant: message.senderId,
          });
        }
        // 2. Kick member from group
        await this.whatsappManager.kickMember(message.chatId, message.senderId);
        // 3. Send warning alert in group
        const cleanNum = message.senderId.split('@')[0].split(':')[0];
        const alertMsg =
          `🚨 *[CARDOSO AI — ILAALADA TOOSKA AH EE KOOXDA (ANTI-LINK)]* 🚨\n\n` +
          `⚠️ Xubinta @${cleanNum} si toos ah ayaa looga saaray kooxda!\n` +
          `🚫 *Sababta:* Waxaa la mamnuucay soo dirista link-yada kooxaha kale ama xayaysiiska.\n\n` +
          `🤖 _Kooxdan waxaa si toos ah 24/7 u ilaaliya Cardoso AI Auto-Guard._`;
        await transport.sendMessage(message.chatId, alertMsg, {
          mentions: [message.senderId],
        });
        return { handled: true, reason: 'Anti-link executed and member kicked' };
      }

      // 2. Anti-Profanity & Toxicity Zero-Tolerance Check (3-Strike System)
      if (!isSenderAdmin) {
        const governor = this.whatsappManager.getGovernor();
        const violation = governor.detectProfanity(text);
        if (violation.isViolating) {
          console.log(`🚨 [Auto-Group Anti-Profanity] Ereyo xun laga helay ${message.senderId} ee group-ka ${message.chatId}. Word: ${violation.word}`);
          // 1. Delete message immediately
          if (message.id) {
            await this.whatsappManager.deleteMessage(message.chatId, {
              remoteJid: message.chatId,
              id: message.id,
              fromMe: false,
              participant: message.senderId,
            });
          }
          // 2. Apply strike
          const strikeRes = governor.addStrike(
            message.chatId,
            message.senderId,
            violation.reason || 'Hadallo anshax-xumo ah',
            violation.word
          );
          const cleanNum = message.senderId.split('@')[0].split(':')[0];

          if (strikeRes.action === 'warn_1') {
            const warnMsg =
              `⚠️ *[CARDOSO AI — DIGNIIN ANSHAX (1/3)]* ⚠️\n\n` +
              `Xubinta @${cleanNum}, fariintaadii waa la tirtiray sababtoo ah waxay jabisay xeerka anshaxa kooxda (Ereyo xun/Aflagaado).\n\n` +
              `💡 *Xusuusin:* Waxaad haysataa 2 digniinood oo kale. Haddii aad gaarto 3, toos ayaa kooxda lagaaga saarayaa! 🤝`;
            await transport.sendMessage(message.chatId, warnMsg, { mentions: [message.senderId] });
          } else if (strikeRes.action === 'warn_2') {
            const warnMsg =
              `🚨 *[CARDOSO AI — DIGNIIN KALE OO ADAG (2/3)]* 🚨\n\n` +
              `Xubinta @${cleanNum}, fariintaadii mar labaad ayaa la tirtiray! Tani waa digniintii kuugu dambaysay.\n\n` +
              `⛔ *Digniin:* Haddii aad mar saddexaad eray xun ama aflagaado soo qorto, kooxda *toos ayaa lagaaga saari doonaa* (Permanent Kick)!`;
            await transport.sendMessage(message.chatId, warnMsg, { mentions: [message.senderId] });
          } else {
            // Action === 'kick' (3 Strikes reached)
            await this.whatsappManager.kickMember(message.chatId, message.senderId);
            const kickMsg =
              `🚨 *[CARDOSO AI — CIQAABTA KOOXDA (KA-SAARIS)]* 🚨\n\n` +
              `Xubinta @${cleanNum} si toos ah ayaa looga saaray kooxda sababtoo ah waxay gaartay 3 digniinood oo ku saabsan cay, aflagaado, iyo jabinta xeerarka kooxda!\n\n` +
              `🤖 _Kooxdan waxaa si adag u ilaaliya Cardoso AI Autonomous Governor._`;
            await transport.sendMessage(message.chatId, kickMsg, { mentions: [message.senderId] });
          }

          return { handled: true, reason: 'Profanity strike executed' };
        }
      }

      // 3. Anti-Flood & Anti-Spam Check
      if (!isSenderAdmin) {
        const floodCheck = this.whatsappManager.getGovernor().checkFlood(message.chatId, message.senderId);
        if (floodCheck.isFlooding) {
          console.log(`🌊 [Auto-Group Anti-Flood] Flood spam laga helay ${message.senderId} ee group-ka ${message.chatId}. Tirtirid...`);
          if (message.id) {
            await this.whatsappManager.deleteMessage(message.chatId, {
              remoteJid: message.chatId,
              id: message.id,
              fromMe: false,
              participant: message.senderId,
            });
          }
          const cleanNum = message.senderId.split('@')[0].split(':')[0];
          const floodAlert =
            `🛑 *[CARDOSO AI — ILAALADA ANTI-FLOOD]* 🌊\n\n` +
            `Xubinta @${cleanNum}, fariimaha badan ee is-daba-jooga ah (spam flood) waa mamnuuc kooxdan. Fadlan xawaaraha daji si looga fogaado ciqaab!`;
          await transport.sendMessage(message.chatId, floodAlert, { mentions: [message.senderId] });
          return { handled: true, reason: 'Anti-flood executed and message deleted' };
        }
      }

      // Record active participation timestamp for ghost/inactive member tracking
      this.whatsappManager.getGovernor().recordMemberActivity(message.chatId, message.senderId);

      // 4. Autonomous Vision NSFW & Inappropriate Media Shield (Zero manual commands needed)
      if (!isSenderAdmin && message.media?.type === 'image' && message.media?.dataBase64) {
        const mediaSafety = await this.whatsappManager.getGovernor().screenMediaSafety(
          { mimeType: message.media.mimeType, dataBase64: message.media.dataBase64 },
          this.engine?.getAIOrchestrator?.()
        );
        if (mediaSafety.isViolating) {
          console.log(`🚨 [Auto-Group Media Shield] Violating image from ${message.senderId} in ${message.chatId}. Reason: ${mediaSafety.reason}`);
          if (message.id) {
            await this.whatsappManager.deleteMessage(message.chatId, {
              remoteJid: message.chatId,
              id: message.id,
              fromMe: false,
              participant: message.senderId,
            });
          }
          await this.whatsappManager.kickMember(message.chatId, message.senderId);
          const cleanNum = message.senderId.split('@')[0].split(':')[0];
          const alertMsg =
            `🚨 *[CARDOSO AI — ILAALADA SAWIRRADA EE KOOXDA (MEDIA SHIELD)]* 🚨\n\n` +
            `⚠️ Xubinta @${cleanNum} si toos ah ayaa looga saaray kooxda!\n` +
            `🚫 *Sababta:* Waxaa la soo diray sawir anshax-xumo ah ama mamnuuc ah (${mediaSafety.reason}).\n\n` +
            `🤖 _Kooxdan waxaa si toos ah 24/7 u ilaaliya Cardoso AI Vision Shield._`;
          await transport.sendMessage(message.chatId, alertMsg, { mentions: [message.senderId] });
          return { handled: true, reason: 'NSFW image violation: deleted and member kicked' };
        }
      }

      // 5. Autonomous Polyglot Code Review & Debugging (Zero manual commands needed)
      if (text.length > 25 && !text.startsWith('!')) {
        const codeDetect = this.whatsappManager.getGovernor().detectCodeSnippet(text);
        if (codeDetect.isCode && codeDetect.snippet.length >= 30) {
          console.log(`👨‍💻 [Auto-Group Polyglot Code] Code snippet (${codeDetect.language}) detected from ${message.senderId}. Generating autonomous review...`);
          const review = await this.whatsappManager.getGovernor().reviewCodeSnippet(
            codeDetect.snippet,
            codeDetect.language,
            this.engine?.getAIOrchestrator?.()
          );
          await transport.sendMessage(message.chatId, review, {
            replyToMessageId: message.id,
          });
          return { handled: true, reason: 'Autonomous code review provided' };
        }
      }

      // 6. Autonomous Natural Language Assistance (Zero commands or prefixes needed)
      if (/(?:xeerarka|rules|xeer)\s*(?:group|koox)/i.test(lowerText) || /(?:maxaa|waxa)\s*mamnuuc\s*ah/i.test(lowerText)) {
        const rulesText = await this.whatsappManager.getGroupRules(message.chatId);
        await transport.sendMessage(message.chatId, rulesText, { replyToMessageId: message.id });
        return { handled: true, reason: 'Autonomous natural rules explanation' };
      }

      if (/(?:maxaa\s*(?:maanta\s*)?dhacay|doodd?(?:a|ii)?\s*maanta\s*(?:ii\s*)?soo\s*koob|summary\s*(?:ah)?\s*maanta)/i.test(lowerText)) {
        const recentMsgs = this.whatsappManager.getRecentGroupMessages(message.chatId);
        const summaryText = await this.whatsappManager.getGovernor().generateEveningSummary(
          'Kooxda',
          recentMsgs,
          this.engine?.getAIOrchestrator?.()
        );
        await transport.sendMessage(message.chatId, summaryText, { replyToMessageId: message.id });
        return { handled: true, reason: 'Autonomous natural discussion summary' };
      }
    }

    // 1c.0. Zero-Ban WhatsApp Views & .vcf Commands:
    // - `!views-group on / drop / off / status` (Admin only in Groups: auto-capture existing + new joiners & auto-drop .vcf on batch full!)
    // - `!views` / `!vcf` in Groups; `views` / `!views` / `vcf` in Private Chat (100% Inbound, 0 Cold DMs!)
    const isViewsGroupAdminCmd = message.isGroup && /^[!./#]views-group(?:\s+(.*))?$/i.test(text);
    if (this.viewsHub && isViewsGroupAdminCmd) {
      const vgRes = await this.handleViewsGroupCommand(message, transport, isAdminUser);
      if (vgRes.handled) return vgRes;
    }

    // `!podcast` — World-Class Safa & Mohamed Somali Podcast Studio!
    // Supports:
    // - `!podcast` -> Official CARDOSO AI Safa & Mohamed Promo Voice Note
    // - `!podcast <Mawduuc> [minutes]` -> Live debate/conversation scaled to exact minutes (1-5m)
    // - `!podcast debate|study|story|ad|diini <Mawduuc> [minutes]`
    // - `!podcast video <Mawduuc> [minutes]` -> 9:16 WhatsApp Status / TikTok Video Audiogram (MP4)
    // - `!podcast <https://...>` -> Article-to-Podcast
    // - Reply to PDF/Image/Long text with `!podcast [minutes]` -> NotebookLM-style Somali Podcast!
    const isPodcastCmd = /^[!./#]podcast(?:\s+([\s\S]+))?$/i.test(text);
    if (isPodcastCmd && (isAdminUser || !message.isGroup)) {
      const podMatch = text.match(/^[!./#]podcast(?:\s+([\s\S]+))?$/i);
      const rawArg = (podMatch?.[1] || '').trim();
      const isBroadcastList = this.whatsappManager.isBroadcastListJid(message.chatId);
      const feedbackChatId = this.resolveOwnerFeedbackChatId(message, transport);
      const feedbackOpts = isBroadcastList ? undefined : { replyToMessageId: message.id };

      try {
        const parsedCmd = VoiceReplyService.parsePodcastCommandArgs(rawArg);

        if (parsedCmd.isHelp) {
          await transport.sendMessage(
            feedbackChatId,
            `🎙️ *CARDOSO AI — SAFA & MOHAMED PODCAST STUDIO* ✨\n\n` +
              `• \`!podcast\` — Warbixinta CARDOSO AI (Safa & Mohamed)\n` +
              `• \`!podcast <Mawduuc> 3min\` — Dood kulul oo 3 daqiiqo ah (1 ilaa 5 daqiiqo)\n` +
              `• \`!podcast debate <Mawduuc> 2m\` — Dood & kala aragti duwanaan\n` +
              `• \`!podcast study <Cashar> 3m\` — Cashar & Su'aal-Jawaab\n` +
              `• \`!podcast story <Mawduuc> 2m\` — Sheeko macaan\n` +
              `• \`!podcast ad <Ganacsigaaga> 1m\` — Xayeysiis Radio Commercial\n` +
              `• \`!podcast diini <Mawduuc> 2m\` — Wacdi & Aqoon Diini ah (Cod Saafi ah)\n` +
              `• \`!podcast video <Mawduuc> 1m\` — Muuqaal Status/TikTok (MP4 + Mowjad)\n` +
              `• \`!podcast status\` — Codka CARDOSO AI toos u dhig WhatsApp Status! 🎙️\n` +
              `• \`!podcast status <Mawduuc> 1m\` — Podcast cusub oo toos Voice Status u noqda!\n` +
              `• \`!podcast status video <Mawduuc> 1m\` — Video Audiogram toos Status u noqda!\n` +
              `• Gudaha *Broadcast List* ku qor \`!podcast ...\` ama \`!cod <qoraalkaaga>\` si dadka liiska loogu wada diro!\n` +
              `• Reply ku samee *Voice Note / Podcast* adigoo qoraya \`!status\` si aad Status ugu dhigto!\n` +
              `• Reply ku samee *PDF / Sawir / Qoraal dheer* adigoo qoraya \`!podcast 2m\`!\n` +
              `• Ama soo dir link maqaal: \`!podcast https://... 2m\``,
            feedbackOpts
          );
          return { handled: true, reason: 'Podcast help sent' };
        }

        const hasAttachedOrQuotedSource = Boolean(
          (message.media && (message.media.type === 'document' || message.media.type === 'image')) ||
          (message.quotedText && message.quotedText.trim().length >= 25)
        );

        let audioResult = null;
        let effectiveTitle = parsedCmd.topic;

        const isPromoOnly =
          (!rawArg && !hasAttachedOrQuotedSource) ||
          (parsedCmd.postToStatus && !effectiveTitle && !parsedCmd.sourceUrl && !hasAttachedOrQuotedSource);

        if (isPromoOnly) {
          // `!podcast` or `!podcast status` alone -> Official CARDOSO AI Safa & Mohamed Promo Voice Note!
          await transport.sendMessage(
            feedbackChatId,
            VoiceReplyService.buildPodcastTeaserMessage({
              isPromo: true,
              outputKind: parsedCmd.outputKind,
            }) + (isBroadcastList ? `\n📢 _Waxaa toos loogu diri doonaa Broadcast List-kaaga._` : ''),
            feedbackOpts
          );
          audioResult = await VoiceReplyService.getCardosoPromoVoiceNote();
        } else if (VoiceReplyService.isExplicitDialogueScript(rawArg)) {
          // Explicit multi-line `Safa: ... \n Mohamed: ...` script
          const turns = VoiceReplyService.parseDialogueScript(rawArg);
          await transport.sendMessage(
            feedbackChatId,
            VoiceReplyService.buildPodcastTeaserMessage({
              topic: 'Wada-Sheekeysi Gaar ah',
              style: parsedCmd.style,
              durationMinutes: Math.max(0.5, Number((turns.length / 7).toFixed(1))),
              outputKind: parsedCmd.outputKind,
            }) + (isBroadcastList ? `\n📢 _Waxaa toos loogu diri doonaa Broadcast List-kaaga._` : ''),
            feedbackOpts
          );
          audioResult = await VoiceReplyService.synthesizeSomaliDialogue(turns, {
            outputFormat: parsedCmd.outputKind === 'video' ? 'mp3' : 'ogg',
            soundMode: parsedCmd.soundMode,
          });
        } else {
          // Dynamic Topic / Debate / URL / PDF / Quoted Text Podcast!
          let sourceText = message.quotedText ? message.quotedText.trim() : undefined;
          let sourceMedia =
            message.media && (message.media.type === 'document' || message.media.type === 'image')
              ? {
                  type: message.media.type,
                  mimeType: message.media.mimeType,
                  dataBase64: message.media.dataBase64,
                }
              : undefined;

          if (parsedCmd.sourceUrl) {
            const article = await VoiceReplyService.fetchArticleExcerptForPodcast(parsedCmd.sourceUrl);
            if (article) {
              sourceText = [sourceText, article.excerpt].filter(Boolean).join('\n\n');
              if (!effectiveTitle && article.title) effectiveTitle = article.title;
            }
          }
          if (!effectiveTitle) {
            effectiveTitle = sourceMedia
              ? (message.media?.fileName || 'Falanqaynta Dukumentiga / Sawirka')
              : 'Falanqaynta Qoraalka';
          }

          await transport.sendMessage(
            feedbackChatId,
            VoiceReplyService.buildPodcastTeaserMessage({
              topic: effectiveTitle,
              style: parsedCmd.style,
              durationMinutes: parsedCmd.durationMinutes,
              outputKind: parsedCmd.outputKind,
            }) + (isBroadcastList ? `\n📢 _Waxaa toos loogu diri doonaa Broadcast List-kaaga._` : ''),
            feedbackOpts
          );

          const aiTurns = await VoiceReplyService.generateTopicDialogueTurns(
            effectiveTitle,
            this.engine?.getAIOrchestrator?.(),
            {
              style: parsedCmd.style,
              durationMinutes: parsedCmd.durationMinutes,
              sourceText,
              sourceMedia,
            }
          );

          audioResult = await VoiceReplyService.synthesizeSomaliDialogue(aiTurns, {
            outputFormat: parsedCmd.outputKind === 'video' ? 'mp3' : 'ogg',
            soundMode: parsedCmd.soundMode,
          });
        }

        if (audioResult && typeof transport.sendMedia === 'function') {
          if (parsedCmd.outputKind === 'video') {
            const mp4Buf = await VoiceReplyService.renderPodcastVideoAudiogram(audioResult.buffer, {
              title: effectiveTitle || 'CARDOSO AI PODCAST',
              styleLabel: 'SAFA & MOHAMED · CARDOSO AI',
            });
            const vidCaption = `🎬 *CARDOSO AI PODCAST — Safa & Mohamed*\n📌 ${effectiveTitle || 'CARDOSO AI'}\n🎧 _Waxaa loo diyaariyay WhatsApp Status & TikTok!_`;

            if (parsedCmd.postToStatus && isAdminUser) {
              const statusRes = await this.whatsappManager.postMediaStatus({
                buffer: mp4Buf,
                mimeType: 'video/mp4',
                type: 'video',
                caption: vidCaption,
              });
              await transport.sendMessage(feedbackChatId, statusRes.message, feedbackOpts);
            }

            const videoMedia: OutgoingMedia = {
              type: 'video',
              dataBuffer: mp4Buf,
              mimeType: 'video/mp4',
              caption: vidCaption,
            };

            if (isBroadcastList) {
              const dispatch = await this.dispatchMediaToBroadcastList(message.chatId, videoMedia, transport);
              if (dispatch.total === 0) {
                if (feedbackChatId !== message.chatId) {
                  await transport.sendMedia(feedbackChatId, videoMedia);
                }
                await transport.sendMessage(
                  feedbackChatId,
                  this.buildEmptyBroadcastListNotice(message.chatId, 'Muuqaalka Podcast-ka')
                );
              } else {
                await transport.sendMessage(
                  feedbackChatId,
                  `📢 *CARDOSO AI — PODCAST VIDEO BROADCAST* ✅\n` +
                    `📋 *Liiska:* ${dispatch.listName}\n` +
                    `🎬 *Mawduuca:* ${effectiveTitle || 'CARDOSO AI'}\n` +
                    `📨 *Loo diray:* ${dispatch.delivered}/${dispatch.total} qof${dispatch.failed > 0 ? ` (${dispatch.failed} fashilmay)` : ''}`
                );
              }
              return {
                handled: true,
                reason: `Podcast Video Audiogram MP4 broadcast to ${dispatch.delivered}/${dispatch.total} recipients`,
              };
            }

            await transport.sendMedia(message.chatId, videoMedia, { replyToMessageId: message.id });
            return {
              handled: true,
              reason: `Podcast Video Audiogram MP4 sent (${audioResult.turnCount} turns, ${audioResult.seconds}s${parsedCmd.postToStatus ? ', posted to Status' : ''})`,
            };
          }

          if (parsedCmd.postToStatus && isAdminUser) {
            const statusRes = await this.whatsappManager.postVoiceStatusSeries(audioResult.buffer, {
              caption: effectiveTitle || 'CARDOSO AI — Safa & Mohamed Podcast',
            });
            await transport.sendMessage(feedbackChatId, statusRes.message, feedbackOpts);
          }

          const podcastAudioMedia: OutgoingMedia = {
            type: 'audio',
            dataBuffer: audioResult.buffer,
            mimeType: 'audio/ogg; codecs=opus',
            ptt: true,
            seconds: audioResult.seconds,
            waveform: audioResult.waveform,
          };

          if (isBroadcastList) {
            const dispatch = await this.dispatchMediaToBroadcastList(message.chatId, podcastAudioMedia, transport);
            if (dispatch.total === 0) {
              if (feedbackChatId !== message.chatId) {
                await transport.sendMedia(feedbackChatId, podcastAudioMedia);
              }
              await transport.sendMessage(
                feedbackChatId,
                this.buildEmptyBroadcastListNotice(message.chatId, 'Codka Podcast-ka')
              );
            } else {
              await transport.sendMessage(
                feedbackChatId,
                `📢 *CARDOSO AI — PODCAST BROADCAST LIST* ✅\n` +
                  `📋 *Liiska:* ${dispatch.listName}\n` +
                  `🎙️ *Mawduuca:* ${effectiveTitle || 'CARDOSO AI — Safa & Mohamed'}\n` +
                  `📨 *Loo diray:* ${dispatch.delivered}/${dispatch.total} qof${dispatch.failed > 0 ? ` (${dispatch.failed} fashilmay)` : ''}\n` +
                  `⏱️ *Dhererka:* ${audioResult.seconds}s`
              );
            }
            return {
              handled: true,
              reason: `Podcast Voice Note PTT broadcast to ${dispatch.delivered}/${dispatch.total} recipients (${audioResult.turnCount} turns, ${audioResult.seconds}s)`,
            };
          }

          await transport.sendMedia(message.chatId, podcastAudioMedia, { replyToMessageId: message.id });
          return {
            handled: true,
            reason: `Podcast Voice Note PTT sent (${audioResult.turnCount} turns, ${audioResult.seconds}s${parsedCmd.postToStatus ? ', posted to Status' : ''})`,
          };
        }

        await transport.sendMessage(
          feedbackChatId,
          '⚠️ Podcast-ka hadda lama samayn karin — mar kale isku day.',
          feedbackOpts
        );
      } catch (podErr: any) {
        await transport.sendMessage(
          feedbackChatId,
          `⚠️ Cilad Podcast Studio: ${podErr?.message || podErr}`,
          feedbackOpts
        );
      }
      return { handled: true, reason: 'Podcast command finished' };
    }

    const isViewsGroupCmd = message.isGroup && /^[!./#](?:views|vcf)(?:\s+(.*))?$/i.test(text);
    const isViewsPrivateCmd =
      !message.isGroup &&
      (message.isFromMe
        ? /^[!./#](?:views|vcf)(?:\s+(.*))?$/i.test(text)
        : /^[!./#]?(?:views|vcf)(?:\s+(.*))?$/i.test(text));

    if (this.viewsHub && (isViewsGroupCmd || isViewsPrivateCmd)) {
      const viewsRes = await this.handleViewsCommand(message, transport, isAdminUser);
      if (viewsRes.handled) return viewsRes;
    }

    // If AI is specifically disabled for this sender (!off <number>), do not respond at all
    if (!message.isGroup && !isAdminUser && this.whatsappManager.isAIDisabledForNumber(message.senderPhone || message.chatId)) {
      console.log(`ℹ️ [Router] Message from ${message.senderId} ignored (AI disabled for this number via !off).`);
      return { handled: true, reason: 'AI disabled specifically for this sender' };
    }

    // Owner Promo Flyer & Link Setup for Status Link Exchange Mode
    if (isAdminUser && !message.isGroup && this.whatsappManager.isAwaitingOwnerPromoSetup()) {
      if (/^[!./#]?(?:cancel|jooji|haka\s*qaadin)$/i.test(lowerText.trim())) {
        this.whatsappManager.setAwaitingOwnerPromoSetup(false);
        await transport.sendMessage(message.chatId, 'Setup-kii sawirka iyo link-ga xayeysiinta waa la joojiyay.');
        return { handled: true, reason: 'Cancelled owner promo setup' };
      }

      const isMediaAttached = Boolean(
        (message.media?.type === 'image' || (message as any).media?.type === 'document') &&
        (message.media?.dataBase64 || (message.media as any)?.dataBuffer)
      );

      const linkMatch = text.match(/(?:https?:\/\/)?(?:wa\.me\/\S+|api\.whatsapp\.com\/\S+|chat\.whatsapp\.com\/\S+|https?:\/\/\S+)/i);
      let detectedLink = linkMatch ? linkMatch[0] : '';
      if (!detectedLink) {
        const rawNumberMatch = text.match(/\b(?:25\d{7,12}|06\d{7,8})\b/);
        if (rawNumberMatch) {
          const cleanNum = rawNumberMatch[0].startsWith('0') ? '252' + rawNumberMatch[0].substring(1) : rawNumberMatch[0];
          detectedLink = `https://wa.me/${cleanNum}`;
        }
      }

      let imageBuffer: Buffer | undefined;
      let mimeType: string | undefined;
      if (message.media?.dataBase64) {
        imageBuffer = Buffer.from(message.media.dataBase64, 'base64');
        mimeType = message.media.mimeType;
      } else if ((message.media as any)?.dataBuffer) {
        imageBuffer = (message.media as any).dataBuffer;
        mimeType = message.media?.mimeType;
      }

      if (isMediaAttached || detectedLink) {
        const botPhone = (this.whatsappManager.getBotNumber() || message.chatId).replace(/\D/g, '');
        const finalLink = detectedLink || (botPhone ? `https://wa.me/${botPhone}` : '');

        const res = this.whatsappManager.setOwnerPromo({
          link: finalLink,
          imageBuffer,
          mimeType,
        });
        await transport.sendMessage(message.chatId, res.message);
        return { handled: true, reason: 'Owner promo flyer and link saved from prompt' };
      }
    }

    // 1c-optout. Recipient opt-out guard (stops annoyed users from tapping WhatsApp "Report Spam")
    if (
      !message.isGroup &&
      !isAdminUser &&
      /^(?:jooji|stop|unsubscribe|ha\s+ii\s+soo\s+dirin|ha\s+i\s+soo\s+dirin|fariimaha\s+jooji|iska\s+daa\s+fariimaha)[.!،\s]*$/i.test(lowerText)
    ) {
      this.broadcast.optOut(message.chatId, text);
      await transport.sendMessage(
        message.chatId,
        'Waa hagaag walaal, fariimaha dambe laguu soo diri maayo. Raalli ahow haddii ay ku dhibtay. Nabadgelyo. 🙏'
      );
      return { handled: true, reason: 'Recipient opted out of broadcasts' };
    }

    // 1c-saveme. Auto-save contact on "save me" DM response and Link Campaign Mode handling
    if (!message.isGroup && !message.isFromMe) {
      // 1c.1. Link Campaign Mode (!link on ONLY):
      // Anyone who sends Link + Photo (together in one message OR in consecutive messages) in private chat:
      // 1. Automatically posts their Photo + Link directly to WhatsApp Status.
      // 2. Automatically sends the owner's saved Promo Photo + Promo Link (!link set) back to them.
      const mediaMime = message.media?.mimeType || '';
      const isMediaAttached = Boolean(
        (
          message.media?.type === 'image' ||
          message.media?.type === 'video' ||
          (message.media?.type === 'document' && /^image\//i.test(mediaMime))
        ) &&
        (message.media?.dataBase64 || (message.media as any)?.dataBuffer)
      );

      const isTransportPlaceholder =
        /^🖼️\s*\[Sawir\b/i.test(text) ||
        /^🎬\s*\[Muuqaal\b/i.test(text) ||
        /^📄\s*\[Dukumenti\b/i.test(text) ||
        /^🎙️\s*\[Voice Note\b/i.test(text);
      const effectiveText = isTransportPlaceholder ? '' : text;

      const isWaLink =
        Boolean(effectiveText) &&
        (
          /(?:https?:\/\/)?(?:wa\.me\/\S+|api\.whatsapp\.com\/\S+|chat\.whatsapp\.com\/\S+)/i.test(effectiveText) ||
          /https?:\/\/\S+/i.test(effectiveText) ||
          /(?:\+?252[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|\b0(?:6[1-9]|77|90)[\s.-]?\d{3}[\s.-]?\d{4}\b|\b25\d{7,12}\b)/.test(effectiveText)
        );

      const isLinkExchangeAsk =
        Boolean(effectiveText) &&
        /(?:link|status|istatus|istatuska)?\s*(?:isoo\s*dhig|iigu\s*dhig|ii\s*dhig|dhig\s*status|dhig\s*link)/i.test(lowerText);

      if (this.whatsappManager.isLinkCampaignMode() && !isAdminUser) {
        const senderPhone = message.senderPhone || message.chatId.replace(/\D/g, '');
        const senderKey = senderPhone || message.chatId;
        const promo = this.whatsappManager.getOwnerPromo();
        const ownerFallbackJid =
          this.whatsappManager.getBotNumber() ||
          this.whatsappManager.getOwnerOnlyRecipients()[0] ||
          this.config.security.adminPhoneNumbers[0] ||
          '';
        const botPhone = ownerFallbackJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const effectiveOwnerLink = (promo.link || '').trim() || (botPhone ? `https://wa.me/${botPhone}` : '');

        const extractIncomingMediaBuffer = (): Buffer => {
          if (message.media?.dataBase64) {
            return Buffer.from(message.media.dataBase64, 'base64');
          }
          const rawBuf = (message.media as any)?.dataBuffer;
          return Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.alloc(0);
        };

        const sendOwnerPromoReply = async (introStatusMsg: string) => {
          const hasPromoImg = Boolean(promo.imageBuffer && promo.imageBuffer.length > 0);
          const promoCaption = effectiveOwnerLink
            ? `${introStatusMsg}\n\n` +
              `Waa kan anigana ${hasPromoImg ? 'sawirkayga iyo link-gayga' : 'link-gayga'} WhatsApp, fadlan adiguna status-kaaga iigu dhig! 📲✨\n` +
              `🔗 ${effectiveOwnerLink}`
            : introStatusMsg;

          if (hasPromoImg && promo.imageBuffer && typeof transport.sendMedia === 'function') {
            let mediaSent = false;
            try {
              const res = await transport.sendMedia(message.chatId, {
                type: 'image',
                dataBuffer: promo.imageBuffer,
                mimeType: promo.mimeType || 'image/jpeg',
                caption: promoCaption,
              });
              mediaSent = res !== false;
            } catch (sendMediaErr: any) {
              console.warn(`[LinkCampaign] Failed sending owner promo photo to ${message.chatId}: ${sendMediaErr?.message}`);
            }
            if (!mediaSent) {
              await transport.sendMessage(message.chatId, promoCaption);
            }
          } else {
            await transport.sendMessage(message.chatId, promoCaption);
          }
        };

        if (isWaLink) {
          if (this.whatsappManager.hasPostedLinkForSender(senderPhone)) {
            this.pendingLinkCampaignPhotos.delete(senderKey);
            await transport.sendMessage(
              message.chatId,
              'Walaal horay ayaa status link laguugu dhigay, qof kale link-giisa ama mar labaad status lama dhigi karo. Mahadsanid! 🙏'
            );
            return { handled: true, reason: 'Link campaign: link already posted previously' };
          }

          const pendingPhoto = !isMediaAttached ? this.getFreshPendingLinkPhoto(senderKey) : null;

          if (isMediaAttached || pendingPhoto) {
            // Post BOTH photo and link directly to WhatsApp Status together!
            const buffer = isMediaAttached ? extractIncomingMediaBuffer() : pendingPhoto!.buffer;
            const postMime = isMediaAttached
              ? (message.media!.mimeType || 'image/jpeg')
              : pendingPhoto!.mimeType;
            const postType: 'image' | 'video' = isMediaAttached
              ? (message.media!.type === 'video' ? 'video' : 'image')
              : pendingPhoto!.type;

            this.pendingLinkCampaignPhotos.delete(senderKey);

            if (buffer.length > 0) {
              const postRes = await this.whatsappManager.postMediaStatus({
                buffer,
                mimeType: postMime,
                caption: effectiveText.trim(),
                type: postType,
              });
              if (postRes.success) {
                this.whatsappManager.recordLinkCampaignPoster(senderPhone);
                await sendOwnerPromoReply('✅ *Sawirkaaga iyo Link-gaaga si toos ah ayaan status-ka kuugu dhigay walaal!* 📲✨');
              } else {
                console.warn(`⚠️ [LinkCampaign] postMediaStatus failed for ${senderPhone}: ${postRes.message}`);
                await sendOwnerPromoReply('⚠️ *Cilad yar ayaa ka dhacday daabacaadda status-ka hadda, fadlan mar kale dib u soo dir.*');
              }
              return { handled: true, reason: 'Link campaign: image and link posted together to status' };
            }
          }

          // Text link only (no attached or pending photo)
          const linkMatch = effectiveText.match(/(?:https?:\/\/)?(?:wa\.me\/\S+|api\.whatsapp\.com\/\S+|chat\.whatsapp\.com\/\S+|https?:\/\/\S+)/i);
          const linkToPost = linkMatch ? linkMatch[0] : effectiveText.trim();

          const postRes = await this.whatsappManager.postTextStatus(linkToPost);
          if (postRes.success) {
            this.whatsappManager.recordLinkCampaignPoster(senderPhone);
            this.recentLinkCampaignTextPosts.set(senderKey, {
              linkText: effectiveText.trim(),
              timestamp: Date.now(),
            });
            await sendOwnerPromoReply('✅ *Status-ka waan kuugu dhigay walaal!* 📲✨');
          } else {
            console.warn(`⚠️ [LinkCampaign] postTextStatus failed for ${senderPhone}: ${postRes.message}`);
            await sendOwnerPromoReply('⚠️ *Cilad yar ayaa ka dhacday daabacaadda status-ka hadda, fadlan mar kale dib u soo dir.*');
          }
          return { handled: true, reason: 'Link campaign: posted status and exchanged owner promo flyer' };
        }

        if (isMediaAttached && !isWaLink) {
          const buffer = extractIncomingMediaBuffer();
          const postMime = message.media!.mimeType || 'image/jpeg';
          const postType: 'image' | 'video' = message.media!.type === 'video' ? 'video' : 'image';

          // Case: User sent their text link first and followed up with their photo within 3 minutes -> pair & post BOTH!
          const recentLink = this.getFreshRecentLinkText(senderKey);
          if (recentLink && buffer.length > 0) {
            this.recentLinkCampaignTextPosts.delete(senderKey);
            const postRes = await this.whatsappManager.postMediaStatus({
              buffer,
              mimeType: postMime,
              caption: recentLink.linkText,
              type: postType,
            });
            if (postRes.success) {
              await transport.sendMessage(
                message.chatId,
                '✅ *Sawirkaaga iyo Link-gaaga labadaba si toos ah ayaan status-ka kuugu wada dhigay walaal!* 📲✨'
              );
            } else {
              console.warn(`⚠️ [LinkCampaign] Follow-up postMediaStatus failed for ${senderPhone}: ${postRes.message}`);
              await transport.sendMessage(
                message.chatId,
                '⚠️ Cilad yar ayaa ka dhacday daabacaadda sawirka status-ka, fadlan mar kale isku day walaal.'
              );
            }
            return { handled: true, reason: 'Link campaign: image and link posted together to status' };
          }

          if (this.whatsappManager.hasPostedLinkForSender(senderPhone)) {
            await transport.sendMessage(
              message.chatId,
              'Walaal horay ayaa status link laguugu dhigay, qof kale link-giisa ama mar labaad status lama dhigi karo. Mahadsanid! 🙏'
            );
            return { handled: true, reason: 'Link campaign: link already posted previously' };
          }

          // Cache the photo for up to 10 minutes so when their link arrives next, BOTH post together!
          if (buffer.length > 0) {
            this.pendingLinkCampaignPhotos.set(senderKey, {
              buffer,
              mimeType: postMime,
              type: postType,
              timestamp: Date.now(),
            });
          }

          await transport.sendMessage(
            message.chatId,
            'Walaal sawirkaaga waan helay! 📸 Fadlan hadda soo dir *Link-gaaga WhatsApp (wa.me)* si aan labadaba status-ka kuugu wada dhigo! 📲✨'
          );
          return { handled: true, reason: 'Link campaign: photo sent without link' };
        }

        if (isLinkExchangeAsk) {
          if (this.whatsappManager.hasPostedLinkForSender(senderPhone)) {
            await transport.sendMessage(
              message.chatId,
              'Walaal horay ayaa status link laguugu dhigay, qof kale link-giisa ama mar labaad status lama dhigi karo. Mahadsanid! 🙏'
            );
            return { handled: true, reason: 'Link campaign: link already posted previously' };
          }

          await sendOwnerPromoReply('Walaal iigu soo dir *Link-gaaga* (ama *Sawirkaaga iyo Link-gaaga* wada socda) si aan toos status-ka kuugu dhigo! 📲✨');
          return { handled: true, reason: 'Link campaign: prompted with owner promo' };
        }
      }

      // 1c.3. Save-Me Keywords & Contact Saving
      const isPendingSaveMe = this.statusReactor?.isPendingSaveMe(message.chatId);
      const isAffirmative = /^(?:haye|ok|haa|ha|waa\s*yahay|waayahay|done|saved?|save|save\s*me|save\s*ma\s*i\s*tidhi|save\s*ma\s*tidhi|ma\s*i\s*save\s*gareysay|i\s*save\s*garee|i\s*kaydi|kaydi|waan\s*ku\s*save\s*gareeyay|waanku\s*save\s*gareeyay|waan\s*ku\s*kaydiyay)(?:\s+(?:sxb|wll|walaal|walaalo|bro))?[.!👍📲✅\s]*$/i.test(lowerText);
      const isExplicitSavePhrase = /^(?:save|save\s*me|save\s*ma\s*i\s*tidhi|save\s*ma\s*tidhi|ma\s*i\s*save\s*gareysay|i\s*save\s*garee|i\s*kaydi|kaydi|waan\s*ku\s*save\s*gareeyay|waanku\s*save\s*gareeyay|waan\s*ku\s*kaydiyay)[.!👍📲✅\s]*$/i.test(lowerText);
      const isStickerReply = Boolean(message.media?.mimeType === 'image/webp' || message.content.includes('[WhatsApp Sticker'));
      const isNameIntro = /(?:magac(?:aygu|eygu)?\s*(?:waa|ayaa\s*la\s*yidhaahdaa|weeye)?|i\s*dhaha|waxaan\s*ahay)\s+([A-Za-zÀ-ÿ]+)/i.test(text);

      if ((isPendingSaveMe && (isAffirmative || isStickerReply)) || isExplicitSavePhrase || (this.whatsappManager.isLinkCampaignMode() && isNameIntro)) {
        this.statusReactor?.resolvePendingSaveMe(message.chatId);

        // Try extracting user's declared name from the text (e.g. "Haye magacaygu waa Ahmed")
        let contactName = '';
        const nameMatch = text.match(/(?:magac(?:aygu|eygu)?\s*(?:waa|ayaa\s*la\s*yidhaahdaa|weeye)?|i\s*dhaha|waxaan\s*ahay)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)/i);
        if (nameMatch && nameMatch[1]) {
          contactName = nameMatch[1].trim();
        } else if (message.senderName && message.senderName.trim().length > 0) {
          contactName = message.senderName.trim();
        } else {
          contactName = 'Walaal';
        }

        // Full WhatsApp contact save: App-State-Sync + vCard to owner + Broadcast DB
        await this.whatsappManager.saveContact(message.chatId, contactName);

        // Also send contact card (vCard) into chat so native WhatsApp [Save Contact] button appears
        try {
          const rawPhone = message.senderPhone || message.chatId.replace(/\D/g, '');
          if (rawPhone && typeof transport.sendContactCard === 'function') {
            await transport.sendContactCard(message.chatId, contactName, rawPhone);
          }
        } catch { }

        await transport.sendMessage(message.chatId, 'Waan ku save gareeyay walaalo! ✅📲');
        return { handled: true, reason: 'Auto-saved contact from save-me status flow' };
      }
    }

    // 1d. SaaS WhatsApp Onboarding (!join form, !approve, !reject, !pending, !pair, !pdf)
    if (this.onboardingHandler) {
      const onboardingRes = await this.onboardingHandler(message, transport, isAdminUser);
      if (onboardingRes.handled) {
        return onboardingRes;
      }
    } else if (!message.isGroup && isAdminUser && this.sendGuidePdfHandler && /^[!./#]?(?:pdf|buug|guide|amarada)\b/i.test(lowerText)) {
      const sentPdf = await this.sendGuidePdfHandler(message.chatId, transport);
      if (sentPdf) {
        return { handled: true, reason: 'Sent subscriber guide PDF' };
      }
    }

    // ─── 1e. Autonomous Group Management Toggle (!maamul on/off/status/list/enhance/topic/rules/strikes) ──
    const maamulToggleMatch = text.match(/^[!./#]?(?:maamul)\s+(on|off|status|list|enhance|brand|topic|post|rules|xeerar|lock|unlock|strikes|clearstrikes)(?:\s+([\s\S]+))?$/i);
    if (maamulToggleMatch && isAdminUser) {
      const subAction = maamulToggleMatch[1].toLowerCase();
      const groupArg = maamulToggleMatch[2]?.trim();

      if (subAction === 'on') {
        let targetJid = '';
        let groupName = '';

        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (!found) {
            await transport.sendMessage(
              message.chatId,
              `⚠️ Lama helin group magaciisu yahay ama la xidhiidha *"${groupArg}"*.\n` +
              `Fadlan hubi magaca saxda ah ama toos group-ka dhexdiisa uga qor: \`!maamul on\``
            );
            return { handled: true, reason: 'group not found for maamul on' };
          }
          targetJid = found.jid;
          groupName = found.name;
        } else if (message.isGroup) {
          targetJid = message.chatId;
          const info = await this.whatsappManager.getGroupInfo(targetJid);
          groupName = info.info?.subject || 'Kooxda';
        } else {
          await transport.sendMessage(
            message.chatId,
            `ℹ️ Fadlan sheeg magaca group-ka aad rabto in bot-ku la wareego maamulkiisa:\n` +
            `• Tusaale: \`!maamul on Jaamacadda\`\n` +
            `• Ama toos group-ka dhexdiisa ka qor: \`!maamul on\``
          );
          return { handled: true, reason: 'missing group target for maamul on' };
        }

        const res = await this.whatsappManager.enableAutoGroup(targetJid, groupName);

        // Send Takeover Announcement in the group
        const announcement = res.announcement ||
          `🤖👑 *[CARDOSO AI — AWOODDA GUUD & MAAMULKA TOOSKA AH (100% AUTONOMOUS TAKEOVER)]* 👑🤖\n\n` +
          `✅ *Kooxda:* *${res.groupName}*\n` +
          `👑 *Maamulaha Sare:* Mulkiilaha ayaa Cardoso AI siiyay awoodda buuxda ee maamulka kooxdan!\n\n` +
          `⚡ *ILAALADA TOOSKA AH EE FIRFIRCOON (ACTIVE 24/7):*\n` +
          `🚫 *Anti-Link & Auto-Kick:* Xubin kasta oo link soo dhigta isla markiiba waa la saarayaa!\n` +
          `🛑 *Anti-Profanity (3-Strikes):* Ereyada xun, cayda iyo aflagaadada ciqaab adag ayaa ka dhalanaysa.\n` +
          `🌊 *Anti-Flood:* Fariimaha is-daba-jooga ah iyo spam-ka toos ayaa loo tirtirayaa.\n` +
          `👋 *Auto-Welcome:* Qof kasta oo ku soo biira waxaa si toos ah loogu soo dhaweynayaa magaciisa iyo xeerarka kooxda.\n` +
          `💡 *Autonomous Topics:* Bot-ku wuxuu si toos ah u soo dhigi doonaa xikmado iyo doodo wax dhisaya.\n\n` +
          `_Kooxdu hadda waxay ku jirtaa gacmo aamin ah oo 100% autonomous ah!_ ✨`;

        await transport.sendMessage(targetJid, announcement);

        if (message.chatId !== targetJid) {
          await transport.sendMessage(
            message.chatId,
            `✅ *[MAAMULKA TOOSKA AH EE KOOXDA WAAR]:*\n` +
            `Bot-ku si toos ah ayuu ula wareegay maamulka kooxda *"${res.groupName}"*!\n` +
            `• Group ID: \`${targetJid}\`\n` +
            `• AI Branding: Description + 3D Logo + Settings Lock (DONE ✅)\n` +
            `• Anti-Link: ON (Auto-delete + Auto-kick)\n` +
            `• Anti-Profanity: ON (3-Strikes: Somali, Arabic, English)\n` +
            `• Anti-Flood: ON (Spam suppression)\n` +
            `• Auto-Welcome: ON\n` +
            `• Autonomous Daily Topics: ACTIVE 24/7\n\n` +
            `💡 _Adigu wax kale ma qoraysid; bot-ka ayaa 100% wax kasta si toos ah u maamulaya!_`
          );
        }
        return { handled: true, reason: 'Auto-group management enabled' };
      }

      if (subAction === 'enhance' || subAction === 'brand') {
        let targetJid = '';
        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (!found) {
            await transport.sendMessage(message.chatId, `⚠️ Lama helin group magaciisu yahay *"${groupArg}"*.`);
            return { handled: true, reason: 'group not found' };
          }
          targetJid = found.jid;
        } else if (message.isGroup) {
          targetJid = message.chatId;
        } else {
          await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sheeg magaca group-ka: `!maamul enhance <magac>` ama group-ka dhexdiisa ka qor: `!maamul enhance`');
          return { handled: true, reason: 'missing group target' };
        }

        await transport.sendMessage(message.chatId, '🎨 *[CARDOSO AI]*: Casriyeynta kooxda (Branding & AI Logo Generation) ayaa socota... Fadlan sug wax yar! ⏳');
        const res = await this.whatsappManager.autoBrandGroup(targetJid);
        await transport.sendMessage(targetJid, res.message);
        if (message.chatId !== targetJid) {
          await transport.sendMessage(message.chatId, `✅ Kooxda *"${res.subject}"* si guul leh ayaa loo casriyeeyay!`);
        }
        return { handled: true, reason: 'Group branding enhanced' };
      }

      if (subAction === 'topic' || subAction === 'post') {
        let targetJid = '';
        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (!found) {
            await transport.sendMessage(message.chatId, `⚠️ Lama helin group magaciisu yahay *"${groupArg}"*.`);
            return { handled: true, reason: 'group not found' };
          }
          targetJid = found.jid;
        } else if (message.isGroup) {
          targetJid = message.chatId;
        } else {
          await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sheeg magaca group-ka: `!maamul topic <magac>`');
          return { handled: true, reason: 'missing group target' };
        }

        const res = await this.whatsappManager.postGovernorTopic(targetJid, transport);
        if (message.chatId !== targetJid) {
          await transport.sendMessage(message.chatId, res.message);
        }
        return { handled: true, reason: 'Governor topic posted' };
      }

      if (subAction === 'rules' || subAction === 'xeerar') {
        let targetJid = message.isGroup ? message.chatId : '';
        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (found) targetJid = found.jid;
        }
        if (!targetJid) {
          await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sheeg magaca group-ka ama toos group-ka dhexdiisa uga qor: `!maamul rules`');
          return { handled: true, reason: 'missing group target' };
        }
        const rules = await this.whatsappManager.getGroupRules(targetJid);
        await transport.sendMessage(targetJid, rules);
        if (message.chatId !== targetJid) {
          await transport.sendMessage(message.chatId, '✅ Xeerarkii kooxda si toos ah ayaa loogu soo dhigay!');
        }
        return { handled: true, reason: 'Governor rules posted' };
      }

      if (subAction === 'lock' || subAction === 'unlock') {
        let targetJid = message.isGroup ? message.chatId : '';
        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (found) targetJid = found.jid;
        }
        if (!targetJid) {
          await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sheeg magaca group-ka: `!maamul lock <magac>`');
          return { handled: true, reason: 'missing group target' };
        }
        const lockRes = await this.whatsappManager.setGroupInfoLock(targetJid, subAction === 'lock');
        await transport.sendMessage(message.chatId, lockRes.message);
        return { handled: true, reason: 'Group info lock toggled' };
      }

      if (subAction === 'strikes') {
        let targetJid = message.isGroup ? message.chatId : '';
        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (found) targetJid = found.jid;
        }
        if (!targetJid) {
          await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sheeg magaca group-ka: `!maamul strikes <magac>`');
          return { handled: true, reason: 'missing group target' };
        }
        const strikesMap = this.whatsappManager.getGovernor().getStrikes(targetJid);
        const users = Object.entries(strikesMap);
        if (users.length === 0) {
          await transport.sendMessage(message.chatId, '✅ Kooxdan ma jiraan xubno digniino ama dambiyo anshax ku leh hadda. Nidaamku waa 100% nadiif!');
        } else {
          let report = `🚨 *[LIISKA DIGNIINADA ANSHAXA EE KOOXDA]* 🚨\n\n`;
          users.forEach(([phone, rec], i) => {
            report += `${i + 1}. 👤 *+${phone}* — *${rec.count}/3 Digniinood*\n`;
            rec.history.forEach(h => {
              report += `   • _${h.reason}_ ${h.word ? `("${h.word}")` : ''}\n`;
            });
            report += '\n';
          });
          report += `💡 _Si aad digniinaha uga tirto qof qor:_ \`!maamul clearstrikes @user\``;
          await transport.sendMessage(message.chatId, report);
        }
        return { handled: true, reason: 'Strikes report displayed' };
      }

      if (subAction === 'clearstrikes') {
        let targetJid = message.isGroup ? message.chatId : '';
        const target = this.extractTargetParticipant(message, groupArg);
        if (!target) {
          await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sheeg qofka aad digniinaha ka tirayso: `!maamul clearstrikes @user` ama lambarkiisa.');
          return { handled: true, reason: 'missing clearstrikes target' };
        }
        this.whatsappManager.getGovernor().clearStrikes(targetJid, target);
        await transport.sendMessage(message.chatId, `✅ Xubinta (${target}) dhammaan digniinihii anshaxa waa laga cafiyay!`);
        return { handled: true, reason: 'Strikes cleared' };
      }

      if (subAction === 'off') {
        let targetJid = '';

        if (groupArg) {
          const found = await this.whatsappManager.findGroupByNameOrJid(groupArg);
          if (!found) {
            await transport.sendMessage(
              message.chatId,
              `⚠️ Lama helin group magaciisu yahay ama la xidhiidha *"${groupArg}"*.`
            );
            return { handled: true, reason: 'group not found for maamul off' };
          }
          targetJid = found.jid;
        } else if (message.isGroup) {
          targetJid = message.chatId;
        } else {
          await transport.sendMessage(
            message.chatId,
            `ℹ️ Fadlan sheeg magaca group-ka aad maamulka tooska ah ka daminayso:\n` +
            `• Tusaale: \`!maamul off Jaamacadda\`\n` +
            `• Ama group-ka dhexdiisa ka qor: \`!maamul off\``
          );
          return { handled: true, reason: 'missing group target for maamul off' };
        }

        const res = await this.whatsappManager.disableAutoGroup(targetJid);
        const offNotice =
          `🛑 *[CARDOSO AI — MAAMULKII TOOSKA AHAA WAA LA JOOJIYAY]*\n\n` +
          `Maamulkii tooska ahaa (Auto-Guard & Anti-Link) ee kooxdan *"${res.groupName}"* waa la damiyay amarka Mulkiilaha darted.`;
        await transport.sendMessage(targetJid, offNotice);

        if (message.chatId !== targetJid) {
          await transport.sendMessage(message.chatId, `🛑 Maamulkii tooska ahaa ee kooxda *"${res.groupName}"* waa la damiyay.`);
        }
        return { handled: true, reason: 'Auto-group management disabled' };
      }

      if (subAction === 'status' || subAction === 'list') {
        const groups = this.whatsappManager.getAutoManagedGroups();
        if (groups.length === 0) {
          await transport.sendMessage(
            message.chatId,
            `ℹ️ *[MAAMULKA TOOSKA AH EE GROUPS-KA]*\n\nHadda ma jiro group uu bot-ku si toos ah u maamulo.\n\n💡 Si aad koox ugu darto, qor:\n\`!maamul on <magaca-group-ka>\` ama toos group-ka dhexdiisa uga qor \`!maamul on\`.`
          );
        } else {
          let listMsg = `🛡️ *[GROUPS-KA UU BOT-KU SI TOOS AH U MAAMULO (${groups.length})]* 🛡️\n\n`;
          groups.forEach((g, idx) => {
            listMsg += `${idx + 1}. 👥 *${g.name}*\n   • ID: \`${g.jid}\`\n   • Ilaalada: *Anti-Link ON + Auto-Welcome ON + Anti-Profanity ON*\n\n`;
          });
          listMsg += `💡 _Si aad koox uga saarto maamulka tooska ah, qor:_ \`!maamul off <magaca-group-ka>\``;
          await transport.sendMessage(message.chatId, listMsg);
        }
        return { handled: true, reason: 'Auto-group list displayed' };
      }
    }

    // Dynamic Group Rules for any member in an auto-managed group
    if (/^[!./#]?(?:rules|xeerar|xeerarka)$/i.test(lowerText.trim()) && message.isGroup && this.whatsappManager.isAutoGroupManaged(message.chatId)) {
      const rulesText = await this.whatsappManager.getGroupRules(message.chatId);
      await transport.sendMessage(message.chatId, rulesText);
      return { handled: true, reason: 'Group dynamic rules displayed' };
    }

    // ─── 1d.1. Interactive WhatsApp Poll Command (!poll) ─────────────────────
    if (/^[!./#]?poll\b/i.test(lowerText)) {
      if (!isAdminUser && !(await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId))) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Codbixinta waxaa abuuri kara Admins-ka oo kaliya!');
        return { handled: true, reason: 'unauthorized poll attempt' };
      }
      const rawArgs = text.replace(/^[!./#]?poll\s*/i, '').trim();
      const parts = rawArgs.split(/[|,\n]/).map(p => p.trim()).filter(Boolean);
      if (parts.length < 3) {
        await transport.sendMessage(
          message.chatId,
          `📊 *[CARDOSO AI — INTERACTIVE POLL CREATOR]*\n\n` +
          `Fadlan u qor qaabkan:\n` +
          `\`!poll Su'aasha | Dooro 1 | Dooro 2 | [Dooro 3...]\`\n\n` +
          `💡 *Tusaale:*\n` +
          `\`!poll Luuqadee ugu fiican? | JavaScript | Python | Go | Rust\``
        );
        return { handled: true, reason: 'invalid poll syntax' };
      }
      const title = parts[0];
      const options = parts.slice(1);
      const pollRes = await this.whatsappManager.createPoll(message.chatId, title, options, 1);
      if (!pollRes.success) {
        await transport.sendMessage(message.chatId, `⚠️ ${pollRes.message}`);
      }
      return { handled: true, reason: 'Poll created' };
    }

    // ─── 1d.2. Smart Night Curfew / Quiet Hours (!curfew) ────────────────────
    if (/^[!./#]?(?:curfew|hurdo|nasasho)\b/i.test(lowerText)) {
      if (!isAdminUser && !(await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId))) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Amarkan waxaa isticmaali kara Admins-ka oo kaliya!');
        return { handled: true, reason: 'unauthorized curfew attempt' };
      }
      const parts = lowerText.replace(/^[!./#]?(?:curfew|hurdo|nasasho)\s*/i, '').trim().split(/\s+/);
      const sub = parts[0];
      if (sub === 'on' || sub === 'enable') {
        const start = parseInt(parts[1] || '23', 10);
        const end = parseInt(parts[2] || '6', 10);
        const cfg = this.whatsappManager.setCurfew(message.chatId, true, isNaN(start) ? 23 : start, isNaN(end) ? 6 : end);
        await transport.sendMessage(
          message.chatId,
          `🌙 *[CARDOSO AI — SAACADDA HURDADA WAA LA SHIDAY (CURFEW ON)]* 😴\n\n` +
          `• Xilliga Xidhitaanka: \`${cfg.startHour}:00 PM\`\n` +
          `• Xilliga Furitaanka: \`0${cfg.endHour}:00 AM\`\n\n` +
          `Bot-ku si toos ah ayuu kooxda u xidhi doonaa habeenkii, subaxiina dib ugu furi doonaa isagoo duco iyo dhiirigelin soo dhigaya! ✨`
        );
        return { handled: true, reason: 'Curfew enabled' };
      } else if (sub === 'off' || sub === 'disable') {
        this.whatsappManager.setCurfew(message.chatId, false);
        await transport.sendMessage(
          message.chatId,
          `🟢 *[CARDOSO AI — SAACADDA HURDADA WAA LA DAMIYAY]*\nKooxdu waxay ahaanaysaa mid furan 24/7.`
        );
        return { handled: true, reason: 'Curfew disabled' };
      } else {
        const cur = this.whatsappManager.getCurfew(message.chatId);
        const statusStr = cur?.enabled
          ? `✅ *SHIDAN TAHAY (ON)* (\`${cur.startHour}:00 PM\` - \`0${cur.endHour}:00 AM\`)`
          : `❌ *DAMISAN TAHAY (OFF)*`;
        await transport.sendMessage(
          message.chatId,
          `🌙 *[XILIGA HURDADA & NASASHADA KOOXDA (CURFEW)]*\n\n` +
          `• Xaaladda Hadda: ${statusStr}\n\n` +
          `💡 *Sida loo isticmaalo:*\n` +
          `• \`!curfew on 23 6\` — Shid saacadda hurdada (11:00 PM ilaa 6:00 AM)\n` +
          `• \`!curfew off\` — Dami saacadda hurdada`
        );
        return { handled: true, reason: 'Curfew status displayed' };
      }
    }

    // ─── 1d.2b. Autonomous Daily Member Auto-Add (!autoadd) ────────────────────
    if (/^[!./#]?(?:autoadd|kudar|ku-dar)\b/i.test(lowerText)) {
      if (!isAdminUser && !(await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId))) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Amarkan waxaa isticmaali kara Admins-ka oo kaliya!');
        return { handled: true, reason: 'unauthorized autoadd attempt' };
      }

      const match = text.match(/^[!./#]?(?:autoadd|kudar|ku-dar)(?:\s+(on|off|run|status))?(?:\s+(\d+))?$/i);
      const action = (match?.[1] || 'status').toLowerCase();
      const countArg = match?.[2] ? parseInt(match[2], 10) : undefined;
      const groupJid = message.chatId;

      if (action === 'on') {
        const limit = countArg && countArg > 0 ? countArg : 5;
        this.whatsappManager.setAutoAddConfig(groupJid, { enabled: true, dailyLimit: limit });
        await transport.sendMessage(
          message.chatId,
          `🟢 *[CARDOSO AI — DAILY AUTO-ADD SHIDAN]* 👥\n\n` +
          `Ku-darista tooska ah ee xubnaha maalinlaha ah waa la shiday!\n` +
          `• Xadka maalintii: *${limit} xubnood*\n` +
          `• Bot-ku wuxuu maalin walba si nabad ah kooxda ugu dari doonaa xubno cusub oo ka tirsan contacts-ka.`
        );
        return { handled: true, reason: 'autoadd enabled' };
      }

      if (action === 'off') {
        this.whatsappManager.setAutoAddConfig(groupJid, { enabled: false });
        await transport.sendMessage(
          message.chatId,
          `🛑 *[CARDOSO AI — DAILY AUTO-ADD DAMIN]* 👥\n\n` +
          `Ku-darista tooska ah ee maalinlaha ah ee kooxdan waa la damiyay.`
        );
        return { handled: true, reason: 'autoadd disabled' };
      }

      if (action === 'run') {
        const limit = countArg && countArg > 0 ? countArg : 5;
        await transport.sendMessage(
          message.chatId,
          `⏳ *[CARDOSO AI]*: Ku-darista tooska ah ee ${limit} xubnood ayaa socota... Fadlan sug wax yar!`
        );
        const res = await this.whatsappManager.autoAddDailyMembers(groupJid, limit);
        await transport.sendMessage(message.chatId, res.message);
        return { handled: true, reason: 'autoadd run completed' };
      }

      // Default: status
      const cfg = this.whatsappManager.getAutoAddConfig(groupJid);
      const counts = await this.whatsappManager.getEligibleContactsCount(groupJid);
      await transport.sendMessage(
        message.chatId,
        `📊 *[CARDOSO AI — XAALADDA AUTO-ADD-KA]* 👥\n\n` +
        `• Xaaladda: ${cfg.enabled ? '🟢 *SHIDAN (Active)*' : '🔴 *DAMISAN (Disabled)*'}\n` +
        `• Xadka Maalintii: *${cfg.dailyLimit || 5} xubnood*\n` +
        `• Wadarta Guud ee Contacts-ka: *${counts.totalContacts} qof*\n` +
        `• U Diyaar ah Ku-darista: *${counts.eligibleCount} qof*\n` +
        `• Durba Kooxda ku jira: *${counts.alreadyInGroupCount} qof*\n` +
        `• Wadarta Ilaa Hadda Lagu Daray: *${cfg.totalAdded || 0} qof*\n` +
        `• Maalintii Ugu Dambaysay: *${cfg.lastRunDate || 'Wali ma socon'}*\n\n` +
        `💡 *Awaamiirta:* \`!autoadd on\`, \`!autoadd off\`, \`!autoadd run [tirada]\``
      );
      return { handled: true, reason: 'autoadd status displayed' };
    }

    // ─── 1d.3. Anti-Delete / Ghost Hunter (!ghost / !deleted) ─────────────────
    if (/^[!./#]?(?:ghost|deleted|tirtiray|la_tirtiray)\b/i.test(lowerText) && message.isGroup) {
      const isSenderAdmin = isAdminUser || (await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId));
      if (!isSenderAdmin) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Ghost Messages waxaa arki kara Admins-ka oo kaliya!');
        return { handled: true, reason: 'unauthorized ghost view attempt' };
      }
      const revokedList = this.whatsappManager.getRevokedMessages(message.chatId);
      if (revokedList.length === 0) {
        await transport.sendMessage(
          message.chatId,
          `👻 *[CARDOSO AI — GHOST VAULT]*\n\nHadda ma jiraan fariimo dhawaan la tirtiray (Delete for everyone) oo keydka ku jira.`
        );
        return { handled: true, reason: 'No ghost messages found' };
      }
      let outMsg = `👻 *[CARDOSO AI — GHOST VAULT / FARIIMAHA LA TIRTIRAY (${revokedList.length})]* 🕵️‍♂️\n\n`;
      revokedList.slice(-5).reverse().forEach((r, idx) => {
        const userNum = r.sender.split('@')[0].split(':')[0];
        const dateStr = new Date(r.deletedAt).toLocaleTimeString();
        outMsg += `${idx + 1}. 👤 *@${userNum}* (${dateStr}):\n   💬 _"${r.text}"_\n\n`;
      });
      outMsg += `_Cardoso AI Ghost Shield wuxuu xafidaa fariimaha la tirtiro._`;
      await transport.sendMessage(message.chatId, outMsg, {
        mentions: revokedList.slice(-5).map(r => r.sender),
      });
      return { handled: true, reason: 'Ghost messages retrieved' };
    }

    // ─── 1d.4. Live Sandboxed Code Runner (!code / !run) ──────────────────────
    if (/^[!./#]?(?:code|run|koodh)\b/i.test(lowerText)) {
      const rawCodeArgs = text.replace(/^[!./#]?(?:code|run|koodh)\s*/i, '').trim();
      if (!rawCodeArgs) {
        await transport.sendMessage(
          message.chatId,
          `💻 *[CARDOSO AI — LIVE CODE RUNNER & INTERPRETER]* ⚡\n\n` +
          `Ku fuli JavaScript si toos ah oo sandboxed ah WhatsApp-ka dhexdiisa!\n\n` +
          `💡 *Tusaalooyinka:*\n` +
          `• \`!code js [1, 2, 3, 4].map(x => x * 10)\`\n` +
          `• \`!run const sum = (a, b) => a + b; sum(25, 75)\`\n` +
          `• \`!code python print("Hello World")\` (AI static analysis)\n\n` +
          `🤖 _Waxaa dhisay Cardoso Software Engineering Core._`
        );
        return { handled: true, reason: 'code helper shown' };
      }

      const langMatch = rawCodeArgs.match(/^(?:js|javascript|node)\s+(.+)$/is);
      if (langMatch || !/^(?:py|python|sql|java|cpp|rust|go)\b/i.test(rawCodeArgs)) {
        const jsCode = langMatch ? langMatch[1].trim() : rawCodeArgs;
        const cleanCode = jsCode.replace(/^```(?:js|javascript)?\n?/, '').replace(/\n?```$/, '').trim();
        const result = codeRunnerService.executeJavaScript(cleanCode);
        const decree = codeRunnerService.formatResult(result, cleanCode);
        await transport.sendMessage(message.chatId, decree);
        return { handled: true, reason: 'JavaScript code executed' };
      }
    }

    // ─── 1d.5. Voice Transcription Guide (!transcribe / !rogcodka) ───────────
    if (/^[!./#]?(?:transcribe|rogcodka|qorcodka|dhageyso)\b/i.test(lowerText)) {
      const isAudio = (message as any).media?.type === 'audio';
      if (!isAudio && !message.quotedMessageId) {
        await transport.sendMessage(
          message.chatId,
          `🎙️ *[CARDOSO AI — FAHAMKA & QORAALKA CODKA]* 📝\n\n` +
          `Si aad codka qoraal ugu rogto:\n` +
          `1. *Reply ku qabo codka (Quote)* oo ku qor: \`!transcribe\` ama \`!rogcodka\`\n` +
          `2. Ama soo dir *Cod (Voice Note)* adigoo caption-kiisa ku qoraya \`!transcribe\`.\n\n` +
          `Bot-ku codka wuu dhagaysanayaa eray-ka-eray wuxuuna kuu soo saarayaa qoraal cad iyo dulmar kooban! 🎧✨`
        );
        return { handled: true, reason: 'transcribe helper shown' };
      }
    }

    // ─── 1d.6. Quiz Leaderboard (!leaderboard / !xididka / !guulaha) ─────────
    if (/^[!./#]?(?:leaderboard|xididka|guulaha|scoreboard|hore)\b/i.test(lowerText) && message.isGroup) {
      const board = this.whatsappManager.getQuizLeaderboard(message.chatId, 10);
      await transport.sendMessage(message.chatId, board, {
        mentions: this.whatsappManager.getGovernor().getLeaderboard(message.chatId, 10).map(e => `${e.user}@s.whatsapp.net`),
      });
      return { handled: true, reason: 'Leaderboard displayed' };
    }

    // ─── 1d.7. Inactive Members Audit (!inactive [days]) ─────────────────────
    if (/^[!./#]?(?:inactive|maqna|aamus|dadmaqna)\b/i.test(lowerText) && message.isGroup) {
      const isSenderAdmin = isAdminUser || (await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId));
      if (!isSenderAdmin) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Amarkan waxaa isticmaali kara Admins-ka oo kaliya!');
        return { handled: true, reason: 'unauthorized inactive check' };
      }
      const daysArg = parseInt(lowerText.replace(/^[!./#]?(?:inactive|maqna|aamus|dadmaqna)\s*/i, '').trim(), 10);
      const days = isNaN(daysArg) || daysArg < 1 ? 30 : daysArg;
      const inactives = this.whatsappManager.getGovernor().getInactiveMembers(message.chatId, days);
      if (inactives.length === 0) {
        await transport.sendMessage(
          message.chatId,
          `✅ *[CARDOSO AI — XUBNAHA FIRFIRCOON]*\n\n` +
          `Dhammaan xubnuhu waxay firfircoon yihiin ${days} maalmood gudahood! 🎉\n\n` +
          `_Bot-ku wuu daawanayaa dhaq-dhaqaaqa xubnaha maalin kasta._`
        );
      } else {
        const jids = inactives.map(u => `${u}@s.whatsapp.net`);
        let inactiveMsg =
          `😴 *[CARDOSO AI — XUBNAHA MAQAN (${days} maalmood)]* 👥\n\n` +
          `Xubnaha aan wax qorin ${days} maalmood:\n\n`;
        inactives.slice(0, 20).forEach((u, i) => {
          inactiveMsg += `${i + 1}. @${u}\n`;
        });
        if (inactives.length > 20) inactiveMsg += `\n...iyo ${inactives.length - 20} qof oo kale.\n`;
        inactiveMsg += `\n💡 _Kick-garee ama u dir digniino si aad kooxda firfircoon u jirto._`;
        await transport.sendMessage(message.chatId, inactiveMsg, { mentions: jids.slice(0, 20) });
      }
      return { handled: true, reason: 'Inactive members listed' };
    }

    // ─── 1d.8. Scheduled Announcement (!schedule / !jadwal) ──────────────────
    if (/^[!./#]?(?:schedule|jadwal|war|announcement)\b/i.test(lowerText) && message.isGroup) {
      const isSenderAdmin = isAdminUser || (await this.whatsappManager.isParticipantGroupAdmin(message.chatId, message.senderId));
      if (!isSenderAdmin) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Amarkan waxaa isticmaali kara Admins-ka oo kaliya!');
        return { handled: true, reason: 'unauthorized schedule attempt' };
      }
      const rawSchedArgs = text.replace(/^[!./#]?(?:schedule|jadwal|war|announcement)\s*/i, '').trim();

      // List command
      if (/^(?:list|liiska|show|eeg)$/i.test(rawSchedArgs)) {
        const list = this.whatsappManager.listScheduledAnnouncements(message.chatId);
        if (list.length === 0) {
          await transport.sendMessage(message.chatId, `📅 *[CARDOSO AI — JADWALKA]*\n\nMa jiro wax xayeysiis ah oo la dejiyay.\n\n💡 Tusaale: \`!schedule 14:30 Kulan casariyeedka waa 15:00!\``);
        } else {
          let listMsg = `📅 *[CARDOSO AI — JADWALKA XAYEYSIISYADA (${list.length})]* ⏰\n\n`;
          list.forEach((ann, i) => {
            const h = String(ann.hour).padStart(2, '0');
            const m = String(ann.minute).padStart(2, '0');
            listMsg += `${i + 1}. ⏰ \`${h}:${m}\` — ${ann.message.slice(0, 60)}${ann.message.length > 60 ? '...' : ''}\n   _ID: \`${ann.id}\`_\n\n`;
          });
          await transport.sendMessage(message.chatId, listMsg);
        }
        return { handled: true, reason: 'Schedule list shown' };
      }

      // Cancel command: !schedule cancel <id>
      const cancelMatch = rawSchedArgs.match(/^(?:cancel|tirtir|dami)\s+(\S+)$/i);
      if (cancelMatch) {
        const removed = this.whatsappManager.cancelScheduledAnnouncement(message.chatId, cancelMatch[1]);
        await transport.sendMessage(
          message.chatId,
          removed
            ? `✅ *[CARDOSO AI]*: Xayeysiiska ID \`${cancelMatch[1]}\` waa la baabi'iyay.`
            : `⚠️ *[CARDOSO AI]*: ID-da \`${cancelMatch[1]}\` lama helin jadwalka.`
        );
        return { handled: true, reason: 'Schedule cancelled' };
      }

      // Add schedule: !schedule HH:MM <message>
      const timeMatch = rawSchedArgs.match(/^(\d{1,2}):(\d{2})\s+(.+)$/s);
      if (!timeMatch) {
        await transport.sendMessage(
          message.chatId,
          `📅 *[CARDOSO AI — JADWALKA XAYEYSIISYADA]* ⏰\n\n` +
          `💡 *Sida loo isticmaalo:*\n` +
          `• \`!schedule 14:30 Kulanku waa billaabanayaa!\` — Jadwal xayeysiis\n` +
          `• \`!schedule list\` — Eeg xayeysiisyada la dejiyay\n` +
          `• \`!schedule cancel <id>\` — Baabi'i xayeysiis\n\n` +
          `📌 Waqtigu waa 24-saacadood (00:00–23:59).`
        );
        return { handled: true, reason: 'schedule syntax help shown' };
      }

      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const annMsg = timeMatch[3].trim();

      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        await transport.sendMessage(message.chatId, '⚠️ *[CARDOSO AI]*: Waqtiga saxda ah soo geli (00:00–23:59).');
        return { handled: true, reason: 'invalid schedule time' };
      }

      const annId = this.whatsappManager.scheduleGroupAnnouncement(message.chatId, hour, minute, annMsg);
      await transport.sendMessage(
        message.chatId,
        `✅ *[CARDOSO AI — JADWALKA]* 📅\n\n` +
        `🕐 *Waqtiga:* \`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}\`\n` +
        `📢 *Fariin:* ${annMsg}\n` +
        `🔑 *ID:* \`${annId}\`\n\n` +
        `_Bot-ku si toos ah ayuu u soo diraya xilliga la qabanayo!_ 🤖`
      );
      return { handled: true, reason: 'Announcement scheduled' };
    }

    // ─── 1d.9. Islamic Prayer Times, Athan & Du'a (!salaad / !prayer / !eedan / !adhan) ──
    if (/^[!./#]?(?:salaad|salaadda|prayer|prayers|eedan|adhan|aadaanka)\b/i.test(lowerText)) {
      const prayerService = this.whatsappManager.getPrayerTimesService();
      const subArg = lowerText.replace(/^[!./#]?(?:salaad|salaadda|prayer|prayers|eedan|adhan|aadaanka)\s*/i, '').trim();

      // If user specifically requested playing the Athan (!eedan or !salaad eedan)
      if (/^(?:eedan|adhan|aadaanka|cod)/i.test(subArg) || /^[!./#]?(?:eedan|adhan|aadaanka)$/i.test(lowerText.trim())) {
        const isFajr = /fajr|subax/i.test(subArg);
        await transport.sendMessage(message.chatId, `🕌 *[CARDOSO AI — EEDANKA SALAADDA]*\n\nWaxaa la diyaarinayaa Eedanka codka ah iyo Ducada... 🎧`);

        // Send Voice Note Athan
        const athan = await prayerService.getAthanAudio(isFajr);
        if (athan && athan.buffer.length > 0) {
          if (transport.sendMedia) {
            await transport.sendMedia(message.chatId, {
              type: 'audio',
              dataBuffer: athan.buffer,
              mimeType: athan.mimeType || 'audio/ogg; codecs=opus',
              ptt: true,
            });
          }
        }

        // Send Sunnah Du'a Text
        await transport.sendMessage(message.chatId, prayerService.getDuaAfterAthanText());

        // Send Sunnah Du'a Voice Note
        const dua = await prayerService.getDuaAudio();
        if (dua && dua.buffer.length > 0) {
          if (transport.sendMedia) {
            await transport.sendMedia(message.chatId, {
              type: 'audio',
              dataBuffer: dua.buffer,
              mimeType: dua.mimeType || 'audio/ogg; codecs=opus',
              ptt: true,
            });
          }
        }

        return { handled: true, reason: 'Athan and Dua audio broadcasted' };
      }

      // Default: Display today's prayer timetable + countdown to next prayer
      const summaryText = prayerService.getScheduleSummaryText();
      await transport.sendMessage(message.chatId, summaryText);
      return { handled: true, reason: 'Prayer times schedule displayed' };
    }

    // ─── 1e. Comprehensive WhatsApp Management Help Command (!maamul / !whatsapp) ──
    if (/^[!./#]?(?:maamul|whatsapp|status-help|bot-help)\b/i.test(lowerText) && isAdminUser) {
      const helpText =
        `🌟 *[CARDOSO AI — AWOODDA MAAMULKA WHATSAPP 100%]* 🌟\n\n` +
        `📱 *WHATSAPP STATUS (STORIES):*\n` +
        `• \`!view on/off\` (ama \`view on/off\`) — ⭐ *HAL AMAR OO WADA JIRA*: Daawashada (Seen) + Falcelinta Emoji + Faallada AI\n` +
        `• \`!status <fariin>\` — Post garee status qoraal ah (midabbo qurxoon leh)\n` +
        `• \`!status\` (Sawir/Cod/Video la socdo) — Post garee sawir, muuqaal ama cod status ah\n` +
        `• \`!statusviews\` (ama \`!daawadeyaasha\`) — Eeg liiska dadka daawatay status-kaaga (Magaca, Lambarka, Waqtiga)\n` +
        `• \`!status-ai [mawduuc]\` — AI ayaa soo saaraya status dhiirigelin ah oo toos u dhigaya\n` +
        `• \`!deletestatus [id]\` (ama \`!tirtirstatus\`) — Tirtir status-kaaga ugu dambeeyay ama mid gaar ah (Delete for everyone)\n` +
        `• \`!autoview on/off\` — Daaro ama dami in bot-ku si toos ah u daawado status-yada dadka (Auto Seen)\n` +
        `• \`!statusreact on/off\` — Daaro/dami falcelinta emoji-ga ee status-ka (❤️, 😂, 👏, 🔥, 🤲)\n` +
        `• \`!statuscomment on/off\` — Daaro/dami faallada tooska ah ee AI (Smart Human Comment)\n` +
        `• \`!statusmode reaction/comment/both\` — Dooro nooca falcelinta status-ka\n` +
        `• \`!statuscooldown <saacado>\` — Deji saacadaha u dhexeeya laba status oo qofka looga falceliyo (tusaale: \`!statuscooldown 4\`)\n` +
        `• \`!statusinfo\` — Eeg xaaladda iyo tirakoobka Status AI Reactor\n\n` +
        `💬 *REPLY & FARIIMO TOOS AH:*\n` +
        `• \`!reply <lambar> <fariin>\` — U dir fariin toos ah lambarkaas\n` +
        `• \`!reply <fariin>\` (adigoo qofka fariintiisa quote ku haya) — Toos ugu reply dheh qofkaas\n` +
        `• \`!cod <lambar> <fariin>\` — U dir cod Soomaali ah oo toos loo akhriyay lambarkaas\n` +
        `• \`!autoreply add <erey> | <jawaab>\` — Sameyso jawaab toos ah oo degdeg ah\n` +
        `• \`!autoreply list\` — Soo bandhig jawaabaha tooska ah ee kuu kaydsan\n` +
        `• \`!autoreply delete <erey>\` — Tirtir jawaab toos ah\n\n` +
        `👥 *MAAMULKA GROUPS-KA (100% CONTROL & AUTONOMOUS GOVERNOR):*\n` +
        `• \`!maamul on [magaca]\` — ⭐ *AUTONOMOUS TAKEOVER*: Bot-ku si buuxda ha ula wareego kooxda\n` +
        `• \`!poll <su'aal> | <opt1> | <opt2>\` — 📊 *INTERACTIVE POLL*: Codbixin toos ah oo WhatsApp ah\n` +
        `• \`!curfew on/off\` (ama \`!hurdo\`) — 🌙 *SMART CURFEW*: Saacadda hurdada & xidhitaanka habeenkii\n` +
        `• \`!ghost\` (ama \`!deleted\`) — 👻 *GHOST VAULT*: Soo saar fariimihii la tirtiray (Delete for everyone)\n` +
        `• \`!code js <koodh>\` (ama \`!run\`) — 💻 *LIVE CODE RUNNER*: Ku dhex fuli JavaScript WhatsApp-ka\n` +
        `• \`!transcribe\` (ama \`!rogcodka\`) — 🎙️ *VOICE TRANSCRIBER*: Codka WhatsApp-ka u rog qoraal cad\n` +
        `• \`!leaderboard\` (ama \`!xididka\`) — 🏆 *QUIZ LEADERBOARD*: Eeg xididdada quiz-ka kooxda\n` +
        `• \`!inactive [days]\` (ama \`!maqna\`) — 😴 *INACTIVE AUDIT*: Soo saar xubnaha aan wax qorin\n` +
        `• \`!schedule HH:MM <fariin>\` — 📅 *SCHEDULED ANNOUNCEMENT*: Jadwal xayeysiis waqti gaar ah\n` +
        `• \`!schedule list\` — Eeg xayeysiisyada la dejiyay\n` +
        `• \`!schedule cancel <id>\` — Baabi'i xayeysiis jadwal ah\n` +
        `• \`!salaad\` (ama \`!eedan\`) — 🕌 *PRAYER TIMES & ATHAN*: Waqtiyada salaadda, Eedanka codka ah & Ducada eedanka\n` +
        `• \`!autoadd on/off/run\` — 👥 *AUTO-ADD MEMBERS*: Ku dar xubno cusub oo contacts ah maalin walba si toos ah\n` +
        `• \`!maamul enhance [magaca]\` — 🎨 *AI BRANDING*: Auto-update Description + AI Logo Profile Picture + Lock Info\n` +
        `• \`!maamul topic [magaca]\` — 💡 *AI TOPIC*: Soo dhig dood ama xikmad caqli badan oo ku habboon kooxda\n` +
        `• \`!maamul rules [magaca]\` — 📜 *RULES*: Soo bandhig ama soo dhig xeerarka kooxda\n` +
        `• \`!maamul lock/unlock\` — 🔒 Xidh ama fur beddelista xogta kooxda (Admins only / Everyone)\n` +
        `• \`!maamul strikes\` — 🚨 Eeg xubnaha qaba digniinaha anshaxa (Strikes 1-3)\n` +
        `• \`!maamul clearstrikes @user\` — 🔄 Ka tirtir digniinaha anshaxa xubin gaar ah\n` +
        `• \`!maamul off [magaca]\` — Dami maamulka tooska ah ee kooxda\n` +
        `• \`!maamul status\` — Eeg liiska groups-ka uu bot-ku si toos ah u maamulo\n` +
        `• \`!rules\` (ama \`!xeerar\`) — Xeerarka rasmiga ah ee kooxda (Qof kasta)\n` +
        `• \`!tagall [fariin]\` — Dhammaan xubnaha kooxda hal mar tag garee\n` +
        `• \`!kick @user\` — Qofka ka saar kooxda\n` +
        `• \`!add <lambar>\` — Qofka ku dar kooxda\n` +
        `• \`!promote @user\` — Qofka ka dhig Admin kooxda\n` +
        `• \`!demote @user\` — Qofka maamulnimada ka qaad\n` +
        `• \`!mute\` — Xidh kooxda (Admins oo kaliya ayaa qori kara)\n` +
        `• \`!unmute\` — Fur kooxda (Dhammaan xubnuhu way qori karaan)\n` +
        `• \`!link\` — Soo qaad link-ga kooxda lagu soo galo\n` +
        `• \`!groupinfo\` — Xogta kooxda (tirada, admins-ka, abuuritaanka)\n\n` +
        `⚙️ *PROFILE-KA & FARIIMAHA:*\n` +
        `• \`!setname <magac>\` — Beddel magaca WhatsApp-ka ee bot-ka\n` +
        `• \`!setbio <qoraal>\` — Beddel WhatsApp Bio-ga / About-ka\n` +
        `• \`!setpp\` (sawir la socdo) — Beddel sawirka profile-ka bot-ka\n` +
        `• \`!block <lambar>\` — Block garee qof\n` +
        `• \`!unblock <lambar>\` — Unblock ka qaad qof\n` +
        `• \`!reject all\` — Xidh dhammaan wicitaannada (Auto-Reject ON + Voice Note)\n` +
        `• \`!reject <lambar>\` — Wicitaannada ka xidh lambar gaar ah\n` +
        `• \`!unreject all\` — Fur dhammaan wicitaannada (Auto-Reject OFF)\n` +
        `• \`!unreject <lambar>\` — Wicitaanka u fur lambar gaar ah\n` +
        `• \`!delete\` (quote fariin) — Delete for everyone fariintaas\n` +
        `• \`!react <emoji>\` (quote fariin) — Emoji ku dhufo fariintaas\n` +
        `• \`!pin\` (quote fariin) — Pin garee fariintaas\n` +
        `• \`!save <lambar> <magac>\` — Qofka toos ugu dar WhatsApp contacts-kaaga 📲\n` +
        `• \`!on\` / \`!off\` — Shid ama Dami AI Chatbot-ka guud ahaan (AI ON/OFF)\n` +
        `• \`!off <lambar>\` — Qof gaar ah ka dami AI-ga, status-ka & calls-ka (Chat aamusan)\n` +
        `• \`!on <lambar>\` — Qofkaas gaarka ah dib ugu fur bot-ka iyo AI-ga\n` +
        `• \`!off list\` — Eeg liiska dadka AI-gu ka xidhan yahay\n` +
        `• \`!link on/off/set\` — Status Link Campaign & Is-dhaafsiga Sawirka/Link-ga WhatsApp\n\n` +
        `📢 *SMART BROADCAST:*\n` +
        `• \`!fariin <qoraal>\` — U dir 50 qof oo cusub fariin shakhsiyeed\n` +
        `• \`!contacts\` — Hubi tirada guud ee contacts-ka kaydsan`;
      await transport.sendMessage(message.chatId, helpText);
      return { handled: true, reason: 'WhatsApp management help menu' };
    }

    // ─── 1f. WhatsApp Status Posting & Management ─────────────────────────────
    if (/^[!./#]?(?:status-ai|status_ai)(?:[\s!./#]+(.+))?$/i.test(lowerText) && isAdminUser) {
      if (this.planGuard) {
        const check = this.planGuard.checkFeature('status_post');
        if (!check.allowed) {
          await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
          return { handled: true, reason: 'Status post gated by plan' };
        }
      }
      const match = text.match(/^[!./#]?(?:status-ai|status_ai)(?:[\s!./#]+(.+))?$/i);
      let topic = match?.[1]?.trim();
      if (topic) {
        topic = topic.replace(/^[!./#]?(?:status(?:-ai)?|sheeko)\s*/i, '').trim();
      }
      await transport.sendMessage(message.chatId, '⏳ *[CARDOSO AI Status]*: AI ayaa diyaarinaya status dhiirigelin ah...');
      const res = await this.whatsappManager.generateAndPostAIStatus(topic || undefined);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'AI Status generated and posted' };
    }

    // ─── 1f. All-in-One Master Status View Command (view on/off / !view on/off) ──
    if (/^[!./#]?(?:view|autoview)(?:\s+(on|off))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:view|autoview)(?:\s+(on|off))?$/i);
      const isExplicitAutoviewOnly = /^autoview/i.test(text.replace(/^[!./#]/, ''));
      const mode = match?.[1]?.toLowerCase();

      if (mode === 'on') {
        if (!isExplicitAutoviewOnly && this.planGuard) {
          const check = this.planGuard.checkFeature('status_reactor');
          if (!check.allowed) {
            await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
            return { handled: true, reason: 'Status reactor gated by plan' };
          }
        }
        this.whatsappManager.setAutoViewStatus(true);
        // If user used "view on" (or !view on), activate ALL 3: Seen + Reaction + AI Comment!
        // Also ensure Link Campaign Mode (which suppresses status replies) is turned OFF so replies actually fire.
        if (!isExplicitAutoviewOnly) {
          if (this.whatsappManager.isLinkCampaignMode()) {
            this.whatsappManager.setLinkCampaignMode(false);
          }
          this.statusReactor.setConfig({ enabled: true, autoReact: true, autoComment: true, mode: 'both', cooldownHours: 0 });
          await transport.sendMessage(
            message.chatId,
            '👁️✨ *[CARDOSO AI — ALL-IN-ONE VIEW]*: Waa la *SHIDAY (ON)*!\n\n' +
            'Hadda bot-ku hal mar ayuu dhammaan si toos ah u wada qabanayaa:\n' +
            '✅ *Auto-View (Seen)*: Wuxuu daawanayaa dhammaan status-yada (views ayaad ka mid noqonaysaa).\n' +
            '✅ *Auto-React (Love Cagaaran 💚)*: Wuxuu status-ka si toos ah u saarayaa Love Cagaaran (💚) ama emoji ku habboon.\n' +
            '✅ *Auto-Comment (AI)*: Wuxuu status *walba* si dabiici ah ugu reply-garaynayaa faallo Soomaali ah oo diirran!\n\n' +
            '_Bot-ku wuxuu u dhaqmayaa sida qof caadi ah oo kale!_ 😊'
          );
        } else {
          await transport.sendMessage(message.chatId, '👁️ *[Auto-View Status]*: Waa la *SHIDAY (ON)*! Hadda bot-ku wuxuu si toos ah u daawan doonaa dhammaan status-yada cusub ee ay dadku soo dhigaan. ✅');
        }
      } else if (mode === 'off') {
        this.whatsappManager.setAutoViewStatus(false);
        if (!isExplicitAutoviewOnly) {
          this.statusReactor.setConfig({ enabled: false, autoReact: false, autoComment: false });
          await transport.sendMessage(
            message.chatId,
            '🛑 *[CARDOSO AI — ALL-IN-ONE VIEW]*: Waa la *DAMIDAY (OFF)*!\n\n' +
            'Bot-ku ma daawan doono status-yada, mana bixin doono wax falcelin (React) ama faallo (Comment) ah.'
          );
        } else {
          await transport.sendMessage(message.chatId, '👁️ *[Auto-View Status]*: Waa la *DAMIDAY (OFF)*! Bot-ku ma daawan doono status-yada. 🛑');
        }
      } else {
        const viewOn = this.whatsappManager.isAutoViewStatusEnabled();
        const sr = this.statusReactor.getConfig();
        await transport.sendMessage(
          message.chatId,
          `👁️ *[CARDOSO AI — ALL-IN-ONE VIEW STATUS]*:\n\n` +
          `• *Auto-View (Seen)*: ${viewOn ? '✅ ON' : '🛑 OFF'}\n` +
          `• *Auto-React (Emoji)*: ${sr.autoReact ? '✅ ON' : '🛑 OFF'}\n` +
          `• *Auto-Comment (AI)*: ${sr.autoComment ? '✅ ON' : '🛑 OFF'}\n\n` +
          `Si aad hal mar u wada shido ama u wada damiso dhammaantood, qor:\n` +
          `👉 \`!view on\` (ama \`view on\`)\n` +
          `👉 \`!view off\` (ama \`view off\`)`
        );
      }
      return { handled: true, reason: 'All-in-one view command toggled' };
    }

    // ─── Status AI Reactor: Auto Reaction Toggling ─────────────────────────
    if (/^[!./#]?(?:statusreact)(?:\s+(on|off))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:statusreact)(?:\s+(on|off))?$/i);
      const action = match?.[1]?.toLowerCase();
      if (action === 'on') {
        if (this.planGuard) {
          const check = this.planGuard.checkFeature('status_reactor');
          if (!check.allowed) {
            await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
            return { handled: true, reason: 'Status reactor gated by plan' };
          }
        }
        this.statusReactor.setConfig({ enabled: true, autoReact: true });
        await transport.sendMessage(message.chatId, '❤️ *[Status Reactor]*: Falcelinta Emoji-ga (Auto-React) waa la *SHIDAY (ON)*! Bot-ku wuxuu status-yada ku dhufan doonaa emoji ku habboon (❤️, 😂, 👏, 🔥, 🤲). ✅');
      } else if (action === 'off') {
        this.statusReactor.setConfig({ autoReact: false });
        await transport.sendMessage(message.chatId, '🛑 *[Status Reactor]*: Falcelinta Emoji-ga (Auto-React) waa la *DAMIDAY (OFF)*.');
      } else {
        const cfg = this.statusReactor.getConfig();
        await transport.sendMessage(
          message.chatId,
          `❤️ *[Status Reactor]*: Falcelinta Emoji-ga hadda waa: *${cfg.autoReact ? 'ON (Furan)' : 'OFF (Xidhan)'}*.\nSi aad u beddesho qor:\n\`!statusreact on\` ama \`!statusreact off\``
        );
      }
      return { handled: true, reason: 'Status react toggled' };
    }

    // ─── Status AI Reactor: Auto Comment Toggling ───────────────────────────
    if (/^[!./#]?(?:statuscomment|statusreply)(?:\s+(on|off))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:statuscomment|statusreply)(?:\s+(on|off))?$/i);
      const action = match?.[1]?.toLowerCase();
      if (action === 'on') {
        if (this.planGuard) {
          const check = this.planGuard.checkFeature('status_reactor');
          if (!check.allowed) {
            await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
            return { handled: true, reason: 'Status reactor gated by plan' };
          }
        }
        this.statusReactor.setConfig({ enabled: true, autoComment: true });
        await transport.sendMessage(message.chatId, '💬 *[Status Reactor]*: Faallada Tooska ah ee AI (Smart Human Comment) waa la *SHIDAY (ON)*! Bot-ku wuxuu status kasta kaga bixin doonaa faallo diirran oo Soomaali ah. ✅');
      } else if (action === 'off') {
        this.statusReactor.setConfig({ autoComment: false });
        await transport.sendMessage(message.chatId, '🛑 *[Status Reactor]*: Faallada Tooska ah ee AI (Status Comment) waa la *DAMIDAY (OFF)*.');
      } else {
        const cfg = this.statusReactor.getConfig();
        await transport.sendMessage(
          message.chatId,
          `💬 *[Status Reactor]*: Faallada tooska ah ee AI hadda waa: *${cfg.autoComment ? 'ON (Furan)' : 'OFF (Xidhan)'}*.\nSi aad u beddesho qor:\n\`!statuscomment on\` ama \`!statuscomment off\``
        );
      }
      return { handled: true, reason: 'Status comment toggled' };
    }

    // ─── Status AI Reactor: Mode Selector (reaction | comment | both) ──────
    if (/^[!./#]?(?:statusmode)(?:\s+(reaction|comment|both))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:statusmode)(?:\s+(reaction|comment|both))?$/i);
      const chosenMode = match?.[1]?.toLowerCase() as any;
      if (chosenMode) {
        this.statusReactor.setConfig({ mode: chosenMode });
        await transport.sendMessage(message.chatId, `⚙️ *[Status Reactor]*: Nooca falcelinta waxaa loo beddelay: *${chosenMode.toUpperCase()}* ✅`);
      } else {
        const cfg = this.statusReactor.getConfig();
        await transport.sendMessage(
          message.chatId,
          `⚙️ *[Status Reactor Mode]*: Nooca hadda shaqaynaya waa: *${cfg.mode.toUpperCase()}*.\nDoorashooyinka:\n• \`!statusmode reaction\` (Emoji kaliya)\n• \`!statusmode comment\` (Faallo qoraal kaliya)\n• \`!statusmode both\` (Labada oo wada jira)`
        );
      }
      return { handled: true, reason: 'Status mode updated' };
    }

    // ─── Status AI Reactor: Cooldown Settings ──────────────────────────────
    if (/^[!./#]?(?:statuscooldown)(?:\s+(\d+))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:statuscooldown)(?:\s+(\d+))?$/i);
      const hours = match?.[1] !== undefined ? parseInt(match[1], 10) : null;
      if (hours !== null && hours >= 0 && hours <= 72) {
        this.statusReactor.setConfig({ cooldownHours: hours });
        await transport.sendMessage(
          message.chatId,
          hours === 0
            ? `⏳ *[Status Reactor]*: Cooldown-ka waa la *DAMIDAY (0 Saacadood)* ✅ — bot-ku status kasta wuu la falgalayaa.`
            : `⏳ *[Status Reactor]*: Cooldown-ka qofkiiba waxaa laga dhigay: *${hours} Saacadood* ✅ (Qofka looma celin doono wax ka badan 1 falcelin ${hours}-kaas saac gudahood).`
        );
      } else {
        const cfg = this.statusReactor.getConfig();
        await transport.sendMessage(
          message.chatId,
          `⏳ *[Status Reactor Cooldown]*: Cooldown-ka hadda waa: *${cfg.cooldownHours} Saacadood*.\nSi aad u beddesho qor:\n\`!statuscooldown <saacado>\` (Tusaale: \`!statuscooldown 2\` ama \`!statuscooldown 6\`)`
        );
      }
      return { handled: true, reason: 'Status cooldown updated' };
    }

    // ─── Status Views & Live Viewers Tracking ("cid daawatay") ──────────────
    if (/^[!./#]?(?:statusviews|statusviewers|daawadeyaasha|daawadayaasha|status-views)(?:\s+(.+))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:statusviews|statusviewers|daawadeyaasha|daawadayaasha|status-views)(?:\s+(.+))?$/i);
      const targetId = match?.[1]?.trim();
      const res = this.whatsappManager.getStatusViews(targetId);
      await transport.sendMessage(message.chatId, res.formattedReport);
      return { handled: true, reason: 'Status views displayed' };
    }

    // ─── !info — Bot health + full error registry (what failed & where it came from) ───
    if (/^[!./#](?:info|botinfo|errors?|khalad(?:aad)?|health)(?:\s+(.+))?$/i.test(lowerText.trim()) && isAdminUser) {
      const infoMatch = text.trim().match(/^[!./#](?:info|botinfo|errors?|khalad(?:aad)?|health)(?:\s+(.+))?$/i);
      const typedAlias = /^[!./#](?:errors?|khalad(?:aad)?)\b/i.test(text.trim());
      const sub = typedAlias ? 'errors' : (infoMatch?.[1] || '').trim().toLowerCase();
      const report = this.buildInfoReport(sub, transport);
      await transport.sendMessage(message.chatId, report);
      return { handled: true, reason: 'Bot info displayed' };
    }

    // ─── Status AI Reactor: Status Info & Overview ──────────────────────────
    if (/^[!./#]?(?:statusinfo|statusreactor)\b/i.test(lowerText) && isAdminUser) {
      const cfg = this.statusReactor.getConfig();
      const recent = this.statusReactor.getRecentInteractions();
      const recentSummary = recent.length > 0
        ? recent.slice(0, 5).map(r => `• ${r.type === 'reaction' ? '❤️ React' : '💬 Comment'}: "${r.content}" ➔ ${r.senderName || r.senderJid} (${r.category})`).join('\n')
        : '_Wali ma jiraan falcelino la diiwaangeliyay._';

      const viewsSummary = this.whatsappManager.getStatusViews();
      const lastStatusLine = viewsSummary.found && viewsSummary.status
        ? `• *Status-kaaga u dambeeyay*: ${viewsSummary.status.content ? `"${viewsSummary.status.content.slice(0, 32)}..."` : `[${viewsSummary.status.type}]`} (*${viewsSummary.totalViews} qof ayaa daawatay*)\n`
        : `• *Status-kaaga u dambeeyay*: _Wali ma jiro status cusub oo diiwaangashan_\n`;

      const anyTr: any = transport;
      const stStats = typeof anyTr.getStatusTelemetry === 'function' ? anyTr.getStatusTelemetry() : null;
      const srStats = this.statusReactor.getStats();
      const recentViewedBlock =
        stStats && stStats.recentViewed.length > 0
          ? `\n👁️ *STATUS-YADII UGU DAMBEEYAY EE BOT-KU DAAWADAY:*\n` +
          stStats.recentViewed
            .slice(0, 5)
            .map((v: any) => `• ✅ ${v.name || v.sender} (${formatClock(v.timestamp)})`)
            .join('\n') +
          `\n`
          : '';
      const engineLine = stStats
        ? `• *Status Engine*: Helay *${stStats.received}* • Seen ✅ *${stStats.viewed}* • React 💚 *${srStats.reacted}* • Reply 💬 *${srStats.commented}*${stStats.viewFailed > 0 ? ` • Failed ❌ *${stStats.viewFailed}*` : ''}\n` +
        (stStats.readReceiptsPrivacy === 'none'
          ? `• ⚠️ *DIGNIIN*: Read Receipts Privacy taleefankaaga waa OFF — fur Settings > Privacy > Read Receipts!\n`
          : '')
        : '';

      const infoText =
        `🌟 *[CARDOSO AI — STATUS AI REACTOR & VIEWS]* 🌟\n\n` +
        lastStatusLine +
        engineLine +
        `• *Auto-View (Seen)*: ${this.whatsappManager.isAutoViewStatusEnabled() ? '✅ ON' : '🛑 OFF'}\n` +
        `• *Auto-React (Emoji)*: ${cfg.autoReact ? '✅ ON' : '🛑 OFF'}\n` +
        `• *Auto-Comment (AI)*: ${cfg.autoComment ? '✅ ON' : '🛑 OFF'}\n` +
        `• *Mode*: *${cfg.mode.toUpperCase()}*\n` +
        `• *Cooldown*: *${cfg.cooldownHours} Saacadood* qofkiiba\n` +
        `• *Delay Dabiici ah*: ${cfg.minDelaySeconds}s - ${cfg.maxDelaySeconds}s\n` +
        recentViewedBlock +
        `\n📋 *FALCELINNADII UGU DAMBEEYAY:*\n${recentSummary}\n\n` +
        `👁️ *Eeg cidda daawatay status-kaaga:* Qor \`!statusviews\`\n` +
        `_Amarrada maamulka:_ \`!statusviews\`, \`!statusreact on/off\`, \`!statuscomment on/off\`, \`!statusmode both/reaction/comment\`, \`!statuscooldown <hours>\``;

      await transport.sendMessage(message.chatId, infoText);
      return { handled: true, reason: 'Status info displayed' };
    }

    if (/^[!./#](?:status|post-status|sheeko)(?:[\s!./#]+([\s\S]+))?$/i.test(lowerText) && isAdminUser) {
      if (this.planGuard) {
        const check = this.planGuard.checkFeature('status_post');
        if (!check.allowed) {
          await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
          return { handled: true, reason: 'Status post gated by plan' };
        }
      }
      const match = text.match(/^[!./#](?:status|post-status|sheeko)(?:[\s!./#]+([\s\S]+))?$/i);
      let statusContent = (match?.[1] || '').trim();
      if (statusContent) {
        statusContent = statusContent.replace(/^[!./#]?(?:status(?:-ai)?|sheeko)\s*/i, '').trim();
      }

      // If media is attached (image, video, voice note / quoted podcast audio)
      if (message.media?.dataBase64) {
        const buffer = Buffer.from(message.media.dataBase64, 'base64');
        if (message.media.type === 'audio') {
          const res = await this.whatsappManager.postVoiceStatusSeries(buffer, {
            caption: statusContent || 'CARDOSO AI Voice Status',
          });
          await transport.sendMessage(message.chatId, res.message);
          return { handled: true, reason: `Voice status posted (${res.partsPosted} part(s))` };
        }
        const res = await this.whatsappManager.postMediaStatus({
          buffer,
          mimeType: message.media.mimeType,
          caption: statusContent,
          type: message.media.type === 'document' ? 'image' : message.media.type,
        });
        await transport.sendMessage(message.chatId, res.message);
        return { handled: true, reason: 'Media status posted' };
      }

      if (!statusContent) {
        await transport.sendMessage(
          message.chatId,
          'ℹ️ *[CARDOSO AI Status]*: Fadlan soo qor fariinta aad rabto inaad status-ka soo dhigto, tusaale:\n`!status Barasho wacan dhammaan ardayda Soomaaliyeed!`\n\nAma sawir / cod soo dir adigoo ku qoraya qoraalka `!status`.'
        );
        return { handled: true, reason: 'Status content missing' };
      }

      let customColor: string | undefined;
      let textToPost = statusContent;
      const colorMatch = statusContent.match(/^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s+([\s\S]+)$/);
      if (colorMatch) {
        customColor = colorMatch[1];
        textToPost = colorMatch[2].trim();
      }

      const res = await this.whatsappManager.postTextStatus(textToPost, {
        backgroundColor: customColor,
      });
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'Text status posted' };
    }

    // ─── 1g. Direct Reply & Person Messaging ("reply u gali karo qofka") ──────
    if (/^[!./#]?(?:reply|send)\s+([0-9+]+)\s+([\s\S]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:reply|send)\s+([0-9+]+)\s+([\s\S]+)$/i);
      const targetNumber = match![1].trim();
      const replyText = match![2].trim();

      let mediaToSend: OutgoingMedia | undefined;
      if (message.media?.dataBase64) {
        mediaToSend = {
          type: message.media.type === 'document' ? 'image' : (message.media.type as any),
          dataBuffer: Buffer.from(message.media.dataBase64, 'base64'),
          mimeType: message.media.mimeType,
          caption: replyText,
        };
      }

      const res = await this.whatsappManager.sendDirectReply(targetNumber, replyText, transport, { media: mediaToSend });
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'Direct reply sent to number' };
    }

    // Quoted reply in chat: !reply <fariin>
    if (/^[!./#]?reply\s+([\s\S]+)$/i.test(text) && isAdminUser && message.quotedParticipant) {
      const match = text.match(/^[!./#]?reply\s+([\s\S]+)$/i);
      const replyText = match![1].trim();
      const targetParticipant = message.quotedParticipant;
      const res = await this.whatsappManager.sendDirectReply(targetParticipant, replyText, transport, { replyToMessageId: message.quotedMessageId });
      await transport.sendMessage(message.chatId, `✅ Jawaabtaada si toos ah ayaa loogu celiyay @${targetParticipant.split('@')[0]}!`, {
        replyToMessageId: message.id,
      });
      return { handled: true, reason: 'Quoted participant reply sent' };
    }

    // Manage WhatsApp Broadcast Lists & trigger clean Broadcast List sends from Self-Chat:
    // - `!bc podcast [#1|all|Magac|listId] [Mawduuc 2m]` -> Sends Safa & Mohamed Podcast to 1 or ALL Broadcast Lists (ZERO raw command text seen by contacts!)
    // - `!bc cod [#1|all|Magac|listId] <qoraalkaaga>` -> Sends Mohamed Human Voice Note to 1 or ALL Broadcast Lists (ZERO raw command text seen by contacts!)
    if (/^[!./#]bc\s+(podcast|cod)(?:\s+([\s\S]+))?$/i.test(text) && isAdminUser) {
      const bcCmdMatch = text.match(/^[!./#]bc\s+(podcast|cod)(?:\s+([\s\S]+))?$/i);
      const subKind = bcCmdMatch![1].toLowerCase();
      let rest = (bcCmdMatch?.[2] || '').trim();
      const feedbackChatId = this.resolveOwnerFeedbackChatId(message, transport);

      if (this.whatsappManager.listBroadcastLists().length === 0) {
        await this.whatsappManager.syncAllBroadcastListsFromWhatsApp().catch(() => {});
      }

      // Optional explicit selector token: `all`/`dhammaan`, `#1`, `1763812345@broadcast`, or an exact custom list name
      let selector = '';
      let isAllLists = false;
      const firstTok = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/);
      if (firstTok) {
        const candidate = firstTok[1];
        const lowerCand = candidate.toLowerCase();
        if (/^(?:all|dhammaan|dhamman|kuli|kuligood)$/i.test(lowerCand)) {
          isAllLists = true;
          rest = (firstTok[2] || '').trim();
        } else if (
          candidate.includes('@broadcast') ||
          /^#\d{1,2}$/.test(candidate) ||
          /^\d{8,}$/.test(candidate)
        ) {
          selector = candidate;
          rest = (firstTok[2] || '').trim();
        } else {
          // Match existing WhatsApp or custom list name (supports BOTH 1-word and multi-word names like "Asxaabta VIP"!)
          const lowerRest = rest.toLowerCase();
          const namedLists = this.whatsappManager
            .listBroadcastLists()
            .filter(l => l.name && !l.name.endsWith('@broadcast'))
            .sort((a, b) => b.name.length - a.name.length);
          const matchedByName = namedLists.find(l => {
            const ln = l.name.toLowerCase();
            return lowerRest === ln || lowerRest.startsWith(`${ln} `);
          });
          if (matchedByName) {
            selector = matchedByName.id;
            rest = rest.slice(matchedByName.name.length).trim();
          }
        }
      }

      let targetChatId = '';
      if (isAllLists) {
        if (this.whatsappManager.listBroadcastLists().length === 0) {
          await transport.sendMessage(
            feedbackChatId,
            `📢 *Broadcast List lama helin weli!*\nMarka hore qor \`!bclist\` ama ku dar xubnaha liisaskaaga adigoo qoraya \`!bclist add <ID> 25263xxxxxxx, 25263yyyyyyy\`.`
          );
          return { handled: true, reason: 'No broadcast lists found for !bc all' };
        }
        targetChatId = WhatsAppManagerService.ALL_BROADCAST_LISTS_JID;
      } else {
        const targetList = this.whatsappManager.findBroadcastListTarget(selector);
        if (!targetList) {
          await transport.sendMessage(
            feedbackChatId,
            `📢 *Broadcast List lama helin weli!*\n` +
              `Hal mar ku dar liiskaaga adigoo qoraya:\n` +
              `\`!bclist add 1763812345@broadcast 25263xxxxxxx, 25263yyyyyyy\`\n` +
              `Ama fur Broadcast List-kaaga WhatsApp oo hal fariin gaaban (\`Salaam\`) dir si bot-ku si toos ah u qabto.`
          );
          return { handled: true, reason: 'No broadcast list found for !bc command' };
        }
        targetChatId = targetList.id;
      }

      // Delegate cleanly to the exact Broadcast List `!podcast` / `!cod` pipeline with targetChatId
      const syntheticMsg: IncomingMessage = {
        ...message,
        id: `${message.id}_bc_dispatch`,
        chatId: targetChatId,
        isGroup: false,
        isFromMe: true,
        content: rest ? `!${subKind} ${rest}` : `!${subKind}`,
      };
      return await this.processMessageInternal(syntheticMsg, transport);
    }

    // Manage WhatsApp Broadcast Lists: !bclist / !bclist name / !bclist sync / !bclist add [listId|#1] <numbers...>
    if (/^[!./#]bclist(?:\s+([\s\S]+))?$/i.test(text) && isAdminUser) {
      const bcMatch = text.match(/^[!./#]bclist(?:\s+([\s\S]+))?$/i);
      const arg = (bcMatch?.[1] || '').trim();
      const isBroadcastList = this.whatsappManager.isBroadcastListJid(message.chatId);
      const feedbackChatId = this.resolveOwnerFeedbackChatId(message, transport);

      if (/^(?:name|rename|magac)\s+([\s\S]+)$/i.test(arg)) {
        const nameRest = arg.replace(/^(?:name|rename|magac)\s+/i, '').trim();
        let targetSelector = isBroadcastList ? message.chatId : '';
        let newName = nameRest;

        if (!targetSelector) {
          const tokMatch = nameRest.match(/^(\S+)\s+([\s\S]+)$/);
          if (
            tokMatch &&
            (tokMatch[1].includes('@broadcast') ||
              /^#?\d{1,2}$/.test(tokMatch[1]) ||
              /^\d{6,}$/.test(tokMatch[1]) ||
              /^(?:last|latest|kan)$/i.test(tokMatch[1]))
          ) {
            targetSelector = tokMatch[1];
            newName = tokMatch[2].trim();
          } else {
            targetSelector = 'last';
          }
        }
        const renameRes = this.whatsappManager.renameBroadcastList(targetSelector, newName);
        await transport.sendMessage(feedbackChatId, renameRes.message);
        return { handled: true, reason: 'Broadcast list renamed' };
      }

      if (/^add\s+([\s\S]+)$/i.test(arg)) {
        const addRest = arg.replace(/^add\s+/i, '').trim();
        let targetList = isBroadcastList ? message.chatId : '';
        let numsBlock = addRest;

        if (!targetList) {
          const firstTokenMatch = addRest.match(/^(\S+)\s+([\s\S]+)$/);
          if (
            firstTokenMatch &&
            (firstTokenMatch[1].includes('@broadcast') ||
              /^#\d{1,2}$/.test(firstTokenMatch[1]) ||
              /^(?:last|latest|kan)$/i.test(firstTokenMatch[1]) ||
              /^\d{6,}$/.test(firstTokenMatch[1]))
          ) {
            targetList = firstTokenMatch[1];
            numsBlock = firstTokenMatch[2];
          } else {
            targetList = 'last';
          }
        } else {
          // If inside a Broadcast List and user still typed the list ID first, strip it cleanly
          const maybeSelfId = addRest.match(/^(\S+@broadcast)\s+([\s\S]+)$/i);
          if (maybeSelfId) {
            targetList = maybeSelfId[1];
            numsBlock = maybeSelfId[2];
          }
        }

        const rawNums = numsBlock
          .split(/[\s,;\n]+/)
          .map(s => s.trim())
          .filter(Boolean);
        const res = this.whatsappManager.addBroadcastListRecipients(targetList, rawNums);
        await transport.sendMessage(feedbackChatId, res.message);
        return { handled: true, reason: 'Broadcast list recipients updated' };
      }

      if (/^sync(?:\s+(\S+))?$/i.test(arg)) {
        const syncArg = arg.replace(/^sync/i, '').trim();
        const targetId = syncArg
          ? (syncArg.includes('@broadcast') ? syncArg : `${syncArg}@broadcast`)
          : (isBroadcastList ? message.chatId : (this.whatsappManager.listBroadcastLists()[0]?.id || ''));
        if (!targetId) {
          await transport.sendMessage(
            feedbackChatId,
            'ℹ️ Weli Broadcast List lama diiwaangelin. Fur Broadcast List-kaaga WhatsApp oo ku qor `!bclist sync` ama dir hal fariin gaaban.'
          );
          return { handled: true, reason: 'Broadcast list sync empty' };
        }
        const resolved = await this.whatsappManager.resolveBroadcastListRecipients(targetId, true);
        await transport.sendMessage(
          feedbackChatId,
          `🔄 *Broadcast List Sync:*\n📢 *Liiska:* ${resolved.name}\n🆔 *ID:* \`${resolved.id}\`\n👥 *Dadka la helay:* ${resolved.recipients.length} qof`
        );
        return { handled: true, reason: 'Broadcast list synced' };
      }

      if (isBroadcastList) {
        await this.whatsappManager.resolveBroadcastListRecipients(message.chatId, true);
      }
      const lists = this.whatsappManager.listBroadcastLists();
      if (lists.length === 0) {
        await transport.sendMessage(
          feedbackChatId,
          `📢 *[WHATSAPP BROADCAST LISTS (0)]*\n\n` +
            `Weli ma jiro Broadcast List kuu diiwaangashan.\n` +
            `• Fur Broadcast List-kaaga WhatsApp oo dir hal fariin gaaban (sida \`Salaam\`) si bot-ku si toos ah u qabto xubnaha, ama gudaha Broadcast List-ka ku qor:\n` +
            `\`!bclist add 25263xxxxxxx, 25263yyyyyyy\`\n` +
            `• Kadib toos u isticmaal \`!podcast ...\` iyo \`!cod <qoraalkaaga>\`!`
        );
      } else {
        const lines = lists.map(
          (l, idx) => `${idx + 1}. *${l.name}*\n   🆔 \`${l.id}\` · 👥 *${l.recipients.length} qof*`
        );
        await transport.sendMessage(
          feedbackChatId,
          `📢 *[WHATSAPP BROADCAST LISTS (${lists.length})]*\n\n` +
            lines.join('\n\n') +
            `\n\n💡 *Amarro Fudud (ka qor Self-Chat):*\n` +
            `• \`!bclist name #1 Ardayda\` — Magac u bixi liiska #1\n` +
            `• \`!bc podcast #1 <Mawduuc> 2m\` — Podcast u dir liiska #1\n` +
            `• \`!bc podcast all <Mawduuc> 2m\` — Podcast u wada dir DHAMMAAN liisaska\n` +
            `• \`!bc cod all <Qoraalkaaga>\` — Codka Mohamed u wada dir DHAMMAAN liisaska\n` +
            `• \`!bclist add #1 25263xxxxxxx, 25263yyyyyyy\` — Xubno ku dar liiska #1`
        );
      }
      return { handled: true, reason: 'Broadcast lists status displayed' };
    }

    // Send Mohamed's Human Voice Note directly inside a WhatsApp Broadcast List: !cod <qoraal>
    if (
      this.whatsappManager.isBroadcastListJid(message.chatId) &&
      isAdminUser &&
      /^[!./#]?cod(?:\s+([\s\S]+))?$/i.test(text)
    ) {
      const match = text.match(/^[!./#]?cod(?:\s+([\s\S]+))?$/i);
      const voiceText = (match?.[1] || message.quotedText || '').trim();
      const feedbackChatId = this.resolveOwnerFeedbackChatId(message, transport);

      if (!voiceText) {
        await transport.sendMessage(
          feedbackChatId,
          `🎙️ *Codka Broadcast List-ka:*\nGudaha Broadcast List-ka ku qor:\n\`!cod Salaan dhammaan asxaabta, caawa barnaamij cusub baa soo baxaya!\`\n\nWaxaa codka Mohamed toos loogu diri doonaa dhammaan dadka liiska ku jira! ✨`
        );
        return { handled: true, reason: 'Broadcast list voice help sent' };
      }

      try {
        const synthesized = await VoiceReplyService.synthesizeVoice(voiceText, 'so', {
          speaker: 'mohamed',
          humanMaster: true,
        });
        if (!synthesized || typeof transport.sendMedia !== 'function') {
          await transport.sendMessage(feedbackChatId, '⚠️ Codka Mohamed hadda lama samayn karin — mar kale isku day.');
          return { handled: true, reason: 'Broadcast list voice synthesis failed' };
        }

        const voiceMedia: OutgoingMedia = {
          type: 'audio',
          dataBuffer: synthesized.buffer,
          mimeType: synthesized.mimeType || 'audio/ogg; codecs=opus',
          ptt: true,
          seconds: synthesized.seconds,
          waveform: synthesized.waveform,
        };

        const dispatch = await this.dispatchMediaToBroadcastList(message.chatId, voiceMedia, transport);
        if (dispatch.total === 0) {
          if (feedbackChatId !== message.chatId) {
            await transport.sendMedia(feedbackChatId, voiceMedia);
          }
          await transport.sendMessage(
            feedbackChatId,
            this.buildEmptyBroadcastListNotice(message.chatId, 'Codka Mohamed')
          );
        } else {
          await transport.sendMessage(
            feedbackChatId,
            `📢 *CARDOSO AI — CODKA BROADCAST LIST* ✅\n` +
              `📋 *Liiska:* ${dispatch.listName}\n` +
              `🎙️ *Codka:* Mohamed (Human Voice Note)\n` +
              `📨 *Loo diray:* ${dispatch.delivered}/${dispatch.total} qof${dispatch.failed > 0 ? ` (${dispatch.failed} fashilmay)` : ''}\n` +
              `⏱️ *Dhererka:* ${synthesized.seconds}s`
          );
        }
        return {
          handled: true,
          reason: `Broadcast list voice note sent to ${dispatch.delivered}/${dispatch.total} recipients`,
        };
      } catch (err: any) {
        await transport.sendMessage(feedbackChatId, `❌ Cilad dirista codka Broadcast List: ${err?.message || err}`);
        return { handled: true, reason: 'Broadcast list voice error' };
      }
    }

    // Send Somali voice note directly to a number: !cod <number> <fariin>
    if (/^[!./#]?cod\s+([0-9+]+)\s+([\s\S]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?cod\s+([0-9+]+)\s+([\s\S]+)$/i);
      const targetNumber = match![1].trim();
      const voiceText = match![2].trim();
      const targetJid = this.whatsappManager.normalizeToJid(targetNumber);

      try {
        const synthesized = await VoiceReplyService.synthesizeVoice(voiceText, 'so', {
          speaker: 'mohamed',
          humanMaster: true,
        });
        if (synthesized && transport.sendMedia) {
          await transport.sendMedia(targetJid, {
            type: 'audio',
            dataBuffer: synthesized.buffer,
            mimeType: synthesized.mimeType || 'audio/ogg; codecs=opus',
            ptt: true,
            seconds: synthesized.seconds,
            waveform: synthesized.waveform,
          });
          await transport.sendMessage(message.chatId, `🎙️ Cod Soomaali ah (Mohamed) si guul leh ayaa loogu diray: *${targetJid}* (${synthesized.seconds}s)`);
        } else {
          await transport.sendMessage(targetJid, voiceText);
          await transport.sendMessage(message.chatId, `⚠️ Codka lama samayn karin, qoraal ahaan ayaa loogu diray ${targetJid}`);
        }
      } catch (err: any) {
        await transport.sendMessage(message.chatId, `❌ Cilad dirista codka: ${err.message}`);
      }
      return { handled: true, reason: 'Voice reply sent to number' };
    }

    // ─── 1h. Custom Auto-Replies Management ───────────────────────────────────
    if (/^[!./#]?autoreply\s+add\s+([^|\->]+)(?:\||->)\s*([\s\S]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?autoreply\s+add\s+([^|\->]+)(?:\||->)\s*([\s\S]+)$/i);
      const keyword = match![1].trim();
      const replyContent = match![2].trim();
      if (this.memory?.saveAutoReply) {
        await this.memory.saveAutoReply(keyword, replyContent, 'contains');
        await transport.sendMessage(message.chatId, `✅ *[Auto-Reply Added]*:\n• Ereyga (Keyword): *"${keyword}"*\n• Jawaabta: "${replyContent}"`);
      } else {
        await transport.sendMessage(message.chatId, '⚠️ Database-ka ma taageerayo auto-reply hadda.');
      }
      return { handled: true, reason: 'Auto-reply added' };
    }

    if (/^[!./#]?autoreply\s+(?:list|liis)$/i.test(lowerText.trim()) && isAdminUser) {
      if (this.memory?.getAutoReplies) {
        const list = await this.memory.getAutoReplies();
        if (list.length === 0) {
          await transport.sendMessage(message.chatId, 'ℹ️ Hadda ma jiraan auto-replies kuu kaydsan.\nKu dar adigoo qoraya:\n`!autoreply add salaan | Wcs walaal, ku soo dhawow!`');
        } else {
          let replyMsg = `📋 *[LIISKA AUTO-REPLIES (${list.length})]*\n\n`;
          for (const item of list) {
            replyMsg += `• *"${item.keyword}"* ➔ "${item.replyText}"\n`;
          }
          await transport.sendMessage(message.chatId, replyMsg);
        }
      }
      return { handled: true, reason: 'Auto-replies list displayed' };
    }

    if (/^[!./#]?autoreply\s+(?:delete|tirtir)\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?autoreply\s+(?:delete|tirtir)\s+(.+)$/i);
      const keyword = match![1].trim();
      if (this.memory?.deleteAutoReply) {
        const deleted = await this.memory.deleteAutoReply(keyword);
        await transport.sendMessage(message.chatId, deleted ? `✅ Auto-reply-gii ku xidhnaa *"${keyword}"* waa la tirtiray.` : `⚠️ Lama helin auto-reply ku xidhan *"${keyword}"*.`);
      }
      return { handled: true, reason: 'Auto-reply deleted' };
    }

    // ─── 1i. Group Management Commands (100% Full Control) ────────────────────
    if (/^[!./#]?(?:tagall|dhammaan)(?:\s+([\s\S]+))?$/i.test(lowerText) && isAdminUser) {
      if (!message.isGroup) {
        await transport.sendMessage(message.chatId, '⚠️ Amarkan waxaa loogu talagalay Groups-ka oo kaliya.');
        return { handled: true, reason: 'tagall not in group' };
      }
      const match = text.match(/^[!./#]?(?:tagall|dhammaan)(?:\s+([\s\S]+))?$/i);
      const customMsg = match?.[1]?.trim();
      const res = await this.whatsappManager.tagAll(message.chatId, customMsg);
      if (!res.success) {
        await transport.sendMessage(message.chatId, res.message);
      }
      return { handled: true, reason: 'tagall executed' };
    }

    if (/^[!./#]?(?:kick|ka-saar)(?:\s+(.+))?$/i.test(lowerText) && isAdminUser && message.isGroup) {
      const match = text.match(/^[!./#]?(?:kick|ka-saar)(?:\s+(.+))?$/i);
      const target = this.extractTargetParticipant(message, match?.[1]);
      if (!target) {
        await transport.sendMessage(
          message.chatId,
          'ℹ️ *[CARDOSO AI — KICK]*: Fadlan sheeg qofka aad saarayso:\n• Mention dheh: `!kick @user`\n• Lambar qor: `!kick 252634949642` ama `!kick 0634949642`\n• Ama fariintooda quote ku qabo oo qor: `!kick`'
        );
        return { handled: true, reason: 'kick target missing' };
      }
      const res = await this.whatsappManager.kickMember(message.chatId, target);
      await transport.sendMessage(message.chatId, res.message, {
        mentions: res.jid ? [res.jid] : undefined,
      });
      return { handled: true, reason: 'kick executed' };
    }

    if (/^[!./#]?(?:add|soo-geli|kudar|ku-dar)(?:\s+(.+))?$/i.test(lowerText) && isAdminUser && message.isGroup) {
      const match = text.match(/^[!./#]?(?:add|soo-geli|kudar|ku-dar)(?:\s+(.+))?$/i);
      const target = this.extractTargetParticipant(message, match?.[1]);
      if (!target) {
        await transport.sendMessage(
          message.chatId,
          'ℹ️ *[CARDOSO AI — ADD]*: Fadlan soo qor lambarka qofka aad ku darayso:\n• Tusaale: `!add 252634949642` ama `!add 0634949642` ama `!add @user`'
        );
        return { handled: true, reason: 'add member target missing' };
      }
      const res = await this.whatsappManager.addMember(message.chatId, target);
      if (res.success && res.jid) {
        const targetNum = res.jid.split('@')[0];
        const contactName = res.name || this.whatsappManager.getContactName(res.jid);
        const nameDisplay = contactName ? `${contactName} (@${targetNum})` : `@${targetNum}`;

        const welcomeMessage =
          `🎉✨ *Soo dhawoow walaal ${nameDisplay}!* ✨🎉\n\n` +
          `Ku soo dhawow group\n` +
          `Haddii aad qabto su'aal bot-ka ayaad weydiin kartaa mar kasta. Ku soo dhawow mar labaad gacmo furan! 🤝💫`;
        await transport.sendMessage(message.chatId, welcomeMessage, {
          mentions: [res.jid],
        });
      } else {
        await transport.sendMessage(message.chatId, res.message);
      }
      return { handled: true, reason: 'add member executed' };
    }

    if (/^[!./#]?(?:promote|dalacsii)(?:\s+(.+))?$/i.test(lowerText) && isAdminUser && message.isGroup) {
      const match = text.match(/^[!./#]?(?:promote|dalacsii)(?:\s+(.+))?$/i);
      const target = this.extractTargetParticipant(message, match?.[1]);
      if (!target) {
        await transport.sendMessage(message.chatId, 'ℹ️ Fadlan quote ku qabo qofka ama qor lambarkiisa: `!promote @user` ama `!promote 252634949642`');
        return { handled: true, reason: 'promote target missing' };
      }
      const res = await this.whatsappManager.promoteMember(message.chatId, target);
      await transport.sendMessage(message.chatId, res.message, {
        mentions: res.jid ? [res.jid] : undefined,
      });
      return { handled: true, reason: 'promote executed' };
    }

    if (/^[!./#]?(?:demote|hoos-u-dhig)(?:\s+(.+))?$/i.test(lowerText) && isAdminUser && message.isGroup) {
      const match = text.match(/^[!./#]?(?:demote|hoos-u-dhig)(?:\s+(.+))?$/i);
      const target = this.extractTargetParticipant(message, match?.[1]);
      if (!target) {
        await transport.sendMessage(message.chatId, 'ℹ️ Fadlan quote ku qabo qofka ama qor lambarkiisa: `!demote @user` ama `!demote 252634949642`');
        return { handled: true, reason: 'demote target missing' };
      }
      const res = await this.whatsappManager.demoteMember(message.chatId, target);
      await transport.sendMessage(message.chatId, res.message, {
        mentions: res.jid ? [res.jid] : undefined,
      });
      return { handled: true, reason: 'demote executed' };
    }

    if (/^[!./#]?(?:mute|xidh)$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await this.whatsappManager.setGroupMute(message.chatId, true);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'group mute executed' };
    }

    if (/^[!./#]?(?:unmute|fur)$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await this.whatsappManager.setGroupMute(message.chatId, false);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'group unmute executed' };
    }

    if (/^[!./#]?(?:grouplink|link)$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await this.whatsappManager.getGroupInviteLink(message.chatId);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'grouplink executed' };
    }

    if (/^[!./#]?groupinfo$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await this.whatsappManager.getGroupInfo(message.chatId);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'groupinfo executed' };
    }

    // ─── 1j. Profile & Account Management Commands ────────────────────────────
    if (/^[!./#]?setname\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?setname\s+(.+)$/i);
      const newName = match![1].trim();
      const res = await this.whatsappManager.updateProfileName(newName);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'setname executed' };
    }

    if (/^[!./#]?(?:setbio|setstatus)\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:setbio|setstatus)\s+(.+)$/i);
      const newBio = match![1].trim();
      const res = await this.whatsappManager.updateProfileBio(newBio);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'setbio executed' };
    }

    if (/^[!./#]?(?:setpp|setpfp)$/i.test(lowerText.trim()) && isAdminUser) {
      if (message.media?.type === 'image' && message.media.dataBase64) {
        const buffer = Buffer.from(message.media.dataBase64, 'base64');
        const res = await this.whatsappManager.updateProfilePicture(buffer);
        await transport.sendMessage(message.chatId, res.message);
      } else {
        await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sawir soo dir adigoo qoraal ahaan ku soo raacinaya `!setpp`');
      }
      return { handled: true, reason: 'setpp executed' };
    }

    if (/^[!./#]?block\s+([0-9+]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?block\s+([0-9+]+)$/i);
      const target = match![1].trim();
      const res = await this.whatsappManager.blockUser(target);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'block executed' };
    }

    if (/^[!./#]?unblock\s+([0-9+]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?unblock\s+([0-9+]+)$/i);
      const target = match![1].trim();
      const res = await this.whatsappManager.unblockUser(target);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'unblock executed' };
    }

    // ─── Call Reject Management (!reject all, !reject <number>, !unreject all, !unreject <number>) ───
    if (/^[!./#]?(?:reject|xidh[-_\s]*calls?)\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:reject|xidh[-_\s]*calls?)\s+(.+)$/i);
      const target = match![1].trim();
      let res: { success: boolean; message: string };
      if (/^(?:all|dhammaan|dhamaan|kulligood)$/i.test(target)) {
        res = this.whatsappManager.setRejectAllCalls(true);
      } else {
        res = this.whatsappManager.rejectCallNumber(target);
      }
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'reject executed' };
    }

    if (/^[!./#]?(?:unreject|inreject|fur[-_\s]*calls?)\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:unreject|inreject|fur[-_\s]*calls?)\s+(.+)$/i);
      const target = match![1].trim();
      let res: { success: boolean; message: string };
      if (/^(?:all|dhammaan|dhamaan|kulligood)$/i.test(target)) {
        res = this.whatsappManager.unrejectAllCalls();
      } else {
        res = this.whatsappManager.unrejectCallNumber(target);
      }
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'unreject executed' };
    }

    // ─── AI Master Toggle & Per-Number Silence (!on / !off / !off <number> / !on <number>) ───
    if (/^[!./#]?(?:ai\s+)?(on|off)(?:\s+(.+))?$/i.test(lowerText.trim()) && isAdminUser) {
      if (!/^(?:view|autoview|statusreact|statuscomment|link|linkmode|link-mode)\b/i.test(lowerText.trim())) {
        const match = lowerText.trim().match(/^[!./#]?(?:ai\s+)?(on|off)(?:\s+(.+))?$/i);
        if (match) {
          const action = match[1].toLowerCase();
          const arg = (match[2] || '').trim();

          // 1. List currently disabled numbers: !off list / !off status
          if (/^(?:list|liis|all|status)$/i.test(arg)) {
            const list = this.whatsappManager.getDisabledAINumbers();
            if (list.length === 0) {
              await transport.sendMessage(
                message.chatId,
                `📋 *[Liiska Lambarrada AI-gu ka Xidhan yahay]*\n\nMa jiro lambar gaar ah oo AI-gu hadda ka xidhan yahay.`
              );
            } else {
              const lines = list.map((num, i) => `${i + 1}. 👤 +${num}`);
              await transport.sendMessage(
                message.chatId,
                `📋 *[Liiska Lambarrada AI-gu ka Xidhan yahay]* (${list.length} qof)\n\n` +
                lines.join('\n') +
                `\n\n💡 Si aad qof ugu furto qor: \`!on <lambar>\``
              );
            }
            return { handled: true, reason: `AI disabled numbers list` };
          }

          // 2. Specific Number target: provided in argument OR quoted message
          let targetPhone = '';
          if (arg) {
            const numMatch = arg.match(/\b(?:25\d{7,12}|06\d{7,8}|\+?25\d{7,12})\b/);
            if (numMatch) {
              targetPhone = numMatch[0];
            } else if (arg.replace(/\D/g, '').length >= 7) {
              targetPhone = arg.replace(/\D/g, '');
            }
          } else if (message.quotedParticipant) {
            targetPhone = message.quotedParticipant;
          }

          if (targetPhone) {
            if (action === 'off') {
              const res = this.whatsappManager.disableAIForNumber(targetPhone);
              await transport.sendMessage(message.chatId, res.message);
              return { handled: true, reason: `Disabled AI for ${res.phone}` };
            } else {
              const res = this.whatsappManager.enableAIForNumber(targetPhone);
              await transport.sendMessage(message.chatId, res.message);
              return { handled: true, reason: `Enabled AI for ${res.phone}` };
            }
          }

          // 3. Global AI Toggle (no number provided and not quoting someone)
          if (!arg && !message.quotedParticipant) {
            const res = this.whatsappManager.setAIEnabled(action === 'on');
            await transport.sendMessage(message.chatId, res.message);
            return { handled: true, reason: `AI master toggle: ${action}` };
          }
        }
      }
    }

    // ─── Status Link Campaign Mode (!link on / !link off / !link set / !link info) ───
    if (/^[!./#]?(?:link|linkmode|link-mode)(?:\s+(on|off|set|setup|flyer|info))?(?:\s+([\s\S]+))?$/i.test(lowerText.trim()) && isAdminUser && !message.isGroup) {
      const match = lowerText.trim().match(/^[!./#]?(?:link|linkmode|link-mode)(?:\s+(on|off|set|setup|flyer|info))?(?:\s+([\s\S]+))?$/i);
      const action = (match?.[1] || '').toLowerCase();
      const extraArgs = match?.[2]?.trim() || '';

      if (action === 'off') {
        const res = this.whatsappManager.setLinkCampaignMode(false);
        this.whatsappManager.setAwaitingOwnerPromoSetup(false);
        await transport.sendMessage(message.chatId, res.message);
        return { handled: true, reason: 'Link campaign toggle: off' };
      }

      if (action === 'set' || action === 'setup' || action === 'flyer') {
        const isMediaAttached = Boolean(
          (message.media?.type === 'image' || (message as any).media?.type === 'document') &&
          (message.media?.dataBase64 || (message.media as any)?.dataBuffer)
        );
        const linkMatch = (extraArgs + ' ' + text).match(/(?:https?:\/\/)?(?:wa\.me\/\S+|api\.whatsapp\.com\/\S+|chat\.whatsapp\.com\/\S+|https?:\/\/\S+)/i);
        let detectedLink = linkMatch ? linkMatch[0] : '';
        if (!detectedLink) {
          const rawNumMatch = (extraArgs + ' ' + text).match(/\b(?:25\d{7,12}|06\d{7,8})\b/);
          if (rawNumMatch) {
            const cleanNum = rawNumMatch[0].startsWith('0') ? '252' + rawNumMatch[0].substring(1) : rawNumMatch[0];
            detectedLink = `https://wa.me/${cleanNum}`;
          }
        }

        if (isMediaAttached || detectedLink) {
          let imageBuffer: Buffer | undefined;
          let mimeType: string | undefined;
          if (message.media?.dataBase64) {
            imageBuffer = Buffer.from(message.media.dataBase64, 'base64');
            mimeType = message.media.mimeType;
          } else if ((message.media as any)?.dataBuffer) {
            imageBuffer = (message.media as any).dataBuffer;
            mimeType = message.media?.mimeType;
          }
          const botPhone = (this.whatsappManager.getBotNumber() || message.chatId).replace(/\D/g, '');
          const finalLink = detectedLink || (botPhone ? `https://wa.me/${botPhone}` : '');

          const res = this.whatsappManager.setOwnerPromo({
            link: finalLink,
            imageBuffer,
            mimeType,
          });
          await transport.sendMessage(message.chatId, res.message);
          return { handled: true, reason: 'Owner promo flyer and link saved' };
        } else {
          this.whatsappManager.setAwaitingOwnerPromoSetup(true);
          await transport.sendMessage(
            message.chatId,
            '📸 *[Setup-ka Sawirka iyo Link-ga]*:\n\nFadlan iisoo dir *Sawirkaaga (Flyer)* iyo *Link-gaaga WhatsApp (wa.me)* ee aad rabto in dadka lagula wadaago, si aan u kaydiyo! 📲✨\n_(Haddii aad rabto inaad joojiso qor: !cancel)_'
          );
          return { handled: true, reason: 'Awaiting owner promo setup' };
        }
      }

      if (action === 'on') {
        this.whatsappManager.setLinkCampaignMode(true);
        this.whatsappManager.setAutoViewStatus(true);
        if (!this.whatsappManager.hasOwnerPromo()) {
          this.whatsappManager.setAwaitingOwnerPromoSetup(true);
          const promptMsg =
            `✅ *[Status Link Campaign Mode: ON]* 🔗✨\n\n` +
            `⚠️ *Ogeysiis:* Ma jiro sawir ama link xayeysiin ah oo kuu kaydsan.\n` +
            `Fadlan hadda iisoo dir *Sawirkaaga (Flyer)* iyo *Link-gaaga WhatsApp (wa.me)* si aan u kaydiyo oo aan ugu celiyo qof kasta oo link status laguu dhigo dhaha! 📲✨\n\n` +
            `_(Haddii aad rabto inaad hadhow dejiso, qor: \`!link set\`)_`;
          await transport.sendMessage(message.chatId, promptMsg);
          return { handled: true, reason: 'Link campaign enabled, prompting for owner promo' };
        } else {
          const promo = this.whatsappManager.getOwnerPromo();
          const confirmMsg =
            `✅ *[Status Link Campaign Mode: ON]* 🔗✨\n\n` +
            `📌 *Link-gaaga Diyaar ah:* ${promo.link}\n` +
            `🖼️ *Sawirka Flyer:* ${promo.imageBuffer ? 'Waa kaydsan yahay ✅' : 'Kuma lifaaqsana (Qoraal kaliya) 📝'}\n\n` +
            `Dadka soo dira link (ama dhaha "link isoo dhig") status ayaa loo dhigi doonaa waxaana loo diri doonaa flyer-kaaga iyo link-gaaga si ay iyaguna status-kooda kuugu dhigaan.\n\n` +
            `💡 Haddii aad rabto inaad cusboonaysiiso, qor \`!link set\`.`;
          await transport.sendMessage(message.chatId, confirmMsg);
          return { handled: true, reason: 'Link campaign enabled with existing promo' };
        }
      }

      // If just '!link' or '!link info' in private chat:
      const isEnabled = this.whatsappManager.isLinkCampaignMode();
      const promo = this.whatsappManager.getOwnerPromo();
      const infoMsg =
        `📊 *[XOGTA STATUS LINK CAMPAIGN]* 🔗\n\n` +
        `• Xaaladda: ${isEnabled ? '*DAARNAN (ON)* ✅' : '*DAMSAN (OFF)* ❌'}\n` +
        `• Link-ga Milkiilaha: ${promo.link ? promo.link : '_Lama gelin_'}\n` +
        `• Sawirka Flyer-ka: ${promo.imageBuffer ? 'Kaydsan yahay ✅' : 'Ma jiro ❌'}\n\n` +
        `💡 Amarada:\n` +
        `• \`!link on\` — Daaro Campaign Mode (Is-dhaafsi status)\n` +
        `• \`!link off\` — Dami Campaign Mode\n` +
        `• \`!link set\` — Deji sawirka iyo link-gaaga xayeysiinta`;
      await transport.sendMessage(message.chatId, infoMsg);
      return { handled: true, reason: 'Link campaign info' };
    }

    // ─── Manual Contact Save Command (!save <number> <name> or !save <name> when quoting) ───
    if (/^[!./#]?(?:save|kaydi|addcontact)\b/i.test(lowerText) && isAdminUser) {
      const parts = text.replace(/^[!./#]?(?:save|kaydi|addcontact)\s*/i, '').trim();
      let targetJid = '';
      let targetName = '';

      if (message.quotedParticipant) {
        targetJid = message.quotedParticipant;
        targetName = parts || 'Walaal';
      } else {
        const match = parts.match(/^(\+?[0-9]{7,15})\s+(.+)$/);
        if (match) {
          targetJid = match[1];
          targetName = match[2].trim();
        } else if (parts) {
          targetName = parts;
          targetJid = message.chatId;
        }
      }

      if (targetJid && targetName) {
        const res = await this.whatsappManager.saveContact(targetJid, targetName);
        await transport.sendMessage(
          message.chatId,
          `✅ Qofka *${res.name}* (${res.phone ? '+' + res.phone : targetJid}) si toos ah ayaa loogu daray contacts-kaaga WhatsApp-ka! 📲`
        );
        return { handled: true, reason: 'contact manually saved' };
      }
    }

    // ─── Status Deletion (Delete for everyone) ───
    const statusDeletePattern = /^[!./#]?(?:deletet?statuse?|delete[-_\s]+statuse?|tirtir[-_\s]*statuse?|statuse?[-_\s]*delete)(?:\s+(.+))?$/i;
    if (statusDeletePattern.test(lowerText) && isAdminUser) {
      const match = text.match(statusDeletePattern);
      const rawTarget = match?.[1]?.trim() || message.quotedMessageId;
      let res: { success: boolean; message: string };
      if (rawTarget && /^(?:all|dhammaan|dhamaan|kulligood|dhamman)$/i.test(rawTarget)) {
        res = await this.whatsappManager.deleteAllStatuses();
      } else if (rawTarget) {
        res = await this.whatsappManager.deleteStatusById(rawTarget);
      } else {
        res = await this.whatsappManager.deleteLastStatus();
      }
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'delete status executed' };
    }

    if (/^[!./#]?(?:delete|tirtir)$/i.test(lowerText.trim()) && isAdminUser && message.quotedMessageId) {
      // If quoting a status story or message from status@broadcast
      if (message.quotedParticipant === 'status@broadcast' || message.isStoryReply) {
        const res = await this.whatsappManager.deleteStatusById(message.quotedMessageId);
        await transport.sendMessage(message.chatId, res.message);
        return { handled: true, reason: 'delete status executed' };
      }

      if (transport.deleteMessage) {
        await transport.deleteMessage(message.chatId, message.quotedMessageId, message.quotedParticipant);
        await transport.sendMessage(message.chatId, '🗑️ Fariintii waa la tirtiray.');
      } else {
        await transport.sendMessage(message.chatId, '⚠️ Transport-ku ma taageerayo tirtiridda fariimaha.');
      }
      return { handled: true, reason: 'delete executed' };
    }

    if (/^[!./#]?react\s+(.+)$/i.test(text) && isAdminUser && message.quotedMessageId) {
      const match = text.match(/^[!./#]?react\s+(.+)$/i);
      const emoji = match![1].trim();
      if (transport.reactToMessage) {
        await transport.reactToMessage(message.chatId, message.quotedMessageId, emoji, message.quotedParticipant);
      }
      return { handled: true, reason: 'react executed' };
    }

    // ─── 1k-pre. `!info` / `!errors` are admin-only (explicit prefix required so normal "info" chat is untouched) ──
    if (/^[!./#](?:info|botinfo|errors?|khalad(?:aad)?|health)\b/i.test(lowerText) && !isAdminUser) {
      console.log(`⛔ [Security Block] Unauthorized user (${message.senderId}) tried to execute admin command "${text}" in ${message.chatId}`);
      if (!message.isGroup) {
        await transport.sendMessage(
          message.chatId,
          '⛔ *[CARDOSO AI — AMNI]*: Amarkan waxaa isticmaali kara oo kaliya Mulkiilaha WhatsApp-ka (Admin-ka). Fadlan adigu su\'aalahaaga caadiga ah i weydii! 😊'
        );
      }
      return { handled: true, reason: 'Unauthorized admin command blocked' };
    }

    // ─── 1k. Security Guard: Reject any management/admin command from unauthorized users ──
    if (
      /^[!./#]?(?:view|status|post-status|sheeko|status-ai|deletet?status|tirtirstatus|statusdelete|autoview|statusreact|statuscomment|statusmode|statuscooldown|statusinfo|statusviews|statusviewers|daawadeyaasha|daawadayaasha|tagall|dhammaan|kick|ka-saar|promote|dalacsii|demote|hoos-u-dhig|mute|xidh|unmute|fur|grouplink|link|linkmode|link-mode|groupinfo|setname|setbio|setstatus|setpp|setpfp|block|unblock|reject|unreject|inreject|autoreply|delete|tirtir|reply|send|cod|maamul|on|off)\b/i.test(lowerText) &&
      !isAdminUser
    ) {
      console.log(`⛔ [Security Block] Unauthorized user (${message.senderId}) tried to execute admin command "${text}" in ${message.chatId}`);
      if (!message.isGroup) {
        await transport.sendMessage(
          message.chatId,
          '⛔ *[CARDOSO AI — AMNI]*: Amarkan waxaa isticmaali kara oo kaliya Mulkiilaha WhatsApp-ka (Admin-ka). Fadlan adigu su\'aalahaaga caadiga ah i weydii! 😊'
        );
      }
      return { handled: true, reason: 'Unauthorized admin command blocked' };
    }

    // 1d. Handle incoming contacts document (.vcf, .csv, .txt) sent by admin
    if (message.media?.type === 'document' && isAdminUser && message.media.dataBase64) {
      const fileName = (message.media.fileName || '').toLowerCase();
      const mime = (message.media.mimeType || '').toLowerCase();
      if (
        fileName.endsWith('.vcf') ||
        fileName.endsWith('.txt') ||
        fileName.endsWith('.csv') ||
        mime.includes('vcard') ||
        mime.includes('text/plain') ||
        mime.includes('text/csv')
      ) {
        try {
          const content = Buffer.from(message.media.dataBase64, 'base64').toString('utf8');
          const result = this.broadcast.importFromText(content);
          const stats = this.broadcast.getStats();
          await transport.sendMessage(
            message.chatId,
            `🎉 *[CARDOSO AI — CONTACTS IMPORT]*\n\nFaylka *${message.media.fileName || 'Contacts'}* si buuxda ayaa loo akhriyay!\n• Waxaa laga helay: *${result.totalParsed} contacts*\n• Waxaa cusub oo lagu daray: *${result.added} qof*\n• Wadarta Guud ee Bot-ka: *${stats.total} qof*\n\nHadda waxaad diyaar u tahay inaad fariin u dirto:\n\`!fariin <fariintaada>\``
          );
          return { handled: true, reason: 'Contacts file imported via document' };
        } catch (err: any) {
          console.warn('[Router] Failed importing document contacts:', err.message);
        }
      }
    }

    // 2. Broadcast Confirmation Handling (HAA / MAYA)
    if (this.broadcast.hasPendingDraft(message.chatId)) {
      const cleanReply = lowerText.trim();
      if (/^(?:haa|ha|yes|y|bilaaw|bilaab)$/i.test(cleanReply)) {
        if (this.planGuard) {
          const check = this.planGuard.checkFeature('broadcast');
          if (!check.allowed) {
            await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
            return { handled: true, reason: 'Broadcast gated by plan' };
          }
        }
        const ok = await this.broadcast.confirmDraft(message.chatId, transport);
        if (ok) this.planGuard?.recordUsage('broadcast');
        return { handled: true, reason: 'Broadcast confirmed and started' };
      }
      if (/^(?:maya|may|no|n|baaji|cancel)$/i.test(cleanReply)) {
        this.broadcast.cancelDraft(message.chatId);
        await transport.sendMessage(message.chatId, '🛑 *[CARDOSO AI]*: Fariin-wadareedkii waa la baajiyay.');
        return { handled: true, reason: 'Broadcast cancelled' };
      }
    }

    // 2b. Broadcast Abort Command (!jooji)
    if (/^!(?:jooji|stop-broadcast|cancel-broadcast)$/i.test(lowerText.trim()) && isAdminUser) {
      const aborted = this.broadcast.abortBroadcast();
      if (aborted) {
        await transport.sendMessage(message.chatId, '🛑 *[CARDOSO AI]*: Waxaa la diray amarka joojinta fariin-wadareedka. Way is-taagaysaa isla markiiba.');
      } else {
        await transport.sendMessage(message.chatId, 'ℹ️ Hadda ma jirto fariin-wadareed socota.');
      }
      return { handled: true, reason: 'Broadcast abort command' };
    }

    // 2c. Broadcast Query Contacts Command (!contacts / !liis)
    if (/^!(?:contacts|liis|xiriir)$/i.test(lowerText.trim()) && isAdminUser) {
      const stats = this.broadcast.getStats();
      const limitStr = stats.dailyLimit > 0 ? `${stats.sentToday}/${stats.dailyLimit}` : `${stats.sentToday} (Xad la'aan)`;
      await transport.sendMessage(
        message.chatId,
        `📋 *[CARDOSO AI Contacts & Broadcast]*:\n• Wadarta Contacts-ka: *${stats.total} qof*\n• Magac leh: *${stats.withNames} qof* | Magac la'aan: *${stats.total - stats.withNames} qof*\n• Fariinta Horey loo Gaarsiiyay: *${stats.sent} qof*\n• Hadhay (Aan wali helin): *${stats.remaining} qof*\n• Maanta (24h): *${limitStr}*\n• Ka baxay (Opt-out): *${stats.optedOut} qof*\n\nSi aad ilaa 50 qof oo cusub ugu dirto, qor:\n\`!fariin <fariintaada>\`\n\nHaddii aad doonayso inaad dib uga bilowdo dhamaan, qor:\n\`!fariin reset\``
      );
      return { handled: true, reason: 'Contacts query' };
    }

    // 2d. Broadcast Test Command (!broadcast-test)
    if (/^!(?:broadcast-test|fariin-test)\s+/i.test(lowerText) && isAdminUser) {
      const sampleText = text.replace(/^!(?:broadcast-test|fariin-test)\s+/i, '');
      const personalized = this.broadcast.formatPersonalizedMessage(sampleText, message.senderName || 'Saaxiib');
      await transport.sendMessage(
        message.chatId,
        `🧪 *[CARDOSO AI Broadcast Test Preview]*:\n\nSidan ayay u gaadhi doontaa qofka:\n"${personalized}"\n\nHaddii ay ku qanciso, u dir dhammaan adigoo isticmaalaya:\n\`!fariin ${sampleText}\``
      );
      return { handled: true, reason: 'Broadcast test preview' };
    }

    // 2e. Broadcast Reset Command (!fariin reset / !broadcast reset)
    if (/^!(?:broadcast|fariin)\s+reset$/i.test(lowerText.trim()) && isAdminUser) {
      await this.broadcast.resetSentHistory();
      await transport.sendMessage(
        message.chatId,
        '🔄 *[CARDOSO AI]*: Liiskii dadka fariinta loo diray waa la nadiifiyay! Hadda waxaad dib ugu bilaabi kartaa fariin cusub dhammaan contacts-ka.'
      );
      return { handled: true, reason: 'Broadcast history reset' };
    }

    // 2f. Broadcast Stats Command (!fariin stats / !broadcast stats)
    if (/^!(?:broadcast|fariin)\s+(?:stats|status)$/i.test(lowerText.trim()) && isAdminUser) {
      const stats = this.broadcast.getStats();
      await transport.sendMessage(
        message.chatId,
        `📊 *[CARDOSO AI Smart Broadcast Xogteeda]*:\n• Wadarta Contacts-ka: *${stats.total} qof*\n• Horey loo Gaarsiiyay: *${stats.sent} qof*\n• Hadhay (Aan wali helin): *${stats.remaining} qof*`
      );
      return { handled: true, reason: 'Broadcast stats' };
    }

    // 2g. Manual Contacts Import Command (!dar / !add)
    if (/^!(?:dar|add|kudar)\s+/i.test(lowerText) && isAdminUser) {
      const numbersRaw = text.replace(/^!(?:dar|add|kudar)\s+/i, '');
      const addedCount = this.broadcast.addManualNumbers(numbersRaw);
      const stats = this.broadcast.getStats();
      await transport.sendMessage(
        message.chatId,
        `✅ *[CARDOSO AI]*: Waxaa si guul leh loogu daray *${addedCount} lambar* oo cusub!\nWadarta contacts-ka hadda waa *${stats.total} qof*.\n\nSi aad fariin ugu dirto, qor:\n\`!fariin <fariintaada>\``
      );
      return { handled: true, reason: 'Manual numbers added' };
    }

    // 2h. Check and auto-import contacts files (!shub / !import)
    if (/^!(?:shub|import|load-contacts)$/i.test(lowerText.trim()) && isAdminUser) {
      const imported = await this.broadcast.checkAndAutoImportFiles();
      const stats = this.broadcast.getStats();
      await transport.sendMessage(
        message.chatId,
        `📋 *[CARDOSO AI — IMPORT]*\nWaxaa faylasha laga soo galiyay *${imported} contacts* oo cusub!\nWadarta guud ee hadda ku jirta: *${stats.total} qof*.\n\nHaddii aad haysato faylka VCF ee taleefanka (2,384 contacts), waxaad toos ugu soo diri kartaa halkan chat-ka dukumenti ahaan!`
      );
      return { handled: true, reason: 'Contacts auto-import triggered' };
    }

    // 2i-barasho. Smart Barasho Command (!barasho [Magacaaga]) — sends tailored intro for named vs unnamed contacts
    if (/^!barasho(?:\s+(.+))?$/i.test(lowerText) && isAdminUser) {
      if (this.planGuard) {
        const check = this.planGuard.checkFeature('broadcast');
        if (!check.allowed) {
          await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
          return { handled: true, reason: 'Broadcast gated by plan' };
        }
      }
      const match = text.match(/^!barasho(?:\s+(.+))?$/i);
      const ownerName = (match?.[1] || '').trim() || 'Maxamed';
      const result = await this.broadcast.startBarashoBroadcast(message.chatId, transport, 50, ownerName);
      if (result.success) this.planGuard?.recordUsage('broadcast');
      await transport.sendMessage(message.chatId, result.message);
      return { handled: true, reason: 'Barasho broadcast initiated' };
    }

    // 2i. Direct Broadcast Command (!broadcast / !fariin) — sends to the next 50 uncontacted contacts immediately!
    if (/^!(?:broadcast|fariin)(?:\s+|[:,-]\s*)/i.test(lowerText) && isAdminUser) {
      if (this.planGuard) {
        const check = this.planGuard.checkFeature('broadcast');
        if (!check.allowed) {
          await transport.sendMessage(message.chatId, `⛔ *[CARDOSO AI — PLAN]*: ${check.reason}`);
          return { handled: true, reason: 'Broadcast gated by plan' };
        }
      }
      const broadcastContent = text.replace(/^!(?:broadcast|fariin)(?:\s+|[:,-]\s*)/i, '');
      const result = await this.broadcast.startDirectBroadcast(message.chatId, broadcastContent, transport, 50);
      if (result.success) this.planGuard?.recordUsage('broadcast');
      await transport.sendMessage(message.chatId, result.message);
      return { handled: true, reason: 'Direct broadcast initiated' };
    }

    // 2j. Guard: never let !fariin / !barasho / !broadcast fall through to Gemini AI (where AI might reply "waa la kaydiyay")
    if (/^!(?:broadcast|fariin|barasho|contacts|liis|jooji|dar|shub)\b/i.test(lowerText)) {
      if (!isAdminUser) {
        await transport.sendMessage(message.chatId, '⛔ *[CARDOSO AI]*: Amarkan waxaa isticmaali kara Admin-ka oo keliya.');
      } else {
        await transport.sendMessage(
          message.chatId,
          'ℹ️ *[CARDOSO AI]*: Fadlan qor fariinta ka dib `!fariin`, tusaale:\n`!fariin Salaan dhammaan, waxaan haynaa ogeysiis.`'
        );
      }
      return { handled: true, reason: 'Broadcast command fallback guard' };
    }

    // 2f. Admin System Commands Handling (!admin on/off/stats)
    if (
      lowerText.startsWith('!cardoso') ||
      lowerText.startsWith('!admin') ||
      lowerText.startsWith(this.config.messaging.prefix.toLowerCase())
    ) {
      const parts = text.split(/\s+/);
      const command = (parts[1] || '').toLowerCase();

      if (command === 'off' && isAdminUser) {
        if (message.isGroup) {
          this.inactiveGroups.add(message.chatId);
          await transport.sendMessage(message.chatId, '🛑 *[CARDOSO AI Admin]*: Bot has been turned OFF for this group by admin.', {
            replyToMessageId: message.id,
          });
        } else {
          this.isBotActiveGlobally = false;
          await transport.sendMessage(message.chatId, '🛑 *[CARDOSO AI Admin]*: Bot has been turned OFF globally.', {
            replyToMessageId: message.id,
          });
        }
        return { handled: true, reason: 'Admin turned bot off' };
      }

      if (command === 'on' && isAdminUser) {
        if (message.isGroup) {
          this.inactiveGroups.delete(message.chatId);
          await transport.sendMessage(message.chatId, '🟢 *[CARDOSO AI Admin]*: Bot is now ACTIVE for this group.', {
            replyToMessageId: message.id,
          });
        } else {
          this.isBotActiveGlobally = true;
          await transport.sendMessage(message.chatId, '🟢 *[CARDOSO AI Admin]*: Bot is now ACTIVE globally.', {
            replyToMessageId: message.id,
          });
        }
        return { handled: true, reason: 'Admin turned bot on' };
      }

      if (command === 'stats' && isAdminUser) {
        await transport.sendMessage(message.chatId, `📊 *[CARDOSO AI Status]*: Active=${this.isBotActiveGlobally}, Mode=${this.config.messaging.mode}`, {
          replyToMessageId: message.id,
        });
        return { handled: true, reason: 'Admin stats query' };
      }
    }

    // 3. Global & Group Activation Check
    if (!this.isBotActiveGlobally) {
      return { handled: false, reason: 'Bot is disabled globally' };
    }

    // Never fall through to Gemini Q&A for unrecognized messages inside a WhatsApp Broadcast List
    if (this.whatsappManager.isBroadcastListJid(message.chatId)) {
      return { handled: false, reason: 'Broadcast list message without broadcast command ignored' };
    }

    if (message.isGroup && this.inactiveGroups.has(message.chatId)) {
      return { handled: false, reason: 'Bot is disabled in this group' };
    }

    // 4. Group Permission Whitelist Check
    if (message.isGroup && !this.isGroupAllowed(message.chatId)) {
      console.log(`⚠️ [Router Ignored] Group-kan (${message.chatId}) kuma jiro ALLOWED_GROUPS. ALLOWED_GROUPS waa: ${this.config.security.allowedGroups.join(', ')}`);
      return { handled: false, reason: 'Group not in whitelist' };
    }

    // 4.5. WhatsApp Status Interaction Continuity & Gratitude Handling
    // If the contact is thanking the bot or following up on a status interaction/story,
    // reply naturally like an authentic Somali male friend and NEVER say "Maxaan kaa caawiyaa?".
    const statusContinuityHandled = await this.handleStatusInteractionContinuity(message, transport);
    if (statusContinuityHandled) {
      return { handled: true, reason: 'Status interaction continuity handled' };
    }

    // 5. Group Mention / Prefix Filter
    // In groups, only respond if @mentioned (@cardoso), short triggers (@cod, @sawir), prefixed, or isMentioned=true
    // (isMentioned is set to true by the transport when user swipe-replies to bot's message).
    // For voice notes (media with no text): isMentioned=true is the only signal — allow it through.
    const hasCardosoText = lowerText.includes('@cardoso');
    const hasVoiceCommand = !hasCardosoText && (lowerText.includes('@cod') || lowerText.startsWith('!cod') || /\b@cod\b/i.test(lowerText));
    const hasImageCommand = lowerText.includes('@sawir') || lowerText.startsWith('!sawir') || lowerText.includes('@image') || lowerText.startsWith('!image') || /\b@sawir\b/i.test(lowerText);
    const hasPrefix = lowerText.startsWith('!cardoso') || lowerText.startsWith('!cod') || lowerText.startsWith('!sawir') || lowerText.startsWith(this.config.messaging.prefix.toLowerCase());
    const hasMention = message.isMentioned || hasCardosoText || hasVoiceCommand || hasImageCommand;
    const isMediaWithNoText = !text && !!(message as any).media;

    if (message.isGroup && this.config.messaging.groupResponseMode === 'mention_only') {
      // Always pass through if isMentioned or has special command (covers voice note replies, @cod, and @sawir trigger)
      if (!hasMention && !hasPrefix && !isMediaWithNoText) {
        console.log(`ℹ️ [Router Ignored] Group message la iska indhatiray sababtoo ah kuma jirto '@cardoso', '@cod', '@sawir' ama '${this.config.messaging.prefix}'. Qoraal: "${text}"`);
        return { handled: false, reason: 'Group message without mention or prefix' };
      }
    }

    // Clean prefix and mention from query
    let queryText = text;
    for (const p of ['!cardoso', '@cardoso', '!cod', '@cod', '!sawir', '@sawir', '!image', '@image', this.config.messaging.prefix]) {
      if (queryText.toLowerCase().startsWith(p.toLowerCase())) {
        queryText = queryText.slice(p.length).trim();
      }
    }
    // Also strip inline mentions like "@cardoso", "@cod", "@sawir"
    queryText = queryText.replace(/@cardoso\b/gi, '').replace(/@cod\b/gi, '').replace(/@sawir\b/gi, '').replace(/@image\b/gi, '').trim();

    // If user initiated with @sawir or !sawir, preserve image command context
    if (hasImageCommand) {
      if (!queryText) {
        queryText = '@sawir';
      } else {
        queryText = 'sawir ' + queryText;
      }
    }

    // For voice notes (media with empty text), set a meaningful placeholder so the AI engine
    // knows to transcribe/respond to the audio. The actual audio bytes are in message.media.
    const incomingMedia = (message as any).media;
    if (!queryText) {
      if (incomingMedia?.type === 'audio') {
        queryText = '🎙️ [Voice Note – Fadlan codkan dhagayso oo jawaab sii]';
      } else if (hasVoiceCommand) {
        queryText = 'cod isoo duub';
      } else if (incomingMedia?.type === 'image') {
        queryText = '🖼️ [Sawir – Fadlan sawirkan eeg oo ka hadal waxa ku jira]';
      } else if (incomingMedia?.type === 'video') {
        queryText = '🎬 [Muuqaal – Fadlan muuqaalkan daawo oo dhagayso kadibna ka jawaab]';
      } else if (incomingMedia?.type === 'document') {
        queryText = '📄 [Dukumenti – Fadlan soo koob macluumaadka muhiimka ah]';
      } else {
        queryText = '!help';
      }
    }

    // In Link Campaign Mode (!link on):
    // Only status link submissions are handled.
    // If user is already an existing contact, do NOT talk to them and do NOT say "Save me"
    // If user is unsaved, guide them to send their status link or picture+link.
    if (this.whatsappManager.isLinkCampaignMode() && !isAdminUser && !message.isGroup) {
      const isSaved = this.whatsappManager.isContactSaved(message.chatId);
      if (isSaved) {
        console.log(`ℹ️ [Router] Link Campaign Mode: Existing contact ${message.chatId} ignored (no AI, no save-me).`);
        return { handled: true, reason: 'Link campaign: existing contact ignored (no AI, no save-me)' };
      } else {
        console.log(`ℹ️ [Router] Link Campaign Mode: Unsaved contact ${message.chatId} prompted for status link.`);
        await transport.sendMessage(
          message.chatId,
          'Walaal fadlan iigu soo dir *Link-gaaga* (ama *Sawirkaaga iyo Link-gaaga* wada socda) si aan toos status kuugu dhigo! 📲✨'
        );
        return { handled: true, reason: 'Link campaign: unsaved contact prompted for status link' };
      }
    }

    // AI Master Toggle: If AI is disabled via !off, do not generate AI responses
    if (!this.whatsappManager.isAIEnabled()) {
      console.log(`ℹ️ [Router] AI is currently disabled (!off). Message from ${message.senderId} will not receive AI response.`);
      return { handled: true, reason: 'AI disabled via !off' };
    }

    console.log(`\n🤖 [Router] Fariin loo dirayaa Gemini AI: "${queryText}" (Qofka: ${message.senderId}, VoiceCommand: ${hasVoiceCommand})...`);

    // 6. Rate Limiting Check per Student
    const rateCheck = this.rateLimiter.checkLimit(message.senderId);
    if (!rateCheck.allowed) {
      console.log(`⏳ [Router] Ardayga waxaa qabtay Cooldown: ${message.senderId}`);
      await transport.sendMessage(
        message.chatId,
        `⏳ *[CARDOSO AI Cooldown]*: Please slow down walaal. Try again in ${rateCheck.retryAfterSeconds}s.`,
        { replyToMessageId: message.id }
      );
      return { handled: false, reason: 'Rate limited' };
    }

    // 6b. Check custom auto-reply keywords before invoking AI
    if (this.memory?.findMatchingAutoReply) {
      const autoReply = await this.memory.findMatchingAutoReply(queryText || text);
      if (autoReply) {
        console.log(`⚡ [Router Auto-Reply] Jawaab toos ah oo kaydsan ayaa loo helay "${text}": "${autoReply.substring(0, 45)}..."`);
        await transport.sendMessage(message.chatId, autoReply, { replyToMessageId: message.id });
        return { handled: true, reason: 'Matched custom auto-reply' };
      }
    }

    // 7. Process message through Advisor Engine (pass media attachment if present)
    const advisorResult = await this.engine.processMessage({
      rawSenderId: message.senderId,
      chatId: message.chatId,
      isGroup: message.isGroup,
      content: queryText,
      timestamp: message.rawTimestamp,
      media: (message as any).media,
      forceVoiceReply: hasVoiceCommand,
      forbidVoiceReply: hasCardosoText,
      hasCardosoMention: hasCardosoText,
      rawContent: text,
      senderName: message.senderName,
    });

    // Respect optional [SILENCE] token from AI output
    const trimmedReply = (advisorResult.replyText || '').trim();
    if (!trimmedReply || trimmedReply === '[SILENCE]' || trimmedReply.includes('[SILENCE]')) {
      return { handled: true, reason: 'Silent on empty/silenced reply' };
    }

    console.log(`\n📤 [Router] Jawaabta waxaa loo dirayaa WhatsApp: "${advisorResult.replyText.substring(0, 80)}..."`);

    // 8. Dispatch reply through transport (with media support for images & voice notes)
    // STRICT USER RULE: "@cardoso hadii qoro marnaba qof cod hagu jaawibin"
    // If the message contains @cardoso, suppress any audio replyMedia and send strictly text!
    if (advisorResult.replyMedia && transport.sendMedia && !(hasCardosoText && advisorResult.replyMedia.type === 'audio')) {
      if (advisorResult.replyMedia.type === 'image') {
        // Send generated image with caption
        const sent = await transport.sendMedia(message.chatId, advisorResult.replyMedia, {
          replyToMessageId: message.id,
        });
        if (!sent) {
          console.warn('[Router] Image upload failed, notifying user with fallback');
          await transport.sendMessage(message.chatId, `⚠️ ${advisorResult.replyText}\n\n*(Cilad yar oo xidhiidhka ah ayaa ku timid soo diridda sawirka, fadlan mar kale tijaabi)*`, {
            replyToMessageId: message.id,
          });
        }
      } else if (advisorResult.replyMedia.type === 'audio') {
        // Send ONLY the voice note (no duplicated text message, as explicitly requested by user)
        const sent = await transport.sendMedia(message.chatId, advisorResult.replyMedia, {
          replyToMessageId: message.id,
        });
        // Zero-Drop Fallback: If media upload was interrupted by WhatsApp, deliver text fallback immediately so user is never ignored!
        if (!sent) {
          console.warn('[Router] Voice upload failed, seamlessly delivering text response to user');
          await transport.sendMessage(message.chatId, advisorResult.replyText, {
            replyToMessageId: message.id,
          });
        }
      } else {
        await transport.sendMessage(message.chatId, advisorResult.replyText, {
          replyToMessageId: message.id,
        });
      }
    } else {
      await transport.sendMessage(message.chatId, advisorResult.replyText, {
        replyToMessageId: message.id,
      });
    }

    console.log(`✅ [Router] Jawaabtii si guul leh ayaa loogu diray WhatsApp!`);

    return { handled: true };
  }

  /**
   * Handles 100% Inbound `!views` / `views` / `vcf` commands in Groups and Private Chats:
   * - Auto-registers sender's WhatsApp Name + Phone (+252, +251, +254, etc.) with zero duplicates.
   * - Replies IN THE SAME CHAT (never cold-DMs strangers privately from a group -> 0% Ban!).
   * - Sends native .vcf document directly inside WhatsApp chat (with 5-min / 10-join anti-spam cooldown in groups).
   */
  private async handleViewsCommand(
    message: IncomingMessage,
    transport: IMessagingTransport,
    isAdminUser: boolean
  ): Promise<{ handled: boolean; reason?: string }> {
    if (!this.viewsHub) return { handled: false };

    const rawText = message.content.trim();
    const argMatch = rawText.match(/^[!./#]?(?:views|vcf)(?:\s+(.+))?$/i);
    const extraArg = (argMatch?.[1] || '').trim();
    const viewsUrl = this.publicBaseUrl ? `${this.publicBaseUrl}/views` : '';

    // Resolve real phone digits (never store an unresolved @lid identifier as a phone number)
    let rawPhoneCandidate = (message.senderPhone || '').replace(/\D/g, '');
    if (!rawPhoneCandidate && message.senderId && !message.senderId.endsWith('@lid')) {
      rawPhoneCandidate = message.senderId.split('@')[0].split(':')[0].replace(/\D/g, '');
    }
    if (!rawPhoneCandidate && !message.isGroup && message.chatId && !message.chatId.endsWith('@lid')) {
      rawPhoneCandidate = message.chatId.split('@')[0].split(':')[0].replace(/\D/g, '');
    }
    if (!rawPhoneCandidate && message.isFromMe) {
      rawPhoneCandidate = (
        this.whatsappManager.getBotNumber() ||
        this.config.security.adminPhoneNumbers[0] ||
        ''
      ).replace(/\D/g, '');
    }

    const phone = normalizeViewsPhone(rawPhoneCandidate);
    const hasValidPhone = Boolean(phone && phone.length >= 9 && phone.length <= 15);
    const mentionTag = message.isGroup && message.senderId ? `@${message.senderId.split('@')[0].split(':')[0]} ` : '';
    const mentionList = message.isGroup && message.senderId ? [message.senderId] : undefined;

    if (!hasValidPhone) {
      const fallbackMsg =
        `${mentionTag}Walaal lambarkaaga WhatsApp si toos ah uma muuqan — 5 ilbiriqsi geli boggan si aad *.vcf* u hesho:` +
        (viewsUrl ? `\n🔗 ${viewsUrl}` : '\n(Fur bogga `/views`)');
      await transport.sendMessage(message.chatId, fallbackMsg, {
        replyToMessageId: message.id,
        mentions: mentionList,
      });
      return { handled: true, reason: 'Views command: unresolved LID phone fallback' };
    }

    const defaultCity = phone.startsWith('251')
      ? 'Jigjiga'
      : phone.startsWith('254')
      ? 'Nairobi'
      : 'Hargeysa';
    const displayName =
      (extraArg && extraArg.length >= 2 && extraArg.length <= 45 ? extraArg : '') ||
      (message.senderName && message.senderName.trim().length >= 2 ? message.senderName.trim() : '') ||
      `Xubin ${phone.slice(-4)}`;

    let contact: any;
    let alreadyJoined = false;
    let batchCompleted = false;
    let nextBatchOpened: number | null = null;

    try {
      const joined = this.viewsHub.joinContact({
        name: displayName,
        phone,
        city: defaultCity,
        category: 'personal',
      });
      contact = joined.contact;
      batchCompleted = joined.batchCompleted;
      nextBatchOpened = joined.nextBatchOpened;
    } catch (err: any) {
      if (err instanceof ViewsHubError && err.code === 'DUPLICATE_PHONE') {
        alreadyJoined = true;
        contact = this.viewsHub.lookupContactByPhone(phone);
      } else {
        await transport.sendMessage(
          message.chatId,
          `${mentionTag}⚠️ ${err?.message || 'Cilad yar ayaa dhacday, mar kale isku day.'}`,
          { replyToMessageId: message.id, mentions: mentionList }
        );
        return { handled: true, reason: 'Views command join error' };
      }
    }

    const cfg = this.viewsHub.getConfig();
    const targetBatch = contact?.batchNumber || cfg.currentBatch;
    const batchCount = this.viewsHub.getBatchFreeCount(targetBatch);
    const isUnlocked = this.viewsHub.isBatchDownloadUnlocked(targetBatch, cfg);

    // If Batch Lock Mode is active and this batch isn't full yet
    if (!isUnlocked && !isAdminUser) {
      const lockMsg =
        `${mentionTag}✅ *${alreadyJoined ? 'Horay ayaad ugu jirtay' : 'Waad ku biirtay'} CARDOSO Views Hub — Batch #${targetBatch}!*\n` +
        `🔒 *Xaaladda:* ${batchCount} / ${cfg.batchTarget} Qof\n` +
        (message.isGroup
          ? `🔥 Marka uu gaaro *${cfg.batchTarget} qof*, faylka *.vcf* toos ayaan kooxda ugu soo tuurayaa — qora \`!views\` si uu degdeg u buuxsamo!`
          : `🔥 Marka uu gaaro *${cfg.batchTarget} qof*, faylka *.vcf* wuu furmayaa — ii soo qor \`vcf\` mar kale ama fur:${viewsUrl ? `\n🔗 ${viewsUrl}` : ''}`);
      await transport.sendMessage(message.chatId, lockMsg, {
        replyToMessageId: message.id,
        mentions: mentionList,
      });
      return { handled: true, reason: 'Views command: joined locked batch' };
    }

    // Decide whether to attach the .vcf file now (always in Private Chat; smart cooldown in Groups to prevent flooding)
    let shouldSendVcfFile = !message.isGroup;
    if (message.isGroup) {
      const now = Date.now();
      const prev = this.groupVcfCooldown.get(message.chatId);
      const joinsSince = (prev?.joinsSince || 0) + (alreadyJoined ? 0 : 1);
      const cooldownExpired = !prev || now - prev.sentAt >= 5 * 60 * 1000;
      const hitBurstThreshold = joinsSince >= 10;
      if (cooldownExpired || hitBurstThreshold || batchCompleted || isAdminUser) {
        shouldSendVcfFile = true;
        this.groupVcfCooldown.set(message.chatId, { sentAt: now, joinsSince: 0 });
      } else {
        this.groupVcfCooldown.set(message.chatId, { sentAt: prev.sentAt, joinsSince });
      }
    }

    if (shouldSendVcfFile && typeof transport.sendMedia === 'function') {
      try {
        const generated = this.viewsHub.generateVcf({
          scope: 'current',
          batch: targetBatch,
          excludePhone: message.isGroup ? undefined : phone,
          isAdminBypass: isAdminUser,
        });

        const vcfCaption = batchCompleted
          ? `🔥 *HAMBALYO! Batch #${targetBatch} (${cfg.batchTarget}/${cfg.batchTarget}) WUU BUUXSAMAY!*\n` +
            `📥 Waa kan faylka *.vcf* (${generated.count} Contacts + VIP) — *Guji ➔ Import All Contacts!*\n` +
            `📦 *Batch #${nextBatchOpened}* hadda ayuu si toos ah u furmay — qor \`!views\` si aad ugu biirto!`
          : `${mentionTag}✅ *${alreadyJoined ? 'Waa kan faylkaagii' : 'Waad ku biirtay'} Batch #${targetBatch} (${batchCount}/${cfg.batchTarget} Qof)!*\n` +
            `📥 *${generated.count} Contacts (+VIP)* — Guji faylkan *.vcf* ➔ *Import All Contacts* (2 ilbiriqsi!)\n` +
            (message.isGroup
              ? `🔥 Qof kasta oo kooxda jooga oo raba 200+ Status Views bilaash ah ha qoro \`!views\`!`
              : `✅ Markaad save gareyso, Status Views-kaagu toos ayay u kacayaan!` + (viewsUrl ? `\n🔗 ${viewsUrl}` : ''));

        await transport.sendMedia(
          message.chatId,
          {
            type: 'document',
            dataBuffer: Buffer.from(generated.vcfText, 'utf8'),
            mimeType: 'text/vcard',
            fileName: generated.filename,
            caption: vcfCaption,
          },
          { replyToMessageId: message.id, mentions: mentionList }
        );
        return { handled: true, reason: `Views command: sent .vcf (${generated.count} contacts)` };
      } catch (vcfErr: any) {
        console.warn(`[ViewsCmd] .vcf generation fallback: ${vcfErr?.message || vcfErr}`);
      }
    }

    // Concise group reply during 5-min anti-flood cooldown (user IS already registered!)
    const shortReply =
      `${mentionTag}✅ *${alreadyJoined ? 'Horay ayaad ugu jirtay' : 'Waad ku biirtay'} Batch #${targetBatch}* (${batchCount}/${cfg.batchTarget} Qof)! 🔥\n` +
      `📥 Guji faylka *.vcf* ee kor ku yaal si aad u save gareyso — ama private-ka iigu soo qor *vcf* si toos kuugu soo diro!` +
      (viewsUrl ? `\n🔗 ${viewsUrl}` : '');

    await transport.sendMessage(message.chatId, shortReply, {
      replyToMessageId: message.id,
      mentions: mentionList,
    });
    return { handled: true, reason: 'Views command: registered (group cooldown concise reply)' };
  }

  /**
   * Helper: extracts real phone + display name from a Baileys group participant object or JID string.
   * Never treats an unresolved `@lid` identifier as a real phone number.
   */
  private extractParticipantPhoneAndName(p: any): { phone: string; name: string; isHiddenLid: boolean } {
    if (!p) return { phone: '', name: '', isHiddenLid: false };

    const rawCandidates: string[] = [];
    let notifyName = '';

    if (typeof p === 'string') {
      rawCandidates.push(p);
    } else if (typeof p === 'object') {
      if (typeof p.phoneNumber === 'string') rawCandidates.push(p.phoneNumber);
      if (typeof p.pn === 'string') rawCandidates.push(p.pn);
      if (typeof p.jid === 'string') rawCandidates.push(p.jid);
      if (typeof p.id === 'string') rawCandidates.push(p.id);
      notifyName = String(p.notify || p.name || '').trim();
    }

    let sawLidOnly = false;
    for (const cand of rawCandidates) {
      const trimmed = String(cand || '').trim();
      if (!trimmed) continue;
      if (trimmed.endsWith('@lid')) {
        sawLidOnly = true;
        continue;
      }
      const digits = trimmed.split('@')[0].split(':')[0].replace(/\D/g, '');
      const normalized = normalizeViewsPhone(digits);
      if (normalized && normalized.length >= 9 && normalized.length <= 15) {
        const knownName =
          notifyName ||
          this.broadcast.getContactName(`${normalized}@s.whatsapp.net`) ||
          this.broadcast.getContactName(normalized) ||
          '';
        return { phone: normalized, name: knownName, isHiddenLid: false };
      }
    }

    return { phone: '', name: notifyName, isHiddenLid: sawLidOnly };
  }

  private async dropBatchVcfToGroup(
    groupJid: string,
    batchNumber: number,
    transport: IMessagingTransport,
    options?: { completed?: boolean; nextBatch?: number; replyToMessageId?: string }
  ): Promise<boolean> {
    if (!this.viewsHub || typeof transport.sendMedia !== 'function') return false;
    const cfg = this.viewsHub.getConfig();
    const viewsUrl = this.publicBaseUrl ? `${this.publicBaseUrl}/views` : '';

    try {
      const generated = this.viewsHub.generateVcf({
        scope: 'current',
        batch: batchNumber,
        isAdminBypass: true,
      });

      const caption = options?.completed
        ? `🔥 *HAMBALYO! Batch #${batchNumber} (${cfg.batchTarget}/${cfg.batchTarget}) WUU BUUXSAMAY!* 🔥\n\n` +
          `📥 Waa kan faylka *.vcf* oo dhammaystiran (*${generated.count} Contacts + ${generated.vipCount} VIP*).\n` +
          `👆 *Guji faylkan ➔ Import All Contacts* (2 ilbiriqsi gudahood dhammaan dadka kooxda ayaa kuu save garoobaya!)\n\n` +
          (options.nextBatch ? `📦 *Batch #${options.nextBatch}* hadda ayuu si toos ah u furmay!` : '') +
          (viewsUrl ? `\n🔗 ${viewsUrl}` : '')
        : `📥 *CARDOSO Views Hub — Batch #${batchNumber} (.vcf)*\n` +
          `👥 *${generated.count} Contacts* (${generated.vipCount} VIP Pinned)\n` +
          `👆 *Guji faylkan ➔ Import All Contacts* si dhammaan Contacts-ku 2 ilbiriqsi kuugu save garoobaan!` +
          (viewsUrl ? `\n🔗 ${viewsUrl}` : '');

      await transport.sendMedia(
        groupJid,
        {
          type: 'document',
          dataBuffer: Buffer.from(generated.vcfText, 'utf8'),
          mimeType: 'text/vcard',
          fileName: generated.filename,
          caption,
        },
        options?.replyToMessageId ? { replyToMessageId: options.replyToMessageId } : undefined
      );
      this.viewsHub.recordGroupVcfDrop(groupJid);
      return true;
    } catch (err: any) {
      console.warn(`[ViewsGroup] Failed dropping .vcf for Batch #${batchNumber} in ${groupJid}: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Admin command inside a WhatsApp Group:
   * - `!views-group on`     -> Scans & auto-registers ALL existing group members + enables auto-capture on future joins.
   * - `!views-group drop`   -> Drops the current batch .vcf file directly into the group immediately.
   * - `!views-group off`    -> Disables auto-capture for this group.
   * - `!views-group status` -> Shows status & stats.
   */
  private async handleViewsGroupCommand(
    message: IncomingMessage,
    transport: IMessagingTransport,
    isAdminUser: boolean
  ): Promise<{ handled: boolean; reason?: string }> {
    if (!this.viewsHub) return { handled: false };
    if (!isAdminUser) {
      await transport.sendMessage(
        message.chatId,
        '⚠️ Amarka `!views-group` waa mid u gaar ah Admin-ka. Adigu qor `!views` si aad ugu biirto Views Hub!',
        { replyToMessageId: message.id }
      );
      return { handled: true, reason: 'Views group admin-only guard' };
    }

    const match = message.content.trim().match(/^[!./#]views-group(?:\s+(\S+))?/i);
    const sub = (match?.[1] || 'status').toLowerCase();
    const viewsUrl = this.publicBaseUrl ? `${this.publicBaseUrl}/views` : '';

    if (sub === 'off' || sub === 'stop' || sub === 'dami') {
      this.viewsHub.setViewsGroup(message.chatId, false);
      await transport.sendMessage(
        message.chatId,
        '🛑 *Views Group Mode waa la damiyay kooxdan.* (Xubnaha cusub si toos ah looguma dari doono Views Hub.)',
        { replyToMessageId: message.id }
      );
      return { handled: true, reason: 'Views group disabled' };
    }

    if (sub === 'drop' || sub === 'vcf' || sub === 'send') {
      const cfg = this.viewsHub.getConfig();
      const targetBatch =
        this.viewsHub.getBatchFreeCount(cfg.currentBatch) > 0 || cfg.currentBatch === 1
          ? cfg.currentBatch
          : cfg.currentBatch - 1;
      const dropped = await this.dropBatchVcfToGroup(message.chatId, targetBatch, transport, {
        replyToMessageId: message.id,
      });
      if (!dropped) {
        await transport.sendMessage(
          message.chatId,
          '⚠️ Weli ma jiraan contacts ku jira Batch-kan oo la soo tuuro. Ku billow `!views-group on` ama `!views`.',
          { replyToMessageId: message.id }
        );
      }
      return { handled: true, reason: 'Views group manual .vcf drop' };
    }

    if (sub === 'on' || sub === 'start' || sub === 'shid') {
      const sock = typeof transport.getSocket === 'function' ? transport.getSocket() : null;
      let groupName = 'Views Group';
      const extractedMembers: Array<{ phone: string; name?: string }> = [];
      let hiddenLidCount = 0;

      if (sock && typeof sock.groupMetadata === 'function') {
        try {
          const meta = await sock.groupMetadata(message.chatId);
          if (meta?.subject) groupName = String(meta.subject);
          for (const p of meta?.participants || []) {
            const parsed = this.extractParticipantPhoneAndName(p);
            if (parsed.phone) {
              extractedMembers.push({ phone: parsed.phone, name: parsed.name });
            } else if (parsed.isHiddenLid) {
              hiddenLidCount++;
            }
          }
        } catch (metaErr: any) {
          console.warn(`[ViewsGroup] groupMetadata error for ${message.chatId}: ${metaErr?.message || metaErr}`);
        }
      }

      const botOwnDigits = (
        this.whatsappManager.getBotNumber() ||
        (sock?.user?.id ? String(sock.user.id).split('@')[0].split(':')[0] : '')
      ).replace(/\D/g, '');

      this.viewsHub.setViewsGroup(message.chatId, true, groupName);
      const bulk = this.viewsHub.bulkRegisterFromGroup(
        message.chatId,
        extractedMembers,
        botOwnDigits ? [botOwnDigits] : []
      );

      let msg =
        `✅ *CARDOSO Views Group Waa Shidan Yahay!*\n\n` +
        `👥 *Xubnaha Horay Kooxda Ugu Jiray:*\n` +
        `• Cusub oo la diiwaangeliyay: *${bulk.added} qof*\n` +
        (bulk.skippedDuplicates > 0 ? `• Horay u diiwaangashanaa: *${bulk.skippedDuplicates} qof*\n` : '') +
        (hiddenLidCount > 0
          ? `• Privacy/LID qarsoon: *${hiddenLidCount} qof* _(waxay qori karaan \`!views\`${viewsUrl ? ` ama fur ${viewsUrl}` : ''})_\n`
          : '') +
        `\n📦 *Batch-ka Hadda:* #${bulk.currentBatch} (*${bulk.currentBatchFreeCount} / ${bulk.batchTarget} Qof*)\n` +
        `🆕 Qof kasta oo cusub oo kooxda soo gala **si toos ah** ayaa loogu dari doonaa (0 typing, 0% Ban).\n` +
        `🔥 Marka uu gaaro *${bulk.batchTarget} qof*, faylka *.vcf* toos ayaan kooxda ugu soo tuurayaa!`;

      await transport.sendMessage(message.chatId, msg, { replyToMessageId: message.id });

      // If existing members already filled 1 or more batches -> auto-drop each completed batch .vcf right away!
      for (const completedBatchNum of bulk.completedBatches) {
        await this.dropBatchVcfToGroup(message.chatId, completedBatchNum, transport, {
          completed: true,
          nextBatch: completedBatchNum + 1,
        });
      }
      return { handled: true, reason: `Views group enabled (${bulk.added} captured)` };
    }

    // Status summary
    const grp = this.viewsHub.getViewsGroup(message.chatId);
    const cfg = this.viewsHub.getConfig();
    const cnt = this.viewsHub.getBatchFreeCount(cfg.currentBatch);
    const statusText =
      `📈 *CARDOSO Views Group Status*\n` +
      `• Xaaladda: ${grp?.enabled ? '✅ SHIDAN (ON)' : '🛑 DAMISAN (OFF)'}\n` +
      `• Xubno laga qabtay kooxdan: *${grp?.capturedCount || 0}*\n` +
      `• Batch-ka hadda: *#${cfg.currentBatch}* (*${cnt} / ${cfg.batchTarget} Qof*)\n\n` +
      `*Amarrada:*\n` +
      `• \`!views-group on\` — Shid + soo xaree xubnaha kooxda\n` +
      `• \`!views-group drop\` — Hadda kooxda ku tuur faylka .vcf\n` +
      `• \`!views-group off\` — Dami kooxdan`;

    await transport.sendMessage(message.chatId, statusText, { replyToMessageId: message.id });
    return { handled: true, reason: 'Views group status shown' };
  }

  /**
   * Automatic hook fired by Baileys `group-participants.update` (`action === 'add'`).
   * Silently auto-registers new joiners in enabled Views Groups (ZERO Cold DMs, ZERO welcome spam)
   * and automatically drops the completed .vcf file into the group the instant the Batch fills!
   */
  public async handleGroupParticipantsAdded(
    groupJid: string,
    participants: any[],
    transport: IMessagingTransport
  ): Promise<{ captured: number; completedBatches: number[] }> {
    if (!this.viewsHub || !this.viewsHub.isViewsGroupEnabled(groupJid)) {
      return { captured: 0, completedBatches: [] };
    }

    const sock = typeof transport.getSocket === 'function' ? transport.getSocket() : null;
    const resolved: Array<{ phone: string; name?: string }> = [];
    const unresolvedLids: string[] = [];

    for (const p of participants || []) {
      const parsed = this.extractParticipantPhoneAndName(p);
      if (parsed.phone) {
        resolved.push({ phone: parsed.phone, name: parsed.name });
      } else if (parsed.isHiddenLid) {
        const lidId = typeof p === 'string' ? p : String(p?.id || '');
        if (lidId) unresolvedLids.push(lidId);
      }
    }

    // If any new joiner arrived as @lid, inspect groupMetadata once to see if phoneNumber is attached
    if (unresolvedLids.length > 0 && sock && typeof sock.groupMetadata === 'function') {
      try {
        const meta = await sock.groupMetadata(groupJid);
        const lidSet = new Set(unresolvedLids);
        for (const mp of meta?.participants || []) {
          if (mp && lidSet.has(String(mp.id || ''))) {
            const parsed = this.extractParticipantPhoneAndName(mp);
            if (parsed.phone) {
              resolved.push({ phone: parsed.phone, name: parsed.name });
            }
          }
        }
      } catch {}
    }

    if (resolved.length === 0) {
      return { captured: 0, completedBatches: [] };
    }

    const botOwnDigits = (
      this.whatsappManager.getBotNumber() ||
      (sock?.user?.id ? String(sock.user.id).split('@')[0].split(':')[0] : '')
    ).replace(/\D/g, '');

    const bulk = this.viewsHub.bulkRegisterFromGroup(
      groupJid,
      resolved,
      botOwnDigits ? [botOwnDigits] : []
    );

    if (bulk.added > 0) {
      console.log(
        `📈 [ViewsGroup] Silently auto-captured ${bulk.added} new joiner(s) in ${groupJid} (Batch #${bulk.currentBatch}: ${bulk.currentBatchFreeCount}/${bulk.batchTarget}).`
      );
    }

    // Automatic .vcf drop into the group the exact second a Batch fills!
    for (const completedBatchNum of bulk.completedBatches) {
      await this.dropBatchVcfToGroup(groupJid, completedBatchNum, transport, {
        completed: true,
        nextBatch: completedBatchNum + 1,
      });
    }

    return { captured: bulk.added, completedBatches: bulk.completedBatches };
  }

  public getStatus() {
    return {
      isBotActiveGlobally: this.isBotActiveGlobally,
      inactiveGroupsCount: this.inactiveGroups.size,
      deduplicatorCacheSize: this.deduplicator.size(),
    };
  }
}

