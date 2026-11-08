import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { IMessagingTransport, IncomingMessage, OutgoingMessageOptions } from './transport.interface.js';

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

  constructor(authDir: string = './baileys_auth_info') {
    this.authDir = authDir;
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public async start(): Promise<void> {
    this.printSafetyWarning();

    // 1. Support complete session bundle (SESSION_BUNDLE_BASE64)
    if (process.env.SESSION_BUNDLE_BASE64 && !fs.existsSync(path.join(this.authDir, 'creds.json'))) {
      try {
        if (!fs.existsSync(this.authDir)) {
          fs.mkdirSync(this.authDir, { recursive: true });
        }
        const compressed = Buffer.from(process.env.SESSION_BUNDLE_BASE64, 'base64');
        const jsonStr = zlib.gunzipSync(compressed).toString('utf8');
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
    else if (process.env.SESSION_CREDS_BASE64 && !fs.existsSync(path.join(this.authDir, 'creds.json'))) {
      try {
        if (!fs.existsSync(this.authDir)) {
          fs.mkdirSync(this.authDir, { recursive: true });
        }
        const credsDecoded = Buffer.from(process.env.SESSION_CREDS_BASE64, 'base64').toString('utf8');
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
        if (shouldReconnect) {
          setTimeout(() => this.start(), 3000);
        }
      } else if (connection === 'open') {
        this.connected = true;
        this.currentQR = null;
        this.lastActivityTimestamp = Date.now();
        console.log('\n✅ [WhatsAppBaileys] Successfully connected to WhatsApp Multi-Device network!');
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

        // Extract clean text from text or extended text
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (!text.trim()) continue;

        // Log incoming message info to terminal for easy visibility and finding group IDs
        if (isGroup) {
          console.log(`\n📩 [Group Message] Qoraal: "${text}" | Group ID: ${chatId} | Qofka: ${senderId} ${msg.key.fromMe ? '(Adiga ayaad dirtay)' : ''}`);
        } else {
          console.log(`\n📩 [Private Message] Qoraal: "${text}" | Laga soo diray: ${senderId}`);
        }

        const contextInfo = msg.message.extendedTextMessage?.contextInfo;
        const quotedSender = contextInfo?.participant || '';
        const quotedStanzaId = contextInfo?.stanzaId || '';
        const botJid = this.socket?.user?.id?.split(':')[0] || '';

        // Check if user is directly replying / quoting a message sent by the bot
        const isReplyingToBot = Boolean(
          (quotedSender && botJid && quotedSender.includes(botJid)) ||
          (quotedStanzaId && this.botSentMessageIds.has(quotedStanzaId))
        );

        if (isReplyingToBot) {
          console.log(`💬 [Reply Detected] Ardaygu wuxuu toos ugu soo jawaabay (Reply) fariintii hore ee bot-ka!`);
        }

        const lowerText = text.toLowerCase();
        const hasCardosoMention = lowerText.includes('@cardoso') || lowerText.includes('@abaarso') || lowerText.includes('@abarso') || lowerText.startsWith('!cardoso') || lowerText.startsWith('!abaarso') || lowerText.startsWith('!abarso');

        // Allow host to test from their own phone:
        // - In 1-on-1 private chat: any human message typed by host (not sent by bot)
        // - In group chat: only if explicitly mentioning @cardoso / @abaarso or replying to bot
        const isHumanHostMessage = Boolean(msg.key.fromMe && (!msg.key.id || !this.botSentMessageIds.has(msg.key.id)));
        const isSelfCommand = isHumanHostMessage && (!isGroup || hasCardosoMention || isReplyingToBot);

        // Never respond to bot-sent messages or random host group chatter to avoid loops
        if (msg.key.fromMe && !isSelfCommand) {
          continue;
        }

        // In 1-on-1 private DM: ALWAYS true so student doesn't need to type @cardoso!
        // In group chats: must be @mentioned, prefixed, or replied to.
        const mentionedJids = contextInfo?.mentionedJid || [];
        const isMentioned = !isGroup || isSelfCommand || isReplyingToBot || mentionedJids.some(j => j.includes(botJid)) || hasCardosoMention;

        const incoming: IncomingMessage = {
          id: msg.key.id || `baileys_${Date.now()}`,
          senderId,
          senderName: msg.pushName || undefined,
          chatId,
          isGroup,
          content: text,
          rawTimestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
          isMentioned,
          replyToMessageId: msg.key.id || undefined,
        };

        if (this.messageHandler) {
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

    try {
      // Human-like anti-ban typing delay (1 to 2 seconds)
      await this.socket.sendPresenceUpdate('composing', chatId);
      await new Promise(resolve => setTimeout(resolve, 1500));
      await this.socket.sendPresenceUpdate('paused', chatId);

      const rawQuoted = options?.replyToMessageId ? this.rawMessages.get(options.replyToMessageId) : undefined;

      let sentMsg: any = undefined;
      try {
        if (rawQuoted) {
          sentMsg = await this.socket.sendMessage(chatId, { text }, { quoted: rawQuoted });
        } else {
          sentMsg = await this.socket.sendMessage(chatId, { text });
        }
      } catch (sendErr) {
        // Fallback: if sending with quoted fails, send as plain text without quote
        console.warn('[WhatsAppBaileys] Quoted send failed, falling back to direct send:', sendErr);
        sentMsg = await this.socket.sendMessage(chatId, { text });
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

