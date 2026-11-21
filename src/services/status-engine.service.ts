import { jidNormalizedUser, proto } from '@whiskeysockets/baileys';
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
  notify: string;
  timestamp: number;
  isOffline: boolean;
  receivedAt: number;
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
  via: 'upsert' | 'watchdog';
  timestamp: number;
}

export interface StatusEngineTelemetry {
  received: number;
  viewed: number;
  viewFailed: number;
  watchdogViews: number;
  ciphertextRetries: number;
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
  private countedReceivedIds: Set<string> = new Set();
  private offlineFlushTimer: NodeJS.Timeout | null = null;

  private telemetry: StatusEngineTelemetry = {
    received: 0,
    viewed: 0,
    viewFailed: 0,
    watchdogViews: 0,
    ciphertextRetries: 0,
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
    this.watchdogTimeoutMs = options.watchdogTimeoutMs ?? 4500;
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
    // plus resolved PN JID if it differs (ensures both LID & PN WhatsApp servers accept the view!).
    const receiptTargets: string[] = [];
    const addTarget = (jid: string) => {
      if (jid && !receiptTargets.includes(jid)) receiptTargets.push(jid);
    };
    if (normalizedParticipant) addTarget(normalizedParticipant);
    if (pnJid) addTarget(pnJid);
    if (lidJid && !normalizedParticipant) addTarget(lidJid);

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
        notify: String(attrs.notify || '').trim(),
        timestamp: Number(attrs.t) || 0,
        isOffline: Boolean(attrs.offline),
        receivedAt: Date.now(),
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

      if (this.viewedIds.has(id) || this.seenWatchdogs.has(id)) return;

      // Fallback watchdog: if messages.upsert never delivers a decrypted status within watchdogTimeoutMs
      // (e.g. SenderKey retry timed out), mark it SEEN anyway using the captured wire metadata.
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
            return this.dispatchSeenReceipt(id, identity, meta.notify, socket, 'watchdog');
          })
          .catch((err) => {
            console.warn(`⚠️ [StatusEngine:${this.tenantId}] Watchdog seen error for ${id}: ${err?.message || err}`);
          });
      }, this.watchdogTimeoutMs);

      if (typeof watchdog.unref === 'function') watchdog.unref();
      this.seenWatchdogs.set(id, watchdog);
    } catch (err: any) {
      console.warn(`⚠️ [StatusEngine:${this.tenantId}] observeRawStanza error: ${err?.message || err}`);
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
    //    Do NOT cancel the watchdog and do NOT poison viewedIds — wait for the retried decrypted stanza!
    const isCiphertextStub =
      msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT || !msg.message;
    if (isCiphertextStub) {
      this.telemetry.ciphertextRetries++;
      console.log(
        `⏳ [StatusEngine:${this.tenantId}] Status ${id} from ${identity.chatTargetJid || identity.rawParticipant} awaiting Signal retry (CIPHERTEXT).`
      );
      return;
    }

    // 5. Ignore pure protocol / reaction / bare senderKeyDistribution stanzas (not actual stories)
    if (
      msg.message.protocolMessage ||
      msg.message.reactionMessage ||
      (msg.message.senderKeyDistributionMessage && Object.keys(msg.message).length === 1)
    ) {
      this.cancelWatchdog(id);
      return;
    }

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
      `(raw=${identity.rawParticipant}, source=${source}, autoView=${shouldAutoView}, linkMode=${this.whatsappManager.isLinkCampaignMode()})`
    );

    if (shouldAutoView && socket && identity.receiptTargets.length > 0) {
      this.cancelWatchdog(id);
      this.scheduleSeenReceipt(id, identity, pushName, socket);
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
    socket: any
  ): void {
    if (this.viewedIds.has(id) || this.seenTimers.has(id)) return;

    if (this.seenDelayMs <= 0) {
      this.dispatchSeenReceipt(id, identity, pushName, socket, 'upsert').catch(() => {});
      return;
    }

    const timer = setTimeout(() => {
      this.seenTimers.delete(id);
      this.dispatchSeenReceipt(id, identity, pushName, socket, 'upsert').catch(() => {});
    }, this.seenDelayMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.seenTimers.set(id, timer);
  }

  /**
   * Dispatches explicit `<receipt to="status@broadcast" participant="..." type="read">` for all
   * resolved participant JIDs (with 1 retry on transient socket failure and transparent telemetry).
   */
  public async dispatchSeenReceipt(
    id: string,
    identity: ResolvedStatusIdentity,
    pushName: string,
    socket: any,
    via: 'upsert' | 'watchdog'
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

    for (const target of identity.receiptTargets) {
      const ok = await this.sendSingleReadReceiptWithRetry(socket, target, id);
      if (ok.success) {
        anySuccess = true;
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
        `👁️✅ [StatusEngine:${this.tenantId}] Marked SEEN (${via}): ${pushName ? `${pushName} ` : ''}` +
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
    id: string
  ): Promise<{ success: boolean; error?: any }> {
    const attempt = async () => {
      if (typeof socket.sendReceipt === 'function') {
        await socket.sendReceipt('status@broadcast', participant, [id], 'read');
        return;
      }
      if (typeof socket.sendNode === 'function') {
        await socket.sendNode({
          tag: 'receipt',
          attrs: {
            id,
            type: 'read',
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
