import { cleanMessage, decryptMessageNode, jidNormalizedUser, proto } from '@whiskeysockets/baileys';
import { BroadcastService } from './broadcast.service.js';
import { WhatsAppManagerService } from './whatsapp-manager.service.js';
import { StatusReactorService } from './status-reactor.service.js';
import { MediaProcessorService } from './media-processor.service.js';
import { errorLogService } from './error-log.service.js';

/**
 * Clean, from-scratch WhatsApp Status Engine.
 *
 * Single source of truth for EVERY incoming `status@broadcast` event:
 *  1. Passively captures raw wire stanza metadata (`participant`, `participant_pn`, `participant_lid`)
 *     from `CB:message` WITHOUT sending a premature `read` receipt before Baileys decrypts & acks delivery.
 *  2. Normalizes BOTH `@s.whatsapp.net` (PN) and `@lid` (LID) identities cleanly without ever stripping `@lid`.
 *  3. Handles `CIPHERTEXT` retry stubs cleanly — waits for Baileys Signal retry instead of poisoning `viewedIds`,
 *     with a bounded fallback watchdog so even an undecryptable status is still marked SEEN after a few seconds.
 *  4. Sends explicit `type="read"` receipts AFTER Baileys' delivery receipt lands (preventing WhatsApp
 *     server-side ordering drops), covering both the stanza's `participant` and resolved `participant_pn`,
 *     with 1 automatic retry and real error logging (never silently swallowed).
 *  5. Flushes Baileys 6.7.x's stuck event buffer on offline status batches so buffered statuses are never lost.
 *  6. Tracks live telemetry & Read-Receipts privacy state so `!info` and `!statusinfo` show the exact truth.
 */

export interface WireStatusMeta {
  id: string;
  participant: string;
  participantPn: string;
  participantLid: string;
  addressingMode?: string;
  mediaType?: string;
  notify: string;
  timestamp: number;
  isOffline: boolean;
  receivedAt: number;
  rawNode?: any;
}

export interface ResolvedStatusIdentity {
  rawParticipant: string;
  normalizedParticipant: string;
  pnJid: string;
  lidJid: string;
  /** Preferred JID for 1-to-1 replies / DMs (`pnJid` if known, else `normalizedParticipant`). */
  chatTargetJid: string;
  /** Deduplicated participant JIDs to include in `<receipt to="status@broadcast" type="read">`. */
  receiptTargets: string[];
}

export interface ViewedStatusRecord {
  id: string;
  sender: string;
  name: string;
  via: 'upsert' | 'watchdog' | 'cb_status';
  timestamp: number;
}

export interface StatusEngineTelemetry {
  received: number;
  viewed: number;
  viewFailed: number;
  watchdogViews: number;
  ciphertextRetries: number;
  fastRetriesSent: number;
  cbStatusAcked: number;
  receiptAckErrors: number;
  skippedOwn: number;
  skippedExpired: number;
  skippedDisabled: number;
  readReceiptsPrivacy: 'all' | 'none' | 'unknown';
  recentViewed: ViewedStatusRecord[];
}

export interface StatusEngineOptions {
  tenantId: string;
  whatsappManager: WhatsAppManagerService;
  statusReactor: StatusReactorService;
  broadcast: BroadcastService;
  /** Delay (ms) between decrypted status arrival and sending `read` so Baileys' delivery receipt lands first. */
  seenDelayMs?: number;
  /** Watchdog timeout (ms) to still send a `read` receipt if Baileys never finishes decrypting/upserting. */
  watchdogTimeoutMs?: number;
}

/** Normalizes any WhatsApp JID while ALWAYS preserving its domain (`@s.whatsapp.net` or `@lid`). */
export function normalizeStatusJid(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.includes('@')) return '';
  const normalized = jidNormalizedUser(trimmed);
  if (normalized) return normalized;
  const [userPart, serverPart] = trimmed.split('@');
  const cleanUser = (userPart || '').split(':')[0].split('_')[0];
  const cleanServer = serverPart === 'c.us' ? 's.whatsapp.net' : serverPart;
  return cleanUser && cleanServer ? `${cleanUser}@${cleanServer}` : '';
}

export class StatusEngineService {
  private readonly tenantId: string;
  private readonly whatsappManager: WhatsAppManagerService;
  private readonly statusReactor: StatusReactorService;
  private readonly broadcast: BroadcastService;
  private readonly seenDelayMs: number;
  private readonly watchdogTimeoutMs: number;

  private wireMetaCache: Map<string, WireStatusMeta> = new Map();
  private lidToPnCache: Map<string, string> = new Map();
  private seenWatchdogs: Map<string, NodeJS.Timeout> = new Map();
  private seenTimers: Map<string, NodeJS.Timeout> = new Map();
  private viewedIds: Set<string> = new Set();
  private fastRetriedIds: Set<string> = new Set();
  private countedReceivedIds: Set<string> = new Set();
  private offlineFlushTimer: NodeJS.Timeout | null = null;

  private telemetry: StatusEngineTelemetry = {
    received: 0,
    viewed: 0,
    viewFailed: 0,
    watchdogViews: 0,
    ciphertextRetries: 0,
    fastRetriesSent: 0,
    cbStatusAcked: 0,
    receiptAckErrors: 0,
    skippedOwn: 0,
    skippedExpired: 0,
    skippedDisabled: 0,
    readReceiptsPrivacy: 'unknown',
    recentViewed: [],
  };

