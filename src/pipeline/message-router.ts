import { IncomingMessage, IMessagingTransport } from '../transports/transport.interface.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { MessageDeduplicator } from './deduplicator.js';
import { RateLimiter } from './rate-limiter.js';
import { AppConfig } from '../config/env.js';
import { broadcastService } from '../services/broadcast.service.js';

export class MessageRouter {
  private engine: StudentAdvisorEngine;
  private deduplicator: MessageDeduplicator;
  private rateLimiter: RateLimiter;
  private config: AppConfig;
  private isBotActiveGlobally: boolean = true;
  private inactiveGroups: Set<string> = new Set();

  constructor(
    engine: StudentAdvisorEngine,
    config: AppConfig,
    deduplicator?: MessageDeduplicator,
    rateLimiter?: RateLimiter
  ) {
    this.engine = engine;
    this.config = config;
    this.deduplicator = deduplicator || new MessageDeduplicator();
    this.rateLimiter = rateLimiter || new RateLimiter();
  }

  public isAdmin(senderNumber: string, isGroup: boolean = false): boolean {
    const clean = senderNumber.replace(/[^0-9]/g, '');
    if (this.config.security.adminPhoneNumbers.length === 0) {
      // In 1-on-1 private chat, allow if no specific admin whitelist is set
      return !isGroup;
    }
    return this.config.security.adminPhoneNumbers.some(admin => clean.endsWith(admin) || admin.endsWith(clean));
  }

  public isGroupAllowed(groupJid: string): boolean {
    if (this.config.security.allowedGroups.length === 0) {
      return true; // No whitelist means all groups allowed
    }
    return this.config.security.allowedGroups.includes(groupJid);
  }

  private chatQueues: Map<string, Promise<any>> = new Map();

  public async handleIncomingMessage(
    message: IncomingMessage,
    transport: IMessagingTransport
  ): Promise<{ handled: boolean; reason?: string }> {
    const queueKey = message.chatId || message.senderId;
    const previousPromise = this.chatQueues.get(queueKey) || Promise.resolve();

    const task = previousPromise
      .catch(() => {})
      .then(() => this.processMessageInternal(message, transport));

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
      lowerText.includes('[cardoso ai cooldown]') ||
      lowerText.includes('xadkii daqiiqada') ||
      lowerText.includes('server-ku wuxuu gaadhay xadkii') ||
      lowerText.includes('gemini api request failed')
    ) {
      console.log(`⚠️ [Router Ignored] Bot-generated notice/echo detected ("${text.substring(0, 45)}..."). Discarding.`);
      return { handled: false, reason: 'Bot echo discarded' };
    }

    // 1c. Record contact for smart broadcasting (individual chats only)
    if (!message.isGroup) {
      broadcastService.recordContact(message.chatId, message.senderName, false);
    }

    const isAdminUser = this.isAdmin(message.senderId, message.isGroup);

    // 2. Broadcast Confirmation Handling (HAA / MAYA)
    if (broadcastService.hasPendingDraft(message.chatId)) {
      const cleanReply = lowerText.trim();
      if (/^(?:haa|ha|yes|y|bilaaw|bilaab)$/i.test(cleanReply)) {
        await broadcastService.confirmDraft(message.chatId, transport);
        return { handled: true, reason: 'Broadcast confirmed and started' };
      }
      if (/^(?:maya|may|no|n|baaji|cancel)$/i.test(cleanReply)) {
        broadcastService.cancelDraft(message.chatId);
        await transport.sendMessage(message.chatId, '🛑 *[CARDOSO AI]*: Fariin-wadareedkii waa la baajiyay.');
        return { handled: true, reason: 'Broadcast cancelled' };
      }
    }

    // 2b. Broadcast Abort Command (!jooji)
    if (/^!(?:jooji|stop-broadcast|cancel-broadcast)$/i.test(lowerText.trim()) && isAdminUser) {
      const aborted = broadcastService.abortBroadcast();
      if (aborted) {
        await transport.sendMessage(message.chatId, '🛑 *[CARDOSO AI]*: Waxaa la diray amarka joojinta fariin-wadareedka. Way is-taagaysaa isla markiiba.');
      } else {
        await transport.sendMessage(message.chatId, 'ℹ️ Hadda ma jirto fariin-wadareed socota.');
      }
      return { handled: true, reason: 'Broadcast abort command' };
    }

