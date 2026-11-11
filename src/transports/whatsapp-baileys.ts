import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  proto,
  WASocket,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { IMessagingTransport, IncomingMessage, OutgoingMessageOptions, OutgoingMedia } from './transport.interface.js';
import { MediaProcessorService } from '../services/media-processor.service.js';
import { VoiceReplyService } from '../services/voice-reply.service.js';
import { OutboundQueue } from './outbound-queue.js';
import { broadcastService } from '../services/broadcast.service.js';

export class WhatsAppBaileysTransport implements IMessagingTransport {
  public readonly name = 'whatsapp_baileys';
  public currentQR: string | null = null;
  private socket: WASocket | null = null;
  private connected: boolean = false;
  private authDir: string;
  private messageHandler: ((message: IncomingMessage) => Promise<void>) | null = null;
  private lastActivityTimestamp: number | null = null;
  private rawMessages: Map<string, any> = new Map();
  private botSentMessageIds: Set<string> = new Set();
  private recentSentTexts: Set<string> = new Set();
  private outboundQueue: OutboundQueue = new OutboundQueue(200, 400);
  private sessionExpired: boolean = false;

  constructor(authDir: string = './baileys_auth_info') {
    this.authDir = authDir;
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public getBotNumber(): string | null {
    if (!this.socket?.user?.id) return null;
    return this.socket.user.id.split(':')[0].split('@')[0];
  }

  public async unlinkSession(): Promise<void> {
    try {
      if (this.socket) {
        await this.socket.logout();
      }
    } catch {}
    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    } catch {}
    this.connected = false;
    this.currentQR = null;
    setTimeout(() => this.start(), 1500);
  }

