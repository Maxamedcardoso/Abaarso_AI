import { IncomingMessage, IMessagingTransport, OutgoingMedia } from '../transports/transport.interface.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { MessageDeduplicator } from './deduplicator.js';
import { RateLimiter } from './rate-limiter.js';
import { AppConfig } from '../config/env.js';
import { broadcastService } from '../services/broadcast.service.js';
import { AbaarsoAdService } from '../services/abaarso-ad.service.js';
import { whatsappManagerService } from '../services/whatsapp-manager.service.js';
import { VoiceReplyService } from '../services/voice-reply.service.js';
import { IStudentMemory } from '../memory/memory.interface.js';

export class MessageRouter {
  private engine: StudentAdvisorEngine;
  private deduplicator: MessageDeduplicator;
  private rateLimiter: RateLimiter;
  private config: AppConfig;
  private isBotActiveGlobally: boolean = true;
  private inactiveGroups: Set<string> = new Set();
  private memory?: IStudentMemory;

  constructor(
    engine: StudentAdvisorEngine,
    config: AppConfig,
    deduplicator?: MessageDeduplicator,
    rateLimiter?: RateLimiter,
    memory?: IStudentMemory
  ) {
    this.engine = engine;
    this.config = config;
    this.deduplicator = deduplicator || new MessageDeduplicator();
    this.rateLimiter = rateLimiter || new RateLimiter();
    this.memory = memory;
  }

