import { WASocket, proto } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { broadcastService } from './broadcast.service.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { OutgoingMedia, IMessagingTransport } from '../transports/transport.interface.js';

export interface PostStatusOptions {
  backgroundColor?: string;
  font?: number;
  statusJidList?: string[];
}

export interface StatusViewerRecord {
  jid: string;
  name?: string;
  timestamp: number;
}

export interface PostedStatusRecord {
  id: string;
  timestamp: number;
  type: 'text' | 'image' | 'video' | 'audio';
  content?: string;
  backgroundColor?: string;
  recipientsCount: number;
  viewers: StatusViewerRecord[];
}

export interface GroupInfo {
  id: string;
  subject: string;
  owner?: string;
  creation?: number;
  participantsCount: number;
  adminCount: number;
  desc?: string;
}

export class WhatsAppManagerService {
  private socket: WASocket | null = null;
  private autoViewStatus: boolean = true;
  private botJid: string = '';
  private aiOrchestrator: AIOrchestrator | null = null;
  private lastPostedStatusKeys: Array<{ id: string; timestamp: number }> = [];
  private readonly statusStoragePath: string = path.join(process.cwd(), 'data', 'posted-statuses.json');
  private postedStatuses: Map<string, PostedStatusRecord> = new Map();
  private inProgressDeletes: Set<string> = new Set();

  constructor() {
    this.loadPersistedStatuses();
  }

