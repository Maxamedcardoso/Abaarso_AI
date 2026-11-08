import { IncomingMessage, IMessagingTransport } from '../transports/transport.interface.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { MessageDeduplicator } from './deduplicator.js';
import { RateLimiter } from './rate-limiter.js';
import { AppConfig } from '../config/env.js';

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

  public isAdmin(senderNumber: string): boolean {
    const clean = senderNumber.replace(/[^0-9]/g, '');
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

    const isAdminUser = this.isAdmin(message.senderId);

    // 2. Admin Command Handling
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
    // In groups, only respond if @mentioned (@cardoso), short voice trigger (@cod / !cod), prefixed, or isMentioned=true
    // (isMentioned is set to true by the transport when user swipe-replies to bot's message).
    // For voice notes (media with no text): isMentioned=true is the only signal — allow it through.
    const hasVoiceCommand = lowerText.includes('@cod') || lowerText.startsWith('!cod') || /\b@cod\b/i.test(lowerText);
    const hasPrefix = lowerText.startsWith('!cardoso') || lowerText.startsWith('!cod') || lowerText.startsWith(this.config.messaging.prefix.toLowerCase());
    const hasMention = message.isMentioned || lowerText.includes('@cardoso') || hasVoiceCommand;
    const isMediaWithNoText = !text && !!(message as any).media;

    if (message.isGroup && this.config.messaging.groupResponseMode === 'mention_only') {
      // Always pass through if isMentioned or hasVoiceCommand (covers voice note replies and @cod trigger)
      if (!hasMention && !hasPrefix && !isMediaWithNoText) {
        console.log(`ℹ️ [Router Ignored] Group message la iska indhatiray sababtoo ah kuma jirto '@cardoso', '@cod' ama '${this.config.messaging.prefix}'. Qoraal: "${text}"`);
        return { handled: false, reason: 'Group message without mention or prefix' };
      }
    }

    // Clean prefix and mention from query
    let queryText = text;
    for (const p of ['!cardoso', '@cardoso', '!cod', '@cod', this.config.messaging.prefix]) {
      if (queryText.toLowerCase().startsWith(p.toLowerCase())) {
        queryText = queryText.slice(p.length).trim();
      }
    }
    // Also strip inline mentions like "@cardoso" and "@cod"
    queryText = queryText.replace(/@cardoso\b/gi, '').replace(/@cod\b/gi, '').trim();

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
    });

    console.log(`\n📤 [Router] Jawaabta waxaa loo dirayaa WhatsApp: "${advisorResult.replyText.substring(0, 80)}..."`);

    // 8. Dispatch reply through transport (with media support for images & voice notes)
    if (advisorResult.replyMedia && transport.sendMedia) {
      if (advisorResult.replyMedia.type === 'image') {
        // Send generated image with caption
        await transport.sendMedia(message.chatId, advisorResult.replyMedia, {
          replyToMessageId: message.id,
        });
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

