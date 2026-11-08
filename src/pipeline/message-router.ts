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

  public async handleIncomingMessage(
    message: IncomingMessage,
    transport: IMessagingTransport
  ): Promise<{ handled: boolean; reason?: string }> {
    // 1. Deduplication check: drop duplicate webhooks or reconnected messages
    if (this.deduplicator.isDuplicate(message.id)) {
      return { handled: false, reason: 'Duplicate message ID dropped' };
    }

    const text = message.content.trim();
    if (!text) {
      return { handled: false, reason: 'Empty message' };
    }

    const isAdminUser = this.isAdmin(message.senderId);

    // 2. Admin Command Handling
    if (text.startsWith('!cardoso') || text.startsWith('!abaarso') || text.startsWith('!abarso') || text.startsWith('!admin')) {
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
    // In groups, only respond if @mentioned (@cardoso / @abaarso / @abarso) or prefixed with !cardoso / !abaarso / !abarso
    const lowerText = text.toLowerCase();
    const hasPrefix = lowerText.startsWith('!cardoso') || lowerText.startsWith('!abaarso') || lowerText.startsWith('!abarso') || lowerText.startsWith(this.config.messaging.prefix.toLowerCase());
    const hasMention = message.isMentioned || lowerText.includes('@cardoso') || lowerText.includes('@abaarso') || lowerText.includes('@abarso');

    if (message.isGroup && this.config.messaging.groupResponseMode === 'mention_only') {
      if (!hasMention && !hasPrefix) {
        console.log(`ℹ️ [Router Ignored] Group message la iska indhatiray sababtoo ah kuma jirto '@cardoso' ama '${this.config.messaging.prefix}'. Qoraal: "${text}"`);
        return { handled: false, reason: 'Group message without mention or prefix' };
      }
    }

    // Clean prefix and mention from query
    let queryText = text;
    for (const p of ['!cardoso', '!abaarso', '!abarso', '@cardoso', '@abaarso', '@abarso', this.config.messaging.prefix]) {
      if (queryText.toLowerCase().startsWith(p.toLowerCase())) {
        queryText = queryText.slice(p.length).trim();
      }
    }
    // Also strip inline mentions like "@cardoso" or "@abaarso"
    queryText = queryText.replace(/@(cardoso|abaarso|abarso)\b/gi, '').trim();

    if (!queryText) {
      queryText = '!help';
    }

    console.log(`\n🤖 [Router] Fariin loo dirayaa Gemini AI: "${queryText}" (Qofka: ${message.senderId})...`);

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
    });

    console.log(`\n📤 [Router] Jawaabta waxaa loo dirayaa WhatsApp: "${advisorResult.replyText.substring(0, 80)}..."`);

    // 8. Dispatch reply through transport
    await transport.sendMessage(message.chatId, advisorResult.replyText, {
      replyToMessageId: message.id,
    });

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

