import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  proto,
  WASocket,
  downloadContentFromMessage,
  downloadMediaMessage,
  getBinaryNodeChild,
  jidNormalizedUser,
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
import { broadcastService, BroadcastService, normalizePhoneNumber } from '../services/broadcast.service.js';
import { whatsappManagerService, WhatsAppManagerService } from '../services/whatsapp-manager.service.js';
import { statusReactorService, StatusReactorService } from '../services/status-reactor.service.js';

export interface BaileysTransportOptions {
  authDir?: string;
  tenantId?: string;
  allowedPhone?: string;
  autoSyncContactsOnEmpty?: boolean;
  allowEnvSessionRestore?: boolean;
  broadcastService?: BroadcastService;
  whatsappManager?: WhatsAppManagerService;
  statusReactor?: StatusReactorService;
  onConnectionChange?: (state: { connected: boolean; phone?: string | null; error?: string }) => void;
  onCredsSaved?: () => void;
}

export class WhatsAppBaileysTransport implements IMessagingTransport {
  public readonly name = 'whatsapp_baileys';
  public currentQR: string | null = null;
  public currentPairingCode: string | null = null;
  public pairingPhone: string | null = null;
  public pairingError: string | null = null;
  public lastSecurityBlockReason: string | null = null;
  private socket: WASocket | null = null;
  private connected: boolean = false;
  private authDir: string;
  private tenantId: string = 'owner';
  private allowedPhone?: string;
  private autoSyncContactsOnEmpty: boolean = true;
  private allowEnvSessionRestore: boolean = true;
  private broadcast: BroadcastService;
  private whatsappManager: WhatsAppManagerService;
  private statusReactor: StatusReactorService;
  private onConnectionChange?: (state: { connected: boolean; phone?: string | null; error?: string }) => void;
  private onCredsSaved?: () => void;
  private manualStopped: boolean = false;
  private suppressCloseReconnect: boolean = false;
  private contactsResyncAttempted: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageHandler: ((message: IncomingMessage) => Promise<void>) | null = null;
  private lastActivityTimestamp: number | null = null;
  private rawMessages: Map<string, any> = new Map();
  private botSentMessageIds: Set<string> = new Set();
  private recentSentTexts: Set<string> = new Set();
  private outboundQueue: OutboundQueue = new OutboundQueue(200, 400);
  private sessionExpired: boolean = false;
  /** Message IDs whose real content has already been dispatched (dedupes PDO resend vs. re-emit). */
  private processedMessageIds: Set<string> = new Set();
  /** Timestamp in seconds when this bot instance started up; used to discard old backlogged commands. */
  private botStartTime: number = Math.floor(Date.now() / 1000);
  /** View-Once stubs waiting for the retry / phone resend to deliver real content. */
  private pendingViewOnce: Map<string, NodeJS.Timeout> = new Map();
  private viewOnceFallbackSent: Set<string> = new Set();
  /** Cached outgoing status@broadcast payloads so owner retry receipts can be fulfilled cleanly. */
  private sentStatusMessages: Map<string, { message: any; statusJidList: string[] }> = new Map();
  /** Maps status@broadcast message IDs to the participant JID that requested a retry. */
  private statusRetryParticipants: Map<string, string> = new Map();

  constructor(authDirOrOptions: string | BaileysTransportOptions = './baileys_auth_info') {
    if (typeof authDirOrOptions === 'string') {
      this.authDir = authDirOrOptions;
      this.broadcast = broadcastService;
      this.whatsappManager = whatsappManagerService;
      this.statusReactor = statusReactorService;
    } else {
      const opts = authDirOrOptions || {};
      this.authDir = opts.authDir || './baileys_auth_info';
      this.tenantId = opts.tenantId || 'owner';
      this.allowedPhone = opts.allowedPhone;
      this.autoSyncContactsOnEmpty = opts.autoSyncContactsOnEmpty ?? true;
      this.allowEnvSessionRestore = opts.allowEnvSessionRestore ?? false;
      this.broadcast = opts.broadcastService || broadcastService;
      this.whatsappManager = opts.whatsappManager || whatsappManagerService;
      this.statusReactor = opts.statusReactor || statusReactorService;
      this.onConnectionChange = opts.onConnectionChange;
      this.onCredsSaved = opts.onCredsSaved;
    }
    this.statusReactor.setWhatsAppManager(this.whatsappManager);
  }

  public static phonesMatch(allowedPhone: string, actualPhone: string): boolean {
    const cleanA = String(allowedPhone || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0+/, '');
    const cleanB = String(actualPhone || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0+/, '');
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true;
    if (cleanA.length >= 9 && cleanB.endsWith(cleanA)) return true;
    if (cleanB.length >= 9 && cleanA.endsWith(cleanB)) return true;
    return false;
  }