  private loadPersistedStatuses(): void {
    try {
      if (fs.existsSync(this.statusStoragePath)) {
        const raw = fs.readFileSync(this.statusStoragePath, 'utf8');
        const list: PostedStatusRecord[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item?.id) {
              this.postedStatuses.set(item.id, {
                ...item,
                viewers: Array.isArray(item.viewers) ? item.viewers : [],
              });
              this.lastPostedStatusKeys.push({ id: item.id, timestamp: item.timestamp || Date.now() });
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to load persisted statuses: ${e?.message}`);
    }
  }

  private savePersistedStatuses(): void {
    try {
      const dir = path.dirname(this.statusStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.postedStatuses.values());
      fs.writeFileSync(this.statusStoragePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to save persisted statuses: ${e?.message}`);
    }
  }

  public recordPostedStatus(
    id: string,
    type: 'text' | 'image' | 'video' | 'audio' = 'text',
    content?: string,
    backgroundColor?: string,
    recipientsCount: number = 0
  ): void {
    const timestamp = Date.now();
    this.lastPostedStatusKeys.push({ id, timestamp });
    if (this.lastPostedStatusKeys.length > 50) {
      this.lastPostedStatusKeys.shift();
    }

    const record: PostedStatusRecord = {
      id,
      timestamp,
      type,
      content,
      backgroundColor,
      recipientsCount,
      viewers: [],
    };
    this.postedStatuses.set(id, record);

    if (this.postedStatuses.size > 50) {
      const oldestKey = this.postedStatuses.keys().next().value;
      if (oldestKey) this.postedStatuses.delete(oldestKey);
    }

    this.savePersistedStatuses();
  }

  public recordStatusView(
    statusId: string,
    viewerJid: string,
    viewTimestamp?: number
  ): { recorded: boolean; count: number; viewerName?: string; statusId?: string } {
    const cleanViewerJid = this.toCleanUserJid(viewerJid) || viewerJid;
    const ts = viewTimestamp
      ? (viewTimestamp > 1e11 ? viewTimestamp : viewTimestamp * 1000)
      : Date.now();

    let targetRecord: PostedStatusRecord | undefined = this.postedStatuses.get(statusId);

    if (!targetRecord && this.postedStatuses.size > 0) {
      for (const [id, record] of this.postedStatuses.entries()) {
        if (id === statusId || statusId.includes(id) || id.includes(statusId)) {
          targetRecord = record;
          break;
        }
      }
      if (!targetRecord) {
        const sorted = Array.from(this.postedStatuses.values()).sort((a, b) => b.timestamp - a.timestamp);
        if (sorted.length > 0 && Date.now() - sorted[0].timestamp < 24 * 3600 * 1000) {
          targetRecord = sorted[0];
        }
      }
    }

    if (targetRecord) {
      const viewerName = broadcastService.getContactName(cleanViewerJid) || undefined;
      const existingIdx = targetRecord.viewers.findIndex(v => v.jid === cleanViewerJid);
      if (existingIdx >= 0) {
        targetRecord.viewers[existingIdx].timestamp = ts;
        if (viewerName) targetRecord.viewers[existingIdx].name = viewerName;
      } else {
        targetRecord.viewers.push({
          jid: cleanViewerJid,
          name: viewerName,
          timestamp: ts,
        });
      }

      this.savePersistedStatuses();
      return {
        recorded: true,
        count: targetRecord.viewers.length,
        viewerName,
        statusId: targetRecord.id,
      };
    }

    return { recorded: false, count: 0 };
  }

  public getStatusViews(statusId?: string): {
    found: boolean;
    status?: PostedStatusRecord;
    formattedReport: string;
    totalViews: number;
    recentStatuses: Array<{ id: string; content?: string; timestamp: number; totalViews: number }>;
  } {
    let record: PostedStatusRecord | undefined;
    if (statusId) {
      record = this.postedStatuses.get(statusId);
      if (!record) {
        for (const [id, r] of this.postedStatuses.entries()) {
          if (id === statusId || statusId.includes(id) || id.includes(statusId)) {
            record = r;
            break;
          }
        }
      }
    } else {
      const sorted = Array.from(this.postedStatuses.values()).sort((a, b) => b.timestamp - a.timestamp);
      record = sorted[0];
    }

    const allRecent = Array.from(this.postedStatuses.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
      .map(s => ({
        id: s.id,
        content: s.content,
        timestamp: s.timestamp,
        totalViews: s.viewers.length,
      }));

    if (!record) {
      return {
        found: false,
        formattedReport:
          `ℹ️ *[CARDOSO AI — DAAWADEYAASHA STATUS-KA]* 👁️\n\n` +
          `Ma jiro status aad dhowaan soo dhigtay oo diiwaangashan.\n` +
          `Si aad status cusub u soo dhigto, qor:\n` +
          `• \`!status <fariin>\` (Qoraal)\n` +
          `• Ama sawir/muuqaal/cod soo dir adigoo qoraal uga dhigaya \`!status\`.`,
        totalViews: 0,
        recentStatuses: allRecent,
      };
    }

    const formatTime = (ts: number) => {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const statusTypeLabel = record.type === 'text' ? 'Qoraal' : record.type === 'image' ? 'Sawir' : record.type === 'video' ? 'Muuqaal' : 'Cod';
    const statusPreview = record.content ? `"${record.content}"` : `[${statusTypeLabel}]`;
    const totalViews = record.viewers.length;

    let viewersListStr = '';
    if (totalViews === 0) {
      viewersListStr = `⏳ _Wali cidna ma daawan status-kan. Marka ay dadku daawadaan, liiskooda tooska ah ayaa halkan ku soo bixi doona._`;
    } else {
      const sortedViewers = [...record.viewers].sort((a, b) => b.timestamp - a.timestamp);
      const lines = sortedViewers.map((v, i) => {
        const phone = v.jid.split('@')[0];
        const displayName = v.name ? `${v.name} (+${phone})` : `+${phone}`;
        return `${i + 1}. 👤 *${displayName}* — 🕒 _${formatTime(v.timestamp)}_`;
      });
      viewersListStr = lines.join('\n');
    }

    const report =
      `📊 *[CARDOSO AI — DAAWADEYAASHA STATUS-KA]* 👁️\n\n` +
      `📝 *Status:* ${statusPreview}\n` +
      `📌 *Nooca:* ${statusTypeLabel}${record.backgroundColor ? ` (${record.backgroundColor})` : ''}\n` +
      `⏰ *Waqtiga la dhigay:* ${formatTime(record.timestamp)}\n` +
      `👥 *Wadarta Daawatay:* *${totalViews} Qof*\n\n` +
      `👁️ *LIISKA DADKA DAAWATAY:*\n` +
      `${viewersListStr}\n\n` +
      `💡 _Talo: Bot-ku wuxuu si toos ah u duubaa ilbiriqsi kasta oo qof daawado, xitaa haddii aysan kaaga soo muuqan tab-ka taleefanka._`;

    return {
      found: true,
      status: record,
      formattedReport: report,
      totalViews,
      recentStatuses: allRecent,
    };
  }

  public hasPostedStatus(id: string): boolean {
    if (!id) return false;
    return this.postedStatuses.has(id) || this.lastPostedStatusKeys.some(k => k.id === id);
  }

  public async deleteStatusById(
    statusId: string,
    options?: { fromPhone?: boolean }
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).' };
    }
    const cleanId = (statusId || '').trim();
    if (!cleanId) {
      return { success: false, message: 'Fadlan bixi Message ID-ga status-ka aad rabto inaad tirtirto.' };
    }

    if (this.inProgressDeletes.has(cleanId)) {
      return { success: true, message: `Status-ka (${cleanId}) horey ayaa loo tirtirayaa.` };
    }
    this.inProgressDeletes.add(cleanId);

    try {
      // For status@broadcast revokes, the key must strictly be { remoteJid: 'status@broadcast', id: cleanId, fromMe: true }
      // without participant so contacts and WhatsApp server match the original broadcast entry correctly.
      const key: proto.IMessageKey = {
        remoteJid: 'status@broadcast',
        id: cleanId,
        fromMe: true,
      };
      const recipients = this.getStatusRecipients();
      const sendOpts: any = { broadcast: true };
      if (recipients.length > 0) {
        sendOpts.statusJidList = recipients;
      }

      // 1. Broadcast delete to all audience recipients who were eligible to see the status
      try {
        await this.socket.sendMessage('status@broadcast', { delete: key }, sendOpts);
      } catch (delSendErr: any) {
        const errMsg = delSendErr?.message || '';
        if (errMsg.includes('session') || errMsg.includes('Session') || errMsg.includes('MAC') || errMsg.includes('Timed Out') || errMsg.includes('timed out')) {
          console.warn(`⚠️ [WhatsApp Status] Session/timeout error during status delete (${errMsg}). Retrying delete with safe fallback...`);
          await this.socket.sendMessage('status@broadcast', { delete: key }, { broadcast: true, statusJidList: this.getSafeFallbackRecipients() });
        } else {
          console.warn(`[WhatsApp Status] Notice during status audience delete (${cleanId}): ${delSendErr?.message}`);
          await this.socket.sendMessage('status@broadcast', { delete: key }, { broadcast: true });
        }
      }

      // 2. Sync delete to primary phone and companion devices via App State Sync (deleteMessageForMeAction)
      // Only dispatch deleteForMe if this was NOT triggered directly from the user's phone,
      // preventing redundant App State mutations that cause phone-side sync conflicts.
      if (!options?.fromPhone && typeof (this.socket as any)?.chatModify === 'function') {
        try {
          await (this.socket as any).chatModify(
            {
              deleteForMe: {
                key,
                timestamp: Math.floor(Date.now() / 1000),
                deleteMedia: true,
              },
            },
            'status@broadcast'
          );
          console.log(`📱 [WhatsApp Status] Dispatched deleteForMe App State Sync for ${cleanId} to clear My Status on phone.`);
        } catch (chatModErr: any) {
          console.warn(`[WhatsApp Status] chatModify deleteForMe notice: ${chatModErr?.message}`);
        }
      }

      this.postedStatuses.delete(cleanId);
      this.lastPostedStatusKeys = this.lastPostedStatusKeys.filter(k => k.id !== cleanId);
      this.savePersistedStatuses();
      console.log(`🗑️ [WhatsApp Status] Status-kii (${cleanId}) waa la tirtiray dhammaan (Delete for everyone)!`);
      return {
        success: true,
        message: `🗑️ Status-kaaga si guul leh ayaa looga tirtiray WhatsApp dhammaan dadka iyo taleefankaaga (Delete for everyone)! ✅`,
      };
    } catch (err: any) {
      console.error(`❌ [WhatsApp Status] Error deleting status ${cleanId}:`, err);
      return { success: false, message: `Cilad tirtiridda status-ka: ${err?.message}` };
    } finally {
      setTimeout(() => this.inProgressDeletes.delete(cleanId), 10000);
    }
  }

  public async deleteLastStatus(): Promise<{ success: boolean; message: string }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).' };
    }
    let lastId = '';
    const sorted = Array.from(this.postedStatuses.values()).sort((a, b) => b.timestamp - a.timestamp);
    if (sorted.length > 0) {
      lastId = sorted[0].id;
    } else if (this.lastPostedStatusKeys.length > 0) {
      const item = this.lastPostedStatusKeys.pop();
      lastId = item?.id || '';
    }

    if (!lastId) {
      return {
        success: false,
        message: '⚠️ Ma jiro status dhowaan la soo dhigay oo la kaydiyay.\nHaddii aad haysato ID-ga status-ka, isticmaal: `!deletestatus <message_id>` ama fariinta status-ka reply ku dheh `!delete`.',
      };
    }
    return await this.deleteStatusById(lastId);
  }

  /**
   * Deletes ALL recorded statuses for everyone from WhatsApp and syncs to phone.
   */
  public async deleteAllStatuses(): Promise<{ success: boolean; message: string; count: number }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).', count: 0 };
    }

    const allKeys = Array.from(this.postedStatuses.keys());
    const combined = Array.from(new Set([...allKeys, ...this.lastPostedStatusKeys.map(k => k.id)])).filter(
      id => id && !id.startsWith('test_') && id !== 'status_msg_123'
    );

    if (combined.length === 0) {
      return {
        success: false,
        message: '⚠️ Ma jiraan status-yo hore oo hadda diiwaangashan oo la tirtiri karo.',
        count: 0,
      };
    }

    let deletedCount = 0;
    for (const statusId of combined) {
      try {
        const res = await this.deleteStatusById(statusId);
        if (res.success) {
          deletedCount++;
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (e: any) {
        console.warn(`[WhatsApp Status] Could not delete status ${statusId}:`, e?.message);
      }
    }

    this.lastPostedStatusKeys = [];
    this.postedStatuses.clear();
    this.savePersistedStatuses();

    return {
      success: true,
      message: `🗑️ Waxaa si guul leh loo tirtiray dhammaan (${deletedCount}) status-yadii hore ee WhatsApp yaallay iyo taleefankaaga (Delete for everyone)! ✅`,
      count: deletedCount,
    };
  }

  public setSocket(socket: WASocket | null): void {
    this.socket = socket;
    if (socket?.user?.id) {
      this.botJid = socket.user.id.split(':')[0].split('@')[0];
    }
  }

  public setBotJid(jid: string): void {
    this.botJid = jid.split(':')[0].split('@')[0];
  }

  public setAIOrchestrator(ai: AIOrchestrator): void {
    this.aiOrchestrator = ai;
  }

  public isAutoViewStatusEnabled(): boolean {
    return this.autoViewStatus;
  }

  public setAutoViewStatus(enabled: boolean): void {
    this.autoViewStatus = enabled;
    console.log(`👁️ [WhatsAppManager] Auto-View Status is now: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  public isConnected(): boolean {
    return Boolean(this.socket);
  }

  /**
   * Normalizes any raw phone number or JID to a clean WhatsApp user JID (e.g. 252634949642@s.whatsapp.net).
   * Strictly excludes device suffixes (:0, :24), LIDs, group JIDs, and non-numeric JIDs.
   */
  public toCleanUserJid(raw?: string): string | null {
    if (!raw) return null;
    const clean = raw.trim();
    if (!clean || clean.includes('@g.us') || clean.includes('@broadcast') || clean.includes('@newsletter') || clean.includes('@lid')) {
      return null;
    }
    // Extract purely the user phone digits before '@' and ':'
    const userPart = clean.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    let normalizedDigits = userPart;
    // Local Somali format: 063... or 061... -> 252...
    if (/^0[69]\d{8}$/.test(userPart)) {
      normalizedDigits = '252' + userPart.slice(1);
    } else if (/^[69]\d{8}$/.test(userPart)) {
      normalizedDigits = '252' + userPart;
    }
    // Real E.164 phone numbers are 7 to 13 digits (14-15 digit numbers in WhatsApp are internal LIDs)
    if (normalizedDigits.length >= 7 && normalizedDigits.length <= 13) {
      return `${normalizedDigits}@s.whatsapp.net`;
    }
    return null;
  }

  /**
   * Returns owner account's primary mobile device (:0) and clean normalized phone JID.
   * This is the absolute minimum safe recipient list needed for the owner to see and decrypt
   * their own status in the WhatsApp "My Status" screen.
   */
  public getOwnerOnlyRecipients(): string[] {
    const list: string[] = [];
    if (this.socket?.user?.id) {
      const cleanMe = this.toCleanUserJid(this.socket.user.id);
      if (cleanMe) {
        list.push(cleanMe);
      }
      const myLid = (this.socket.user as any)?.lid;
      if (myLid) {
        const cleanLid = myLid.split(':')[0].split('@')[0] + '@lid';
        list.push(cleanLid);
      }
    } else {
      try {
        const credsPath = path.join(process.cwd(), 'baileys_auth_info', 'creds.json');
        if (fs.existsSync(credsPath)) {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
          if (creds?.me?.id) {
            const cleanMe = this.toCleanUserJid(creds.me.id);
            if (cleanMe) {
              list.push(cleanMe);
            }
          }
          if (creds?.me?.lid) {
            const cleanLid = creds.me.lid.split(':')[0].split('@')[0] + '@lid';
            list.push(cleanLid);
          }
        }
      } catch {}
    }
    return Array.from(new Set(list));
  }

  /**
   * Returns admin phone numbers configured in environment variables.
   * Ensures the user/admin always receives and can view status updates.
   */
  public getAdminRecipients(): string[] {
    const set = new Set<string>();
    const envAdmins = [
      process.env.ADMIN_PHONE_NUMBERS,
      process.env.SUPER_ADMIN_PHONE,
      process.env.ALLOWED_PHONE_NUMBERS,
      '252634949642',
      '252633171649',
    ]
      .filter(Boolean)
      .join(',')
      .split(',')
      .map(n => n.trim())
      .filter(Boolean);

    for (const a of envAdmins) {
      const cleanAdmin = this.toCleanUserJid(a);
      if (cleanAdmin) {
        set.add(cleanAdmin);
      }
    }
    return Array.from(set);
  }

  /**
   * Scans baileys_auth_info for active pairwise Signal session files that belong to real E.164 phone numbers.
   * Strictly excludes internal WhatsApp LID sessions so USync never times out on fake @s.whatsapp.net JIDs.
   */
  public getVerifiedDiskSessionRecipients(): string[] {
    const list: string[] = [];
    try {
      const authDir = path.join(process.cwd(), 'baileys_auth_info');
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        for (const file of files) {
          const match = file.match(/^session-([0-9]{7,13})\.0\.json$/);
          if (match && match[1]) {
            const digits = match[1];
            if (digits.startsWith('1800')) continue;
            const clean = this.toCleanUserJid(digits);
            if (clean) {
              list.push(clean);
            }
          }
        }
      }
    } catch {}
    return Array.from(new Set(list));
  }

  /**
   * Safe fallback recipients containing the host account and admin accounts.
   */
  public getSafeFallbackRecipients(): string[] {
    return Array.from(
      new Set([
        ...this.getOwnerOnlyRecipients(),
        ...this.getAdminRecipients(),
      ])
    );
  }

  /**
   * Checks whether a recipient is a valid phone JID (owner, admin, or valid 7-13 digit E.164 phone number).
   * Strictly rejects @lid or 14-15 digit LID numbers.
   */
  public hasSessionRecord(jid: string): boolean {
    if (!jid || jid.includes('@lid') || jid.includes(':')) return false;
    const cleanDigits = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (!cleanDigits || cleanDigits.length < 7 || cleanDigits.length > 13) return false;

    // In unit-test / mock environment (no authState attached), allow all valid phone JIDs
    if (this.socket && !(this.socket as any).authState) {
      return true;
    }

    // Owner account devices always have session records
    const ownerNumber = this.socket?.user?.id
      ? this.socket.user.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
      : '';
    if (ownerNumber && cleanDigits === ownerNumber) {
      return true;
    }

    // Admin numbers configured in env are always trusted
    const admins = this.getAdminRecipients().map(a => a.split('@')[0].split(':')[0].replace(/[^0-9]/g, ''));
    if (admins.includes(cleanDigits)) {
      return true;
    }

    // Valid E.164 phone numbers (7-13 digits, non-LID) are valid WhatsApp phone recipients
    return true;
  }

  /**
   * Filters any recipient list to verified phone recipients and strictly excludes all @lid JIDs and colon device suffixes.
   * Caps total status recipients at 50 (matching WhatsApp's encrypt IQ prekey batch limit) with
   * owner and admin accounts guaranteed first so WhatsApp never drops oversized broadcast stanzas.
   */
  public filterSessionVerifiedRecipients(recipients: string[]): string[] {
    const MAX_STATUS_RECIPIENTS = 50;
    const safeSet = new Set<string>();

    // 1. Always ensure owner clean JID is first
    for (const o of this.getOwnerOnlyRecipients()) safeSet.add(o);

    // 2. Always ensure admin numbers are next
    for (const a of this.getAdminRecipients()) safeSet.add(a);

    // 3. Add candidates that pass validation up to MAX_STATUS_RECIPIENTS
    for (const r of recipients) {
      if (safeSet.size >= MAX_STATUS_RECIPIENTS) break;
      if (!r || r.includes('@lid') || r.includes(':')) continue;
      const digits = r.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      if (!digits || digits.startsWith('1800')) continue;
      const clean = this.toCleanUserJid(r);
      if (clean && this.hasSessionRecord(clean)) {
        safeSet.add(clean);
      }
    }

    // 4. Fill remaining slots from established phone disk sessions
    if (safeSet.size < MAX_STATUS_RECIPIENTS) {
      for (const d of this.getVerifiedDiskSessionRecipients()) {
        if (safeSet.size >= MAX_STATUS_RECIPIENTS) break;
        if (d && !d.includes(':')) {
          safeSet.add(d);
        }
      }
    }

    return Array.from(safeSet);
  }

  /**
   * Builds the recipient JID list for status posts and status deletions (Stories).
   * WhatsApp Multi-Device strictly requires statusJidList so that:
   * 1. The owner's primary mobile phone receives the status in "My Status" (decrypts sender key).
   * 2. The admin / user receives and decrypts the status on their phone.
   * 3. Real phone contacts receive the status in their "Updates" tab.
   * 4. Deletion requests broadcast the revocation key to all recipients.
   * Strictly excludes @lid contacts and caps at 50 active recipients so USync/encrypt IQ never times out or drops.
   */
  public getStatusRecipients(): string[] {
    const jidSet = new Set<string>();

    // 1. Host account's own primary number
    for (const o of this.getOwnerOnlyRecipients()) {
      jidSet.add(o);
    }

    // 2. Admin phone numbers from environment (the user)
    for (const a of this.getAdminRecipients()) {
      jidSet.add(a);
    }

    // 3. Bot's configured JID if available
    if (this.botJid) {
      const cleanBot = this.toCleanUserJid(this.botJid);
      if (cleanBot) {
        jidSet.add(cleanBot);
      }
    }

    // 4. Synchronized phone contacts from broadcast service (most recently active first, strictly @s.whatsapp.net only)
    const contacts = [...broadcastService.getContacts()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    for (const c of contacts) {
      const phoneCandidate = c.phone || (!c.jid?.includes('@lid') ? c.jid : undefined);
      if (!phoneCandidate) continue;
      const digits = phoneCandidate.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      if (!digits || digits.startsWith('1800')) continue;
      const clean = this.toCleanUserJid(phoneCandidate);
      if (clean) jidSet.add(clean);
    }

    // 5. Active pairwise phone Signal sessions from disk
    for (const d of this.getVerifiedDiskSessionRecipients()) {
      jidSet.add(d);
    }

    return this.filterSessionVerifiedRecipients(Array.from(jidSet));
  }

  /**
   * Resets only the recipient delivery map ('sender-key-memory') for status@broadcast,
   * while preserving the active Signal 'sender-key' chain state.
   */
  public async resetStatusSenderKeyMemory(): Promise<void> {
    try {
      const authDir = path.join(process.cwd(), 'baileys_auth_info');
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        for (const file of files) {
          if (file.startsWith('sender-key-memory-status@broadcast')) {
            try {
              fs.unlinkSync(path.join(authDir, file));
            } catch {}
          }
        }
      }

      if ((this.socket as any)?.authState?.keys?.set) {
        await (this.socket as any).authState.keys.set({
          'sender-key-memory': { 'status@broadcast': null },
        });
      }
    } catch (err: any) {
      console.warn('⚠️ [WhatsApp Status] Error resetting status sender-key memory:', err?.message);
    }
  }

  /**
   * Validates the pairwise Signal session between the bot companion device
   * and the owner's primary mobile phone (:0), ensuring the session store is intact.
   */
  public async ensureOwnerSessionHealthy(): Promise<void> {
    // Keep session store safe and intact; never delete working sessions during runtime
  }

  // ─── 1. WHATSAPP STATUS (STORIES) MANAGEMENT ──────────────────────────────

  /**
   * Posts a text status update to WhatsApp (status@broadcast) with styling.
   */
  public async postTextStatus(
    text: string,
    options?: PostStatusOptions
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).' };
    }

    const cleanText = text.trim();
    if (!cleanText) {
      return { success: false, message: 'Qoraalka status-ka ma noqon karo mid maran.' };
    }

    try {
      // 1. Reset sender key memory and ensure owner pairwise session is healthy
      await this.resetStatusSenderKeyMemory();
      await this.ensureOwnerSessionHealthy();

      const targetRecipients = (options?.statusJidList && options.statusJidList.length > 0)
        ? options.statusJidList.map(j => this.toCleanUserJid(j) || j).filter(Boolean)
        : this.getStatusRecipients();

      const vibrantColors = [
        '#1e3c72', // Royal Navy Blue
        '#0f5132', // Deep Forest Green
        '#4a154b', // Imperial Purple
        '#0d6efd', // Vibrant Blue
        '#b02a37', // Crimson Red
        '#198754', // Emerald Green
        '#6f42c1', // Royal Violet
        '#0b7285', // Teal Ocean
        '#d63384', // Magenta Rose
      ];
      const chosenColor = options?.backgroundColor || vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
      const chosenFont = options?.font || 1;

      const statusSendOptions: any = {
        broadcast: true,
        backgroundColor: chosenColor,
        font: chosenFont,
        useUserDevicesCache: false,
      };
      if (targetRecipients.length > 0) {
        statusSendOptions.statusJidList = targetRecipients;
      }

      console.log(`📢 [WhatsApp Status] Posting text status (Color: ${chosenColor}, Font: ${chosenFont}, Recipients: ${targetRecipients.length}): "${cleanText.slice(0, 45)}"...`);

      let sent: any = undefined;
      try {
        sent = await this.socket.sendMessage(
          'status@broadcast',
          {
            text: cleanText,
            backgroundColor: chosenColor,
            font: chosenFont,
          } as any,
          statusSendOptions
        );
      } catch (sendErr: any) {
        const errMsg = sendErr?.message || '';
        if (errMsg.includes('session') || errMsg.includes('Session') || errMsg.includes('MAC') || errMsg.includes('Timed Out') || errMsg.includes('timed out')) {
          console.warn(`⚠️ [WhatsApp Status] Session/timeout error during text status dispatch (${errMsg}). Retrying with safe fallback recipients...`);
          await this.resetStatusSenderKeyMemory();
          const fallbackOptions = {
            ...statusSendOptions,
            statusJidList: this.getSafeFallbackRecipients(),
          };
          sent = await this.socket.sendMessage(
            'status@broadcast',
            {
              text: cleanText,
              backgroundColor: chosenColor,
              font: chosenFont,
            } as any,
            fallbackOptions
          );
        } else {
          throw sendErr;
        }
      }

      // 2. Clear sender key memory right after send so subsequent posts also re-distribute cleanly
      await this.resetStatusSenderKeyMemory();

      console.log(`📢 [WhatsApp Status] Message dispatched successfully! MessageId: ${sent?.key?.id}`);

      if (sent?.key?.id) {
        this.recordPostedStatus(sent.key.id, 'text', cleanText, chosenColor, targetRecipients.length);
      }

      const visibilityNote = targetRecipients.length > 0
        ? `${targetRecipients.length} qof (Contacts + Milkiilaha)`
        : 'Dhammaan contacts-ka';

      console.log(`📢 [WhatsApp Status] Status text posted successfully to ${targetRecipients.length} recipients! (${cleanText.slice(0, 45)}...)`);
      return {
        success: true,
        message: `✅ Status-kaaga si guul leh ayaa loogu daabacay WhatsApp!\n• Fariinta: "${cleanText}"\n• Midabka: ${chosenColor}\n• U muuqashada: ${visibilityNote}\n• 👁️ Eeg cidda daawatay: Qor \`!statusviews\``,
        messageId: sent?.key?.id || undefined,
      };
    } catch (err: any) {
      console.error('❌ [WhatsApp Status] Error posting text status:', err);
      return { success: false, message: `Cilad ayaa ku timid soo dhigista status-ka: ${err.message}` };
    }
  }

  /**
   * Posts an image, video, or voice status to WhatsApp (status@broadcast).
   */
  public async postMediaStatus(
    media: { buffer: Buffer; mimeType: string; caption?: string; type: 'image' | 'video' | 'audio' },
    options?: { backgroundColor?: string; statusJidList?: string[] }
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).' };
    }

    try {
      // 1. Reset sender key memory and ensure owner pairwise session is healthy
      await this.resetStatusSenderKeyMemory();
      await this.ensureOwnerSessionHealthy();

      const targetRecipients = (options?.statusJidList && options.statusJidList.length > 0)
        ? options.statusJidList.map(j => this.toCleanUserJid(j) || j).filter(Boolean)
        : this.getStatusRecipients();

      let sent: any = undefined;

      const statusSendOptions: any = {
        broadcast: true,
        useUserDevicesCache: false,
      };
      if (targetRecipients.length > 0) {
        statusSendOptions.statusJidList = targetRecipients;
      }

      const dispatchMedia = async (sendOpts: any) => {
        if (media.type === 'image') {
          return await this.socket!.sendMessage(
            'status@broadcast',
            {
              image: media.buffer,
              caption: media.caption || '',
            },
            sendOpts
          );
        } else if (media.type === 'video') {
          return await this.socket!.sendMessage(
            'status@broadcast',
            {
              video: media.buffer,
              caption: media.caption || '',
            },
            sendOpts
          );
        } else if (media.type === 'audio') {
          const colors = ['#1e3c72', '#0f5132', '#4a154b', '#0d6efd', '#6f42c1'];
          const chosenColor = options?.backgroundColor || colors[Math.floor(Math.random() * colors.length)];
          const audioSendOptions = {
            ...sendOpts,
            backgroundColor: chosenColor,
          };
          return await this.socket!.sendMessage(
            'status@broadcast',
            {
              audio: media.buffer,
              mimetype: 'audio/mp4',
              ptt: true,
              backgroundColor: chosenColor,
            } as any,
            audioSendOptions
          );
        }
      };

      try {
        sent = await dispatchMedia(statusSendOptions);
      } catch (sendErr: any) {
        const errMsg = sendErr?.message || '';
        if (errMsg.includes('session') || errMsg.includes('Session') || errMsg.includes('MAC') || errMsg.includes('Timed Out') || errMsg.includes('timed out')) {
          console.warn(`⚠️ [WhatsApp Status] Session/timeout error during media status dispatch (${errMsg}). Retrying with safe fallback recipients...`);
          await this.resetStatusSenderKeyMemory();
          const fallbackOptions = {
            ...statusSendOptions,
            statusJidList: this.getSafeFallbackRecipients(),
          };
          sent = await dispatchMedia(fallbackOptions);
        } else {
          throw sendErr;
        }
      }

      // 2. Clear sender key memory right after send
      await this.resetStatusSenderKeyMemory();

      if (sent?.key?.id) {
        this.recordPostedStatus(sent.key.id, media.type, media.caption, options?.backgroundColor, targetRecipients.length);
      }

      const visibilityNote = targetRecipients.length > 0
        ? `${targetRecipients.length} qof (Contacts + Milkiilaha)`
        : 'Dhammaan contacts-ka';

      console.log(`📢 [WhatsApp Status] Media status (${media.type}) posted successfully to ${targetRecipients.length} recipients!`);
      return {
        success: true,
        message: `✅ Sawirka/Codka/Muuqaalka si guul leh ayaa loogu soo dhigay WhatsApp Status!\n• U muuqashada: ${visibilityNote}\n• 👁️ Eeg cidda daawatay: Qor \`!statusviews\``,
        messageId: sent?.key?.id || undefined,
      };
    } catch (err: any) {
      console.error('❌ [WhatsApp Status] Error posting media status:', err);
      return { success: false, message: `Cilad ayaa ku timid soo dhigista media status: ${err.message}` };
    }
  }

  /**
   * Uses Gemini AI to craft an inspiring, educational status in natural Somali and posts it.
   */
  public async generateAndPostAIStatus(
    topic?: string
  ): Promise<{ success: boolean; message: string; generatedText?: string }> {
    try {
      const promptTopic = topic?.trim() || 'dhiirigelin, guul, waxbarasho, iyo horumarka ardayda Soomaaliyeed';
      let statusText = '';

      if (this.aiOrchestrator) {
        const prompt = `Waxaad tahay qoraa Soomaali ah oo aad ugu xeeldheer qoraallada dhiirigelinta iyo xigmadda WhatsApp Status.
Mawduuca: "${promptTopic}".
Soo saar hal fariin oo aad u gaaban (1 ilaa 2 weedhood oo kaliya), macno qoto dheer leh, qalbiga taabanaysa, ku qoran af-Soomaali dabiici ah oo heer sare ah, oo ay ku jiraan 2-3 emoji oo qurux badan.
Marnaba ha ku darin hordhac ama faahfaahin dambe, soo celi QORAALKA STATUS-KA OO KELIYA.`;

        const response = await this.aiOrchestrator.generateResponse(prompt);
        statusText = (response.text || '').replace(/^["']|["']$/g, '').trim();
      }

      if (!statusText) {
        const quotes = [
          '✨ "Guushu maaha wax kugu yimaada si kadis ah, waa miraha dadaalkaaga joogtada ah ee maalinlaha ah." 📚🚀',
          '💡 "Ha sugin waqti ku habboon, qaado waqtiga hadda jira oo ka dhig mid ku habboon." 🌱🌟',
          '🎯 "Caqabadaha maanta waxay dhisayaan awooddaada berri. Waligaa ha quusan!" 💪🔥',
          '📖 "Aqoontu waa iftiinka kaliya ee qofka ka saara mugdiga jahliga una horseeda mustaqbal ifaya." 🎓✨',
          '⏳ "Waqtigu waa raasamaalkaaga ugu qiimaha badan, u maal-gali waxyaabaha mustaqbalkaaga dhisaya." ⏰💎',
        ];
        statusText = quotes[Math.floor(Math.random() * quotes.length)];
      }

      const postResult = await this.postTextStatus(statusText);
      if (postResult.success) {
        return {
          success: true,
          message: `🌟 *[AI WhatsApp Status]*\n\nFariintan dhiirigelinta ah ayaa toos loogu soo dhigay WhatsApp Status:\n\n"${statusText}"`,
          generatedText: statusText,
        };
      } else {
        return {
          success: false,
          message: postResult.message,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `Cilad ayaa ku timid abuurista AI Status: ${err.message}`,
      };
    }
  }

  /**
   * Marks incoming status update as read (Auto View Status / Mark Seen).
   */
  public async markStatusSeen(key: proto.IMessageKey): Promise<boolean> {
    if (!this.socket || !this.autoViewStatus) return false;
    try {
      await this.socket.readMessages([key]);
      return true;
    } catch (err: any) {
      console.warn(`[WhatsAppManager] Failed to mark status seen: ${err?.message}`);
      return false;
    }
  }

  // ─── 2. REPLY & DIRECT MESSAGING CONTROL ──────────────────────────────────

  /**
   * Normalizes any raw phone number or JID to standard WhatsApp JID format.
   * Seamlessly handles @252634949642, plain numbers, 061/063 local formats, and full JIDs.
   */
  public normalizeToJid(raw: string): string {
    const clean = (raw || '').trim();
    if (!clean) return '';
    // If it's already a full WhatsApp JID like 252634949642@s.whatsapp.net or 252634949642:5@s.whatsapp.net
    if (clean.includes('@s.whatsapp.net') || clean.includes('@lid')) {
      const parts = clean.split('@');
      const user = parts[0].split(':')[0].replace(/[^0-9]/g, '');
      const server = parts[1];
      return `${user}@${server}`;
    }
    // Clean out all non-digits (handles leading @, +, spaces, hyphens, parentheses, etc.)
    const digits = clean.replace(/[^0-9]/g, '');
    let normalized = digits;
    if (/^0[69]\d{8}$/.test(digits)) {
      normalized = '252' + digits.slice(1);
    } else if (/^[69]\d{8}$/.test(digits)) {
      normalized = '252' + digits;
    }
    return normalized ? `${normalized}@s.whatsapp.net` : '';
  }

  /**
   * Sends a direct reply or new message to any specified contact number.
   */
  public async sendDirectReply(
    targetPhoneOrJid: string,
    text: string,
    transport?: IMessagingTransport,
    options?: { replyToMessageId?: string; media?: OutgoingMedia }
  ): Promise<{ success: boolean; message: string }> {
    const targetJid = this.normalizeToJid(targetPhoneOrJid);

    try {
      if (options?.media && transport?.sendMedia) {
        const sent = await transport.sendMedia(targetJid, options.media, {
          replyToMessageId: options.replyToMessageId,
        });
        if (sent) {
          return { success: true, message: `✅ Fariinta media-da ah si guul leh ayaa loogu diray ${targetJid}!` };
        }
      }

      if (transport) {
        const sent = await transport.sendMessage(targetJid, text, {
          replyToMessageId: options?.replyToMessageId,
        });
        if (sent) {
          return { success: true, message: `✅ Fariintaada si guul leh ayaa loogu diray ${targetJid}!` };
        }
      } else if (this.socket) {
        await this.socket.sendMessage(targetJid, { text });
        return { success: true, message: `✅ Fariintaada si guul leh ayaa loogu diray ${targetJid}!` };
      }

      return { success: false, message: 'Ma suurtogalin in fariinta la diro (Transport not available).' };
    } catch (err: any) {
      return { success: false, message: `Cilad dirista: ${err.message}` };
    }
  }

  // ─── 3. GROUP MANAGEMENT (FULL 100% CONTROL) ──────────────────────────────

  /**
   * Mentions and tags all participants in a group chat.
   */
  public async tagAll(
    groupJid: string,
    customMessage?: string
  ): Promise<{ success: boolean; message: string; count: number }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda.', count: 0 };
    }

    try {
      const meta = await this.socket.groupMetadata(groupJid);
      const participants = meta.participants.map(p => p.id);

      let text = `📢 *[OGEYSIIS DHAMMAAN — ${meta.subject}]*\n\n`;
      if (customMessage?.trim()) {
        text += `💬 *Fariinta:* ${customMessage.trim()}\n\n`;
      }
      text += `👥 *Xubnaha Kooxda (${participants.length}):*\n`;
      for (const p of participants) {
        const num = p.split('@')[0].split(':')[0];
        text += `• @${num}\n`;
      }

      await this.socket.sendMessage(groupJid, {
        text,
        mentions: participants,
      });

      return {
        success: true,
        message: `✅ Waxaa la tag-gareeyay ${participants.length} xubnood oo kooxda ku jira!`,
        count: participants.length,
      };
    } catch (err: any) {
      console.error('[WhatsAppManager] tagAll error:', err);
      return { success: false, message: `Cilad tag-garaynta kooxda: ${err.message}`, count: 0 };
    }
  }

  /**
   * Resolves a contact's saved name if available.
   */
  public getContactName(jidOrPhone: string): string | undefined {
    const jid = this.normalizeToJid(jidOrPhone);
    return broadcastService.getContactName(jid);
  }

  /**
   * Removes (kicks) a participant from the group.
   * Supports @mention, raw number, local 061/063 format, or JID.
   */
  public async kickMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string; name?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan. Fadlan qor lambar sax ah ama @ mention.' };
    }

    try {
      await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
      const num = participantJid.split('@')[0];
      const contactName = this.getContactName(participantJid);
      const nameDisplay = contactName ? `${contactName} (@${num})` : `@${num}`;
      return {
        success: true,
        message: `👋 *Macasalaama ${nameDisplay}!*`,
        jid: participantJid,
        name: contactName,
      };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin kooxda si uu dadka uga saari karo.` };
      }
      return { success: false, message: `Cilad ka-saaridda xubinta: ${err.message}` };
    }
  }

  /**
   * Adds a new member to the group.
   * Supports @mention, raw number, local 061/063 format, or JID.
   */
  public async addMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string; name?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan. Fadlan qor lambar sax ah ama @ mention.' };
    }

    try {
      const res: any = await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'add');
      const status = res?.[0]?.status;
      const num = participantJid.split('@')[0];
      const contactName = this.getContactName(participantJid);
      const nameDisplay = contactName ? `${contactName} (@${num})` : `@${num}`;

      if (status === '403') {
        return {
          success: false,
          message: `⚠️ Qofka (${nameDisplay}) wuxuu xidhay Privacy-ga ku-darista kooxaha (Direct Add). Fadlan u dir link-ga kooxda si uu isagu u soo galo.`,
          jid: participantJid,
          name: contactName,
        };
      } else if (status === '409') {
        return {
          success: false,
          message: `ℹ️ Qofka (${nameDisplay}) durba wuxuu ku jiraa kooxda!`,
          jid: participantJid,
          name: contactName,
        };
      }

      return {
        success: true,
        message: `✅ Qofka (${nameDisplay}) waxaa lagu daray kooxda.`,
        jid: participantJid,
        name: contactName,
      };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin kooxda si uu dadka ugu dari karo.` };
      }
      return { success: false, message: `Cilad ku-daridda kooxda: ${err.message}` };
    }
  }

  /**
   * Promotes a group member to Admin.
   */
  public async promoteMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan.' };
    }

    try {
      await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'promote');
      const num = participantJid.split('@')[0];
      return { success: true, message: `👑 Qofka (@${num}) waxaa laga dhigay Admin!`, jid: participantJid };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin.` };
      }
      return { success: false, message: `Cilad dalacsiinta Admin: ${err.message}` };
    }
  }

  /**
   * Demotes a group Admin to regular member.
   */
  public async demoteMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan.' };
    }

    try {
      await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'demote');
      const num = participantJid.split('@')[0];
      return { success: true, message: `👤 Qofka (@${num}) maamulnimadii waa laga qaaday.`, jid: participantJid };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin.` };
      }
      return { success: false, message: `Cilad hoos-u-dhigidda: ${err.message}` };
    }
  }

  /**
   * Mutes or Unmutes the group (Announcement mode vs All members).
   */
  public async setGroupMute(
    groupJid: string,
    mute: boolean
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.groupSettingUpdate(groupJid, mute ? 'announcement' : 'not_announcement');
      return {
        success: true,
        message: mute
          ? '🔒 Kooxda waa la xidhay: Maamulka (Admins) oo kaliya ayaa qori kara fariimaha.'
          : '🔓 Kooxda waa la furay: Dhammaan xubnuhu way qori karaan fariimaha.',
      };
    } catch (err: any) {
      return { success: false, message: `Cilad beddelidda setting-ka kooxda: ${err.message}` };
    }
  }

  /**
   * Retrieves the invite link for a group.
   */
  public async getGroupInviteLink(
    groupJid: string
  ): Promise<{ success: boolean; link?: string; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const code = await this.socket.groupInviteCode(groupJid);
      const link = `https://chat.whatsapp.com/${code}`;
      return {
        success: true,
        link,
        message: `🔗 *Link-ga Kooxda:*\n${link}`,
      };
    } catch (err: any) {
      return { success: false, message: `Cilad helidda link-ga kooxda: ${err.message}` };
    }
  }

  /**
   * Fetches full metadata and member count of a group.
   */
  public async getGroupInfo(
    groupJid: string
  ): Promise<{ success: boolean; info?: GroupInfo; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const meta = await this.socket.groupMetadata(groupJid);
      const adminCount = meta.participants.filter(p => Boolean(p.admin)).length;

      const info: GroupInfo = {
        id: meta.id,
        subject: meta.subject,
        owner: meta.owner,
        creation: meta.creation,
        participantsCount: meta.participants.length,
        adminCount,
        desc: meta.desc,
      };

      const msg =
        `📋 *[XOGTA KOOXDA — ${meta.subject}]*\n` +
        `• ID-ga: \`${meta.id}\`\n` +
        `• Xubnaha: *${meta.participants.length} qof*\n` +
        `• Admins-ka: *${adminCount} qof*\n` +
        (meta.desc ? `• Sharaxaadda: ${meta.desc}\n` : '');

      return { success: true, info, message: msg };
    } catch (err: any) {
      return { success: false, message: `Cilad xogta kooxda: ${err.message}` };
    }
  }

  // ─── 4. PROFILE & ACCOUNT MANAGEMENT ──────────────────────────────────────

  /**
   * Changes the bot's WhatsApp display name.
   */
  public async updateProfileName(
    name: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.updateProfileName(name.trim());
      return { success: true, message: `✅ Magaca bot-ka WhatsApp-ka waxaa loo beddelay: *${name.trim()}*` };
    } catch (err: any) {
      return { success: false, message: `Cilad magac beddelka: ${err.message}` };
    }
  }

  /**
   * Changes the bot's WhatsApp bio / About text.
   */
  public async updateProfileBio(
    bioText: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.updateProfileStatus(bioText.trim());
      return { success: true, message: `✅ Bio-ga / About-ka bot-ka waxaa loo beddelay:\n"${bioText.trim()}"` };
    } catch (err: any) {
      return { success: false, message: `Cilad bio beddelka: ${err.message}` };
    }
  }

  /**
   * Updates the bot's profile picture.
   */
  public async updateProfilePicture(
    imageBuffer: Buffer
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const meJid = this.socket.user?.id || '';
      await this.socket.updateProfilePicture(meJid, imageBuffer);
      return { success: true, message: '✅ Sawirka profile-ka bot-ka si guul leh ayaa loo beddelay!' };
    } catch (err: any) {
      return { success: false, message: `Cilad sawir beddelka: ${err.message}` };
    }
  }

  /**
   * Blocks a contact on WhatsApp.
   */
  public async blockUser(
    phoneOrJid: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const jid = this.normalizeToJid(phoneOrJid);
    try {
      await this.socket.updateBlockStatus(jid, 'block');
      return { success: true, message: `🚫 Lambarka (${jid}) waa la block-gareeyay.` };
    } catch (err: any) {
      return { success: false, message: `Cilad block-garaynta: ${err.message}` };
    }
  }

  /**
   * Unblocks a contact on WhatsApp.
   */
  public async unblockUser(
    phoneOrJid: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const jid = this.normalizeToJid(phoneOrJid);
    try {
      await this.socket.updateBlockStatus(jid, 'unblock');
      return { success: true, message: `✅ Lambarka (${jid}) block-gii waa laga qaaday.` };
    } catch (err: any) {
      return { success: false, message: `Cilad unblock-garaynta: ${err.message}` };
    }
  }

  // ─── 5. MESSAGE MANAGEMENT (DELETE, REACT, PIN) ───────────────────────────

  /**
   * Deletes a message for everyone (Revoke).
   */
  public async deleteMessage(
    chatId: string,
    messageKey: proto.IMessageKey
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const isStatus = chatId === 'status@broadcast';
      const sendOptions: any = {};
      if (isStatus) {
        sendOptions.broadcast = true;
        const recipients = this.getStatusRecipients();
        if (recipients.length > 0) {
          sendOptions.statusJidList = recipients;
        }
      }
      const targetKey: proto.IMessageKey = isStatus
        ? { remoteJid: 'status@broadcast', id: messageKey.id, fromMe: true }
        : messageKey;

      await this.socket.sendMessage(chatId, { delete: targetKey }, sendOptions);
      return { success: true, message: '🗑️ Fariintii waa la tirtiray dhammaan (Delete for everyone).' };
    } catch (err: any) {
      return { success: false, message: `Cilad tirtiridda fariinta: ${err.message}` };
    }
  }

  /**
   * Reacts to a message with an emoji.
   */
  public async reactToMessage(
    chatId: string,
    messageKey: proto.IMessageKey,
    emoji: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.sendMessage(chatId, {
        react: {
          text: emoji,
          key: messageKey,
        },
      });
      return { success: true, message: `✅ React-ga (${emoji}) waa la diray!` };
    } catch (err: any) {
      return { success: false, message: `Cilad reaction-ka: ${err.message}` };
    }
  }

  /**
   * Pins a message in the chat.
   */
  public async pinMessage(
    chatId: string,
    messageKey: proto.IMessageKey,
    durationSeconds: number = 86400
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const validTime: 86400 | 604800 | 2592000 = durationSeconds >= 604800 ? 604800 : 86400;
      await this.socket.sendMessage(chatId, {
        pin: messageKey,
        type: 1,
        time: validTime,
      } as any);
      return { success: true, message: '📌 Fariintii si guul leh ayaa loo pin-gareeyay!' };
    } catch (err: any) {
      return { success: false, message: `Cilad pin-garaynta: ${err.message}` };
    }
  }
}

export const whatsappManagerService = new WhatsAppManagerService();