  constructor(options: StatusEngineOptions) {
    this.tenantId = options.tenantId || 'owner';
    this.whatsappManager = options.whatsappManager;
    this.statusReactor = options.statusReactor;
    this.broadcast = options.broadcast;
    this.seenDelayMs = options.seenDelayMs ?? 600;
    // Wait 15s (longer than Baileys' 5s placeholder-resend retry delay) so Signal retries decrypt cleanly
    // before the fallback watchdog fires!
    this.watchdogTimeoutMs = options.watchdogTimeoutMs ?? 15000;
  }

  /** Records a known LID -> Phone Number JID mapping for accurate receipt & reaction targeting. */
  public recordLidMapping(lid?: string | null, pn?: string | null): void {
    const cleanLid = normalizeStatusJid(lid);
    const cleanPn = normalizeStatusJid(pn);
    if (!cleanLid.endsWith('@lid') || !cleanPn.endsWith('@s.whatsapp.net')) return;
    this.lidToPnCache.set(cleanLid, cleanPn);
    if (this.lidToPnCache.size > 5000) {
      const oldest = this.lidToPnCache.keys().next().value;
      if (oldest) this.lidToPnCache.delete(oldest);
    }
  }

  public getTelemetry(): StatusEngineTelemetry {
    return {
      ...this.telemetry,
      recentViewed: [...this.telemetry.recentViewed],
    };
  }

  /**
   * Queries WhatsApp's server-side privacy settings on connect so we can warn the owner
   * immediately if their phone has "Read Receipts" turned OFF (which causes WhatsApp servers
   * to hide status views even when the bot sends `type="read"`).
   */
  public async checkReadReceiptsPrivacy(socket: any): Promise<'all' | 'none' | 'unknown'> {
    if (!socket || typeof socket.fetchPrivacySettings !== 'function') {
      return this.telemetry.readReceiptsPrivacy;
    }
    try {
      const settings = await socket.fetchPrivacySettings(true);
      const val = String(settings?.readreceipts || '').toLowerCase();
      if (val === 'all') {
        this.telemetry.readReceiptsPrivacy = 'all';
        console.log(`🔒 [StatusEngine:${this.tenantId}] WhatsApp Read Receipts Privacy: ✅ ON (all) — views will be visible to contacts.`);
      } else if (val === 'none') {
        this.telemetry.readReceiptsPrivacy = 'none';
        console.warn(
          `⚠️ [StatusEngine:${this.tenantId}] WhatsApp Read Receipts Privacy waa OFF ("none")! ` +
          `Fur WhatsApp taleefankaaga > Settings > Privacy > Read Receipts oo shid, haddii kale dadku ma arki doonaan inaad status-kooda daawatay.`
        );
      } else {
        this.telemetry.readReceiptsPrivacy = 'unknown';
      }
    } catch {
      // Non-fatal; keep previous value
    }
    return this.telemetry.readReceiptsPrivacy;
  }