  public setAllowedPhone(phone?: string): void {
    this.allowedPhone = phone;
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

  public async syncContactsFromWhatsApp(force: boolean = false): Promise<{ synced: boolean; total: number }> {
    if (!this.socket || !this.connected) {
      return { synced: false, total: this.broadcast.getContactsCount() };
    }
    try {
      this.contactsResyncAttempted = true;
      await this.socket.resyncAppState(['critical_unblock_low'], force);
      return { synced: true, total: this.broadcast.getContactsCount() };
    } catch (err: any) {
      console.warn(`⚠️ [Contacts Sync:${this.tenantId}] resyncAppState failed:`, err?.message || err);
      return { synced: false, total: this.broadcast.getContactsCount() };
    }
  }

  private restoreCredsBackupIfNeeded(): boolean {
    try {
      const credsPath = path.join(this.authDir, 'creds.json');
      const bakPath = path.join(this.authDir, 'creds.backup.json');
      if (!fs.existsSync(bakPath)) return false;

      let primaryValid = false;
      if (fs.existsSync(credsPath)) {
        try {
          const parsedPrimary = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
          primaryValid = Boolean(parsedPrimary && (parsedPrimary.registered || parsedPrimary.account || parsedPrimary.noiseKey));
        } catch {}
      }
      if (primaryValid) return false;

      const bakRaw = fs.readFileSync(bakPath, 'utf8');
      const parsedBak = JSON.parse(bakRaw);
      if (parsedBak && (parsedBak.registered || parsedBak.account)) {
        fs.writeFileSync(credsPath, bakRaw, 'utf8');
        console.log(`🛡️ [Auth Recovery:${this.tenantId}] Restored corrupted/missing creds.json from atomic backup!`);
        return true;
      }
    } catch {}
    return false;
  }

  private writeAtomicCredsBackup(): void {
    try {
      const credsPath = path.join(this.authDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return;
      const raw = fs.readFileSync(credsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || (!parsed.registered && !parsed.account)) return;
      const bakPath = path.join(this.authDir, 'creds.backup.json');
      const tmpPath = `${bakPath}.tmp`;
      fs.writeFileSync(tmpPath, raw, 'utf8');
      fs.renameSync(tmpPath, bakPath);
    } catch {}
  }

  private readDiskCredsState(): { exists: boolean; registered: boolean } {
    this.restoreCredsBackupIfNeeded();
    try {
      const credsPath = path.join(this.authDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return { exists: false, registered: false };
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      return { exists: true, registered: Boolean(parsed?.registered || parsed?.account) };
    } catch {
      return { exists: false, registered: false };
    }
  }

  private purgeUnregisteredAuthDir(): void {
    const state = this.readDiskCredsState();
    if (state.exists && !state.registered) {
      try {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      } catch {}
    }
  }

  public async requestPairingCodeForTenant(
    phoneInput?: string
  ): Promise<{ success: boolean; code?: string; formattedCode?: string; phone?: string; error?: string }> {
    if (this.connected) {
      return { success: false, error: 'WhatsApp horay ayuu ugu xidhan yahay!' };
    }
    const cleanedInput = normalizePhoneNumber(String(phoneInput || this.allowedPhone || '').replace(/^00/, ''));
    if (cleanedInput.length < 9) {
      return { success: false, error: 'Fadlan geli lambar WhatsApp ah oo sax ah (tusaale: 252634xxxxxx ama 0634xxxxxx).' };
    }
    if (this.allowedPhone && phoneInput && !WhatsAppBaileysTransport.phonesMatch(this.allowedPhone, cleanedInput)) {
      return {
        success: false,
        error: 'Lambarkani kuma diiwaangashana akoonkan! Fadlan isticmaal lambarkii aad isku diiwaangelisay.',
      };
    }

    const pairingDigits = (this.allowedPhone ? normalizePhoneNumber(this.allowedPhone.replace(/^00/, '')) : cleanedInput) || cleanedInput;

    const diskCreds = this.readDiskCredsState();
    if (this.socket?.authState?.creds?.registered || diskCreds.registered) {
      this.pairingError = 'Session horay ayuu u diiwaangashan yahay — marka hore Unlink dheh.';
      return { success: false, error: this.pairingError };
    }

    // Always recycle into a clean unregistered WebSocket + fresh Noise/creds state so pairingEphemeralKeyPair stays synced
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.suppressCloseReconnect = true;
      try {
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.end(undefined);
      } catch {}
      this.socket = null;
    }
    this.currentQR = null;
    this.currentPairingCode = null;
    this.pairingError = null;
    this.purgeUnregisteredAuthDir();

    this.start().catch((err) => {
      this.pairingError = err?.message || 'Socket start failed';
    });

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && (!this.getSocket() || (!this.currentQR && !this.connected))) {
      await new Promise((r) => setTimeout(r, 200));
    }

    const activeSock = this.getSocket();
    if (!activeSock || !this.currentQR) {
      this.pairingError = 'Xidhiidhka WhatsApp server-ka wuu daahay, fadlan mar kale guji.';
      return { success: false, error: this.pairingError };
    }

    // Settle briefly so the initial WS Noise frame queue clears cleanly before sending companion_hello
    await new Promise((r) => setTimeout(r, 350));

    try {
      const rawCode = await activeSock.requestPairingCode(pairingDigits);
      const formatted = rawCode && rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
      this.currentPairingCode = formatted;
      this.pairingPhone = pairingDigits;
      this.pairingError = null;
      console.log(`🔑 [Pairing Code:${this.tenantId}] Generated code ${formatted} for +${pairingDigits}`);
      return { success: true, code: rawCode, formattedCode: formatted, phone: pairingDigits };
    } catch (err: any) {
      this.pairingError = err?.message || 'Pairing code lama soo saari karin';
      return { success: false, error: this.pairingError || undefined };
    }
  }

  public async stopWithoutLogout(): Promise<void> {
    this.manualStopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected = false;
    this.currentQR = null;
    this.currentPairingCode = null;
    this.whatsappManager.setSocket(null);
    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.end(undefined);
      } catch {}
      this.socket = null;
    }
  }

  public async unlinkSession(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.currentPairingCode = null;
    this.pairingError = null;
    this.pairingPhone = null;
    this.contactsResyncAttempted = false;
    this.whatsappManager.setSocket(null);
    if (!this.manualStopped) {
      this.reconnectTimer = setTimeout(() => this.start(), 1500);
    }
  }

  private static cachedWaVersion: { version: [number, number, number]; fetchedAt: number } | null = null;

  private async resolveLatestWaVersion(): Promise<[number, number, number] | undefined> {
    if (
      WhatsAppBaileysTransport.cachedWaVersion &&
      Date.now() - WhatsAppBaileysTransport.cachedWaVersion.fetchedAt < 60 * 60 * 1000
    ) {
      return WhatsAppBaileysTransport.cachedWaVersion.version;
    }
    try {
      const waRes = await fetchLatestWaWebVersion({ timeout: 2500 });
      if (waRes?.version && Array.isArray(waRes.version)) {
        const ver = waRes.version as [number, number, number];
        WhatsAppBaileysTransport.cachedWaVersion = { version: ver, fetchedAt: Date.now() };
        return ver;
      }
    } catch {}
    try {
      const bRes = await fetchLatestBaileysVersion({ timeout: 2500 });
      if (bRes?.version && Array.isArray(bRes.version)) {
        const ver = bRes.version as [number, number, number];
        WhatsAppBaileysTransport.cachedWaVersion = { version: ver, fetchedAt: Date.now() };
        return ver;
      }
    } catch {}
    return undefined;
  }

  public async start(): Promise<void> {
    this.manualStopped = false;
    this.suppressCloseReconnect = false;
    this.printSafetyWarning();

    // 1. Support complete session bundle (SESSION_BUNDLE_BASE64) for primary owner instance only
    if (this.allowEnvSessionRestore && !this.sessionExpired && process.env.SESSION_BUNDLE_BASE64 && !fs.existsSync(path.join(this.authDir, 'creds.json'))) {
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
          if (
            filename.startsWith('sender-key-status@broadcast') ||
            filename.startsWith('sender-key-memory-status@broadcast') ||
            filename.startsWith('session-')
          ) {
            continue;
          }
          fs.writeFileSync(path.join(this.authDir, filename), content as string, 'utf8');
        }
        console.log(`✅ [WhatsAppBaileys] Si guul leh ayaa loo soo celiyay ${Object.keys(bundle).length} auth files oo buuxa!`);
      } catch (err: any) {
        console.error('⚠️ [WhatsAppBaileys] Failed to restore SESSION_BUNDLE_BASE64:', err.message);
      }
    }

    // 2. Fallback to single creds.json (SESSION_CREDS_BASE64) for primary owner instance only
    if (this.allowEnvSessionRestore && !this.sessionExpired && process.env.SESSION_CREDS_BASE64 && !fs.existsSync(path.join(this.authDir, 'creds.json'))) {
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

    // Purge our own status sender-key & sender-key-memory files on startup so status #1 starts at iteration 0
    // while keeping incoming status sender keys from contacts intact
    try {
      if (fs.existsSync(this.authDir)) {
        let myPhoneUser = '';
        let myLidUser = '';
        const credsPath = path.join(this.authDir, 'creds.json');
        if (fs.existsSync(credsPath)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            myPhoneUser = String(creds?.me?.id || '').split('@')[0]?.split(':')[0] || '';
            myLidUser = String(creds?.me?.lid || '').split('@')[0]?.split(':')[0] || '';
          } catch {}
        }

        for (const f of fs.readdirSync(this.authDir)) {
          const isMemory = f.startsWith('sender-key-memory-status@broadcast');
          const isOwnPhoneSenderKey = Boolean(myPhoneUser && f.startsWith(`sender-key-status@broadcast--${myPhoneUser}--`));
          const isOwnLidSenderKey = Boolean(myLidUser && f.startsWith(`sender-key-status@broadcast--${myLidUser}--`));
          if (isMemory || isOwnPhoneSenderKey || isOwnLidSenderKey) {
            try {
              fs.unlinkSync(path.join(this.authDir, f));
            } catch {}
          }
        }
      }
    } catch {}

    // If a previous QR/pairing attempt left unregistered half-baked creds (registered !== true), wipe them cleanly
    // so Baileys performs fresh device registration rather than failing login with "Couldn't link device".
    this.purgeUnregisteredAuthDir();

    this.botStartTime = Math.floor(Date.now() / 1000);
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const waVersion = await this.resolveLatestWaVersion();

    const logger = pino({ level: 'silent' }); // Keep terminal clean

    this.socket = makeWASocket({
      ...(waVersion ? { version: waVersion } : {}),
      auth: state,
      printQRInTerminal: false, // We handle QR with qrcode-terminal
      logger,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false, // Do not dump hundreds of old historical chat messages on every connect
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: true, // Ensure WhatsApp marks companion available and streams status@broadcast events
      emitOwnEvents: true,
      getMessage: async (key) => this.getMessageForRetry(key),
    });

    // Fix Baileys 6.7.9 GroupCipher.encrypt off-by-one iteration bug (`iteration === 0 ? 0 : iteration + 1` -> `iteration`)
    // so status #2, #3, #4+ never skip odd iterations (1, 3, 5...) and always match SenderKeyDistributionMessage iteration.
    try {
      // @ts-ignore
      const { GroupCipher, SenderKeyMessage } = await import('@whiskeysockets/baileys/lib/Signal/Group/index.js');
      const protoAny: any = GroupCipher?.prototype;
      if (protoAny && !protoAny._cardosoPatched) {
        protoAny.encrypt = async function (this: any, paddedPlaintext: any) {
          return await this.queueJob(async () => {
            const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
            if (!record) {
              throw new Error('No SenderKeyRecord found for encryption');
            }
            const senderKeyState = record.getSenderKeyState();
            if (!senderKeyState) {
              throw new Error('No session to encrypt message');
            }
            const iteration = senderKeyState.getSenderChainKey().getIteration();
            const senderKey = this.getSenderKey(senderKeyState, iteration);
            const ciphertext = await this.getCipherText(senderKey.getIv(), senderKey.getCipherKey(), paddedPlaintext);
            const senderKeyMessage = new (SenderKeyMessage as any)(
              senderKeyState.getKeyId(),
              senderKey.getIteration(),
              ciphertext,
              senderKeyState.getSigningKeyPrivate()
            );
            await this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
            return senderKeyMessage.serialize();
          });
        };
        protoAny._cardosoPatched = true;
        console.log('🛡️ [Signal GroupCipher] Patched Baileys GroupCipher.encrypt iteration bug (0,1,2,3... sequential).');
      }
    } catch (err: any) {
      console.warn('⚠️ [Signal GroupCipher] Could not apply GroupCipher patch:', err?.message);
    }

    // Protect status and broadcast encryption against un-sessioned recipient crashes
    if ((this.socket as any)?.signalRepository?.encryptMessage) {
      const origEncrypt = (this.socket as any).signalRepository.encryptMessage.bind((this.socket as any).signalRepository);
      (this.socket as any).signalRepository.encryptMessage = async (args: { jid: string; data: Buffer }) => {
        try {
          return await origEncrypt(args);
        } catch (err: any) {
          // If PN failed for the host account, retry using its companion LID mapping
          try {
            const myPhone = this.socket?.user?.id?.split(':')[0]?.split('@')[0];
            const myLid = (this.socket?.user as any)?.lid?.split(':')[0]?.split('@')[0];
            const targetUser = args?.jid?.split(':')[0]?.split('@')[0];
            const targetDevice = args?.jid?.split(':')[1]?.split('@')[0] || '0';

            if (myPhone && myLid && targetUser === myPhone) {
              const lidJid = `${myLid}:${targetDevice}@lid`;
              const lidRes = await origEncrypt({ jid: lidJid, data: args.data });
              if (lidRes?.ciphertext && lidRes.ciphertext.length > 0) {
                return lidRes;
              }
            }
          } catch {}

          const errMsg = err?.message || '';
          if (errMsg.includes('No session record') || errMsg.includes('Session') || errMsg.includes('session') || errMsg.includes('MAC')) {
            console.warn(`🛡️ [Signal Repository] No active session for ${args.jid} during broadcast encryption. Gracefully skipping recipient.`);
            return { type: 'msg', ciphertext: Buffer.alloc(0) };
          }
          throw err;
        }
      };
    }

    // Guarantee addressing_mode="pn" on status@broadcast and strip 0-byte or malformed participant nodes
    if ((this.socket as any)?.sendNode) {
      const origSendNode = (this.socket as any).sendNode.bind(this.socket);
      (this.socket as any).sendNode = async (frame: any) => {
        try {
          if (frame?.tag === 'message' && frame?.attrs?.to === 'status@broadcast') {
            // WhatsApp server on LID-migrated accounts strictly requires addressing_mode="pn" on status stanzas
            // to avoid rejecting with <ack error="479"/> (smax-invalid)
            frame.attrs.addressing_mode = 'pn';
          }

          if (frame?.tag === 'message' && Array.isArray(frame.content)) {
            for (const child of frame.content) {
              if (child?.tag === 'participants' && Array.isArray(child.content)) {
                const seenJids = new Set<string>();
                child.content = child.content.filter((toNode: any) => {
                  if (!toNode || toNode.tag !== 'to' || !Array.isArray(toNode.content)) return false;
                  // Deduplicate identical participant stanzas while preserving authentic device targeting (e.g. :0 for phone)
                  if (toNode.attrs?.jid) {
                    if (seenJids.has(toNode.attrs.jid)) return false;
                    seenJids.add(toNode.attrs.jid);
                  }
                  const encNode = toNode.content.find((c: any) => c?.tag === 'enc');
                  if (encNode && (!encNode.content || encNode.content.length === 0)) {
                    return false;
                  }
                  return true;
                });
              }
            }
          }
        } catch {}
        return await origSendNode(frame);
      };
    }

    // Monitor server ACKs for instant detection of server-side delivery confirmations or 479 rejections
    if ((this.socket as any)?.ws) {
      (this.socket.ws as any).on('CB:ack', (node: any) => {
        try {
          if (node?.attrs?.class === 'message' && node?.attrs?.error) {
            console.error(`🚨 [WhatsApp Server Error ACK] Message ID ${node.attrs.id} was REJECTED by WhatsApp server with error code ${node.attrs.error}!`);
          } else if (node?.attrs?.class === 'message' && node?.attrs?.from === 'status@broadcast') {
            console.log(`✅ [WhatsApp Server ACK] Status broadcast ${node.attrs.id} was successfully accepted by WhatsApp server!`);
          }
        } catch {}
      });
    }

    // Install status@broadcast cache/retry hooks and CB:receipt listener
    this.installStatusHooks(this.socket);

    this.whatsappManager.setSocket(this.socket);

    this.socket.ev.on('creds.update', async () => {
      await saveCreds();
      this.writeAtomicCredsBackup();
      this.onCredsSaved?.();
    });

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.currentQR = qr;
        console.log(`\n======================================================`);
        console.log(`  SCAN THIS QR CODE IN WHATSAPP TO LINK (${this.tenantId}):`);
        console.log('======================================================');
        qrcode.generate(qr, { small: true });
        console.log('Open WhatsApp > Linked Devices > Link a Device\n');
      }

      if (connection === 'close') {
        this.connected = false;
        this.whatsappManager.setSocket(null);
        if (this.manualStopped || this.suppressCloseReconnect) {
          this.suppressCloseReconnect = false;
          return;
        }
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsAppBaileys:${this.tenantId}] Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        this.onConnectionChange?.({ connected: false, phone: this.getBotNumber(), error: statusCode ? String(statusCode) : undefined });

        if (statusCode === DisconnectReason.loggedOut) {
          this.sessionExpired = true;
          this.currentPairingCode = null;
          this.pairingPhone = null;
          console.warn(`⚠️ [WhatsAppBaileys:${this.tenantId}] Session expired or unlinked (401 Logged Out). Purging stale auth...`);
          try {
            fs.rmSync(this.authDir, { recursive: true, force: true });
          } catch {}
          if (!this.manualStopped) {
            this.reconnectTimer = setTimeout(() => this.start(), 2000);
          }
        } else if (statusCode === DisconnectReason.restartRequired) {
          // 515 Stream Restart right after entering 8-digit pairing code or scanning QR: reconnect immediately!
          console.log(`🔄 [WhatsAppBaileys:${this.tenantId}] Pairing restart required (515). Completing WhatsApp link in 400ms...`);
          this.reconnectTimer = setTimeout(() => this.start(), 400);
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          console.warn(`⚠️ [WhatsAppBaileys:${this.tenantId}] Session conflict (440 Connection Replaced by another running instance). Backing off 15s...`);
          this.reconnectTimer = setTimeout(() => this.start(), 15000);
        } else if (shouldReconnect && !this.manualStopped) {
          if (statusCode === DisconnectReason.timedOut && !this.readDiskCredsState().registered) {
            this.currentPairingCode = null;
            this.pairingError = 'Waqtigii pairing code-ka wuu dhammaaday — fadlan mar kale guji Soo Saar.';
            this.purgeUnregisteredAuthDir();
          }
          this.reconnectTimer = setTimeout(() => this.start(), 3000);
        }
      } else if (connection === 'open') {
        const botId = this.socket?.user?.id || '';
        const botLid = (this.socket?.user as any)?.lid || '';
        const botPhone = botId.split(':')[0].split('@')[0].replace(/\D/g, '');

        // Phone-Number Lock: if subscriber signed up with allowedPhone, enforce exact phone match
        if (this.allowedPhone && botPhone && !WhatsAppBaileysTransport.phonesMatch(this.allowedPhone, botPhone)) {
          console.error(`⛔ [Security Phone Lock:${this.tenantId}] Connected phone ${botPhone} does NOT match allowedPhone ${this.allowedPhone}! Disconnecting & purging auth.`);
          this.lastSecurityBlockReason = `Lambarka ku xidhmay (${botPhone}) kuma jiro diiwaanka akoonkan (${this.allowedPhone}).`;
          this.connected = false;
          this.currentQR = null;
          this.currentPairingCode = null;
          this.whatsappManager.setSocket(null);
          this.onConnectionChange?.({ connected: false, phone: botPhone, error: this.lastSecurityBlockReason });
          const sockToLogout = this.socket;
          this.socket = null;
          this.manualStopped = true;
          Promise.resolve(sockToLogout?.logout()).catch(() => {}).finally(() => {
            try {
              fs.rmSync(this.authDir, { recursive: true, force: true });
            } catch {}
          });
          return;
        }

        this.connected = true;
        this.currentQR = null;
        this.currentPairingCode = null;
        this.pairingError = null;
        this.lastSecurityBlockReason = null;
        this.lastActivityTimestamp = Date.now();
        if (botId || botLid) {
          this.broadcast.setBotJid(botId, botLid);
          this.whatsappManager.setBotJid(botId || botLid);
        }
        this.whatsappManager.setSocket(this.socket);
        this.onConnectionChange?.({ connected: true, phone: botPhone || null });
        // Heal stale unacknowledged owner primary-phone Signal sessions on connect
        this.whatsappManager.ensureOwnerSessionHealthy(false).catch((err) => {
          console.warn(`⚠️ [WhatsAppBaileys:${this.tenantId}] Owner session health check failed:`, err?.message || err);
        });
        if (this.autoSyncContactsOnEmpty && !this.contactsResyncAttempted && this.broadcast.getContactsCount() === 0) {
          setTimeout(() => {
            if (this.connected && this.broadcast.getContactsCount() === 0) {
              this.syncContactsFromWhatsApp(true).catch(() => {});
            }
          }, 4500);
        }
        console.log(`\n✅ [WhatsAppBaileys:${this.tenantId}] Successfully connected to WhatsApp Multi-Device network!`);
        // Notify WhatsApp network that companion is active/available so live status updates stream reliably
        this.socket?.sendPresenceUpdate?.('available').catch(() => {});
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
        if (this.broadcast.isValidIndividualJid(normalizedJid)) {
          this.broadcast.recordContact(normalizedJid, resolvedName, false, isProfileName);
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
      console.log(`📋 [Contacts Sync:${this.tenantId}] Synchronized ${this.broadcast.getContactsCount()} contacts from WhatsApp Multi-Device history!`);
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

    this.socket.ev.on('chats.phoneNumberShare', ({ lid, jid }: { lid: string; jid: string }) => {
      if (jid && this.broadcast.isValidIndividualJid(jid)) {
        const existingName = lid ? this.broadcast.getContactName(lid) : undefined;
        this.broadcast.recordContact(jid, existingName, false, Boolean(existingName));
      }
    });

    // ─── Incoming Call Handler (Configurable Auto-reject & Voice Redirect) ──────
    this.socket.ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call.status === 'offer') {
          console.log(`\n📞 [Incoming Call] Wicitaan laga helay: ${call.from} (ID: ${call.id})`);
          const callerPhone = call.from.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (this.whatsappManager?.isAIDisabledForNumber(callerPhone)) {
            console.log(`📞 [Incoming Call Allowed] Wicitaanka ${callerPhone} lama jarin sababtoo ah AI-ga ayaa laga xidhay (!off).`);
            continue;
          }
          const shouldReject = this.whatsappManager ? this.whatsappManager.shouldRejectCall(callerPhone) : false;
          if (!shouldReject) {
            console.log(`📞 [Incoming Call Allowed] Wicitaanka ${callerPhone} waa loo ogolaaday sababtoo ah Call Reject kuma saarna.`);
            continue;
          }

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
            console.log(`✅ [Call Handled] Qofkii soo wacay (+${callerPhone}) waa laga xidhay, waxaana loo diray cod iyo qoraal codsanaya Voice Note!`);
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

    // ─── Status View Receipts & Live Viewer Tracking ("cid daawatay") ────────
    this.socket.ev.on('message-receipt.update', (receipts) => {
      for (const item of receipts) {
        if (item.key?.remoteJid === 'status@broadcast' && item.receipt?.userJid) {
          const statusId = item.key.id || '';
          const viewerJid = item.receipt.userJid;
          const readTimestamp = item.receipt.readTimestamp || (item.receipt as any).receiptTimestamp;

          const result = this.whatsappManager.recordStatusView(statusId, viewerJid, readTimestamp);
          if (result.recorded) {
            console.log(`👁️ [Status View] Qof ayaa daawatay status-kaaga: ${result.viewerName || viewerJid} (Wadarta: ${result.count})`);
          }
        }
      }
    });

    // ─── Listen for Phone-Side Status & Message Deletions ────────────────────
    this.socket.ev.on('messages.delete', async (item: any) => {
      try {
        const keys = Array.isArray(item?.keys) ? item.keys : [item?.key].filter(Boolean);
        for (const k of keys) {
          const isStatus = k?.remoteJid === 'status@broadcast';
          const id = k?.id;
          if (id && (isStatus || this.whatsappManager.hasPostedStatus(id))) {
            console.log(`🗑️ [Phone Status Delete Detected] User manually deleted status ${id} on phone. Propagating delete to all contacts...`);
            await this.whatsappManager.deleteStatusById(id, { fromPhone: true });
          }
        }
      } catch (err: any) {
        console.warn(`[WhatsAppBaileys] Error handling messages.delete: ${err?.message}`);
      }
    });

    this.socket.ev.on('messages.update', async (updates: any[]) => {
      try {
        for (const update of updates) {
          const id = update?.key?.id;
          const isRevoke = update?.update?.message === null || (update?.update as any)?.messageStubType === proto.WebMessageInfo.StubType.REVOKE;
          if (id && isRevoke && (update?.key?.remoteJid === 'status@broadcast' || this.whatsappManager.hasPostedStatus(id))) {
            console.log(`🗑️ [Status Revoke Detected] Status ${id} was revoked. Ensuring delete is propagated to all contacts...`);
            await this.whatsappManager.deleteStatusById(id, { fromPhone: true });
          }
        }
      } catch (err: any) {
        console.warn(`[WhatsAppBaileys] Error handling messages.update: ${err?.message}`);
      }
    });

    // ─── Group Participants Updates (Auto-Welcome / Auto-Guard) ───────────────
    this.socket.ev.on('group-participants.update', async ({ id, participants, action }: any) => {
      try {
        if (action === 'add' && this.whatsappManager.isAutoGroupManaged(id)) {
          await this.whatsappManager.handleAutoWelcome(id, participants, this);
        }
      } catch (err: any) {
        console.warn(`[WhatsAppBaileys] Error handling group-participants.update: ${err?.message}`);
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      const nowSec = Math.floor(Date.now() / 1000);

      for (const msg of messages) {
        if (!msg?.key) continue;

        // ─── WhatsApp Status (Story) Dedicated Handler ───────────────────────
        // Stories arrive under remoteJid === 'status@broadcast'.
        // Route them immediately to handleIncomingStatusMessage so they are
        // NEVER dropped by chat timestamp filters, View-Once stubs, or processedMessageIds!
        if (msg.key.remoteJid === 'status@broadcast') {
          try {
            await this.handleIncomingStatusMessage(msg, type);
          } catch (err: any) {
            console.error('[WhatsAppBaileys] Error handling status@broadcast:', err);
          }
          continue;
        }

        // Drop non-status messages sent before this bot run began (prevents executing old backlogged commands on startup).
        const ts = WhatsAppBaileysTransport.toNumber(msg.messageTimestamp);
        if (ts > 0 && ts < this.botStartTime - 5) {
          if (msg.key?.id) this.processedMessageIds.add(msg.key.id);
          continue;
        }

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
          const isRecent = ts > 0 && nowSec - ts <= 300;
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

  /**
   * Dedicated, unblockable handler for all WhatsApp Status (Story) events.
   * Ensures 100% reliable real-time Auto-View (Seen receipts) and intelligent AI reactions/replies.
   */
  public async handleIncomingStatusMessage(msg: any, source: string): Promise<void> {
    if (!msg?.key) return;
    const id = msg.key.id;
    if (!id) return;

    const rawParticipant = msg.key.participant || msg.participant || '';
    const cleanSender = rawParticipant ? jidNormalizedUser(rawParticipant) : '';
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = WhatsAppBaileysTransport.toNumber(msg.messageTimestamp);

    // 1. Handle Status Revoke (Delete for Everyone of a story)
    const isRevoke =
      msg.message?.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE ||
      (msg as any)?.messageStubType === proto.WebMessageInfo.StubType.REVOKE;
    if (isRevoke) {
      const revokedId = msg.message?.protocolMessage?.key?.id || id;
      if (revokedId && (this.whatsappManager.hasPostedStatus(revokedId) || msg.key?.fromMe)) {
        console.log(`🗑️ [Status Revoke] Received status revoke for ${revokedId}. Propagating delete to all contacts...`);
        await this.whatsappManager.deleteStatusById(revokedId, { fromPhone: true });
      }
      return;
    }

    // 2. Drop expired status backlogs older than 24 hours (86,400s)
    if (ts > 0 && nowSec - ts > 86400) {
      return;
    }

    // 3. Bot's own status broadcast posted from linked primary phone (fromMe === true)
    if (msg.key.fromMe) {
      if (!this.whatsappManager.hasPostedStatus(id)) {
        let contentType: 'text' | 'image' | 'video' | 'audio' = 'text';
        let content = '';
        if (msg.message?.imageMessage) {
          contentType = 'image';
          content = msg.message.imageMessage.caption || '[Sawir]';
        } else if (msg.message?.videoMessage) {
          contentType = 'video';
          content = msg.message.videoMessage.caption || '[Muuqaal]';
        } else if (msg.message?.audioMessage) {
          contentType = 'audio';
          content = '[Cod]';
        } else if (msg.message?.conversation) {
          content = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
          content = msg.message.extendedTextMessage.text;
        }
        this.whatsappManager.recordPostedStatus(id, contentType, content, undefined, 0);
        console.log(`📱 [Phone Status Recorded] Recorded status posted from phone (${id}, ${contentType}): "${content.slice(0, 30)}"`);
      }
      return;
    }

    // 4. AUTO-VIEW STATUS (Real-Time Seen Mark)
    // USER RULE: in both normal view and link campaign mode (!link on), bot ALWAYS views every status!
    const shouldAutoView = this.whatsappManager.isAutoViewStatusEnabled() || this.whatsappManager.isLinkCampaignMode();
    console.log(`📱 [Status Received] id=${id}, sender=${cleanSender || rawParticipant}, source=${source}, shouldAutoView=${shouldAutoView}, linkMode=${this.whatsappManager?.isLinkCampaignMode()}`);

    if (shouldAutoView && this.socket && cleanSender) {
      try {
        const statusKey = {
          remoteJid: 'status@broadcast',
          id,
          participant: cleanSender,
          fromMe: false,
        };

        // A) Direct raw WhatsApp Web read receipt stanza:
        //    <receipt id="..." to="status@broadcast" participant="252634444444@s.whatsapp.net" type="read" t="..." />
        //    Forces explicit type="read" directly to WhatsApp servers so sender immediately sees our profile in their status viewers list!
        if (typeof (this.socket as any).sendReceipt === 'function') {
          await (this.socket as any).sendReceipt('status@broadcast', cleanSender, [id], 'read').catch(() => {});
        } else if (typeof (this.socket as any).sendNode === 'function') {
          await (this.socket as any).sendNode({
            tag: 'receipt',
            attrs: {
              id,
              type: 'read',
              to: 'status@broadcast',
              participant: cleanSender,
              t: nowSec.toString(),
            },
          }).catch(() => {});
        }

        // B) Also call official Baileys readMessages for companion state sync
        if (typeof this.socket.readMessages === 'function') {
          await this.socket.readMessages([statusKey]).catch(() => {});
        }

        console.log(`👁️ [Auto-View Status] Status-ka waxaa arkay bot-ka: ${cleanSender} (id=${id})`);
      } catch (err: any) {
        console.warn(`[WhatsAppBaileys] Error auto-viewing status: ${err?.message}`);
      }
    }

    // 5. Record contact WhatsApp pushName and phone number JID
    if (cleanSender && this.broadcast.isValidIndividualJid(cleanSender)) {
      this.broadcast.recordContact(cleanSender, msg.pushName, false, Boolean(msg.pushName));
    }
    const rawPn = (msg.key as any)?.participantPn || (msg.key as any)?.senderPn;
    if (rawPn) {
      const cleanPn = jidNormalizedUser(rawPn);
      if (cleanPn && this.broadcast.isValidIndividualJid(cleanPn)) {
        this.broadcast.recordContact(cleanPn, msg.pushName, false, Boolean(msg.pushName));
      }
    }

    // 6. Status Reactor: Intelligently react (Love Cagaaran 💚) and comment like a real human,
    // or when in Link Campaign Mode (!link on): view status, suppress story replies, and DM extracted phone numbers only.
    if (this.socket && cleanSender) {
      const isLinkMode = this.whatsappManager?.isLinkCampaignMode();
      if (!isLinkMode && this.whatsappManager?.isAIDisabledForNumber(cleanSender)) {
        console.log(`ℹ️ [WhatsAppBaileys] Status from ${cleanSender} ignored: AI disabled for this number (!off).`);
      } else {
        this.statusReactor.handleIncomingStatus(msg, this.socket, this.whatsappManager).catch((err: any) => {
          console.warn(`[WhatsAppBaileys] Status reactor interaction error: ${err?.message}`);
        });
      }
    }
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

    const chatId = msg.key.remoteJid || '';
    const isGroup = chatId.endsWith('@g.us');
    const senderId = msg.key.participant || msg.participant || msg.key.remoteJid || '';
    const nowSec = Math.floor(Date.now() / 1000);
    const msgTimestamp = WhatsAppBaileysTransport.toNumber(msg.messageTimestamp);

    // ─── Drop Historical Messages & Commands on Startup ───────────────────────
    // When the bot boots up, WhatsApp Multi-Device sends backlogged/unread chat messages.
    // If an owner message (fromMe: true) or command was sent before this bot run started
    // (or is older than 90s), NEVER execute it! This prevents re-posting old deleted statuses
    // or re-triggering past commands (e.g. !status, !deletestatus) from chat history.
    if (chatId !== 'status@broadcast') {
      const isHistoricalOwnerMsg = Boolean(msg.key?.fromMe) && (
        (msgTimestamp > 0 && msgTimestamp < this.botStartTime - 10) ||
        (msgTimestamp > 0 && nowSec - msgTimestamp > 90)
      );
      if (isHistoricalOwnerMsg) {
        if (msg.key?.id) this.processedMessageIds.add(msg.key.id);
        console.log(`⏳ [Historical Command Ignored] Skipped stale fromMe message (${msg.key?.id}, age: ${nowSec - msgTimestamp}s) to prevent re-executing old commands on startup.`);
        return;
      }

      // Also ignore any management/prefix commands from any user that are older than 180s on connect
      if (msgTimestamp > 0 && nowSec - msgTimestamp > 180) {
        if (msg.key?.id) this.processedMessageIds.add(msg.key.id);
        return;
      }
    }

    // Cache raw message so we can safely quote it in replies AND recover View Once media when quoted
    // (Never cache status@broadcast messages so Baileys retry handler cannot re-relay status without statusJidList)
    if (msg.key?.id && chatId !== 'status@broadcast') {
      this.rawMessages.set(msg.key.id, msg);
      if (this.rawMessages.size > 1000) {
        const oldest = this.rawMessages.keys().next().value;
        if (oldest) this.rawMessages.delete(oldest);
      }
    }

    // ─── WhatsApp Status (Story) Handling & Auto-View Status ─────────────────
    if (chatId === 'status@broadcast') {
      await this.handleIncomingStatusMessage(msg, source);
      return;
    }

    // Always record sender WhatsApp profile pushName and real phone JID (senderPn / participantPn)
    if (!msg.key.fromMe) {
      const targetProfileJid = isGroup ? (msg.key.participant || '') : chatId;
      if (msg.pushName && this.broadcast.isValidIndividualJid(targetProfileJid)) {
        this.broadcast.recordContact(targetProfileJid, msg.pushName, false, true);
      }
      const realPnJid = (msg.key as any)?.senderPn || (msg.key as any)?.participantPn;
      if (realPnJid && this.broadcast.isValidIndividualJid(realPnJid)) {
        this.broadcast.recordContact(realPnJid, msg.pushName, false, Boolean(msg.pushName));
      }
    }

    // ─── Unwrap View Once ("one-click" 1️⃣), Ephemeral & Detect Message Type ──
    const unwrapped = MediaProcessorService.unwrapMessage(msg.message);
    const innerMsg = unwrapped.message;

    // Anti-Delete / Ghost message capture for groups (Delete for Everyone)
    const revokeProto = msg.message?.protocolMessage || (innerMsg as any)?.protocolMessage;
    if (revokeProto?.type === proto.Message.ProtocolMessage.Type.REVOKE && revokeProto.key?.id) {
      this.whatsappManager.recordRevocation(chatId, revokeProto.key.id);
      return;
    }

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
      const res = this.broadcast.importFromText(innerMsg.contactMessage.vcard);
      console.log(`👤 [WhatsApp Contact Shared]: Processed vCard (${res.added} new added).`);
    }
    if (innerMsg.contactsArrayMessage?.contacts) {
      let totalAdded = 0;
      for (const c of innerMsg.contactsArrayMessage.contacts) {
        if (c.vcard) {
          const res = this.broadcast.importFromText(c.vcard);
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
      // Send read receipt so WhatsApp marks it read and never re-delivers it on future reconnects
      if (this.socket && chatId !== 'status@broadcast') {
        this.socket.readMessages([msg.key]).catch(() => {});
      }

      // Record in group message cache for Anti-Delete / Ghost Hunter
      if (isGroup && text.trim()) {
        const senderJid = msg.key.participant || msg.participant || (msg.key as any)?.senderPn || chatId;
        this.whatsappManager.recordIncomingGroupMessage(chatId, msg.key.id, senderJid, text.trim());
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

    // Detect bot triggers: '@cardoso', '!cardoso', short voice trigger '@cod'/'!cod', image trigger '@sawir'/'!sawir', or broadcast commands
    const hasVoiceCommand = lowerText.includes('@cod') || lowerText.startsWith('!cod') || /\b@cod\b/i.test(lowerText);
    const hasImageCommand = lowerText.includes('@sawir') || lowerText.startsWith('!sawir') || lowerText.includes('@image') || lowerText.startsWith('!image') || /\b@sawir\b/i.test(lowerText);
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
      /^[!./#]?(?:status|post-status|sheeko|status-ai|autoview|tagall|dhammaan|kick|ka-saar|promote|dalacsii|demote|hoos-u-dhig|mute|xidh|unmute|fur|grouplink|link|groupinfo|setname|setbio|setstatus|setpp|setpfp|block|unblock|autoreply|delete|tirtir|reply|send|cod|maamul|help|contact|reset)\b/i.test(lowerText);

    const hasCardosoMention =
      lowerText.includes('@cardoso') ||
      lowerText.startsWith('!cardoso') ||
      isPrefixCommand ||
      hasManagementCommand ||
      hasVoiceCommand ||
      hasImageCommand ||
      hasBroadcastCommand ||
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

    const isStoryReply = Boolean(
      (contextInfoRaw?.remoteJid === 'status@broadcast' && contextInfoRaw?.quotedMessage) ||
      quotedSender === 'status@broadcast'
    );
    const quotedInner = quotedUnwrapped?.message;
    const quotedText =
      quotedInner?.conversation ||
      quotedInner?.extendedTextMessage?.text ||
      quotedInner?.imageMessage?.caption ||
      quotedInner?.videoMessage?.caption ||
      quotedInner?.documentMessage?.caption ||
      '';

    let resolvedSenderPhone = '';
    const pnCandidate =
      (msg.key as any)?.senderPn ||
      (msg.key as any)?.participantPn ||
      (msg.key as any)?.remoteJidAlt ||
      (senderId.endsWith('@s.whatsapp.net') ? senderId : (!isGroup && chatId.endsWith('@s.whatsapp.net') ? chatId : ''));
    if (pnCandidate && !String(pnCandidate).endsWith('@lid')) {
      resolvedSenderPhone = String(pnCandidate).split('@')[0].split(':')[0].replace(/\D/g, '');
    } else if (senderId.endsWith('@lid') && (this.socket as any)?.signalRepository?.lidMapping?.getPNForLID) {
      try {
        const pnJid = await (this.socket as any).signalRepository.lidMapping.getPNForLID(senderId);
        if (pnJid && !String(pnJid).endsWith('@lid')) {
          resolvedSenderPhone = String(pnJid).split('@')[0].split(':')[0].replace(/\D/g, '');
        }
      } catch {}
    }

    const isSticker = unwrapped.msgType === 'stickerMessage' || unwrapped.baileysMediaType === 'sticker';

    const incoming: IncomingMessage = {
      id: msg.key.id || `baileys_${Date.now()}`,
      senderId,
      senderPhone: resolvedSenderPhone || undefined,
      senderName: msg.pushName || undefined,
      chatId,
      isGroup,
      content: text || (isSticker ? '🏷️ [WhatsApp Sticker – Qofku wuxuu soo diray Sticker/Istiikar. Eeg waxa ku qoran (sida Save me, qosol, salaam) oo si dabiici ah ugu jawaab]' : isAudio || mediaAttachment?.type === 'audio' ? '🎙️ [Voice Note – Fadlan codkan dhagayso oo jawaab sii]' : isImage || mediaAttachment?.type === 'image' ? '🖼️ [Sawir – Fadlan sawirkan eeg oo ka hadal waxa ku jira]' : isVideo || mediaAttachment?.type === 'video' ? '🎬 [Muuqaal – Fadlan muuqaalkan daawo oo dhagayso kadibna ka jawaab]' : isDocument || mediaAttachment?.type === 'document' ? '📄 [Dukumenti – Fadlan soo koob macluumaadka muhiimka ah]' : ''),
      rawTimestamp: WhatsAppBaileysTransport.toNumber(msg.messageTimestamp) * 1000 || Date.now(),
      isMentioned,
      isFromMe: Boolean(msg.key.fromMe),
      replyToMessageId: msg.key.id || undefined,
      quotedMessageId: quotedStanzaId || undefined,
      quotedParticipant: quotedSender || undefined,
      quotedText: quotedText || undefined,
      isStoryReply: isStoryReply || undefined,
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
        const customStatusJids = (options as any)?.statusJidList?.length
          ? (options as any).statusJidList
          : (isStatus ? this.whatsappManager.getStatusRecipients() : undefined);
        const sendOptions: any = {};
        if (isStatus) {
          sendOptions.broadcast = true;
          sendOptions.useUserDevicesCache = false;
          sendOptions.backgroundColor = (options as any)?.backgroundColor || '#1e3c72';
          sendOptions.font = (options as any)?.font || 1;
          if (customStatusJids && customStatusJids.length > 0) {
            sendOptions.statusJidList = customStatusJids;
          }
          await this.whatsappManager.resetStatusSenderKeyMemory();
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
          if (chatId !== 'status@broadcast') {
            this.cacheRawMessage(sentMsg);
          }
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
        const customStatusJids = (options as any)?.statusJidList?.length
          ? (options as any).statusJidList
          : (isStatus ? this.whatsappManager.getStatusRecipients() : undefined);
        const sendOptions: any = {};
        if (isStatus) {
          sendOptions.broadcast = true;
          sendOptions.useUserDevicesCache = false;
          sendOptions.backgroundColor = (options as any)?.backgroundColor || '#1e3c72';
          sendOptions.font = (options as any)?.font || 1;
          if (customStatusJids && customStatusJids.length > 0) {
            sendOptions.statusJidList = customStatusJids;
          }
          await this.whatsappManager.resetStatusSenderKeyMemory();
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
        } else if (media.type === 'document') {
          const docPayload: any = {
            document: media.dataBuffer,
            mimetype: media.mimeType || 'application/pdf',
            fileName: media.fileName || 'CARDOSO_AI_Guide.pdf',
            ...(media.caption ? { caption: media.caption } : {}),
          };
          try {
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              docPayload,
              sendOptions
            );
          } catch (quotedErr) {
            console.warn('[WhatsAppBaileys] Quoted document send failed, falling back to direct send:', quotedErr);
            sentMediaMsg = await this.socket!.sendMessage(
              chatId,
              docPayload
            );
          }
        }

        // Track bot-sent media IDs so students can quote or reply to them in groups
        if (sentMediaMsg?.key?.id) {
          if (chatId !== 'status@broadcast') {
            this.cacheRawMessage(sentMediaMsg);
          }
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
      const res = await this.whatsappManager.postMediaStatus({
        buffer: content.media.dataBuffer,
        mimeType: content.media.mimeType,
        caption: content.media.caption,
        type: content.media.type === 'document' ? 'image' : content.media.type,
      }, {
        backgroundColor: content.backgroundColor,
      });
      return res.success;
    } else if (content.text) {
      const res = await this.whatsappManager.postTextStatus(content.text, {
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
      const isStatus = chatId === 'status@broadcast' || messageId.startsWith('status_');
      if (isStatus) {
        const cleanId = messageId.replace(/^status_/, '');
        const res = await this.whatsappManager.deleteStatusById(cleanId);
        return res.success;
      }

      const raw = this.rawMessages.get(messageId);
      const key = raw?.key || {
        remoteJid: chatId,
        fromMe: true,
        id: messageId,
        participant,
      };
      const res = await this.whatsappManager.deleteMessage(chatId, key);
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
      const res = await this.whatsappManager.reactToMessage(chatId, key, emoji);
      return res.success;
    } catch {
      return false;
    }
  }

  public async sendContactCard(chatId: string, name: string, phoneNumber: string): Promise<boolean> {
    if (!this.socket || !this.connected) return false;
    try {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const vcard =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `FN:${name}\n` +
        `TEL;type=CELL;type=VOICE;waid=${cleanPhone}:+${cleanPhone}\n` +
        'END:VCARD';

      await this.socket.sendMessage(chatId, {
        contacts: {
          displayName: name,
          contacts: [{ vcard }],
        },
      });
      console.log(`👤 [WhatsAppBaileys] Sent native contact card for "${name}" (+${cleanPhone}) to ${chatId}`);
      return true;
    } catch (err: any) {
      console.warn(`[WhatsAppBaileys] sendContactCard error: ${err?.message}`);
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

  private trimBoundedMap<K, V>(map: Map<K, V>, maxEntries: number): void {
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private cacheRawMessage(msg: any): void {
    const id = msg?.key?.id;
    if (!id || !msg?.message) {
      return;
    }
    this.rawMessages.set(id, msg);
    this.trimBoundedMap(this.rawMessages, 1000);
  }

  private cacheSentStatusMessage(id: string, message: any, statusJidList: string[]): void {
    if (!id || !message) {
      return;
    }
    this.sentStatusMessages.set(id, { message, statusJidList: [...statusJidList] });
    this.trimBoundedMap(this.sentStatusMessages, 50);
  }

  private isOwnerParticipantJid(jid: string, socket: any = this.socket): boolean {
    const reqUser = String(jid || '').split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
    if (!reqUser) {
      return false;
    }

    const ownerUsers = new Set<string>();
    const sockPhone = String(socket?.user?.id || '').split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
    const sockLid = String(socket?.user?.lid || '').split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
    if (sockPhone) ownerUsers.add(sockPhone);
    if (sockLid) ownerUsers.add(sockLid);

    for (const ownerJid of this.whatsappManager.getOwnerOnlyRecipients()) {
      const num = String(ownerJid || '').split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
      if (num) ownerUsers.add(num);
    }

    return ownerUsers.has(reqUser);
  }

  /**
   * Provides stored message payloads to Baileys on Signal retry receipts,
   * including recently sent `status@broadcast` payloads so owner/contact
   * retry requests are never dropped silently.
   */
  public async getMessageForRetry(key: { id?: string | null; remoteJid?: string | null }): Promise<proto.IMessage | undefined> {
    if (!key?.id) {
      return undefined;
    }
    if (key.remoteJid === 'status@broadcast') {
      return this.sentStatusMessages.get(key.id)?.message;
    }
    if (this.rawMessages.has(key.id)) {
      return this.rawMessages.get(key.id)?.message;
    }
    return undefined;
  }

  /**
   * Records participant JIDs from `<receipt type="retry" from="status@broadcast">`
   * stanzas so `relayMessage` knows which device requested a resend even when
   * Baileys takes its `sendToAll` path and omits `participant` and `statusJidList`.
   */
  public handleStatusReceiptNode(node: any): void {
    try {
      const attrs = node?.attrs;
      const isStatusReceipt = attrs?.from === 'status@broadcast' || attrs?.recipient === 'status@broadcast';
      if (!attrs || attrs.type !== 'retry' || !isStatusReceipt) {
        return;
      }
      const participant = String(
        attrs.participant || (attrs.from !== 'status@broadcast' ? attrs.from : '') || ''
      ).trim();
      if (!participant) {
        return;
      }

      const ids = new Set<string>();
      if (attrs.id) {
        ids.add(String(attrs.id));
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          if (child?.tag === 'item' && child?.attrs?.id) {
            ids.add(String(child.attrs.id));
          } else if (child?.tag === 'list' && Array.isArray(child.content)) {
            for (const item of child.content) {
              if (item?.tag === 'item' && item?.attrs?.id) {
                ids.add(String(item.attrs.id));
              }
            }
          }
        }
      }

      for (const id of ids) {
        this.statusRetryParticipants.set(id, participant);
      }
      this.trimBoundedMap(this.statusRetryParticipants, 100);
    } catch {}
  }

  /**
   * Instruments a Baileys socket to:
   * 1. Force `useUserDevicesCache: false` on `status@broadcast` relays (Baileys `sendMessage` strips it).
   * 2. Cache outgoing status payloads by message ID for retry receipts.
   * 3. Restore `statusJidList` and heal owner `:0` PN sessions when a retry arrives for `status@broadcast`,
   *    preventing Baileys `sendMessagesAgain` from sending empty participant lists or mangling `@lid` JIDs.
   */
  public installStatusHooks(socket: any): void {
    if (!socket) {
      return;
    }

    if (socket.ws && typeof socket.ws.on === 'function' && !(socket.ws as any).__statusReceiptHooked) {
      (socket.ws as any).__statusReceiptHooked = true;
      socket.ws.on('CB:receipt', (node: any) => this.handleStatusReceiptNode(node));
    }

    if (typeof socket.relayMessage === 'function' && !(socket.relayMessage as any).__statusWrapped) {
      const origRelay = socket.relayMessage.bind(socket);
      const wrappedRelay = async (jid: string, message: any, options: any = {}) => {
        if (jid !== 'status@broadcast') {
          return origRelay(jid, message, options);
        }

        const relayOpts: any = { ...(options || {}), useUserDevicesCache: false };

        if (Array.isArray(relayOpts.statusJidList) && relayOpts.statusJidList.length > 0) {
          await this.whatsappManager.ensureOwnerSessionHealthy(false);
          if (relayOpts.messageId) {
            this.cacheSentStatusMessage(String(relayOpts.messageId), message, relayOpts.statusJidList);
          }
          return origRelay(jid, message, relayOpts);
        }

        // Retry path (or omitted statusJidList): determine requester and ensure clean SKDM delivery
        const messageId = relayOpts.messageId ? String(relayOpts.messageId) : '';
        const recordedParticipant = messageId ? this.statusRetryParticipants.get(messageId) : undefined;
        const requesterJid = String(relayOpts.participant?.jid || recordedParticipant || '').trim();

        await this.whatsappManager.resetStatusSenderKeyMemory();

        if (!requesterJid || this.isOwnerParticipantJid(requesterJid, socket)) {
          await this.whatsappManager.ensureOwnerSessionHealthy(true);
          delete relayOpts.participant;
          let ownerRecipients = this.whatsappManager.getOwnerOnlyRecipients();
          if (ownerRecipients.length === 0) {
            const sockPhone = String(socket?.user?.id || '').split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
            if (sockPhone) {
              ownerRecipients = [`${sockPhone}@s.whatsapp.net`];
            }
          }
          if (ownerRecipients.length > 0) {
            relayOpts.statusJidList = ownerRecipients;
          }
        } else if (requesterJid.endsWith('@s.whatsapp.net')) {
          if (!relayOpts.participant?.jid || !String(relayOpts.participant.jid).endsWith('@s.whatsapp.net')) {
            delete relayOpts.participant;
            const cleanUser = requesterJid.split('@')[0]?.split(':')[0];
            if (cleanUser) {
              relayOpts.statusJidList = [`${cleanUser}@s.whatsapp.net`];
            }
          }
        } else {
          // Third-party @lid retry: Baileys messages-send.js:366 encodes @lid participant retries as @s.whatsapp.net
          // when groupData is absent, so strip participant and use PN recipient list instead.
          delete relayOpts.participant;
          const cachedRecipients = messageId ? this.sentStatusMessages.get(messageId)?.statusJidList : undefined;
          const fallbackRecipients = (cachedRecipients && cachedRecipients.length > 0)
            ? cachedRecipients
            : this.whatsappManager.getStatusRecipients();
          if (fallbackRecipients.length > 0) {
            relayOpts.statusJidList = fallbackRecipients;
          }
        }

        return origRelay(jid, message, relayOpts);
      };
      (wrappedRelay as any).__statusWrapped = true;
      socket.relayMessage = wrappedRelay;
    }
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