  public async start(): Promise<void> {
    this.printSafetyWarning();

    // 1. Support complete session bundle (SESSION_BUNDLE_BASE64)
    if (!this.sessionExpired && process.env.SESSION_BUNDLE_BASE64 && !fs.existsSync(path.join(this.authDir, 'creds.json'))) {
      try {
        if (!fs.existsSync(this.authDir)) {
          fs.mkdirSync(this.authDir, { recursive: true });
        }
        const cleanRaw = process.env.SESSION_BUNDLE_BASE64.trim().replace(/\s+/g, '');
        let jsonStr = '';
        try {
          const compressed = Buffer.from(cleanRaw, 'base64');
          jsonStr = zlib.gunzipSync(compressed).toString('utf8');
        } catch {
          // If not gzipped or gzip corrupted, try plain base64 JSON
          jsonStr = Buffer.from(cleanRaw, 'base64').toString('utf8');
        }
        const bundle = JSON.parse(jsonStr);
        for (const [filename, content] of Object.entries(bundle)) {
          fs.writeFileSync(path.join(this.authDir, filename), content as string, 'utf8');
        }
        console.log(`✅ [WhatsAppBaileys] Si guul leh ayaa loo soo celiyay ${Object.keys(bundle).length} auth files oo buuxa!`);
      } catch (err: any) {
        console.error('⚠️ [WhatsAppBaileys] Failed to restore SESSION_BUNDLE_BASE64:', err.message);
      }
    }

    // 2. Fallback to single creds.json (SESSION_CREDS_BASE64)
    if (!this.sessionExpired && process.env.SESSION_CREDS_BASE64 && !fs.existsSync(path.join(this.authDir, 'creds.json'))) {
      try {
        if (!fs.existsSync(this.authDir)) {
          fs.mkdirSync(this.authDir, { recursive: true });
        }
        const cleanCreds = process.env.SESSION_CREDS_BASE64.trim().replace(/\s+/g, '');
        const credsDecoded = Buffer.from(cleanCreds, 'base64').toString('utf8');
        fs.writeFileSync(path.join(this.authDir, 'creds.json'), credsDecoded, 'utf8');
        console.log('✅ [WhatsAppBaileys] Si guul leh ayaa login-kii looga soo celiyay SESSION_CREDS_BASE64!');
      } catch (err: any) {
        console.error('⚠️ [WhatsAppBaileys] Failed to restore SESSION_CREDS_BASE64:', err.message);
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    const logger = pino({ level: 'silent' }); // Keep terminal clean

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We handle QR with qrcode-terminal
      logger,
      browser: ['CARDOSO AI', 'Chrome', '1.0.0'],
      syncFullHistory: true, // Sync full chat & contact history from WhatsApp Multi-Device
      getMessage: async (key) => {
        if (key?.id && this.rawMessages.has(key.id)) {
          return this.rawMessages.get(key.id)?.message;
        }
        return undefined;
      },
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.currentQR = qr;
        console.log('\n======================================================');
        console.log('  SCAN THIS QR CODE IN WHATSAPP TO LINK CARDOSO AI:   ');
        console.log('======================================================');
        qrcode.generate(qr, { small: true });
        console.log('Open WhatsApp > Linked Devices > Link a Device\n');
      }

      if (connection === 'close') {
        this.connected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsAppBaileys] Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          this.sessionExpired = true;
          console.warn('⚠️ [WhatsAppBaileys] Session has expired or was unlinked (401 Logged Out). Purging stale auth and requesting fresh QR Code in 2s...');
          try {
            fs.rmSync(this.authDir, { recursive: true, force: true });
          } catch {}
          setTimeout(() => this.start(), 2000);
        } else if (shouldReconnect) {
          setTimeout(() => this.start(), 3000);
        }
      } else if (connection === 'open') {
        this.connected = true;
        this.currentQR = null;
        this.lastActivityTimestamp = Date.now();
        const botId = this.socket?.user?.id || '';
        const botLid = (this.socket?.user as any)?.lid || '';
        if (botId || botLid) {
          broadcastService.setBotJid(botId, botLid);
        }
        console.log('\n✅ [WhatsAppBaileys] Successfully connected to WhatsApp Multi-Device network!');
      }
    });

    // ─── Contact & Chat Synchronization for Smart Broadcasting ───────────────
    // Baileys multi-device emits 'messaging-history.set' with full initial sync of chats & contacts
    this.socket.ev.on('messaging-history.set', ({ chats, contacts }: any) => {
      if (Array.isArray(contacts)) {
        for (const contact of contacts) {
          if (contact.id && broadcastService.isValidIndividualJid(contact.id)) {
            broadcastService.recordContact(contact.id, contact.name || contact.notify || (contact as any).verifiedName);
          }
        }
      }
      if (Array.isArray(chats)) {
        for (const chat of chats) {
          if (chat.id && broadcastService.isValidIndividualJid(chat.id)) {
            broadcastService.recordContact(chat.id, (chat as any).name || (chat as any).notify);
          }
        }
      }
      console.log(`📋 [Contacts Sync] Synchronized ${broadcastService.getContactsCount()} contacts from WhatsApp Multi-Device history!`);
    });

    this.socket.ev.on('chats.upsert', (chats: any[]) => {
      if (!Array.isArray(chats)) return;
      for (const chat of chats) {
        if (chat.id && broadcastService.isValidIndividualJid(chat.id)) {
          broadcastService.recordContact(chat.id, (chat as any).name || (chat as any).notify);
        }
      }
    });

    this.socket.ev.on('contacts.upsert', (contacts: any[]) => {
      if (!Array.isArray(contacts)) return;
      for (const contact of contacts) {
        if (contact.id && broadcastService.isValidIndividualJid(contact.id)) {
          broadcastService.recordContact(contact.id, contact.name || contact.notify || (contact as any).verifiedName);
        }
      }
    });

    this.socket.ev.on('contacts.update', (updates: any[]) => {
      if (!Array.isArray(updates)) return;
      for (const contact of updates) {
        const resolvedName = contact.name || contact.notify || (contact as any).verifiedName;
        if (contact.id && resolvedName && broadcastService.isValidIndividualJid(contact.id)) {
          broadcastService.recordContact(contact.id, resolvedName);
        }
      }
    });

    // ─── Incoming Call Handler (Auto-reject & Voice Redirect) ────────────────
    this.socket.ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call.status === 'offer') {
          console.log(`\n📞 [Incoming Call] Wicitaan laga helay: ${call.from} (ID: ${call.id})`);
          try {
            // 1. Gracefully reject the incoming call
            await this.socket?.rejectCall(call.id, call.from);

            // 2. Prepare friendly redirect message
            const callNotice = `Waan ka xumahay walaal, ma qaban karo wicitaan toos ah hadda. 📵\nFadlan iigu soo duub *Cod (Voice Note)* su'aashaada, aniguna isla markiiba cod baan kuugu soo jawaabayaa! 🎙️✨`;

            // 3. Synthesize natural Somali voice note so the user hears voice immediately
            try {
              const voiceResult = await VoiceReplyService.synthesizeVoice(callNotice, 'so');
              if (voiceResult) {
                await this.sendMedia(call.from, {
                  type: 'audio',
                  dataBuffer: voiceResult.buffer,
                  mimeType: 'audio/mpeg',
                  ptt: false,
                });
              }
            } catch (vErr) {
              console.warn('[WhatsAppBaileys] Voice synthesis for call redirect failed:', vErr);
            }

            // 4. Also send text notice
            await this.sendMessage(call.from, callNotice);
            console.log(`✅ [Call Handled] Qofkii soo wacay waxaa loo diray cod iyo qoraal codsanaya Voice Note!`);
          } catch (err) {
            console.error('[WhatsAppBaileys] Error handling call:', err);
          }
        }
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        // Cache raw message so we can safely quote it in replies without Baileys internal crashes
        if (msg.key?.id) {
          this.rawMessages.set(msg.key.id, msg);
          if (this.rawMessages.size > 200) {
            const oldest = this.rawMessages.keys().next().value;
            if (oldest) this.rawMessages.delete(oldest);
          }
        }

        const chatId = msg.key.remoteJid || '';
        const isGroup = chatId.endsWith('@g.us');
        const senderId = msg.key.participant || msg.key.remoteJid || '';

        // ─── Detect message type (text, audio, image, document) ───────────────────
        const msgType = Object.keys(msg.message)[0];
        const isAudio = msgType === 'audioMessage' || msgType === 'ptvMessage';
        const isImage = msgType === 'imageMessage';
        const isDocument = msgType === 'documentMessage';
        const isMedia = isAudio || isImage || isDocument;

        // Extract clean text from text or extended text
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.documentMessage?.caption ||
          (isAudio ? '🎙️ [Voice Note]' : '') ||
          '';

        // Ingest native WhatsApp shared contact cards (Share Contacts via WhatsApp)
        if (msg.message.contactMessage?.vcard) {
          const res = broadcastService.importFromText(msg.message.contactMessage.vcard);
          console.log(`👤 [WhatsApp Contact Shared]: Processed vCard (${res.added} new added).`);
        }
        if (msg.message.contactsArrayMessage?.contacts) {
          let totalAdded = 0;
          for (const c of msg.message.contactsArrayMessage.contacts) {
            if (c.vcard) {
              const res = broadcastService.importFromText(c.vcard);
              totalAdded += res.added;
            }
          }
          console.log(`👥 [WhatsApp Contacts Shared]: Processed contacts batch (${totalAdded} new added).`);
        }

        // Skip completely empty non-media messages
        if (!text.trim() && !isMedia && !msg.message.contactMessage && !msg.message.contactsArrayMessage) continue;

        // ─── Log incoming message ─────────────────────────────────────────────────
        if (isGroup) {
          console.log(`\n📩 [Group ${isMedia ? '(MEDIA) ' : ''}Message] "${text || msgType}" | Group ID: ${chatId} | Qofka: ${senderId}`);
        } else {
          console.log(`\n📩 [Private ${isMedia ? '(MEDIA) ' : ''}Message] "${text || msgType}" | Laga soo diray: ${senderId}`);
        }

        // ─── Download & encode media to base64 for Gemini multimodal ─────────────
        let mediaAttachment: { type: 'image' | 'audio' | 'document'; mimeType: string; dataBase64: string; fileName?: string } | undefined;
        if (isMedia) {
          try {
            const msgContent = isAudio
              ? (msg.message.audioMessage || msg.message.ptvMessage)
              : isImage
                ? msg.message.imageMessage
                : msg.message.documentMessage;
            const streamType = isAudio ? 'audio' : isImage ? 'image' : 'document';
            const stream = await downloadContentFromMessage(msgContent as any, streamType as any);
            const rawMime = (msgContent as any)?.mimetype || '';
            const mimeType = MediaProcessorService.getMimeType(msgType, rawMime);
            const dataBase64 = await MediaProcessorService.streamToBase64(stream as any);
            mediaAttachment = {
              type: streamType as 'image' | 'audio' | 'document',
              mimeType,
              dataBase64,
              fileName: (msgContent as any)?.fileName,
            };
          } catch (mediaErr: any) {
            console.warn(`[WhatsAppBaileys] Media download failed: ${mediaErr?.message}`);
          }
        }

        // ─── Extract contextInfo from ALL possible message types ──────────────────
        // CRITICAL: For voice notes (audioMessage), contextInfo is on audioMessage, NOT extendedTextMessage!
        // We must check every container type to correctly detect "reply to bot" in groups.
        const contextInfoRaw =
          msg.message.audioMessage?.contextInfo ||
          msg.message.ptvMessage?.contextInfo ||
          msg.message.extendedTextMessage?.contextInfo ||
          msg.message.imageMessage?.contextInfo ||
          msg.message.documentMessage?.contextInfo ||
          msg.message.videoMessage?.contextInfo ||
          undefined;

        // Support Quoted Media (e.g. user in a group quotes a voice note/image and types "@cardoso")
        const quotedMsg = contextInfoRaw?.quotedMessage;
        const quotedAudio = quotedMsg?.audioMessage || quotedMsg?.ptvMessage;
        const quotedImage = quotedMsg?.imageMessage;
        const quotedDoc = quotedMsg?.documentMessage;
        const hasQuotedMedia = !mediaAttachment && Boolean(quotedAudio || quotedImage || quotedDoc);

        if (hasQuotedMedia) {
          try {
            const streamType = quotedAudio ? 'audio' : quotedImage ? 'image' : 'document';
            const quotedContent = quotedAudio || quotedImage || quotedDoc;
            const stream = await downloadContentFromMessage(quotedContent as any, streamType as any);
            const rawMime = (quotedContent as any)?.mimetype || '';
            const quotedType = quotedAudio ? 'audioMessage' : quotedImage ? 'imageMessage' : 'documentMessage';
            const mimeType = MediaProcessorService.getMimeType(quotedType, rawMime);
            const dataBase64 = await MediaProcessorService.streamToBase64(stream as any);
            mediaAttachment = {
              type: streamType as 'image' | 'audio' | 'document',
              mimeType,
              dataBase64,
              fileName: (quotedContent as any)?.fileName,
            };
            console.log(`📎 [Quoted Media] Si guul leh ayaa loo soo dejiyay ${streamType} laga soo xigtay group-ka!`);
          } catch (quotedErr: any) {
            console.warn(`[WhatsAppBaileys] Quoted media download failed: ${quotedErr?.message}`);
          }
        }

        // ─── ANTI-LOOP & ECHO GUARDS ─────────────────────────────────────────────
        // 1. Skip if message ID is known to be sent by this bot
        if (msg.key?.id && this.botSentMessageIds.has(msg.key.id)) {
          continue;
        }

        const lowerText = text.toLowerCase().trim();

        // 2. Echo Protection: Ignore exact text recently sent by this bot
        if (lowerText && this.recentSentTexts.has(lowerText)) {
          continue;
        }

        // 3. Signature Protection: Drop any message containing bot tags/error banners
        if (
          lowerText.includes('[cardoso ai]') ||
          lowerText.includes('[cardoso ai cooldown]') ||
          lowerText.includes('xadkii daqiiqada') ||
          lowerText.includes('server-ku wuxuu gaadhay xadkii') ||
          lowerText.includes('gemini api request failed')
        ) {
          continue;
        }

        // Detect bot triggers: '@cardoso', '!cardoso', short voice trigger '@cod'/'!cod', image trigger '@sawir'/'!sawir', or broadcast commands
        const hasVoiceCommand = lowerText.includes('@cod') || lowerText.startsWith('!cod') || /\b@cod\b/i.test(lowerText);
        const hasImageCommand = lowerText.includes('@sawir') || lowerText.startsWith('!sawir') || lowerText.includes('@image') || lowerText.startsWith('!image') || /\b@sawir\b/i.test(lowerText);
        const hasBroadcastCommand =
          lowerText.startsWith('!fariin') ||
          lowerText.startsWith('!broadcast') ||
          lowerText.startsWith('!contacts') ||
          lowerText.startsWith('!liis') ||
          lowerText.startsWith('!xiriir') ||
          lowerText.startsWith('!jooji') ||
          lowerText.startsWith('!dar') ||
          lowerText.startsWith('!add') ||
          lowerText.startsWith('!kudar') ||
          lowerText.startsWith('!shub') ||
          lowerText.startsWith('!import') ||
          lowerText.startsWith('!load-contacts') ||
          lowerText.startsWith('!admin');

        const isContactsDoc = Boolean(
          mediaAttachment?.type === 'document' &&
          /\.(vcf|csv|txt)$/i.test(mediaAttachment.fileName || '')
        );

        const hasCardosoMention =
          lowerText.includes('@cardoso') ||
          lowerText.startsWith('!cardoso') ||
          hasVoiceCommand ||
          hasImageCommand ||
          hasBroadcastCommand ||
          isContactsDoc;

        // 4. Strict fromMe Handling:
        // Any message sent by the bot or from the host phone (fromMe):
        // Allow if the host explicitly typed '!cardoso', '@cardoso', '@cod', '@sawir', or broadcast commands '!fariin', '!broadcast', '!contacts', '!jooji'
        if (msg.key.fromMe) {
          if (!hasCardosoMention) {
            continue;
          }
        }

        // ─── Bot JID & LID extraction ─────────────────────────────────────────────
        // In WhatsApp groups (multi-device), participants are identified by their LID
        // (Linked Device Identifier, e.g. 277923424645192@lid), NOT by phone JID!
        // So we must check BOTH botJid (phone) AND botLid (lid) against quotedSender.
        const botJidRaw = this.socket?.user?.id || '';
        const botLidRaw = (this.socket?.user as any)?.lid || '';
        // Extract numeric/alphanum portion before "@"
        const botJid = botJidRaw.split(':')[0].split('@')[0];
        const botLid = botLidRaw.split(':')[0].split('@')[0];

        // contextInfoRaw was already extracted above from the correct message container
        const quotedSender = contextInfoRaw?.participant || '';
        const quotedStanzaId = contextInfoRaw?.stanzaId || '';

        // isReplyingToBot: true when user swipes-to-reply on ANY bot message in group
        // — matches by phone JID, LID, or stanzaId tracked in botSentMessageIds Set.
        const isReplyingToBot = Boolean(
          !msg.key.fromMe &&
          (
            (quotedSender && botJid && quotedSender.includes(botJid)) ||
            (quotedSender && botLid && quotedSender.includes(botLid)) ||
            (quotedStanzaId && this.botSentMessageIds.has(quotedStanzaId))
          )
        );

        if (isReplyingToBot) {
          console.log(`💬 [Reply Detected] Ardaygu wuxuu reply ugu sameeyay bot-ka! quotedSender=${quotedSender} botJid=${botJid} botLid=${botLid} stanzaId=${quotedStanzaId}`);
        }

        // In 1-on-1 private DM: ALWAYS respond (no need to type @cardoso).
        // In group chats: respond if @mentioned, !cardoso prefix, or replied-to-bot.
        // For voice/media in groups specifically: also allow if isReplyingToBot (swipe-reply voice note).
        const mentionedJids = contextInfoRaw?.mentionedJid || [];
        const isMentioned =
          !isGroup ||
          isReplyingToBot ||
          mentionedJids.some(j => (botJid && j.includes(botJid)) || (botLid && j.includes(botLid))) ||
          hasCardosoMention;

        // For media in groups, skip if not mentioned/replied-to (avoid processing every group photo/video)
        if (isMedia && isGroup && !isMentioned) continue;

        const incoming: IncomingMessage = {
          id: msg.key.id || `baileys_${Date.now()}`,
          senderId,
          senderName: msg.pushName || undefined,
          chatId,
          isGroup,
          content: text || (isAudio || mediaAttachment?.type === 'audio' ? '🎙️ [Voice Note – Fadlan codkan akhriso oo jawaab sii]' : isImage || mediaAttachment?.type === 'image' ? '🖼️ [Sawir – Fadlan sawirkan sharax]' : isDocument || mediaAttachment?.type === 'document' ? '📄 [Dukumenti – Fadlan soo koob macluumaadka muhiimka ah]' : ''),
          rawTimestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
          isMentioned,
          isFromMe: Boolean(msg.key.fromMe),
          replyToMessageId: msg.key.id || undefined,
          media: mediaAttachment,
        };

        if (this.messageHandler) {
          // Immediately show typing presence to user so they know bot is actively formulating response
          if (this.socket) {
            this.socket.sendPresenceUpdate('composing', chatId).catch(() => {});
          }

          try {
            await this.messageHandler(incoming);
          } catch (err) {
            console.error('[WhatsAppBaileys] Error processing message:', err);
          }
        }
      }
    });
  }

  public async stop(): Promise<void> {
    this.connected = false;
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }

  public async sendMessage(chatId: string, text: string, options?: OutgoingMessageOptions): Promise<boolean> {
    if (!this.socket || !this.connected) {
      console.warn('[WhatsAppBaileys] Cannot send message: transport not connected.');
      return false;
    }

    // Immediately cache normalized outbound text before network send to kill echo loops instantly
    const normalizedText = text.trim().toLowerCase();
    if (normalizedText) {
      this.recentSentTexts.add(normalizedText);
      if (this.recentSentTexts.size > 200) {
        const oldest = this.recentSentTexts.keys().next().value;
        if (oldest) this.recentSentTexts.delete(oldest);
      }
    }

    return this.outboundQueue.enqueue(async () => {
      try {
        // Human-like typing presence before sending (scales with length: ~0.9s - 2.3s)
        const typingMs = Math.min(2300, Math.max(900, text.length * 18)) + Math.floor(Math.random() * 400);
        await this.socket!.sendPresenceUpdate('composing', chatId).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, typingMs));
        await this.socket!.sendPresenceUpdate('paused', chatId).catch(() => {});

        const rawQuoted = options?.replyToMessageId ? this.rawMessages.get(options.replyToMessageId) : undefined;

        let sentMsg: any = undefined;
        try {
          if (rawQuoted) {
            sentMsg = await this.socket!.sendMessage(chatId, { text }, { quoted: rawQuoted });
          } else {
            sentMsg = await this.socket!.sendMessage(chatId, { text });
          }
        } catch (sendErr) {
          // Fallback: if sending with quoted fails, send as plain text without quote
          console.warn('[WhatsAppBaileys] Quoted send failed, falling back to direct send:', sendErr);
          sentMsg = await this.socket!.sendMessage(chatId, { text });
        }

        if (sentMsg?.key?.id) {
          this.botSentMessageIds.add(sentMsg.key.id);
          if (this.botSentMessageIds.size > 500) {
            const oldest = this.botSentMessageIds.keys().next().value;
            if (oldest) this.botSentMessageIds.delete(oldest);
          }
        }

        this.lastActivityTimestamp = Date.now();
        return true;
      } catch (err) {
        console.error('[WhatsAppBaileys] Send error:', err);
        return false;
      }
    });
  }

  public async sendMedia(chatId: string, media: OutgoingMedia, options?: OutgoingMessageOptions): Promise<boolean> {
    if (!this.socket || !this.connected) {
      console.warn('[WhatsAppBaileys] Cannot send media: transport not connected.');
      return false;
    }

    return this.outboundQueue.enqueue(async () => {
      try {
        const rawQuoted = options?.replyToMessageId ? this.rawMessages.get(options.replyToMessageId) : undefined;

        let sentMediaMsg: any = undefined;

        if (media.type === 'image') {
          try {
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              { image: media.dataBuffer, caption: media.caption },
              rawQuoted ? { quoted: rawQuoted } : undefined
            );
          } catch (quotedErr) {
            console.warn('[WhatsAppBaileys] Quoted image send failed, falling back to direct send:', quotedErr);
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              { image: media.dataBuffer, caption: media.caption }
            );
          }
        } else if (media.type === 'audio') {
          // Send authentic playable voice note for WhatsApp with waveform (PTT)
          const isPtt = media.ptt ?? true;
          const isOgg = (media.mimeType && media.mimeType.includes('ogg')) || media.dataBuffer.slice(0, 4).toString() === 'OggS';
          const audioPayload: any = {
            audio: media.dataBuffer,
            mimetype: isOgg ? 'audio/ogg; codecs=opus' : (media.mimeType || 'audio/mpeg'),
            ptt: isPtt,
          };
          if (!isPtt && media.fileName) {
            audioPayload.fileName = media.fileName;
          }

          try {
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              audioPayload,
              rawQuoted ? { quoted: rawQuoted } : undefined
            );
          } catch (quotedErr) {
            console.warn('[WhatsAppBaileys] Quoted audio send failed, falling back to direct send:', quotedErr);
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              audioPayload
            );
          }
        }

        // Track bot-sent media IDs so students can quote or reply to them in groups
        if (sentMediaMsg?.key?.id) {
          this.botSentMessageIds.add(sentMediaMsg.key.id);
          if (this.botSentMessageIds.size > 500) {
            const oldest = this.botSentMessageIds.keys().next().value;
            if (oldest) this.botSentMessageIds.delete(oldest);
          }
        }

        this.lastActivityTimestamp = Date.now();
        return true;
      } catch (err) {
        console.error('[WhatsAppBaileys] Error sending media:', err);
        return false;
      }
    });
  }

  public onMessage(handler: (message: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  public getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      activeChats: 1,
      lastActivity: this.lastActivityTimestamp,
    };
  }

  private printSafetyWarning(): void {
    console.log(`
⚠️  ==============================================================
⚠️  WHATSAPP WEB AUTOMATION BAN RISK NOTICE
⚠️  ==============================================================
⚠️  CARDOSO AI uses WhatsApp Web multi-device companion protocol.
⚠️  Meta actively monitors and suspends accounts detected using
⚠️  automated scripts or bulk unsolicited messaging.
⚠️
⚠️  SAFETY MEASURES INCLUDED IN THIS CODE:
⚠️  1. Mention-only trigger in groups (bot only speaks when tagged).
⚠️  2. Anti-spam typing presence and debounce delays.
⚠️  3. Per-student rate limits to prevent loop spamming.
⚠️  4. Never use your primary personal number for mass bots.
⚠️  ==============================================================
`);
  }
}

