import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  proto,
  WASocket,
  downloadContentFromMessage,
  downloadMediaMessage,
  getBinaryNodeChild,
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
import { whatsappManagerService } from '../services/whatsapp-manager.service.js';

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
  /** Message IDs whose real content has already been dispatched (dedupes PDO resend vs. re-emit). */
  private processedMessageIds: Set<string> = new Set();
  /** View-Once stubs waiting for the retry / phone resend to deliver real content. */
  private pendingViewOnce: Map<string, NodeJS.Timeout> = new Map();
  private viewOnceFallbackSent: Set<string> = new Set();

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

  public getSocket(): WASocket | null {
    return this.socket;
  }

  public getRawMessage(id: string): any {
    return this.rawMessages.get(id);
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

    whatsappManagerService.setSocket(this.socket);

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
        whatsappManagerService.setSocket(null);
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
          whatsappManagerService.setBotJid(botId || botLid);
        }
        whatsappManagerService.setSocket(this.socket);
        console.log('\n✅ [WhatsAppBaileys] Successfully connected to WhatsApp Multi-Device network!');
      }
    });

    // ─── Contact & Chat Synchronization for Smart Broadcasting ───────────────
    const syncContactEntry = (entry: any) => {
      if (!entry) return;
      // Prefer the user's own WhatsApp profile name (notify/pushName/verifiedName) over saved phonebook nickname (entry.name)
      const profileName = entry.notify || entry.pushName || entry.verifiedName;
      const resolvedName = profileName || entry.name;
      const isProfileName = Boolean(profileName);
      const candidateIds = [entry.id, entry.lid, entry.pnJid, entry.phoneNumber]
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      for (const jid of candidateIds) {
        const normalizedJid = jid.includes('@') ? jid : `${jid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        if (broadcastService.isValidIndividualJid(normalizedJid)) {
          broadcastService.recordContact(normalizedJid, resolvedName, false, isProfileName);
        }
      }
    };

    // Baileys multi-device emits 'messaging-history.set' with full initial sync of chats & contacts
    this.socket.ev.on('messaging-history.set', ({ chats, contacts, messages }: any) => {
      // On-demand history may carry a View-Once message we are still waiting for
      if (Array.isArray(messages)) {
        for (const m of messages) {
          if (m?.message && m?.key?.id && this.pendingViewOnce.has(m.key.id)) {
            this.processIncomingBaileysMessage(m, 'history').catch(err =>
              console.error('[WhatsAppBaileys] Error processing history View-Once message:', err)
            );
          }
        }
      }
      if (Array.isArray(contacts)) contacts.forEach(syncContactEntry);
      if (Array.isArray(chats)) chats.forEach(syncContactEntry);
      console.log(`📋 [Contacts Sync] Synchronized ${broadcastService.getContactsCount()} contacts from WhatsApp Multi-Device history!`);
    });

    this.socket.ev.on('chats.upsert', (chats: any[]) => {
      if (Array.isArray(chats)) chats.forEach(syncContactEntry);
    });

    this.socket.ev.on('contacts.upsert', (contacts: any[]) => {
      if (Array.isArray(contacts)) contacts.forEach(syncContactEntry);
    });

    this.socket.ev.on('contacts.update', (updates: any[]) => {
      if (Array.isArray(updates)) updates.forEach(syncContactEntry);
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

    // ─── View-Once (1️⃣) raw stanza hook ─────────────────────────────────────
    // WhatsApp delivers View-Once media to linked devices as <unavailable type="view_once"/>
    // WITHOUT an <enc> payload. Baileys skips the retry receipt for these, so we send one
    // ourselves (with pre-keys) asking the sender's device to re-encrypt it for this device.
    const rawWs: any = (this.socket as any).ws;
    rawWs?.on?.('CB:message', (node: any) => {
      try {
        const unavailable = getBinaryNodeChild(node, 'unavailable');
        const enc = getBinaryNodeChild(node, 'enc');
        if (unavailable && !enc) {
          console.log(`👁️‍🗨️ [View-Once Stanza] type=${unavailable.attrs?.type || '?'} id=${node.attrs?.id} from=${node.attrs?.from} — codsanaya retry + resend...`);
          const sock: any = this.socket;
          if (sock?.sendRetryRequest) {
            Promise.resolve(sock.sendRetryRequest(node, true)).catch((e: any) =>
              console.warn(`[WhatsAppBaileys] View-Once retry request failed: ${e?.message}`)
            );
          }
        }
      } catch (err: any) {
        console.warn(`[WhatsAppBaileys] CB:message hook error: ${err?.message}`);
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      const nowSec = Math.floor(Date.now() / 1000);

      for (const msg of messages) {
        // 1. Primary phone answered our placeholder-resend (PDO) request → decode the real message(s)
        const resent = this.extractPdoResendMessages(msg);
        for (const recovered of resent) {
          console.log(`📥 [PDO Resend] Taleefanka ayaa dib u soo diray fariin (id=${recovered?.key?.id}).`);
          try {
            await this.processIncomingBaileysMessage(recovered, 'pdo');
          } catch (err) {
            console.error('[WhatsAppBaileys] Error processing PDO resend message:', err);
          }
        }

        // 2. 'append' batches (offline / buffered events) are only accepted when they are
        //    recent incoming messages or a View-Once message we are actively waiting for.
        if (type !== 'notify') {
          const id = msg.key?.id || '';
          const ts = WhatsAppBaileysTransport.toNumber(msg.messageTimestamp);
          const isRecent = ts > 0 && nowSec - ts <= 120;
          const isPending = Boolean(id && this.pendingViewOnce.has(id));
          if (msg.key?.fromMe || !(isRecent || isPending)) continue;
        }

        try {
          await this.processIncomingBaileysMessage(msg, type);
        } catch (err) {
          console.error('[WhatsAppBaileys] Error processing message:', err);
        }
      }
    });
  }

  /** Converts number / Long / string timestamps to a plain number (seconds). */
  private static toNumber(value: any): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toNumber === 'function') return value.toNumber();
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /** Decodes PEER_DATA_OPERATION placeholder-resend responses into full WebMessageInfo objects. */
  private extractPdoResendMessages(msg: any): any[] {
    const results =
      msg?.message?.protocolMessage?.peerDataOperationRequestResponseMessage?.peerDataOperationResult || [];
    const out: any[] = [];
    for (const r of results) {
      const bytes = r?.placeholderMessageResendResponse?.webMessageInfoBytes;
      if (!bytes) continue;
      try {
        out.push(proto.WebMessageInfo.decode(bytes));
      } catch (err: any) {
        console.warn(`[WhatsAppBaileys] Failed decoding PDO webMessageInfoBytes: ${err?.message}`);
      }
    }
    return out;
  }

  private isSelfChat(chatId: string): boolean {
    const num = chatId.split('@')[0].split(':')[0];
    const botNum = this.getBotNumber();
    const botLid = ((this.socket?.user as any)?.lid || '').split(':')[0].split('@')[0];
    return Boolean(num && ((botNum && num === botNum) || (botLid && num === botLid)));
  }

  /**
   * A View-Once stub (<unavailable type="view_once"/>) arrived without content.
   * Wait for the retry / phone resend to deliver the real message; if WhatsApp never
   * releases it to this linked device, reply helpfully instead of staying silent.
   */
  private handleViewOnceStub(msg: any): void {
    const id: string = msg.key?.id || '';
    if (!id || this.processedMessageIds.has(id) || this.pendingViewOnce.has(id)) return;

    const chatId: string = msg.key.remoteJid || '';
    const isGroup = chatId.endsWith('@g.us');
    const fromMe = Boolean(msg.key.fromMe);
    console.log(`\n👁️‍🗨️ [View-Once 1️⃣ Stub] Fariin hal-mar-la-arko ayaa timid (id=${id}, chat=${chatId}). Waxaa la sugayaa in dib loo soo diro...`);

    // Ask the primary phone again via placeholder resend AND on-demand history sync
    const sock: any = this.socket;
    if (sock?.requestPlaceholderResend) {
      Promise.resolve(
        sock.requestPlaceholderResend({ remoteJid: chatId, fromMe, id, participant: msg.key.participant || undefined })
      ).catch(() => {});
    }
    if (sock?.fetchMessageHistory) {
      const ts = WhatsAppBaileysTransport.toNumber(msg.messageTimestamp) * 1000 || Date.now();
      Promise.resolve(
        sock.fetchMessageHistory(2, msg.key, ts)
      ).catch(() => {});
    }

    const timer = setTimeout(() => {
      this.pendingViewOnce.delete(id);
      if (this.processedMessageIds.has(id)) return;
      console.warn(`⚠️ [View-Once 1️⃣] WhatsApp ma u oggolaan linked device-ka inuu furo fariinta (id=${id}).`);
      // Groups: stay quiet (we cannot know whether the bot was addressed). Host's own outgoing
      // View-Once to other people must never trigger a reply in that person's chat.
      if (isGroup) return;
      if (fromMe && !this.isSelfChat(chatId)) return;
      this.sendViewOnceFallback(chatId, id).catch(err =>
        console.error('[WhatsAppBaileys] View-Once fallback reply failed:', err)
      );
    }, 12000);

    this.pendingViewOnce.set(id, timer);
  }

  /** Natural Somali voice (or text) reply asking the user to resend View-Once media normally. */
  private async sendViewOnceFallback(chatId: string, messageId?: string): Promise<void> {
    if (messageId) {
      if (this.viewOnceFallbackSent.has(messageId)) return;
      this.viewOnceFallbackSent.add(messageId);
      if (this.viewOnceFallbackSent.size > 300) {
        const oldest = this.viewOnceFallbackSent.values().next().value;
        if (oldest) this.viewOnceFallbackSent.delete(oldest);
      }
    }

    const notice =
      'Walaal, codadka ama sawirrada *View Once (1️⃣)* waxaa xannibay amniga WhatsApp-ka si aan aaladaha ku xiran toos ugu furin. 🔒\n\n' +
      'Si aan isla markiiba uga jawaabo, labadan midkood samee:\n' +
      '• *Swipe/Reply ku qabo:* Codkaaga uun reply u dheh, WhatsApp-kuna toos buu ii soo fasaxayaa! 💬\n' +
      '• *Cod Caadi ah:* Ii soo duub cod adigoon taaban astaanta (1️⃣) — isla markiiba cod baan kuugu soo jawaabayaa! 🎙️✨';

    let voiceSent = false;
    try {
      const voice = await VoiceReplyService.synthesizeVoice(notice, 'so');
      if (voice) {
        voiceSent = await this.sendMedia(chatId, {
          type: 'audio',
          dataBuffer: voice.buffer,
          mimeType: voice.mimeType || 'audio/mpeg',
          ptt: true,
        }, messageId ? { replyToMessageId: messageId } : undefined);
      }
    } catch (vErr: any) {
      console.warn(`[WhatsAppBaileys] View-Once fallback voice synthesis failed: ${vErr?.message}`);
    }
    if (!voiceSent) {
      await this.sendMessage(chatId, notice, messageId ? { replyToMessageId: messageId } : undefined);
    }
    console.log(`📨 [View-Once 1️⃣] Qofka waxaa loo diray jawaab ku saabsan fariinta hal-mar-la-arko.`);
  }

  private async processIncomingBaileysMessage(msg: any, source: string): Promise<void> {
    if (!msg?.key) return;

    // View-Once stub without content → wait for retry/resend, never stay silent
    if (!msg.message) {
      if ((msg.key as any)?.isViewOnce) {
        this.handleViewOnceStub(msg);
      }
      return;
    }

    if (msg.key.id && this.processedMessageIds.has(msg.key.id)) return;

    // Cache raw message so we can safely quote it in replies AND recover View Once media when quoted
    if (msg.key?.id) {
      this.rawMessages.set(msg.key.id, msg);
      if (this.rawMessages.size > 1000) {
        const oldest = this.rawMessages.keys().next().value;
        if (oldest) this.rawMessages.delete(oldest);
      }
    }

    const chatId = msg.key.remoteJid || '';
    const isGroup = chatId.endsWith('@g.us');
    const senderId = msg.key.participant || msg.participant || msg.key.remoteJid || '';

    // ─── WhatsApp Status (Story) Handling & Auto-View Status ─────────────────
    if (chatId === 'status@broadcast') {
      const statusSender = msg.key.participant || msg.participant || '';
      // 1. Auto View Status: automatically mark contacts' status seen in real-time
      if (whatsappManagerService.isAutoViewStatusEnabled() && this.socket) {
        try {
          await this.socket.readMessages([msg.key]);
          console.log(`👁️ [Auto-View Status] Status-ka waxaa arkay bot-ka: ${statusSender || 'Contact'}`);
        } catch (e: any) {
          console.warn(`[WhatsAppBaileys] Error auto-viewing status: ${e?.message}`);
        }
      }

      // 2. Record contact pushName if present
      if (msg.pushName && statusSender && broadcastService.isValidIndividualJid(statusSender)) {
        broadcastService.recordContact(statusSender, msg.pushName, false, true);
      }

      // WhatsApp status updates are stories, do not route them as incoming private chat messages
      return;
    }

    // Always record sender WhatsApp profile pushName (both in DMs and group participant profiles)
    if (!msg.key.fromMe && msg.pushName) {
      const targetProfileJid = isGroup ? (msg.key.participant || '') : chatId;
      if (broadcastService.isValidIndividualJid(targetProfileJid)) {
        broadcastService.recordContact(targetProfileJid, msg.pushName, false, true);
      }
    }

    // ─── Unwrap View Once ("one-click" 1️⃣), Ephemeral & Detect Message Type ──
    const unwrapped = MediaProcessorService.unwrapMessage(msg.message);
    const innerMsg = unwrapped.message;
    const msgType = unwrapped.msgType;
    const isViewOnce = unwrapped.isViewOnce || Boolean((msg.key as any)?.isViewOnce);
    const isAudio = unwrapped.mediaKind === 'audio';
    const isImage = unwrapped.mediaKind === 'image';
    const isVideo = unwrapped.mediaKind === 'video';
    const isDocument = unwrapped.mediaKind === 'document';
    const isMedia = Boolean(unwrapped.mediaKind);

    // Extract clean text from text, extended text, or media caption
    const text =
      innerMsg.conversation ||
      innerMsg.extendedTextMessage?.text ||
      innerMsg.imageMessage?.caption ||
      innerMsg.videoMessage?.caption ||
      innerMsg.documentMessage?.caption ||
      (isAudio ? (isViewOnce ? '🎙️ [View Once Voice Note]' : '🎙️ [Voice Note]') : '') ||
      '';

    // Ingest native WhatsApp shared contact cards (Share Contacts via WhatsApp)
    if (innerMsg.contactMessage?.vcard) {
      const res = broadcastService.importFromText(innerMsg.contactMessage.vcard);
      console.log(`👤 [WhatsApp Contact Shared]: Processed vCard (${res.added} new added).`);
    }
    if (innerMsg.contactsArrayMessage?.contacts) {
      let totalAdded = 0;
      for (const c of innerMsg.contactsArrayMessage.contacts) {
        if (c.vcard) {
          const res = broadcastService.importFromText(c.vcard);
          totalAdded += res.added;
        }
      }
      console.log(`👥 [WhatsApp Contacts Shared]: Processed contacts batch (${totalAdded} new added).`);
    }

    // Skip completely empty non-media messages
    if (!text.trim() && !isMedia && !innerMsg.contactMessage && !innerMsg.contactsArrayMessage) return;

    // Real content arrived → mark processed (dedupes PDO path vs. Baileys re-emit) & cancel View-Once wait
    if (msg.key.id) {
      this.processedMessageIds.add(msg.key.id);
      if (this.processedMessageIds.size > 2000) {
        const oldest = this.processedMessageIds.values().next().value;
        if (oldest) this.processedMessageIds.delete(oldest);
      }
      const pendingTimer = this.pendingViewOnce.get(msg.key.id);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.pendingViewOnce.delete(msg.key.id);
        console.log(`✅ [View-Once 1️⃣] Fariintii hal-mar-la-arko si guul leh ayaa loo helay (source=${source})!`);
      }
    }

    // ─── Log incoming message ─────────────────────────────────────────────────
    const mediaTag = isViewOnce ? '(VIEW-ONCE 1️⃣ MEDIA) ' : isMedia ? '(MEDIA) ' : '';
    if (isGroup) {
      console.log(`\n📩 [Group ${mediaTag}Message] "${text || msgType}" | Group ID: ${chatId} | Qofka: ${senderId}`);
    } else {
      console.log(`\n📩 [Private ${mediaTag}Message] "${text || msgType}" | Laga soo diray: ${senderId}`);
    }

    // ─── Download & encode media (including View Once 1️⃣) to base64 for Gemini ─
    let mediaAttachment: { type: 'image' | 'audio' | 'document' | 'video'; mimeType: string; dataBase64: string; fileName?: string; isViewOnce?: boolean } | undefined;
    if (isMedia && unwrapped.mediaContent && unwrapped.baileysMediaType && unwrapped.mediaKind) {
      try {
        const stream = await downloadContentFromMessage(unwrapped.mediaContent as any, unwrapped.baileysMediaType as any);
        const rawMime = (unwrapped.mediaContent as any)?.mimetype || '';
        const mimeType = MediaProcessorService.getMimeType(msgType, rawMime);
        const dataBase64 = await MediaProcessorService.streamToBase64(stream as any);
        if (dataBase64) {
          mediaAttachment = {
            type: unwrapped.mediaKind,
            mimeType,
            dataBase64,
            fileName: (unwrapped.mediaContent as any)?.fileName,
            isViewOnce,
          };
          if (isViewOnce) {
            console.log(`👁️‍🗨️ [View-Once / One-Click 1️⃣] Si guul leh ayaa loo furay oo loo akhriyay ${unwrapped.mediaKind} (${mimeType})!`);
          }
        }
      } catch (mediaErr: any) {
        console.warn(`[WhatsAppBaileys] Media download failed (${mediaErr?.message}), trying downloadMediaMessage fallback...`);
        try {
          const buffer = await downloadMediaMessage(
            { key: msg.key, message: innerMsg } as any,
            'buffer',
            {},
            {
              logger: pino({ level: 'silent' }) as any,
              reuploadRequest: this.socket ? this.socket.updateMediaMessage : (async (m: any) => m),
            }
          );
          if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
            const rawMime = (unwrapped.mediaContent as any)?.mimetype || '';
            const mimeType = MediaProcessorService.getMimeType(msgType, rawMime);
            mediaAttachment = {
              type: unwrapped.mediaKind,
              mimeType,
              dataBase64: buffer.toString('base64'),
              fileName: (unwrapped.mediaContent as any)?.fileName,
              isViewOnce,
            };
            console.log(`✅ [WhatsAppBaileys] Fallback downloadMediaMessage succeeded for ${unwrapped.mediaKind}!`);
          }
        } catch (fallbackErr: any) {
          console.warn(`[WhatsAppBaileys] Fallback media download also failed: ${fallbackErr?.message}`);
        }
      }
    }

    // ─── Extract contextInfo from ALL possible message types (including unwrapped View Once) ──
    // CRITICAL: For voice notes (audioMessage), contextInfo is on audioMessage, NOT extendedTextMessage!
    const contextInfoRaw =
      innerMsg.audioMessage?.contextInfo ||
      innerMsg.ptvMessage?.contextInfo ||
      innerMsg.extendedTextMessage?.contextInfo ||
      innerMsg.imageMessage?.contextInfo ||
      innerMsg.documentMessage?.contextInfo ||
      innerMsg.videoMessage?.contextInfo ||
      innerMsg.stickerMessage?.contextInfo ||
      msg.message.audioMessage?.contextInfo ||
      msg.message.ptvMessage?.contextInfo ||
      msg.message.extendedTextMessage?.contextInfo ||
      msg.message.imageMessage?.contextInfo ||
      msg.message.documentMessage?.contextInfo ||
      msg.message.videoMessage?.contextInfo ||
      undefined;

    // Support Quoted Media (including when user quotes a View Once 1️⃣ voice note, photo, or video!)
    const quotedStanzaIdForMedia = contextInfoRaw?.stanzaId || '';
    const cachedOriginalMsg = quotedStanzaIdForMedia ? this.rawMessages.get(quotedStanzaIdForMedia) : undefined;
    const quotedUnwrapped = contextInfoRaw?.quotedMessage
      ? MediaProcessorService.unwrapMessage(contextInfoRaw.quotedMessage)
      : null;
    const cachedUnwrapped = cachedOriginalMsg?.message
      ? MediaProcessorService.unwrapMessage(cachedOriginalMsg.message)
      : null;

    // Prefer quotedUnwrapped if it has valid mediaKey + (url or directPath); otherwise recover from cachedOriginalMsg!
    const quotedHasKeys = Boolean(
      quotedUnwrapped?.mediaContent?.mediaKey &&
      (quotedUnwrapped?.mediaContent?.url || quotedUnwrapped?.mediaContent?.directPath)
    );
    const effectiveQuoted = quotedHasKeys
      ? quotedUnwrapped
      : (cachedUnwrapped?.mediaContent ? cachedUnwrapped : quotedUnwrapped);

    const hasQuotedMedia = !mediaAttachment && Boolean(effectiveQuoted?.mediaContent && effectiveQuoted?.baileysMediaType && effectiveQuoted?.mediaKind);

    if (hasQuotedMedia && effectiveQuoted) {
      try {
        const stream = await downloadContentFromMessage(
          effectiveQuoted.mediaContent as any,
          effectiveQuoted.baileysMediaType as any
        );
        const rawMime = (effectiveQuoted.mediaContent as any)?.mimetype || '';
        const mimeType = MediaProcessorService.getMimeType(effectiveQuoted.msgType, rawMime);
        const dataBase64 = await MediaProcessorService.streamToBase64(stream as any);
        if (dataBase64) {
          mediaAttachment = {
            type: effectiveQuoted.mediaKind!,
            mimeType,
            dataBase64,
            fileName: (effectiveQuoted.mediaContent as any)?.fileName,
            isViewOnce: effectiveQuoted.isViewOnce,
          };
          console.log(`📎 [Quoted ${effectiveQuoted.isViewOnce ? 'View-Once 1️⃣ ' : ''}Media] Si guul leh ayaa loo soo dejiyay ${effectiveQuoted.mediaKind} laga soo xigtay chat-ka!`);
        }
      } catch (quotedErr: any) {
        console.warn(`[WhatsAppBaileys] Quoted media download failed: ${quotedErr?.message}`);
      }
    }

    // ─── ANTI-LOOP & ECHO GUARDS ─────────────────────────────────────────────
    // 1. Skip if message ID is known to be sent by this bot
    if (msg.key?.id && this.botSentMessageIds.has(msg.key.id)) {
      return;
    }

    const lowerText = text.toLowerCase().trim();

    // 2. Echo Protection: Ignore exact text recently sent by this bot
    if (lowerText && this.recentSentTexts.has(lowerText)) {
      return;
    }

    // 3. Signature Protection: Drop any message containing bot tags/error banners
    if (
      lowerText.includes('[cardoso ai]') ||
      lowerText.includes('[cardoso ai cooldown]') ||
      lowerText.includes('xadkii daqiiqada') ||
      lowerText.includes('server-ku wuxuu gaadhay xadkii') ||
      lowerText.includes('gemini api request failed')
    ) {
      return;
    }

    // Detect bot triggers: '@cardoso', '!cardoso', short voice trigger '@cod'/'!cod', image trigger '@sawir'/'!sawir', broadcast commands, or Abaarso triggers
    const hasVoiceCommand = lowerText.includes('@cod') || lowerText.startsWith('!cod') || /\b@cod\b/i.test(lowerText);
    const hasImageCommand = lowerText.includes('@sawir') || lowerText.startsWith('!sawir') || lowerText.includes('@image') || lowerText.startsWith('!image') || /\b@sawir\b/i.test(lowerText);
    const hasAbaarsoCommand =
      lowerText.includes('@abaarso') ||
      lowerText.startsWith('!abaarso') ||
      /\b@abaarso\b/i.test(lowerText) ||
      /\b!abaarso\b/i.test(lowerText);
    const hasBroadcastCommand =
      lowerText.startsWith('!fariin') ||
      lowerText.startsWith('!barasho') ||
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

    // Any command starting with standard prefix (!, ., /, #)
    const isPrefixCommand = /^[!./#][a-zA-Z0-9_-]+/i.test(lowerText);

    // Any WhatsApp management or bot command keyword (with or without prefix)
    const hasManagementCommand =
      /^[!./#]?(?:status|post-status|sheeko|status-ai|autoview|tagall|dhammaan|kick|ka-saar|promote|dalacsii|demote|hoos-u-dhig|mute|xidh|unmute|fur|grouplink|link|groupinfo|setname|setbio|setstatus|setpp|setpfp|block|unblock|autoreply|delete|tirtir|reply|send|cod|maamul|help|shax|ogaansho|kuliyadaha|kharashka|shuruudaha|contact|reset|abaarso)\b/i.test(lowerText);

    const hasCardosoMention =
      lowerText.includes('@cardoso') ||
      lowerText.startsWith('!cardoso') ||
      isPrefixCommand ||
      hasManagementCommand ||
      hasVoiceCommand ||
      hasImageCommand ||
      hasBroadcastCommand ||
      hasAbaarsoCommand ||
      isContactsDoc;

    // 4. Strict fromMe Handling:
    // Allow host messages only with explicit triggers — or a View-Once test sent to the bot's own chat
    // (the bot itself never sends View-Once messages).
    if (msg.key.fromMe) {
      const isSelfViewOnceTest = isViewOnce && this.isSelfChat(chatId);
      if (!hasCardosoMention && !isSelfViewOnceTest) {
        return;
      }
    }

    // ─── Bot JID & LID extraction ─────────────────────────────────────────────
    const botJidRaw = this.socket?.user?.id || '';
    const botLidRaw = (this.socket?.user as any)?.lid || '';
    const botJid = botJidRaw.split(':')[0].split('@')[0];
    const botLid = botLidRaw.split(':')[0].split('@')[0];

    const quotedSender = contextInfoRaw?.participant || '';
    const quotedStanzaId = contextInfoRaw?.stanzaId || '';

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

    // In 1-on-1 private DM: ALWAYS respond. In groups: @mention, !cardoso prefix, or reply-to-bot.
    const mentionedJids: string[] = contextInfoRaw?.mentionedJid || [];
    const isMentioned =
      !isGroup ||
      isReplyingToBot ||
      mentionedJids.some((j: string) => (botJid && j.includes(botJid)) || (botLid && j.includes(botLid))) ||
      hasCardosoMention;

    // For media in groups, skip if not mentioned/replied-to (avoid processing every group photo/video)
    if (isMedia && isGroup && !isMentioned) return;

    // View-Once media whose bytes WhatsApp withheld (no mediaKey / download blocked):
    // never send a blind placeholder to Gemini (it would hallucinate) — explain instead.
    if (isMedia && isViewOnce && !mediaAttachment) {
      console.warn(`⚠️ [View-Once 1️⃣] Media-da lama soo dejin karin (mediaKey/url ma jiro). Jawaab caawimo ah ayaa la dirayaa.`);
      await this.sendViewOnceFallback(chatId, msg.key.id || undefined);
      return;
    }

    const incoming: IncomingMessage = {
      id: msg.key.id || `baileys_${Date.now()}`,
      senderId,
      senderName: msg.pushName || undefined,
      chatId,
      isGroup,
      content: text || (isAudio || mediaAttachment?.type === 'audio' ? '🎙️ [Voice Note – Fadlan codkan dhagayso oo jawaab sii]' : isImage || mediaAttachment?.type === 'image' ? '🖼️ [Sawir – Fadlan sawirkan eeg oo ka hadal waxa ku jira]' : isVideo || mediaAttachment?.type === 'video' ? '🎬 [Muuqaal – Fadlan muuqaalkan daawo oo dhagayso kadibna ka jawaab]' : isDocument || mediaAttachment?.type === 'document' ? '📄 [Dukumenti – Fadlan soo koob macluumaadka muhiimka ah]' : ''),
      rawTimestamp: WhatsAppBaileysTransport.toNumber(msg.messageTimestamp) * 1000 || Date.now(),
      isMentioned,
      isFromMe: Boolean(msg.key.fromMe),
      replyToMessageId: msg.key.id || undefined,
      quotedMessageId: quotedStanzaId || undefined,
      quotedParticipant: quotedSender || undefined,
      mentionedJids: mentionedJids.length > 0 ? mentionedJids : undefined,
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
        // Quick natural typing presence before immediate send (250-450ms)
        const typingMs = 250 + Math.floor(Math.random() * 200);
        await this.socket!.sendPresenceUpdate('composing', chatId).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, typingMs));
        await this.socket!.sendPresenceUpdate('paused', chatId).catch(() => {});

        const rawQuoted = options?.replyToMessageId ? this.rawMessages.get(options.replyToMessageId) : undefined;
        const isStatus = chatId === 'status@broadcast';
        const statusJidList = isStatus ? whatsappManagerService.getStatusRecipients() : [];
        const sendOptions: any = {};
        if (isStatus && statusJidList.length > 0) {
          sendOptions.statusJidList = statusJidList;
        } else if (rawQuoted) {
          sendOptions.quoted = rawQuoted;
        }

        let sentMsg: any = undefined;
        const msgPayload: any = { text };
        if (options?.mentions && options.mentions.length > 0) {
          msgPayload.mentions = options.mentions;
        }

        try {
          sentMsg = await this.socket!.sendMessage(chatId, msgPayload, sendOptions);
        } catch (sendErr) {
          // Fallback: if sending with options fails, send directly
          console.warn('[WhatsAppBaileys] Send with options failed, falling back to direct send:', sendErr);
          sentMsg = await this.socket!.sendMessage(chatId, msgPayload);
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
        const isStatus = chatId === 'status@broadcast';
        const statusJidList = isStatus ? whatsappManagerService.getStatusRecipients() : [];
        const sendOptions: any = {};
        if (isStatus && statusJidList.length > 0) {
          sendOptions.statusJidList = statusJidList;
        } else if (rawQuoted) {
          sendOptions.quoted = rawQuoted;
        }

        let sentMediaMsg: any = undefined;

        if (media.type === 'image') {
          try {
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              { image: media.dataBuffer, caption: media.caption },
              sendOptions
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
              sendOptions
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

  public async postStatus(content: { text?: string; media?: OutgoingMedia; backgroundColor?: string; font?: number }): Promise<boolean> {
    if (content.media) {
      const res = await whatsappManagerService.postMediaStatus({
        buffer: content.media.dataBuffer,
        mimeType: content.media.mimeType,
        caption: content.media.caption,
        type: content.media.type === 'document' ? 'image' : content.media.type,
      }, {
        backgroundColor: content.backgroundColor,
      });
      return res.success;
    } else if (content.text) {
      const res = await whatsappManagerService.postTextStatus(content.text, {
        backgroundColor: content.backgroundColor,
        font: content.font,
      });
      return res.success;
    }
    return false;
  }

  public async deleteMessage(chatId: string, messageId: string, participant?: string): Promise<boolean> {
    if (!this.socket || !this.connected) return false;
    try {
      const raw = this.rawMessages.get(messageId);
      const key = raw?.key || {
        remoteJid: chatId,
        fromMe: true,
        id: messageId,
        participant,
      };
      const res = await whatsappManagerService.deleteMessage(chatId, key);
      return res.success;
    } catch {
      return false;
    }
  }

  public async reactToMessage(chatId: string, messageId: string, emoji: string, participant?: string): Promise<boolean> {
    if (!this.socket || !this.connected) return false;
    try {
      const raw = this.rawMessages.get(messageId);
      const key = raw?.key || {
        remoteJid: chatId,
        fromMe: false,
        id: messageId,
        participant,
      };
      const res = await whatsappManagerService.reactToMessage(chatId, key, emoji);
      return res.success;
    } catch {
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