  public isAdmin(senderNumber: string, isGroup: boolean = false): boolean {
    const clean = senderNumber.replace(/[^0-9]/g, '');
    if (this.config.security.adminPhoneNumbers.length === 0) {
      // If no admin whitelist is configured, strictly only host phone (isFromMe) has admin privileges
      return false;
    }
    return this.config.security.adminPhoneNumbers.some(admin => clean.endsWith(admin) || admin.endsWith(clean));
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

    // 1c. Record contact for smart broadcasting (individual chats only, skip host's own fromMe messages)
    if (!message.isGroup && !message.isFromMe) {
      broadcastService.recordContact(message.chatId, message.senderName, false, true);
    }

    // Host phone's own outgoing commands (isFromMe) or whitelisted ADMIN_PHONE_NUMBERS are Admin
    const isAdminUser = Boolean(message.isFromMe) || this.isAdmin(message.senderId, message.isGroup);

    // 1c-optout. Recipient opt-out guard (stops annoyed users from tapping WhatsApp "Report Spam")
    if (
      !message.isGroup &&
      !isAdminUser &&
      /^(?:jooji|stop|unsubscribe|ha\s+ii\s+soo\s+dirin|ha\s+i\s+soo\s+dirin|fariimaha\s+jooji|iska\s+daa\s+fariimaha)[.!،\s]*$/i.test(lowerText)
    ) {
      broadcastService.optOut(message.chatId, text);
      await transport.sendMessage(
        message.chatId,
        'Waa hagaag walaal, fariimaha dambe laguu soo diri maayo. Raalli ahow haddii ay ku dhibtay. Nabadgelyo. 🙏'
      );
      return { handled: true, reason: 'Recipient opted out of broadcasts' };
    }

    // 1c-abaarso. Section 1: Official Abaarso University Voice Advertisement Trigger (!abaarso or @abaarso)
    const isAbaarsoAdTrigger =
      /^(?:!abaarso|@abaarso)(?:\s+.*)?$/i.test(lowerText.trim()) ||
      /(?:^|\s)(?:!abaarso|@abaarso)(?:\s|$)/i.test(lowerText);

    if (isAbaarsoAdTrigger) {
      console.log(`📢 [Router] Abaarso official voice ad triggered by ${message.senderId} in ${message.chatId}`);
      const delivered = await AbaarsoAdService.deliverAdvertisement(message.chatId, transport);
      return { handled: true, reason: `Abaarso voice advertisement completed (delivered=${delivered})` };
    }

    // ─── 1e. Comprehensive WhatsApp Management Help Command (!maamul / !whatsapp) ──
    if (/^[!./#]?(?:maamul|whatsapp|status-help|bot-help)\b/i.test(lowerText) && isAdminUser) {
      const helpText =
        `🌟 *[CARDOSO AI — AWOODDA MAAMULKA WHATSAPP 100%]* 🌟\n\n` +
        `📱 *WHATSAPP STATUS (STORIES):*\n` +
        `• \`!status <fariin>\` — Post garee status qoraal ah (midabbo qurxoon leh)\n` +
        `• \`!status\` (Sawir/Cod/Video la socdo) — Post garee sawir, muuqaal ama cod status ah\n` +
        `• \`!status-ai [mawduuc]\` — AI ayaa soo saaraya status dhiirigelin ah oo toos u dhigaya\n` +
        `• \`!autoview on/off\` — Daaro ama dami in bot-ku si toos ah u daawado status-yada dadka (Auto Seen)\n\n` +
        `💬 *REPLY & FARIIMO TOOS AH:*\n` +
        `• \`!reply <lambar> <fariin>\` — U dir fariin toos ah lambarkaas\n` +
        `• \`!reply <fariin>\` (adigoo qofka fariintiisa quote ku haya) — Toos ugu reply dheh qofkaas\n` +
        `• \`!cod <lambar> <fariin>\` — U dir cod Soomaali ah oo toos loo akhriyay lambarkaas\n` +
        `• \`!autoreply add <erey> | <jawaab>\` — Sameyso jawaab toos ah oo degdeg ah\n` +
        `• \`!autoreply list\` — Soo bandhig jawaabaha tooska ah ee kuu kaydsan\n` +
        `• \`!autoreply delete <erey>\` — Tirtir jawaab toos ah\n\n` +
        `👥 *MAAMULKA GROUPS-KA (100% CONTROL):*\n` +
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
        `• \`!delete\` (quote fariin) — Delete for everyone fariintaas\n` +
        `• \`!react <emoji>\` (quote fariin) — Emoji ku dhufo fariintaas\n` +
        `• \`!pin\` (quote fariin) — Pin garee fariintaas\n\n` +
        `📢 *SMART BROADCAST:*\n` +
        `• \`!fariin <qoraal>\` — U dir 50 qof oo cusub fariin shakhsiyeed\n` +
        `• \`!contacts\` — Hubi tirada guud ee contacts-ka kaydsan`;
      await transport.sendMessage(message.chatId, helpText);
      return { handled: true, reason: 'WhatsApp management help menu' };
    }

    // ─── 1f. WhatsApp Status Posting & Management ─────────────────────────────
    if (/^[!./#]?(?:status-ai)(?:\s+(.+))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:status-ai)(?:\s+(.+))?$/i);
      const topic = match?.[1]?.trim();
      await transport.sendMessage(message.chatId, '⏳ *[CARDOSO AI Status]*: AI ayaa diyaarinaya status dhiirigelin ah...');
      const res = await whatsappManagerService.generateAndPostAIStatus(topic);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'AI Status generated and posted' };
    }

    if (/^[!./#]?(?:autoview)(?:\s+(on|off))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:autoview)(?:\s+(on|off))?$/i);
      const mode = match?.[1]?.toLowerCase();
      if (mode === 'on') {
        whatsappManagerService.setAutoViewStatus(true);
        await transport.sendMessage(message.chatId, '👁️ *[Auto-View Status]*: Waa la *SHIDAY (ON)*! Hadda bot-ku wuxuu si toos ah u daawan doonaa dhammaan status-yada cusub ee ay dadku soo dhigaan. ✅');
      } else if (mode === 'off') {
        whatsappManagerService.setAutoViewStatus(false);
        await transport.sendMessage(message.chatId, '👁️ *[Auto-View Status]*: Waa la *DAMIDAY (OFF)*! Bot-ku ma daawan doono status-yada. 🛑');
      } else {
        const current = whatsappManagerService.isAutoViewStatusEnabled();
        await transport.sendMessage(
          message.chatId,
          `👁️ *[Auto-View Status]*: Xaaladda hadda waa: *${current ? 'ON (Furan)' : 'OFF (Xidhan)'}*.\nSi aad u beddesho qor:\n\`!autoview on\` ama \`!autoview off\``
        );
      }
      return { handled: true, reason: 'Auto-view status toggled' };
    }

    if (/^[!./#]?(?:status|post-status|sheeko)(?:\s+([\s\S]+))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:status|post-status|sheeko)(?:\s+([\s\S]+))?$/i);
      const statusContent = (match?.[1] || '').trim();

      // If media is attached (image, video, voice note)
      if (message.media?.dataBase64) {
        const buffer = Buffer.from(message.media.dataBase64, 'base64');
        const res = await whatsappManagerService.postMediaStatus({
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

      const res = await whatsappManagerService.postTextStatus(statusContent);
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

      const res = await whatsappManagerService.sendDirectReply(targetNumber, replyText, transport, { media: mediaToSend });
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'Direct reply sent to number' };
    }

    // Quoted reply in chat: !reply <fariin>
    if (/^[!./#]?reply\s+([\s\S]+)$/i.test(text) && isAdminUser && message.quotedParticipant) {
      const match = text.match(/^[!./#]?reply\s+([\s\S]+)$/i);
      const replyText = match![1].trim();
      const targetParticipant = message.quotedParticipant;
      const res = await whatsappManagerService.sendDirectReply(targetParticipant, replyText, transport, { replyToMessageId: message.quotedMessageId });
      await transport.sendMessage(message.chatId, `✅ Jawaabtaada si toos ah ayaa loogu celiyay @${targetParticipant.split('@')[0]}!`, {
        replyToMessageId: message.id,
      });
      return { handled: true, reason: 'Quoted participant reply sent' };
    }

    // Send Somali voice note directly to a number: !cod <number> <fariin>
    if (/^[!./#]?cod\s+([0-9+]+)\s+([\s\S]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?cod\s+([0-9+]+)\s+([\s\S]+)$/i);
      const targetNumber = match![1].trim();
      const voiceText = match![2].trim();
      const targetJid = whatsappManagerService.normalizeToJid(targetNumber);

      try {
        const synthesized = await VoiceReplyService.synthesizeVoice(voiceText, 'so');
        if (synthesized && transport.sendMedia) {
          await transport.sendMedia(targetJid, {
            type: 'audio',
            dataBuffer: synthesized.buffer,
            mimeType: synthesized.mimeType || 'audio/mpeg',
            ptt: true,
          });
          await transport.sendMessage(message.chatId, `🎙️ Cod Soomaali ah si guul leh ayaa loogu diray: *${targetJid}*`);
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
      const res = await whatsappManagerService.tagAll(message.chatId, customMsg);
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
      const res = await whatsappManagerService.kickMember(message.chatId, target);
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
      const res = await whatsappManagerService.addMember(message.chatId, target);
      if (res.success && res.jid) {
        const targetNum = res.jid.split('@')[0];
        // Beautiful welcome message with @mention tag
        const welcomeMessage =
          `🎉✨ *SOO DHAWAADA WALAAL @${targetNum}!* ✨🎉\n\n` +
          `Ku soo dhawow kooxda rasmiga ah! Waxaan kuu rajaynaynaa waqti waxbarasho, horumar, iyo faa'iido buuxda leh. 📚🎓\n\n` +
          `Haddii aad qabto su'aal ku saabsan jaamacadda, casharrada ama adeegyada, bot-ka ayaad weydiin kartaa mar kasta. Ku soo dhawow gacmo furan! 🤝💫`;
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
      const res = await whatsappManagerService.promoteMember(message.chatId, target);
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
      const res = await whatsappManagerService.demoteMember(message.chatId, target);
      await transport.sendMessage(message.chatId, res.message, {
        mentions: res.jid ? [res.jid] : undefined,
      });
      return { handled: true, reason: 'demote executed' };
    }

    if (/^[!./#]?(?:mute|xidh)$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await whatsappManagerService.setGroupMute(message.chatId, true);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'group mute executed' };
    }

    if (/^[!./#]?(?:unmute|fur)$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await whatsappManagerService.setGroupMute(message.chatId, false);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'group unmute executed' };
    }

    if (/^[!./#]?(?:grouplink|link)$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await whatsappManagerService.getGroupInviteLink(message.chatId);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'grouplink executed' };
    }

    if (/^[!./#]?groupinfo$/i.test(lowerText.trim()) && isAdminUser && message.isGroup) {
      const res = await whatsappManagerService.getGroupInfo(message.chatId);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'groupinfo executed' };
    }

    // ─── 1j. Profile & Account Management Commands ────────────────────────────
    if (/^[!./#]?setname\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?setname\s+(.+)$/i);
      const newName = match![1].trim();
      const res = await whatsappManagerService.updateProfileName(newName);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'setname executed' };
    }

    if (/^[!./#]?(?:setbio|setstatus)\s+(.+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?(?:setbio|setstatus)\s+(.+)$/i);
      const newBio = match![1].trim();
      const res = await whatsappManagerService.updateProfileBio(newBio);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'setbio executed' };
    }

    if (/^[!./#]?(?:setpp|setpfp)$/i.test(lowerText.trim()) && isAdminUser) {
      if (message.media?.type === 'image' && message.media.dataBase64) {
        const buffer = Buffer.from(message.media.dataBase64, 'base64');
        const res = await whatsappManagerService.updateProfilePicture(buffer);
        await transport.sendMessage(message.chatId, res.message);
      } else {
        await transport.sendMessage(message.chatId, 'ℹ️ Fadlan sawir soo dir adigoo qoraal ahaan ku soo raacinaya `!setpp`');
      }
      return { handled: true, reason: 'setpp executed' };
    }

    if (/^[!./#]?block\s+([0-9+]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?block\s+([0-9+]+)$/i);
      const target = match![1].trim();
      const res = await whatsappManagerService.blockUser(target);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'block executed' };
    }

    if (/^[!./#]?unblock\s+([0-9+]+)$/i.test(text) && isAdminUser) {
      const match = text.match(/^[!./#]?unblock\s+([0-9+]+)$/i);
      const target = match![1].trim();
      const res = await whatsappManagerService.unblockUser(target);
      await transport.sendMessage(message.chatId, res.message);
      return { handled: true, reason: 'unblock executed' };
    }

    if (/^[!./#]?(?:delete|tirtir)$/i.test(lowerText.trim()) && isAdminUser && message.quotedMessageId) {
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

    // ─── 1k. Security Guard: Reject any management/admin command from unauthorized users ──
    if (
      /^[!./#]?(?:status|post-status|sheeko|status-ai|autoview|tagall|dhammaan|kick|ka-saar|promote|dalacsii|demote|hoos-u-dhig|mute|xidh|unmute|fur|grouplink|link|groupinfo|setname|setbio|setstatus|setpp|setpfp|block|unblock|autoreply|delete|tirtir|reply|send|cod|maamul)\b/i.test(lowerText) &&
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
          const result = broadcastService.importFromText(content);
          const stats = broadcastService.getStats();
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

    // 2g. Manual Contacts Import Command (!dar / !add)
    if (/^!(?:dar|add|kudar)\s+/i.test(lowerText) && isAdminUser) {
      const numbersRaw = text.replace(/^!(?:dar|add|kudar)\s+/i, '');
      const addedCount = broadcastService.addManualNumbers(numbersRaw);
      const stats = broadcastService.getStats();
      await transport.sendMessage(
        message.chatId,
        `✅ *[CARDOSO AI]*: Waxaa si guul leh loogu daray *${addedCount} lambar* oo cusub!\nWadarta contacts-ka hadda waa *${stats.total} qof*.\n\nSi aad fariin ugu dirto, qor:\n\`!fariin <fariintaada>\``
      );
      return { handled: true, reason: 'Manual numbers added' };
    }

    // 2h. Check and auto-import contacts files (!shub / !import)
    if (/^!(?:shub|import|load-contacts)$/i.test(lowerText.trim()) && isAdminUser) {
      const imported = await broadcastService.checkAndAutoImportFiles();
      const stats = broadcastService.getStats();
      await transport.sendMessage(
        message.chatId,
        `📋 *[CARDOSO AI — IMPORT]*\nWaxaa faylasha laga soo galiyay *${imported} contacts* oo cusub!\nWadarta guud ee hadda ku jirta: *${stats.total} qof*.\n\nHaddii aad haysato faylka VCF ee taleefanka (2,384 contacts), waxaad toos ugu soo diri kartaa halkan chat-ka dukumenti ahaan!`
      );
      return { handled: true, reason: 'Contacts auto-import triggered' };
    }

    // 2i-barasho. Smart Barasho Command (!barasho [Magacaaga]) — sends tailored intro for named vs unnamed contacts
    if (/^!barasho(?:\s+(.+))?$/i.test(lowerText) && isAdminUser) {
      const match = text.match(/^!barasho(?:\s+(.+))?$/i);
      const ownerName = (match?.[1] || '').trim() || 'Maxamed';
      const result = await broadcastService.startBarashoBroadcast(message.chatId, transport, 50, ownerName);
      await transport.sendMessage(message.chatId, result.message);
      return { handled: true, reason: 'Barasho broadcast initiated' };
    }

    // 2i. Direct Broadcast Command (!broadcast / !fariin) — sends to the next 50 uncontacted contacts immediately!
    if (/^!(?:broadcast|fariin)(?:\s+|[:,-]\s*)/i.test(lowerText) && isAdminUser) {
      const broadcastContent = text.replace(/^!(?:broadcast|fariin)(?:\s+|[:,-]\s*)/i, '');
      const result = await broadcastService.startDirectBroadcast(message.chatId, broadcastContent, transport, 50);
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
    const hasAbaarsoCommand = lowerText.includes('@abaarso') || lowerText.startsWith('!abaarso') || /\b@abaarso\b/i.test(lowerText);
    const hasPrefix = lowerText.startsWith('!cardoso') || lowerText.startsWith('!abaarso') || lowerText.startsWith('!cod') || lowerText.startsWith('!sawir') || lowerText.startsWith(this.config.messaging.prefix.toLowerCase());
    const hasMention = message.isMentioned || hasCardosoText || hasVoiceCommand || hasImageCommand || hasAbaarsoCommand;
    const isMediaWithNoText = !text && !!(message as any).media;

    if (message.isGroup && this.config.messaging.groupResponseMode === 'mention_only') {
      // Always pass through if isMentioned or has special command (covers voice note replies, @cod, and @sawir trigger)
      if (!hasMention && !hasPrefix && !isMediaWithNoText) {
        console.log(`ℹ️ [Router Ignored] Group message la iska indhatiray sababtoo ah kuma jirto '@cardoso', '@abaarso', '@cod', '@sawir' ama '${this.config.messaging.prefix}'. Qoraal: "${text}"`);
        return { handled: false, reason: 'Group message without mention or prefix' };
      }
    }

    // Clean prefix and mention from query
    let queryText = text;
    for (const p of ['!cardoso', '@cardoso', '!abaarso', '@abaarso', '!cod', '@cod', '!sawir', '@sawir', '!image', '@image', this.config.messaging.prefix]) {
      if (queryText.toLowerCase().startsWith(p.toLowerCase())) {
        queryText = queryText.slice(p.length).trim();
      }
    }
    // Also strip inline mentions like "@cardoso", "@abaarso", "@cod", "@sawir"
    queryText = queryText.replace(/@cardoso\b/gi, '').replace(/@abaarso\b/gi, '').replace(/@cod\b/gi, '').replace(/@sawir\b/gi, '').replace(/@image\b/gi, '').trim();

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

    // Section 9: Strict Abaarso Silence Rule — Remain completely silent on unrelated questions
    const trimmedReply = (advisorResult.replyText || '').trim();
    if (!trimmedReply || trimmedReply === '[SILENCE]' || trimmedReply.includes('[SILENCE]')) {
      console.log(`🤫 [Router] Strict Abaarso Mode: Unrelated question received, remaining completely silent.`);
      return { handled: true, reason: 'Silent on unrelated question' };
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

  public getStatus() {
    return {
      isBotActiveGlobally: this.isBotActiveGlobally,
      inactiveGroupsCount: this.inactiveGroups.size,
      deduplicatorCacheSize: this.deduplicator.size(),
    };
  }
}