    // 2c. Broadcast Query Contacts Command (!contacts / !liis)
    if (/^!(?:contacts|liis|xiriir)$/i.test(lowerText.trim()) && isAdminUser) {
      const stats = broadcastService.getStats();
      await transport.sendMessage(
        message.chatId,
        `📋 *[CARDOSO AI Contacts & Broadcast]*:\n• Wadarta Contacts-ka: *${stats.total} qof*\n• Fariinta Horey loo Gaarsiiyay: *${stats.sent} qof*\n• Hadhay (Aan wali helin): *${stats.remaining} qof*\n\nSi aad 50 qof oo cusub ugu dirto, qor:\n\`!fariin <fariintaada>\`\n\nHaddii aad doonayso inaad dib uga bilowdo dhamaan, qor:\n\`!fariin reset\``
      );
      return { handled: true, reason: 'Contacts query' };
    }

    // 2d. Broadcast Test Command (!broadcast-test)
    if (/^!(?:broadcast-test|fariin-test)\s+/i.test(lowerText) && isAdminUser) {
      const sampleText = text.replace(/^!(?:broadcast-test|fariin-test)\s+/i, '');
      const personalized = broadcastService.formatPersonalizedMessage(sampleText, message.senderName || 'Saaxiib');
      await transport.sendMessage(
        message.chatId,
        `🧪 *[CARDOSO AI Broadcast Test Preview]*:\n\nSidan ayay u gaadhi doontaa qofka:\n"${personalized}"\n\nHaddii ay ku qanciso, u dir dhammaan adigoo isticmaalaya:\n\`!fariin ${sampleText}\``
      );
      return { handled: true, reason: 'Broadcast test preview' };
    }

    // 2e. Broadcast Reset Command (!fariin reset / !broadcast reset)
    if (/^!(?:broadcast|fariin)\s+reset$/i.test(lowerText.trim()) && isAdminUser) {
      await broadcastService.resetSentHistory();
      await transport.sendMessage(
        message.chatId,
        '🔄 *[CARDOSO AI]*: Liiskii dadka fariinta loo diray waa la nadiifiyay! Hadda waxaad dib ugu bilaabi kartaa fariin cusub dhammaan contacts-ka.'
      );
      return { handled: true, reason: 'Broadcast history reset' };
    }

    // 2f. Broadcast Stats Command (!fariin stats / !broadcast stats)
    if (/^!(?:broadcast|fariin)\s+(?:stats|status)$/i.test(lowerText.trim()) && isAdminUser) {
      const stats = broadcastService.getStats();
      await transport.sendMessage(
        message.chatId,
        `📊 *[CARDOSO AI Smart Broadcast Xogteeda]*:\n• Wadarta Contacts-ka: *${stats.total} qof*\n• Horey loo Gaarsiiyay: *${stats.sent} qof*\n• Hadhay (Aan wali helin): *${stats.remaining} qof*`
      );
      return { handled: true, reason: 'Broadcast stats' };
    }

    // 2g. Direct Broadcast Command (!broadcast / !fariin) — sends to the next 50 uncontacted contacts immediately!
    if (/^!(?:broadcast|fariin)\s+/i.test(lowerText) && isAdminUser) {
      const broadcastContent = text.replace(/^!(?:broadcast|fariin)\s+/i, '');
      const result = await broadcastService.startDirectBroadcast(message.chatId, broadcastContent, transport, 50);
      await transport.sendMessage(message.chatId, result.message);
      return { handled: true, reason: 'Direct broadcast initiated' };
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

    if (message.isGroup && this.inactiveGroups.has(message.chatId)) {
      return { handled: false, reason: 'Bot is disabled in this group' };
    }

    // 4. Group Permission Whitelist Check
    if (message.isGroup && !this.isGroupAllowed(message.chatId)) {
      console.log(`⚠️ [Router Ignored] Group-kan (${message.chatId}) kuma jiro ALLOWED_GROUPS. ALLOWED_GROUPS waa: ${this.config.security.allowedGroups.join(', ')}`);
      return { handled: false, reason: 'Group not in whitelist' };
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
        queryText = '🎙️ [Voice Note – Fadlan codkan akhriso oo jawaab sii]';
      } else if (hasVoiceCommand) {
        queryText = 'cod isoo duub';
      } else if (incomingMedia?.type === 'image') {
        queryText = '🖼️ [Sawir – Fadlan sawirkan sharax]';
      } else if (incomingMedia?.type === 'document') {
        queryText = '📄 [Dukumenti – Fadlan soo koob macluumaadka muhiimka ah]';
      } else {
        queryText = '!help';
      }
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

  public getStatus() {
    return {
      isBotActiveGlobally: this.isBotActiveGlobally,
      inactiveGroupsCount: this.inactiveGroups.size,
      deduplicatorCacheSize: this.deduplicator.size(),
    };
  }
}