  /**
   * Checks whether a participant belongs to the bot's own WhatsApp account (matches PN OR LID).
   */
  public isOwnParticipant(
    identity: { rawParticipant?: string; normalizedParticipant?: string; pnJid?: string; lidJid?: string },
    socket: any,
    fromMe?: boolean
  ): boolean {
    if (fromMe) return true;
    const myPnDigits = String(socket?.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const myLidDigits = String((socket?.user as any)?.lid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

    const candidates = [
      identity.rawParticipant,
      identity.normalizedParticipant,
      identity.pnJid,
      identity.lidJid,
    ].filter((v): v is string => Boolean(v));

    for (const c of candidates) {
      const digits = c.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (!digits || digits.length < 7) continue;
      if (myPnDigits && digits === myPnDigits) return true;
      if (myLidDigits && digits === myLidDigits) return true;
    }
    return false;
  }

  /**
   * Resolves all identity variants for an incoming status message, combining
   * Baileys decoded key fields, raw wire stanza attrs, cached LID->PN map, and Baileys lidMapping store.
   */
  public async resolveIdentity(
    msg: any,
    socket: any,
    wireMeta?: WireStatusMeta
  ): Promise<ResolvedStatusIdentity> {
    const key = msg?.key || {};
    const rawParticipant = String(
      key.participant || msg?.participant || wireMeta?.participant || ''
    ).trim();
    const rawPn = String(
      key.participantPn || key.senderPn || wireMeta?.participantPn || ''
    ).trim();
    const rawLid = String(
      key.participantLid || key.senderLid || wireMeta?.participantLid || ''
    ).trim();

    const normalizedParticipant = normalizeStatusJid(rawParticipant);
    let pnJid = normalizeStatusJid(rawPn);
    let lidJid = normalizeStatusJid(rawLid);

    if (!pnJid && normalizedParticipant.endsWith('@s.whatsapp.net')) {
      pnJid = normalizedParticipant;
    }
    if (!lidJid && normalizedParticipant.endsWith('@lid')) {
      lidJid = normalizedParticipant;
    }

    // Record mapping whenever both are present
    if (lidJid && pnJid) {
      this.recordLidMapping(lidJid, pnJid);
    }

    // Try resolving missing PN from local LID->PN cache or Baileys internal lidMapping store
    if (!pnJid && lidJid) {
      const cachedPn = this.lidToPnCache.get(lidJid);
      if (cachedPn) {
        pnJid = cachedPn;
      } else if (typeof socket?.signalRepository?.lidMapping?.getPNForLID === 'function') {
        try {
          const resolved = await socket.signalRepository.lidMapping.getPNForLID(lidJid);
          const cleanResolved = normalizeStatusJid(resolved);
          if (cleanResolved.endsWith('@s.whatsapp.net')) {
            pnJid = cleanResolved;
            this.recordLidMapping(lidJid, pnJid);
          }
        } catch {
          // Optional Baileys helper
        }
      }
    }

    // Deduplicated receipt targets: always include normalized stanza participant FIRST,
    // plus resolved PN JID and LID JID if distinct (ensures both LID & PN WhatsApp servers accept the view!).
    const receiptTargets: string[] = [];
    const addTarget = (jid: string) => {
      if (jid && !receiptTargets.includes(jid)) receiptTargets.push(jid);
    };
    if (normalizedParticipant) addTarget(normalizedParticipant);
    if (pnJid) addTarget(pnJid);
    if (lidJid) addTarget(lidJid);

    const chatTargetJid = pnJid || normalizedParticipant || lidJid;

    return {
      rawParticipant,
      normalizedParticipant,
      pnJid,
      lidJid,
      chatTargetJid,
      receiptTargets,
    };
  }

  /**
   * Stage 0: Passively observes raw `<message from="status@broadcast">` stanzas on `ws`.
   * NEVER sends a premature `read` receipt here (which would race Baileys' decryption & delivery ack).
   * Instead:
   *  - Caches wire attributes (`participant`, `participant_pn`, `participant_lid`).
   *  - Triggers a safe debounced `ev.flush()` when offline statuses arrive (working around Baileys 6.7.x's
   *    `createBufferedFunction` buffer-trap bug).
   *  - Starts a fallback watchdog so even if decryption/retry fails, the status is STILL marked SEEN.
   */
  public observeRawStanza(node: any, socket: any): void {
    try {
      if (node?.tag !== 'message' || node?.attrs?.from !== 'status@broadcast') return;
      const attrs = node.attrs || {};
      const id = String(attrs.id || '').trim();
      if (!id) return;

      const meta: WireStatusMeta = {
        id,
        participant: String(attrs.participant || '').trim(),
        participantPn: String(attrs.participant_pn || attrs.sender_pn || '').trim(),
        participantLid: String(attrs.participant_lid || attrs.sender_lid || '').trim(),
        addressingMode: String(attrs.addressing_mode || '').trim() || undefined,
        mediaType: String(attrs.mediatype || attrs.type || '').trim() || undefined,
        notify: String(attrs.notify || '').trim(),
        timestamp: Number(attrs.t) || 0,
        isOffline: Boolean(attrs.offline),
        receivedAt: Date.now(),
        rawNode: node,
      };

      this.wireMetaCache.set(id, meta);
      if (this.wireMetaCache.size > 2000) {
        const oldest = this.wireMetaCache.keys().next().value;
        if (oldest) this.wireMetaCache.delete(oldest);
      }

      if (meta.participant && meta.participantPn) {
        this.recordLidMapping(meta.participant, meta.participantPn);
      }
      if (meta.participantLid && meta.participantPn) {
        this.recordLidMapping(meta.participantLid, meta.participantPn);
      }

      // Baileys 6.7.x offlineNodeProcessor calls upsertMessage (createBufferedFunction -> ev.buffer() without flush).
      // Schedule a clean debounced flush so offline statuses are never trapped in memory!
      if (meta.isOffline) {
        this.scheduleOfflineBufferFlush(socket);
      }

      // Skip watchdog for expired (>24h) or own statuses
      const nowSec = Math.floor(Date.now() / 1000);
      if (meta.timestamp > 0 && nowSec - meta.timestamp > 86400) return;

      const quickIdentity = {
        rawParticipant: meta.participant,
        normalizedParticipant: normalizeStatusJid(meta.participant),
        pnJid: normalizeStatusJid(meta.participantPn),
        lidJid: normalizeStatusJid(meta.participantLid),
      };
      if (this.isOwnParticipant(quickIdentity, socket, false)) return;

      console.log(
        `📡 [StatusEngine:${this.tenantId}] Wire status stanza id=${id} participant=${meta.participant || '?'} ` +
        `pn=${meta.participantPn || '-'} lid=${meta.participantLid || '-'} mode=${meta.addressingMode || '-'} ` +
        `offline=${meta.isOffline}`
      );

      if (this.viewedIds.has(id) || this.seenWatchdogs.has(id)) return;
      this.armSeenWatchdog(id, meta, socket);
    } catch (err: any) {
      console.warn(`⚠️ [StatusEngine:${this.tenantId}] observeRawStanza error: ${err?.message || err}`);
    }
  }

  /**
   * Arms the bounded fallback watchdog so even if decryption/retry never succeeds within `watchdogTimeoutMs`,
   * the status is STILL marked SEEN using the captured wire metadata.
   */
  private armSeenWatchdog(id: string, meta: WireStatusMeta, socket: any): void {
    if (this.viewedIds.has(id) || this.seenWatchdogs.has(id)) return;
    const watchdog = setTimeout(() => {
      this.seenWatchdogs.delete(id);
      if (this.viewedIds.has(id)) return;
      const shouldAutoView =
        this.whatsappManager.isAutoViewStatusEnabled() || this.whatsappManager.isLinkCampaignMode();
      if (!shouldAutoView) return;

      this.resolveIdentity(
        { key: { remoteJid: 'status@broadcast', id, participant: meta.participant } },
        socket,
        meta
      )
        .then((identity) => {
          if (identity.receiptTargets.length === 0) return;
          return this.dispatchSeenReceipt(id, identity, meta.notify, socket, 'watchdog', meta.mediaType);
        })
        .catch((err) => {
          console.warn(`⚠️ [StatusEngine:${this.tenantId}] Watchdog seen error for ${id}: ${err?.message || err}`);
        });
    }, this.watchdogTimeoutMs);

    if (typeof watchdog.unref === 'function') watchdog.unref();
    this.seenWatchdogs.set(id, watchdog);
  }

  /**
   * Handles WhatsApp's top-level `<status>` stanzas (`CB:status`, WhiskeySockets/Baileys#2858 & whatsmeow).
   *  1. Immediately acknowledges (`<ack class="status">`) so WhatsApp never freezes the offline queue
   *     or drops the session with `Stream Errored (ack)`.
   *  2. Decrypts embedded E2EE `<enc>` / `<plaintext>` payloads (identical to `<message from="status@broadcast">`)
   *     inside `processingMutex` and routes the decrypted story into `handleStatusUpsert` so Auto-View,
   *     Status Replies/Reactions (`!link off`), AND Link Campaign DMs (`!link on`) all execute cleanly!
   *  3. Falls back to metadata-only SEEN if a `<status>` stanza carries no encrypted payload.
   */
  public async observeRawStatusNode(node: any, socket: any): Promise<void> {
    try {
      if (!node || node.tag !== 'status') return;
      const attrs = node.attrs || {};
      const id = String(attrs.id || '').trim();
      const from = String(attrs.from || 'status@broadcast').trim();

      // 1. Immediately send protocol <ack class="status"> so WhatsApp never stalls the stream
      if (socket && id) {
        try {
          if (typeof socket.sendMessageAck === 'function') {
            await socket.sendMessageAck(node);
          } else if (typeof socket.sendNode === 'function') {
            const ackAttrs: Record<string, string> = {
              id,
              to: from,
              class: 'status',
            };
            if (attrs.participant) ackAttrs.participant = String(attrs.participant);
            if (attrs.type) ackAttrs.type = String(attrs.type);
            await socket.sendNode({ tag: 'ack', attrs: ackAttrs });
          }
          this.telemetry.cbStatusAcked++;
        } catch (ackErr: any) {
          console.warn(`⚠️ [StatusEngine:${this.tenantId}] Failed acking CB:status (${id}): ${ackErr?.message || ackErr}`);
        }
      }

      // Group statuses (<status from="...@g.us">) are acknowledged above; keep personal status pipeline isolated
      if (from.endsWith('@g.us')) return;

      const participant = String(attrs.participant || (from !== 'status@broadcast' ? from : '') || '').trim();
      const participantPn = String(attrs.participant_pn || attrs.sender_pn || '').trim();
      const participantLid = String(attrs.participant_lid || attrs.sender_lid || '').trim();
      const notify = String(attrs.notify || '').trim();

      if (participant && participantPn) this.recordLidMapping(participant, participantPn);
      if (participantLid && participantPn) this.recordLidMapping(participantLid, participantPn);

      if (!id || !participant) return;

      const nowSec = Math.floor(Date.now() / 1000);
      const wireTs = Number(attrs.t) || 0;
      if (wireTs > 0 && nowSec - wireTs > 86400) return;

      const quickIdentity = {
        rawParticipant: participant,
        normalizedParticipant: normalizeStatusJid(participant),
        pnJid: normalizeStatusJid(participantPn),
        lidJid: normalizeStatusJid(participantLid),
      };
      if (this.isOwnParticipant(quickIdentity, socket, false)) return;

      const meta: WireStatusMeta = {
        id,
        participant,
        participantPn,
        participantLid,
        addressingMode: String(attrs.addressing_mode || '').trim() || undefined,
        mediaType: String(attrs.mediatype || attrs.type || '').trim() || undefined,
        notify,
        timestamp: wireTs || nowSec,
        isOffline: Boolean(attrs.offline),
        receivedAt: Date.now(),
        rawNode: node,
      };
      this.wireMetaCache.set(id, meta);
      if (this.wireMetaCache.size > 2000) {
        const oldest = this.wireMetaCache.keys().next().value;
        if (oldest) this.wireMetaCache.delete(oldest);
      }

      // Locate encrypted/plaintext children (either directly under <status> or nested 1 level deep)
      const topChildren: any[] = Array.isArray(node.content) ? node.content : [];
      const isEncOrPlain = (c: any) =>
        Boolean(c && (c.tag === 'enc' || c.tag === 'plaintext') && c.content instanceof Uint8Array);

      let decryptContent: any[] | null = null;
      if (topChildren.some(isEncOrPlain)) {
        decryptContent = topChildren;
      } else {
        const nested = topChildren.find((c: any) => Array.isArray(c?.content) && c.content.some(isEncOrPlain));
        if (nested) {
          decryptContent = nested.content;
        }
      }

      const canDecrypt = Boolean(
        decryptContent &&
        socket?.signalRepository &&
        socket?.authState?.creds?.me?.id
      );

      if (canDecrypt && decryptContent) {
        // Ensure pkmsg/msg (which may carry senderKeyDistributionMessage) ALWAYS decrypt BEFORE skmsg
        const orderedContent = [...decryptContent].sort((a: any, b: any) => {
          const rank = (x: any) => {
            if (x?.tag !== 'enc') return 0;
            const t = x?.attrs?.type;
            if (t === 'pkmsg' || t === 'msg') return 1;
            if (t === 'skmsg') return 2;
            return 3;
          };
          return rank(a) - rank(b);
        });

        const decryptNode = {
          tag: 'message',
          attrs: {
            ...attrs,
            from: 'status@broadcast',
            participant,
            ...(participantPn && !attrs.participant_pn ? { participant_pn: participantPn } : {}),
            ...(participantLid && !attrs.participant_lid ? { participant_lid: participantLid } : {}),
          },
          content: orderedContent,
        };

        this.armSeenWatchdog(id, meta, socket);

        const meId = String(socket.authState.creds.me.id || '');
        const meLid = String(socket.authState.creds.me.lid || '');
        const silentLogger: any = {
          level: 'silent',
          trace() {},
          debug() {},
          info() {},
          warn() {},
          error() {},
          fatal() {},
          child() { return this; },
        };

        const runDecrypt = async () => {
          const { fullMessage: msg, decrypt } = decryptMessageNode(
            decryptNode,
            meId,
            meLid,
            socket.signalRepository,
            silentLogger
          );
          await decrypt();

          const isCiphertext =
            msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT || !msg.message;

          if (!isCiphertext) {
            // Send delivery receipt FIRST so WhatsApp accepts the subsequent `read` receipt cleanly
            if (typeof socket.sendReceipt === 'function') {
              await socket.sendReceipt('status@broadcast', participant, [id], undefined).catch(() => {});
            }
            cleanMessage(msg, meId);
          }

          // Hand decrypted story (or CIPHERTEXT stub for fast retry) into the unified StatusEngine pipeline
          await this.handleStatusUpsert(msg, 'cb_status', socket);
        };

        if (typeof socket?.processingMutex?.mutex === 'function') {
          await socket.processingMutex.mutex(runDecrypt);
        } else {
          await runDecrypt();
        }
        return;
      }

      // Fallback when <status> stanza has no <enc>/<plaintext> payload (or mock socket without signalRepository)
      const shouldAutoView =
        this.whatsappManager.isAutoViewStatusEnabled() || this.whatsappManager.isLinkCampaignMode();
      if (!shouldAutoView || this.viewedIds.has(id)) return;

      const childTags = topChildren.map((c: any) => c?.tag).filter(Boolean).join(',');
      if (childTags && socket?.signalRepository) {
        console.log(`ℹ️ [StatusEngine:${this.tenantId}] CB:status id=${id} had no <enc> payload (tags=[${childTags}]); marking SEEN only.`);
      }

      const identity = await this.resolveIdentity(
        { key: { remoteJid: 'status@broadcast', id, participant } },
        socket,
        meta
      );
      if (identity.receiptTargets.length > 0) {
        await this.dispatchSeenReceipt(id, identity, notify, socket, 'cb_status', meta.mediaType);
      }
    } catch (err: any) {
      console.warn(`⚠️ [StatusEngine:${this.tenantId}] observeRawStatusNode error: ${err?.message || err}`);
    }
  }

  /** Records a server-rejected `<ack class="receipt" error="...">` for transparent diagnostics. */
  public recordReceiptAckError(id: string, errorCode: string, from?: string): void {
    this.telemetry.receiptAckErrors++;
    const msg = `WhatsApp rejected receipt ${id} (from=${from || '?'}, error=${errorCode})`;
    console.warn(`🚨 [StatusEngine:${this.tenantId}] ${msg}`);
    errorLogService.record(`StatusEngine:ReceiptAck:${this.tenantId}`, new Error(msg), 'warn');
  }

  /**
   * Sends a direct `<receipt type="retry">` WITH fresh prekeys for an undecrypted `status@broadcast`
   * stanza without blocking 5 seconds inside Baileys' `requestPlaceholderResend` phone-PDO sleep.
   */
  public async requestFastStatusRetry(rawNode: any, socket: any, reason?: string): Promise<boolean> {
    const id = String(rawNode?.attrs?.id || '').trim();
    if (!id || !socket || this.fastRetriedIds.has(id)) return false;

    this.fastRetriedIds.add(id);
    if (this.fastRetriedIds.size > 1000) {
      const oldest = this.fastRetriedIds.values().next().value;
      if (oldest) this.fastRetriedIds.delete(oldest);
    }

    try {
      const creds = socket?.authState?.creds;
      const keys = socket?.authState?.keys;
      if (!creds?.signedPreKey || !creds?.signedIdentityKey || !creds?.account || !keys || typeof socket.sendNode !== 'function') {
        return false;
      }

      // Dynamically import Baileys wire helpers to build an authentic prekey retry receipt
      const baileysUtils: any = await import('@whiskeysockets/baileys/lib/Utils/index.js');
      const baileysDefaults: any = await import('@whiskeysockets/baileys/lib/Defaults/index.js');
      if (
        typeof baileysUtils?.getNextPreKeys !== 'function' ||
        typeof baileysUtils?.encodeSignedDeviceIdentity !== 'function' ||
        typeof baileysUtils?.encodeBigEndian !== 'function'
      ) {
        return false;
      }

      const { update, preKeys } = await baileysUtils.getNextPreKeys(socket.authState, 1);
      const [keyId] = Object.keys(preKeys || {});
      if (!keyId) return false;
      const preKey = preKeys[+keyId];
      const deviceIdentity = baileysUtils.encodeSignedDeviceIdentity(creds.account, true);

      const receiptAttrs: Record<string, string> = {
        id,
        type: 'retry',
        to: String(rawNode.attrs.from || 'status@broadcast'),
      };
      if (rawNode.attrs.participant) receiptAttrs.participant = String(rawNode.attrs.participant);
      if (rawNode.attrs.recipient) receiptAttrs.recipient = String(rawNode.attrs.recipient);

      const receipt = {
        tag: 'receipt',
        attrs: receiptAttrs,
        content: [
          {
            tag: 'retry',
            attrs: {
              count: '1',
              id,
              t: String(rawNode.attrs.t || Math.floor(Date.now() / 1000)),
              v: '1',
            },
          },
          {
            tag: 'registration',
            attrs: {},
            content: baileysUtils.encodeBigEndian(creds.registrationId),
          },
          {
            tag: 'keys',
            attrs: {},
            content: [
              { tag: 'type', attrs: {}, content: Buffer.from(baileysDefaults.KEY_BUNDLE_TYPE) },
              { tag: 'identity', attrs: {}, content: creds.signedIdentityKey.public },
              baileysUtils.xmppPreKey(preKey, +keyId),
              baileysUtils.xmppSignedPreKey(creds.signedPreKey),
              { tag: 'device-identity', attrs: {}, content: deviceIdentity },
            ],
          },
        ],
      };

      socket.ev?.emit?.('creds.update', update);
      await socket.sendNode(receipt);
      this.telemetry.fastRetriesSent++;
      console.log(
        `🔄 [StatusEngine:${this.tenantId}] Sent fast prekey retry for status ${id} ` +
        `(participant=${receiptAttrs.participant || '?'}, reason=${reason || 'CIPHERTEXT'})`
      );
      return true;
    } catch (err: any) {
      console.warn(`⚠️ [StatusEngine:${this.tenantId}] Fast status retry failed for ${id}: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Flushes Baileys' event buffer if it got stuck in buffering mode after offline messages or resyncs.
   */
  public scheduleOfflineBufferFlush(socket: any): void {
    if (!socket?.ev || typeof socket.ev.flush !== 'function') return;
    if (this.offlineFlushTimer) clearTimeout(this.offlineFlushTimer);
    this.offlineFlushTimer = setTimeout(() => {
      this.offlineFlushTimer = null;
      try {
        if (typeof socket.ev.isBuffering === 'function' && socket.ev.isBuffering()) {
          socket.ev.flush();
          console.log(`🔄 [StatusEngine:${this.tenantId}] Flushed stuck Baileys offline event buffer.`);
        }
      } catch {
        // Safe ignore
      }
    }, 650);
    if (typeof this.offlineFlushTimer.unref === 'function') this.offlineFlushTimer.unref();
  }

  /**
   * Stage 1–3: Main handler invoked from `messages.upsert` for every `status@broadcast` message.
   */
  public async handleStatusUpsert(msg: any, source: string, socket: any): Promise<void> {
    if (!msg?.key || msg.key.remoteJid !== 'status@broadcast') return;
    const id = String(msg.key.id || '').trim();
    if (!id) return;

    const wireMeta = this.wireMetaCache.get(id);
    const identity = await this.resolveIdentity(msg, socket, wireMeta);
    const pushName = String(msg.pushName || wireMeta?.notify || '').trim();

    // 1. Handle Status Revoke (Delete for Everyone)
    const isRevoke =
      msg.message?.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE ||
      msg.messageStubType === proto.WebMessageInfo.StubType.REVOKE;
    if (isRevoke) {
      this.cancelWatchdog(id);
      const revokedId = msg.message?.protocolMessage?.key?.id || id;
      if (revokedId && (this.whatsappManager.hasPostedStatus(revokedId) || msg.key.fromMe)) {
        console.log(`🗑️ [StatusEngine:${this.tenantId}] Status revoke received for ${revokedId}. Propagating delete...`);
        await this.whatsappManager.deleteStatusById(revokedId, { fromPhone: true });
      }
      return;
    }

    // 2. Drop expired statuses older than 24 hours
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = StatusEngineService.toSeconds(msg.messageTimestamp) || wireMeta?.timestamp || 0;
    if (ts > 0 && nowSec - ts > 86400) {
      this.cancelWatchdog(id);
      this.telemetry.skippedExpired++;
      return;
    }

    // 3. Own Status posted from primary phone (matches fromMe, botPhone, OR botLid)
    if (this.isOwnParticipant(identity, socket, Boolean(msg.key.fromMe))) {
      this.cancelWatchdog(id);
      this.telemetry.skippedOwn++;
      if (!this.whatsappManager.hasPostedStatus(id) && msg.message) {
        const { contentType, content } = this.extractOwnStatusSummary(msg.message);
        this.whatsappManager.recordPostedStatus(id, contentType, content, undefined, 0);
        console.log(`📱 [StatusEngine:${this.tenantId}] Recorded owner phone status (${id}, ${contentType}): "${content.slice(0, 30)}"`);
      }
      return;
    }

    // Count unique contact statuses received
    if (!this.countedReceivedIds.has(id)) {
      this.countedReceivedIds.add(id);
      this.telemetry.received++;
      if (this.countedReceivedIds.size > 5000) {
        const oldest = this.countedReceivedIds.values().next().value;
        if (oldest) this.countedReceivedIds.delete(oldest);
      }
    }

    // 4. Undecrypted CIPHERTEXT stub waiting for Signal SenderKey retry:
    //    Do NOT cancel the watchdog and do NOT poison viewedIds — trigger a fast prekey retry
    //    and wait for the retried decrypted stanza!
    const isCiphertextStub =
      msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT || !msg.message;
    if (isCiphertextStub) {
      this.telemetry.ciphertextRetries++;
      const stubReason = Array.isArray(msg.messageStubParameters) ? msg.messageStubParameters.join('; ') : '';
      console.log(
        `⏳ [StatusEngine:${this.tenantId}] Status ${id} from ${identity.chatTargetJid || identity.rawParticipant} ` +
        `awaiting Signal retry (CIPHERTEXT${stubReason ? `: ${stubReason}` : ''}).`
      );
      if (wireMeta?.rawNode && socket) {
        this.requestFastStatusRetry(wireMeta.rawNode, socket, stubReason).catch(() => {});
      }
      return;
    }

    // 5. Ignore pure protocol / reaction / metadata-only senderKeyDistribution stanzas (not actual stories)
    const realContentKeys = Object.keys(msg.message).filter(
      (k) => k !== 'senderKeyDistributionMessage' && k !== 'messageContextInfo' && msg.message[k] != null
    );
    if (msg.message.protocolMessage || msg.message.reactionMessage) {
      this.cancelWatchdog(id);
      return;
    }
    if (realContentKeys.length === 0) {
      // Bare SKDM / metadata packet without story body yet — do not cancel watchdog or poison viewedIds
      return;
    }

    // Detect media kind for video/audio played receipt support
    const unwrapped = MediaProcessorService.unwrapMessage(msg.message);
    const detectedMediaKind = unwrapped.mediaKind || wireMeta?.mediaType;

    // Attach resolved PN onto msg.key so downstream StatusReactor always has it even on LID statuses
    if (identity.pnJid && !(msg.key as any).participantPn) {
      (msg.key as any).participantPn = identity.pnJid;
    }
    if (identity.lidJid && !(msg.key as any).participantLid) {
      (msg.key as any).participantLid = identity.lidJid;
    }
    if (pushName && !msg.pushName) {
      msg.pushName = pushName;
    }

    // 6. Record contact in Broadcast directory (both PN and normalized participant)
    if (identity.pnJid && this.broadcast.isValidIndividualJid(identity.pnJid)) {
      this.broadcast.recordContact(identity.pnJid, pushName || undefined, false, Boolean(pushName));
    }
    if (
      identity.normalizedParticipant &&
      identity.normalizedParticipant !== identity.pnJid &&
      this.broadcast.isValidIndividualJid(identity.normalizedParticipant)
    ) {
      this.broadcast.recordContact(identity.normalizedParticipant, pushName || undefined, false, Boolean(pushName));
    }

    // 7. AUTO-VIEW (SEEN) — Clean, ordered delivery after Baileys' delivery ack
    const shouldAutoView =
      this.whatsappManager.isAutoViewStatusEnabled() || this.whatsappManager.isLinkCampaignMode();

    console.log(
      `📱 [StatusEngine:${this.tenantId}] Status arrived id=${id} from=${identity.chatTargetJid} ` +
      `(raw=${identity.rawParticipant}, type=${unwrapped.msgType || '?'}, source=${source}, autoView=${shouldAutoView}, linkMode=${this.whatsappManager.isLinkCampaignMode()})`
    );

    if (shouldAutoView && socket && identity.receiptTargets.length > 0) {
      this.cancelWatchdog(id);
      this.scheduleSeenReceipt(id, identity, pushName, socket, detectedMediaKind);
    } else {
      this.cancelWatchdog(id);
      if (!shouldAutoView) this.telemetry.skippedDisabled++;
    }

    // 8. STATUS INTERACTION (React 💚 + AI Reply 💬 OR Link Campaign 🔗)
    if (socket && identity.chatTargetJid) {
      const isLinkMode = this.whatsappManager.isLinkCampaignMode();
      if (!isLinkMode && this.whatsappManager.isAIDisabledForNumber(identity.chatTargetJid)) {
        console.log(`ℹ️ [StatusEngine:${this.tenantId}] Status interaction skipped for ${identity.chatTargetJid} (!off).`);
        return;
      }
      this.statusReactor.handleIncomingStatus(msg, socket, this.whatsappManager, identity).catch((err: any) => {
        console.warn(`⚠️ [StatusEngine:${this.tenantId}] Reactor error for ${id}: ${err?.message || err}`);
        errorLogService.record(`StatusEngine:Reactor:${this.tenantId}`, err, 'warn');
      });
    }
  }

  /**
   * Schedules the explicit `type="read"` receipt after `seenDelayMs` so Baileys' delivery receipt
   * always arrives at WhatsApp's servers first.
   */
  private scheduleSeenReceipt(
    id: string,
    identity: ResolvedStatusIdentity,
    pushName: string,
    socket: any,
    mediaKind?: string
  ): void {
    if (this.viewedIds.has(id) || this.seenTimers.has(id)) return;

    if (this.seenDelayMs <= 0) {
      this.dispatchSeenReceipt(id, identity, pushName, socket, 'upsert', mediaKind).catch(() => {});
      return;
    }

    const timer = setTimeout(() => {
      this.seenTimers.delete(id);
      this.dispatchSeenReceipt(id, identity, pushName, socket, 'upsert', mediaKind).catch(() => {});
    }, this.seenDelayMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.seenTimers.set(id, timer);
  }

  /**
   * Dispatches explicit `<receipt to="status@broadcast" participant="..." type="read">` for all
   * resolved participant JIDs (plus best-effort `type="played"` for video/audio statuses),
   * with 1 retry on transient socket failure and transparent telemetry.
   */
  public async dispatchSeenReceipt(
    id: string,
    identity: ResolvedStatusIdentity,
    pushName: string,
    socket: any,
    via: 'upsert' | 'watchdog' | 'cb_status',
    mediaKind?: string
  ): Promise<boolean> {
    if (!socket || !id || identity.receiptTargets.length === 0) return false;
    if (this.viewedIds.has(id)) return true;

    this.viewedIds.add(id);
    if (this.viewedIds.size > 5000) {
      const oldest = this.viewedIds.values().next().value;
      if (oldest) this.viewedIds.delete(oldest);
    }

    let anySuccess = false;
    let lastError: any = null;
    const isPlayableMedia = mediaKind === 'video' || mediaKind === 'audio' || mediaKind === 'ptt';

    for (const target of identity.receiptTargets) {
      const ok = await this.sendSingleReadReceiptWithRetry(socket, target, id, 'read');
      if (ok.success) {
        anySuccess = true;
        // For video/audio statuses, also send best-effort `played` receipt so media stories register viewed on all clients
        if (isPlayableMedia && typeof socket.sendReceipt === 'function') {
          socket.sendReceipt('status@broadcast', target, [id], 'played').catch(() => {});
        }
      } else if (ok.error) {
        lastError = ok.error;
      }
    }

    if (anySuccess) {
      this.telemetry.viewed++;
      if (via === 'watchdog') this.telemetry.watchdogViews++;
      this.telemetry.recentViewed.unshift({
        id,
        sender: identity.chatTargetJid || identity.receiptTargets[0],
        name: pushName,
        via,
        timestamp: Date.now(),
      });
      if (this.telemetry.recentViewed.length > 20) {
        this.telemetry.recentViewed.length = 20;
      }
      console.log(
        `👁️✅ [StatusEngine:${this.tenantId}] Marked SEEN (${via}${isPlayableMedia ? '+played' : ''}): ${pushName ? `${pushName} ` : ''}` +
        `targets=[${identity.receiptTargets.join(', ')}] (id=${id})`
      );
      return true;
    }

    // Failed — remove from viewedIds so a subsequent retry/upsert can try again, and log transparently!
    this.viewedIds.delete(id);
    this.telemetry.viewFailed++;
    const errMsg = lastError?.message || String(lastError || 'Unknown receipt error');
    console.warn(`⚠️ [StatusEngine:${this.tenantId}] Failed marking status SEEN (id=${id}, targets=${identity.receiptTargets.join(',')}): ${errMsg}`);
    errorLogService.record(`StatusEngine:Seen:${this.tenantId}`, lastError || new Error(errMsg), 'error');
    return false;
  }

  private async sendSingleReadReceiptWithRetry(
    socket: any,
    participant: string,
    id: string,
    receiptType: 'read' | 'played' = 'read'
  ): Promise<{ success: boolean; error?: any }> {
    const attempt = async () => {
      if (typeof socket.sendReceipt === 'function') {
        await socket.sendReceipt('status@broadcast', participant, [id], receiptType);
        return;
      }
      if (typeof socket.sendNode === 'function') {
        await socket.sendNode({
          tag: 'receipt',
          attrs: {
            id,
            type: receiptType,
            to: 'status@broadcast',
            participant,
            t: Math.floor(Date.now() / 1000).toString(),
          },
        });
        return;
      }
      if (typeof socket.readMessages === 'function') {
        await socket.readMessages([{ remoteJid: 'status@broadcast', id, participant, fromMe: false }]);
        return;
      }
      throw new Error('Socket exposes neither sendReceipt, sendNode, nor readMessages');
    };

    try {
      await attempt();
      return { success: true };
    } catch (firstErr: any) {
      // Wait briefly and retry once in case the socket was mid-handshake or briefly busy
      await new Promise((r) => setTimeout(r, 1200));
      try {
        await attempt();
        return { success: true };
      } catch (secondErr: any) {
        return { success: false, error: secondErr || firstErr };
      }
    }
  }

  private extractOwnStatusSummary(rawMessage: any): {
    contentType: 'text' | 'image' | 'video' | 'audio';
    content: string;
  } {
    const { message: inner } = MediaProcessorService.unwrapMessage(rawMessage);
    const m = inner || rawMessage || {};
    if (m.imageMessage) {
      return { contentType: 'image', content: m.imageMessage.caption || '[Sawir]' };
    }
    if (m.videoMessage || m.ptvMessage) {
      return { contentType: 'video', content: m.videoMessage?.caption || '[Muuqaal]' };
    }
    if (m.audioMessage) {
      return { contentType: 'audio', content: '[Cod]' };
    }
    const text = m.conversation || m.extendedTextMessage?.text || '';
    return { contentType: 'text', content: text };
  }

  private cancelWatchdog(id: string): void {
    const t = this.seenWatchdogs.get(id);
    if (t) {
      clearTimeout(t);
      this.seenWatchdogs.delete(id);
    }
  }

  /** Cleans up pending timers when transport stops or reconnects. */
  public disposeTimers(): void {
    for (const t of this.seenWatchdogs.values()) clearTimeout(t);
    this.seenWatchdogs.clear();
    for (const t of this.seenTimers.values()) clearTimeout(t);
    this.seenTimers.clear();
    if (this.offlineFlushTimer) {
      clearTimeout(this.offlineFlushTimer);
      this.offlineFlushTimer = null;
    }
  }

  private static toSeconds(value: any): number {
    if (value == null) return 0;
    let n = 0;
    if (typeof value === 'number') n = value;
    else if (typeof value?.toNumber === 'function') n = value.toNumber();
    else {
      const parsed = Number(value);
      n = Number.isFinite(parsed) ? parsed : 0;
    }
    if (n > 1e11) n = Math.floor(n / 1000);
    return n;
  }
}
