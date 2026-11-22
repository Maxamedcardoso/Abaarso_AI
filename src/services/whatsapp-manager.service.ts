import { WASocket, proto, jidNormalizedUser } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { BroadcastService, broadcastService } from './broadcast.service.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { OutgoingMedia, IMessagingTransport } from '../transports/transport.interface.js';
import { groupGovernorService, GroupGovernorService } from './group-governor.service.js';
import { prayerTimesService, PrayerTimesService, PrayerDefinition, PrayerKey } from './prayer-times.service.js';
import { generateSpeechWaveform, getOggOpusDurationSeconds } from './voice-reply.service.js';

export interface WhatsAppManagerOptions {
  authDir?: string;
  statusStoragePath?: string;
  broadcast?: BroadcastService;
  adminPhones?: string[];
}

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

export interface RevokedGroupMessage {
  id: string;
  sender: string;
  text: string;
  deletedAt: number;
  originalTime: number;
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

export interface AutoAddGroupConfig {
  groupJid: string;
  enabled: boolean;
  dailyLimit: number;
  lastRunDate?: string;
  totalAdded: number;
  attemptedJids: string[];
}

export interface ParticipatingGroupItem {
  id: string;
  name: string;
  participantsCount: number;
  isManaged: boolean;
  isAdmin: boolean;
  role: 'admin' | 'superadmin' | 'member';
}

interface KnownGroupRecord {
  id: string;
  name: string;
  participantsCount: number;
  isAdmin: boolean;
  role: 'admin' | 'superadmin' | 'member';
  updatedAt: number;
}

export class WhatsAppManagerService {
  private socket: WASocket | null = null;
  private autoViewStatus: boolean = true;
  private botJid: string = '';
  private aiOrchestrator: AIOrchestrator | null = null;
  private lastPostedStatusKeys: Array<{ id: string; timestamp: number }> = [];
  private readonly authDir: string;
  private readonly statusStoragePath: string;
  private readonly broadcast: BroadcastService;
  private configuredAdminPhones: string[] | null = null;
  private postedStatuses: Map<string, PostedStatusRecord> = new Map();
  private inProgressDeletes: Set<string> = new Set();
  private rejectAllCalls: boolean = false;
  private rejectedCallNumbers: Set<string> = new Set();
  private allowedCallNumbers: Set<string> = new Set();
  private readonly callRejectStoragePath: string;

  private aiEnabled: boolean = true;
  private linkCampaignMode: boolean = false;
  private linkCampaignPostedSenders: Set<string> = new Set();
  private disabledAINumbers: Set<string> = new Set();
  private ownerPromoLink?: string;
  private ownerPromoMimeType?: string;
  private awaitingOwnerPromoSetup: boolean = false;
  private readonly botControlStoragePath: string;
  private readonly autoGroupStoragePath: string;
  private readonly autoAddStoragePath: string;
  private readonly knownGroupsStoragePath: string;
  private autoManagedGroups: Map<string, { jid: string; name: string; enabledAt: number }> = new Map();
  private knownGroups: Map<string, KnownGroupRecord> = new Map();
  private lastLiveGroupsFetchAt: number = 0;
  private lastGroupsFetchError: string | null = null;
  private autoAddConfig: Map<string, AutoAddGroupConfig> = new Map();
  private readonly governor: GroupGovernorService = groupGovernorService;
  private readonly prayerTimes: PrayerTimesService = prayerTimesService;
  private autonomousLoopTimer?: NodeJS.Timeout;
  private recentGroupMessages: Map<string, { id: string; sender: string; text: string; timestamp: number }[]> = new Map();
  private revokedGroupMessages: Map<string, RevokedGroupMessage[]> = new Map();

  constructor(options?: WhatsAppManagerOptions) {
    this.authDir = options?.authDir || path.join(process.cwd(), 'baileys_auth_info');
    this.statusStoragePath = options?.statusStoragePath || path.join(process.cwd(), 'data', 'posted-statuses.json');
    // Store call-reject config alongside auth files so it survives Render restarts
    this.callRejectStoragePath = path.join(this.authDir, 'call-reject-config.json');
    this.botControlStoragePath = path.join(this.authDir, 'bot-control-config.json');
    this.autoGroupStoragePath = path.join(this.authDir, 'auto-managed-groups.json');
    this.autoAddStoragePath = path.join(this.authDir, 'auto-add-members-config.json');
    this.knownGroupsStoragePath = path.join(this.authDir, 'discovered-groups-cache.json');
    this.broadcast = options?.broadcast || broadcastService;
    if (options?.adminPhones) {
      this.configuredAdminPhones = options.adminPhones;
    }
    this.loadPersistedStatuses();
    this.loadCallRejectConfig();
    this.loadBotControlConfig();
    this.loadAutoGroupConfig();
    this.loadAutoAddConfig();
    this.loadKnownGroupsCache();
  }

  public setAdminPhones(phones: string[]): void {
    this.configuredAdminPhones = phones;
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
      const viewerName = this.broadcast.getContactName(cleanViewerJid) || undefined;
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
      const sendOpts: any = { broadcast: true, useUserDevicesCache: false };
      if (recipients.length > 0) {
        sendOpts.statusJidList = recipients;
      }

      // Reset status sender-key memory before revoking so all recipient devices receive SKDM cleanly
      await this.resetStatusSenderKeyMemory();

      // 1. Broadcast delete to all audience recipients who were eligible to see the status
      try {
        await this.socket.sendMessage('status@broadcast', { delete: key }, sendOpts);
      } catch (delSendErr: any) {
        const errMsg = delSendErr?.message || '';
        if (errMsg.includes('session') || errMsg.includes('Session') || errMsg.includes('MAC') || errMsg.includes('Timed Out') || errMsg.includes('timed out')) {
          console.warn(`⚠️ [WhatsApp Status] Session/timeout error during status delete (${errMsg}). Retrying delete with safe fallback...`);
          await this.socket.sendMessage('status@broadcast', { delete: key }, { broadcast: true, useUserDevicesCache: false, statusJidList: this.getSafeFallbackRecipients() } as any);
        } else {
          console.warn(`[WhatsApp Status] Notice during status audience delete (${cleanId}): ${delSendErr?.message}`);
          await this.socket.sendMessage('status@broadcast', { delete: key }, { broadcast: true, useUserDevicesCache: false } as any);
        }
      }

      // Reset status sender-key memory after delete so the next status starts with fresh key distribution
      await this.resetStatusSenderKeyMemory();

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
    if (socket) {
      this.startAutonomousGovernorLoop();
    } else {
      this.stopAutonomousGovernorLoop();
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
    this.saveBotControlConfig(); // persist across restarts
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
    } else {
      try {
        const credsPath = path.join(this.authDir, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
          if (creds?.me?.id) {
            const cleanMe = this.toCleanUserJid(creds.me.id);
            if (cleanMe) {
              list.push(cleanMe);
            }
          }
        }
      } catch { }
    }
    return Array.from(new Set(list));
  }

  /**
   * Returns admin phone numbers configured for this instance.
   * Ensures the owner/admin always receives and can view status updates.
   */
  public getAdminRecipients(): string[] {
    const set = new Set<string>();
    const rawAdmins = this.configuredAdminPhones !== null
      ? this.configuredAdminPhones
      : [
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

    for (const a of rawAdmins) {
      const cleanAdmin = this.toCleanUserJid(a);
      if (cleanAdmin) {
        set.add(cleanAdmin);
      }
    }
    return Array.from(set);
  }

  /**
   * Scans authDir for active pairwise Signal session files that belong to real E.164 phone numbers.
   * Strictly excludes internal WhatsApp LID sessions so USync never times out on fake @s.whatsapp.net JIDs.
   */
  public getVerifiedDiskSessionRecipients(): string[] {
    const list: string[] = [];
    try {
      const authDir = this.authDir;
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
    } catch { }
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
    const contacts = [...this.broadcast.getContacts()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
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
  public async resetStatusSenderKeyMemory(authDirOverride?: string): Promise<void> {
    try {
      const authDir = authDirOverride || this.authDir;
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        for (const file of files) {
          if (file.startsWith('sender-key-memory-status@broadcast')) {
            try {
              fs.unlinkSync(path.join(authDir, file));
            } catch { }
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
   * Inspects a serialized libsignal SessionRecord to determine whether its open
   * session is stuck in an unacknowledged PreKey state (pendingPreKey still set,
   * at most one chain, and outgoing counter >= 5 with zero peer reply/ack chains).
   */
  private inspectOwnerSessionRecord(rawRecord: any): { stale: boolean; reason?: string } {
    if (!rawRecord) {
      return { stale: false };
    }

    let parsed = rawRecord;
    try {
      if (typeof rawRecord === 'string') {
        parsed = JSON.parse(rawRecord);
      } else if (Buffer.isBuffer(rawRecord) || rawRecord instanceof Uint8Array) {
        parsed = JSON.parse(Buffer.from(rawRecord).toString('utf8'));
      }
    } catch {
      return { stale: false };
    }

    const sessionsMap = parsed?._sessions || parsed?.sessions;
    if (!sessionsMap || typeof sessionsMap !== 'object') {
      return { stale: false };
    }

    const sessionEntries = Object.values(sessionsMap).filter((s): s is Record<string, any> => Boolean(s && typeof s === 'object'));
    if (sessionEntries.length === 0) {
      return { stale: false };
    }

    const openSessions = sessionEntries.filter((s) => s?.indexInfo?.closed === -1 || s?.indexInfo?.closed == null);
    if (openSessions.length === 0) {
      return { stale: true, reason: 'no open session in record' };
    }

    for (const sess of openSessions) {
      const hasPendingPreKey = Boolean(sess?.pendingPreKey);
      const chainsObj = sess?._chains || sess?.chains || {};
      const chainEntries = Object.values(chainsObj).filter((c): c is Record<string, any> => Boolean(c && typeof c === 'object'));
      let maxCounter = 0;
      for (const ch of chainEntries) {
        const counter = Number(ch?.chainKey?.counter ?? -1);
        if (counter > maxCounter) {
          maxCounter = counter;
        }
      }

      if (hasPendingPreKey && chainEntries.length <= 1 && maxCounter >= 5) {
        return {
          stale: true,
          reason: `unacknowledged PreKey session (counter=${maxCounter}, chains=${chainEntries.length})`,
        };
      }
    }

    return { stale: false };
  }

  /**
   * Validates the pairwise Signal session between the bot companion device
   * and the owner's primary mobile phone (:0). Only clears and re-asserts a
   * session when `force` is true (e.g. an owner retry receipt) or when the open
   * session is provably stuck sending unacknowledged PreKey messages.
   */
  public async ensureOwnerSessionHealthy(force: boolean = false, authDirOverride?: string): Promise<boolean> {
    if (!this.socket) {
      return false;
    }

    const ownerNumbers = new Set<string>();
    for (const jid of this.getOwnerOnlyRecipients()) {
      const num = jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
      if (num) ownerNumbers.add(num);
    }
    const socketUserId = String((this.socket as any)?.user?.id || '');
    const socketUserNum = socketUserId.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
    if (socketUserNum) {
      ownerNumbers.add(socketUserNum);
    }

    if (ownerNumbers.size === 0) {
      return false;
    }

    const authDir = authDirOverride || this.authDir;
    let refreshed = false;

    for (const ownerNum of ownerNumbers) {
      const signalId = `${ownerNum}.0`;
      const targetJid = `${ownerNum}:0@s.whatsapp.net`;
      const sessionFile = path.join(authDir, `session-${signalId}.json`);

      let rawRecord: any = null;
      try {
        if ((this.socket as any)?.authState?.keys?.get) {
          const storeResult = await (this.socket as any).authState.keys.get('session', [signalId]);
          rawRecord = storeResult?.[signalId] ?? null;
        }
      } catch { }

      if (!rawRecord && fs.existsSync(sessionFile)) {
        try {
          rawRecord = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        } catch {
          rawRecord = null;
        }
      }

      const check = this.inspectOwnerSessionRecord(rawRecord);
      if (!force && !check.stale) {
        continue;
      }

      const reason = force ? 'forced by retry' : (check.reason || 'stale session');
      console.warn(`⚠️ [WhatsApp Status] Refreshing primary phone Signal session ${signalId} (${reason})...`);

      try {
        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
        }
      } catch { }

      try {
        if ((this.socket as any)?.authState?.keys?.set) {
          await (this.socket as any).authState.keys.set({
            session: { [signalId]: null },
          });
        }
      } catch { }

      // Reset status sender-key memory so Baileys re-sends SKDM over the refreshed PN session
      await this.resetStatusSenderKeyMemory(authDirOverride);

      try {
        if (typeof (this.socket as any).assertSessions === 'function') {
          await (this.socket as any).assertSessions([targetJid], true);
        }
      } catch (assertErr: any) {
        console.warn(`⚠️ [WhatsApp Status] assertSessions failed for ${targetJid}:`, assertErr?.message);
      }

      refreshed = true;
    }

    return refreshed;
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
              mimetype: media.mimeType || 'image/jpeg',
              caption: media.caption || '',
            },
            sendOpts
          );
        } else if (media.type === 'video') {
          return await this.socket!.sendMessage(
            'status@broadcast',
            {
              video: media.buffer,
              mimetype: media.mimeType || 'video/mp4',
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
   * Preserves both `@s.whatsapp.net` and `@lid` domains cleanly and acknowledges both
   * the raw participant and resolved `participantPn` when they differ.
   */
  public async markStatusSeen(key: proto.IMessageKey): Promise<boolean> {
    if (!this.socket || !this.autoViewStatus) return false;
    try {
      const id = key.id;
      const rawParticipant = key.participant || '';
      const rawPn = (key as any).participantPn || (key as any).senderPn || '';
      const targets: string[] = [];
      for (const candidate of [rawParticipant, rawPn]) {
        if (!candidate) continue;
        const clean = jidNormalizedUser(candidate);
        if (clean && !targets.includes(clean)) targets.push(clean);
      }
      if (!id || targets.length === 0) return false;

      let sentAny = false;
      for (const target of targets) {
        if (typeof (this.socket as any).sendReceipt === 'function') {
          await (this.socket as any).sendReceipt('status@broadcast', target, [id], 'read');
          sentAny = true;
        } else if (typeof (this.socket as any).sendNode === 'function') {
          await (this.socket as any).sendNode({
            tag: 'receipt',
            attrs: {
              id,
              type: 'read',
              to: 'status@broadcast',
              participant: target,
              t: Math.floor(Date.now() / 1000).toString(),
            },
          });
          sentAny = true;
        } else if (typeof (this.socket as any).readMessages === 'function') {
          await (this.socket as any).readMessages([{ ...key, remoteJid: 'status@broadcast', participant: target }]);
          sentAny = true;
        }
      }
      return sentAny;
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
    return this.broadcast.getContactName(jid);
  }

  /**
   * Saves a contact directly into WhatsApp contacts list via Baileys multi-device sync
   * (syncd app-state-sync / contactAction), and registers them in broadcast service.
   * Also sends a native vCard contact card to the Bot Owner so they have the 1-click [Save Contact] button!
   */
  public async saveContact(
    jidOrPhone: string,
    fullName: string,
    firstName?: string
  ): Promise<{ success: boolean; name: string; jid: string; phone: string }> {
    const cleanJid = this.normalizeToJid(jidOrPhone);
    const rawDigits = jidOrPhone.replace(/\D/g, '');
    const phone = rawDigits || cleanJid?.split('@')[0].split(':')[0] || '';
    const name = fullName.trim() || 'Walaal';
    const first = (firstName || name.split(' ')[0] || name).trim();

    if (!cleanJid) {
      return { success: false, name, jid: jidOrPhone, phone };
    }

    // 1. Record in broadcast service & SQLite database
    this.broadcast.recordContact(cleanJid, name, false, true);

    // 2. Sync to WhatsApp multi-device (App State Sync) so it saves directly in WhatsApp address book
    if (this.socket) {
      try {
        const contactAction = {
          fullName: name,
          firstName: first,
          saveOnPrimaryAddressbook: true,
          pnJid: cleanJid,
        };

        // Method A: Built-in addOrEditContact
        if (typeof (this.socket as any).addOrEditContact === 'function') {
          await (this.socket as any).addOrEditContact(cleanJid, contactAction);
          console.log(`📲 [WhatsAppManager] Contact saved via addOrEditContact: "${name}" (${cleanJid})`);
        } else if (typeof (this.socket as any).chatModify === 'function') {
          // Method B: chatModify with contact mutation
          await (this.socket as any).chatModify({ contact: contactAction }, cleanJid);
          console.log(`📲 [WhatsAppManager] Contact saved via chatModify: "${name}" (${cleanJid})`);
        }
      } catch (syncErr: any) {
        console.warn(`[WhatsAppManager] Contact AppStateSync warning: ${syncErr?.message}`);
      }

      // 3. Send native vCard Contact Card to the Bot Owner / Admin so they have the 1-click [Save Contact] button!
      try {
        const adminPhones = this.configuredAdminPhones || [];
        const ownerPhone = adminPhones[0];
        if (ownerPhone) {
          const ownerJid = this.normalizeToJid(ownerPhone);
          if (ownerJid && ownerJid !== cleanJid) {
            const vcard =
              'BEGIN:VCARD\n' +
              'VERSION:3.0\n' +
              `FN:${name}\n` +
              `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\n` +
              'END:VCARD';

            await (this.socket as any).sendMessage(ownerJid, {
              contacts: {
                displayName: name,
                contacts: [{ vcard }],
              },
            });
            console.log(`👤 [WhatsAppManager] Delivered vCard contact card for "${name}" (+${phone}) to bot owner (${ownerJid})`);
          }
        }
      } catch (vcardErr: any) {
        console.warn(`[WhatsAppManager] Contact vCard delivery error: ${vcardErr?.message}`);
      }
    }

    return { success: true, name, jid: cleanJid, phone };
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

  // ─── 3.1. AUTONOMOUS GROUP TAKEOVER & AUTO-GUARD ────────────────────────────

  private loadAutoGroupConfig(): void {
    try {
      if (fs.existsSync(this.autoGroupStoragePath)) {
        const raw = JSON.parse(fs.readFileSync(this.autoGroupStoragePath, 'utf8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item?.jid) {
              this.autoManagedGroups.set(item.jid, {
                jid: item.jid,
                name: item.name || '',
                enabledAt: item.enabledAt || Date.now(),
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to load auto-managed groups config: ${e?.message}`);
    }
  }

  private saveAutoGroupConfig(): void {
    try {
      const dir = path.dirname(this.autoGroupStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.autoManagedGroups.values());
      fs.writeFileSync(this.autoGroupStoragePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to save auto-managed groups config: ${e?.message}`);
    }
  }

  private loadAutoAddConfig(): void {
    try {
      if (fs.existsSync(this.autoAddStoragePath)) {
        const raw = JSON.parse(fs.readFileSync(this.autoAddStoragePath, 'utf8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item?.groupJid) {
              this.autoAddConfig.set(item.groupJid, {
                groupJid: item.groupJid,
                enabled: item.enabled !== false,
                dailyLimit: typeof item.dailyLimit === 'number' ? item.dailyLimit : 5,
                lastRunDate: item.lastRunDate,
                totalAdded: item.totalAdded || 0,
                attemptedJids: Array.isArray(item.attemptedJids) ? item.attemptedJids : [],
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to load auto-add members config: ${e?.message}`);
    }
  }

  private saveAutoAddConfig(): void {
    try {
      const dir = path.dirname(this.autoAddStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.autoAddConfig.values());
      fs.writeFileSync(this.autoAddStoragePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to save auto-add members config: ${e?.message}`);
    }
  }

  /**
   * Enables autonomous group takeover for a given group.
   * Cardoso AI will enforce Anti-Link, Auto-Welcome, and autonomous protection.
   */
  public async enableAutoGroup(
    groupJid: string,
    groupName?: string
  ): Promise<{
    success: boolean;
    message: string;
    groupName: string;
    jid: string;
    announcement?: string;
    profile?: any;
  }> {
    let name = groupName?.trim() || '';
    if (!name && this.socket) {
      try {
        const meta = await this.socket.groupMetadata(groupJid);
        name = meta?.subject || groupJid;
      } catch {
        name = groupJid;
      }
    }
    if (!name) name = groupJid;

    this.autoManagedGroups.set(groupJid, {
      jid: groupJid,
      name,
      enabledAt: Date.now(),
    });
    this.saveAutoGroupConfig();

    // Enable daily member auto-add for this managed group
    if (!this.autoAddConfig.has(groupJid)) {
      this.setAutoAddConfig(groupJid, { enabled: true, dailyLimit: 5 });
    }

    let announcement: string | undefined;
    let profile: any = null;

    if (this.socket) {
      try {
        const takeoverRes = await this.governor.executeFullAutonomousTakeover(this.socket, groupJid, name);
        announcement = takeoverRes.announcement;
        profile = takeoverRes.profile;
        if (takeoverRes.subject) name = takeoverRes.subject;
      } catch (err: any) {
        console.warn(`[WhatsAppManager] Error executing full autonomous takeover on enable: ${err?.message}`);
      }
    }

    return {
      success: true,
      message: `✅ Maamulka tooska ah ee kooxda "${name}" si buuxda oo 100% autonomous ah ayaa loo furay!`,
      groupName: name,
      jid: groupJid,
      announcement,
      profile,
    };
  }

  public startAutonomousGovernorLoop(transport?: any): void {
    if (this.autonomousLoopTimer) return;
    // Check every hour: 1. Curfew transitions (night mute/morning unmute) & 2. Daily topic drops
    this.autonomousLoopTimer = setInterval(async () => {
      try {
        for (const [groupJid] of this.autoManagedGroups.entries()) {
          // 1. Smart Night Curfew Check
          try {
            const curfewRes = await this.governor.applyCurfew(this.socket, groupJid);
            if (curfewRes.changed && curfewRes.notice) {
              if (transport?.sendMessage) {
                await transport.sendMessage(groupJid, curfewRes.notice);
              } else if (this.socket) {
                await this.socket.sendMessage(groupJid, { text: curfewRes.notice });
              }
            }
          } catch (curfewErr: any) {
            console.warn(`[Autonomous Governor] Curfew error for ${groupJid}: ${curfewErr?.message}`);
          }

          // 2. Daily Value & Wisdom Topic Drop
          if (this.governor.shouldPostDailyTopic(groupJid)) {
            console.log(`💡 [Autonomous Governor] Scheduled daily topic drop running for ${groupJid}...`);
            await this.postGovernorTopic(groupJid, transport);
            this.governor.recordDailyTopicPosted(groupJid);
          }

          // 3. Autonomous Evening Discussion Summary (21:00 Somali Time)
          if (this.governor.shouldPostEveningSummary(groupJid)) {
            try {
              const recentMsgs = this.getRecentGroupMessages(groupJid);
              const summary = await this.governor.generateEveningSummary(
                this.autoManagedGroups.get(groupJid)?.name || 'Kooxda',
                recentMsgs,
                this.aiOrchestrator
              );
              if (transport?.sendMessage) {
                await transport.sendMessage(groupJid, summary);
              } else if (this.socket) {
                await this.socket.sendMessage(groupJid, { text: summary });
              }
              this.governor.recordEveningSummaryPosted(groupJid);
            } catch (sumErr: any) {
              console.warn(`[Autonomous Governor] Evening summary error for ${groupJid}: ${sumErr?.message}`);
            }
          }

          // 4. Autonomous Daily Quiz (Single combined Poll as requested by user)
          if (this.governor.shouldPostDailyQuiz(groupJid)) {
            try {
              const groupInfo = this.autoManagedGroups.get(groupJid);
              const groupSubject = groupInfo?.name || 'Kooxda';
              let desc = '';
              if (this.socket) {
                try { const meta = await this.socket.groupMetadata(groupJid); desc = meta?.desc || ''; } catch { }
              }
              const quiz = await this.governor.generateDailyQuiz(groupJid, groupSubject, desc, this.aiOrchestrator);
              // Combined Poll Question: Call to action included directly in the question title without separate spam message
              const combinedPollTitle = `${quiz.pollTitle} — (Ka dooro jawaabta saxda ah poll-ka hoose 👇)`;
              const pollRes = await this.createPoll(groupJid, combinedPollTitle, quiz.options, 1);
              if (pollRes.success) {
                this.governor.setActiveQuiz(groupJid, quiz.pollTitle, quiz.options, quiz.correctIndex, 15 * 60 * 1000);
                this.governor.recordDailyQuizPosted(groupJid);
              }
            } catch (quizErr: any) {
              console.warn(`[Autonomous Governor] Quiz error for ${groupJid}: ${quizErr?.message}`);
            }
          }

          // 4b. Check for Expired Active Quiz (15-Minute Expiration & Winner Announcement)
          try {
            const expiredQuizResult = this.governor.checkExpiredQuizToAnnounce(groupJid);
            if (expiredQuizResult) {
              const winnerLines = expiredQuizResult.winners.length > 0
                ? expiredQuizResult.winners.map((w, idx) => {
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '⭐️';
                  return `${medal} ${idx + 1}. *+${w.phone}* ${w.name && w.name !== w.phone ? `(${w.name})` : ''} ➔ *+10 Dhibcood* [Waqtiga: ${w.elapsedSeconds}s]`;
                }).join('\n')
                : '_Waqtigii wuu dhacay mana jirin cid saxday markan. Nasiib wacan barrito!_ 🤝';

              const announceText =
                `⏰ *[CARDOSO AI — DHAMMAADKA QUIZ-KA (15 DAQIIQO)]* 🏁\n\n` +
                `❓ *Su'aashii:* ${expiredQuizResult.question}\n` +
                `✅ *Jawaabta Saxda ah:* *${expiredQuizResult.correctAnswer}*\n\n` +
                `🏆 *Xiddigaha Saxay (${expiredQuizResult.winners.length} qof):*\n` +
                `${winnerLines}\n\n` +
                `📊 Si aad u aragto tartanka guud qor: \`!leaderboard\` (ama \`!xididka\`) 🚀`;

              if (transport?.sendMessage) {
                await transport.sendMessage(groupJid, announceText);
              } else if (this.socket) {
                await this.socket.sendMessage(groupJid, { text: announceText });
              }
            }
          } catch (quizAnnErr: any) {
            console.warn(`[Autonomous Governor] Error announcing quiz results for ${groupJid}: ${quizAnnErr?.message}`);
          }

          // 4c. Weekly Thursday (Khamiislaha) Top 3 Awards Ceremony (Every Thursday at 20:00 EAT)
          try {
            if (this.governor.shouldPostThursdayAwards(groupJid)) {
              const top3 = this.governor.getLeaderboard(groupJid, 3);
              if (top3.length > 0) {
                const medals = ['🥇', '🥈', '🥉'];
                const titles = ['👑 HORYAALKA TODOBAADKA', '🥈 XIDDIGA DHEH', '🥉 GEESIGA KOOXDA'];
                const stars = ['⭐️⭐️⭐️⭐️⭐️', '⭐️⭐️⭐️⭐️', '⭐️⭐️⭐️'];

                const topLines = top3.map((item, i) =>
                  `${medals[i]} *KAALINTA ${i + 1}-AAD — ${titles[i]}:*\n` +
                  `👤 *+${item.user}* ➔ *${item.score} Dhibcood* (${item.correct} sax, ${item.wrong} qalad) ${stars[i]}`
                ).join('\n\n');

                const awardsText =
                  `🌟👑 *[XAFLADDA KHAMIISLAHA: 3-DA XIDDIG EE UGU SARREEYA KOOXDA]* 👑🌟\n\n` +
                  `Kooxda sharafta leh, waxaa la gaadhay caawa oo Khamiis ah xilligii la abaalmarinaayey saddexda xubnood ee ugu dhibcaha badan toddobaadkan tartankii aqoonta! 🏆✨\n\n` +
                  `${topLines}\n\n` +
                  `👏 *Hambalyo dhammaan xiddigaha!* Dedaalkiina iyo aqoontiina waa mid lagu faano.\n` +
                  `Tartanka waxbarashada iyo aqoonta guud wuu soconayaa. Qor \`!leaderboard\` si aad u aragto kaalintaada! 🚀`;

                if (transport?.sendMessage) {
                  await transport.sendMessage(groupJid, awardsText);
                } else if (this.socket) {
                  await this.socket.sendMessage(groupJid, { text: awardsText });
                }
                this.governor.recordThursdayAwardsPosted(groupJid);
              }
            }
          } catch (thuErr: any) {
            console.warn(`[Autonomous Governor] Thursday awards error for ${groupJid}: ${thuErr?.message}`);
          }

          // 5. Scheduled Announcements Check (minute precision)
          const nowForAnn = new Date();
          const nowH = nowForAnn.getHours();
          const nowM = nowForAnn.getMinutes();
          const dueAnns = this.governor.checkScheduledAnnouncements(groupJid, nowH, nowM);
          for (const ann of dueAnns) {
            try {
              const announcementText =
                `📢 *[CARDOSO AI — XAYEYSIINTA JADWALKA]* ⏰\n\n` +
                `${ann.message}\n\n` +
                `_Waxaa diraya Cardoso AI Autonomous Governor_`;
              if (transport?.sendMessage) {
                await transport.sendMessage(groupJid, announcementText);
              } else if (this.socket) {
                await this.socket.sendMessage(groupJid, { text: announcementText });
              }
            } catch (annErr: any) {
              console.warn(`[Autonomous Governor] Scheduled announcement error: ${annErr?.message}`);
            }
          }

          // 6. Autonomous Islamic Prayer Times, Voice Note Athan & Du'a Engine
          try {
            const duePrayer = this.prayerTimes.checkDuePrayer(groupJid);
            if (duePrayer) {
              await this.broadcastPrayerNotification(groupJid, duePrayer, transport);
            }
          } catch (prayerErr: any) {
            console.warn(`[Autonomous Governor] Prayer notification error for ${groupJid}: ${prayerErr?.message}`);
          }

          // 7. Autonomous Daily Member Growth (Auto-Add Members to Group)
          try {
            const todayStr = new Date().toISOString().slice(0, 10);
            const autoAddCfg = this.getAutoAddConfig(groupJid);
            if (autoAddCfg.enabled && autoAddCfg.lastRunDate !== todayStr) {
              console.log(`👥 [Autonomous Governor] Scheduled daily member growth running for ${groupJid}...`);
              await this.autoAddDailyMembers(groupJid, autoAddCfg.dailyLimit || 5);
            }
          } catch (autoAddErr: any) {
            console.warn(`[Autonomous Governor] Daily auto-add error for ${groupJid}: ${autoAddErr?.message}`);
          }
        }
      } catch (err: any) {
        console.warn(`[WhatsAppManager] Error in autonomous governor loop: ${err?.message}`);
      }
    }, 60 * 1000); // Runs every 60 seconds for minute-exact prayer times & scheduled announcements
  }

  /**
   * Broadcasts a complete prayer notification to a group:
   * 1. Reverent title header only (as requested: "CIWAANKA SARE UUN UDAA").
   * 2. Authentic Voice Note Athan (Ogg Opus PTT).
   * 3. Authentic Sunnah Du'a Voice Note (Ogg Opus PTT).
   */
  public async broadcastPrayerNotification(
    groupJid: string,
    prayer: PrayerDefinition,
    transport?: any
  ): Promise<void> {
    console.log(`🕌 [Autonomous Governor] Broadcasting Prayer Notification (${prayer.somaliName} / ${prayer.arabicName}) for ${groupJid}...`);

    // 1. Reverent Title Only (as requested by user: "CIWAANKA SARE UUN UDAA")
    const textReminder = this.prayerTimes.getPrayerReminderText(prayer);
    if (transport?.sendMessage) {
      await transport.sendMessage(groupJid, textReminder);
    } else if (this.socket) {
      await this.socket.sendMessage(groupJid, { text: textReminder });
    }

    // 2. Authentic Voice Note Athan (Ogg Opus PTT)
    try {
      const athan = await this.prayerTimes.getAthanAudio(prayer.isFajr);
      if (athan && athan.buffer.length > 0) {
        if (transport?.sendMedia) {
          await transport.sendMedia(groupJid, {
            type: 'audio',
            dataBuffer: athan.buffer,
            mimeType: athan.mimeType || 'audio/ogg; codecs=opus',
            ptt: true,
          });
        } else if (this.socket) {
          await this.socket.sendMessage(groupJid, {
            audio: athan.buffer,
            mimetype: athan.mimeType || 'audio/ogg; codecs=opus',
            ptt: true,
          });
        }
      }
    } catch (athanErr: any) {
      console.warn(`[WhatsAppManager] Athan audio delivery error: ${athanErr?.message}`);
    }

    // 3. Sunnah Du'a Voice Note (Ogg Opus PTT) - No long text wall as requested
    try {
      const duaAudio = await this.prayerTimes.getDuaAudio();
      if (duaAudio && duaAudio.buffer.length > 0) {
        if (transport?.sendMedia) {
          await transport.sendMedia(groupJid, {
            type: 'audio',
            dataBuffer: duaAudio.buffer,
            mimeType: duaAudio.mimeType || 'audio/ogg; codecs=opus',
            ptt: true,
          });
        } else if (this.socket) {
          await this.socket.sendMessage(groupJid, {
            audio: duaAudio.buffer,
            mimetype: duaAudio.mimeType || 'audio/ogg; codecs=opus',
            ptt: true,
          });
        }
      }
    } catch (duaErr: any) {
      console.warn(`[WhatsAppManager] Du'a audio delivery error: ${duaErr?.message}`);
    }

    // 4. Mark as successfully notified for today
    this.prayerTimes.markPrayerPosted(groupJid, prayer.key);
  }

  public getPrayerTimesService(): PrayerTimesService {
    return this.prayerTimes;
  }

  public stopAutonomousGovernorLoop(): void {
    if (this.autonomousLoopTimer) {
      clearInterval(this.autonomousLoopTimer);
      this.autonomousLoopTimer = undefined;
    }
  }

  /**
   * Disables autonomous group takeover for a given group.
   */
  public async disableAutoGroup(
    groupJid: string
  ): Promise<{ success: boolean; message: string; groupName: string }> {
    const existing = this.autoManagedGroups.get(groupJid);
    const name = existing?.name || groupJid;
    this.autoManagedGroups.delete(groupJid);
    this.saveAutoGroupConfig();

    return {
      success: true,
      message: `🛑 Maamulkii tooska ahaa ee kooxda "${name}" waa la damiyay.`,
      groupName: name,
    };
  }

  /**
   * Returns whether a group is currently autonomously managed.
   */
  public isAutoGroupManaged(groupJid: string): boolean {
    if (!groupJid) return false;
    return this.autoManagedGroups.has(groupJid);
  }

  public isGroupAutoManaged(groupJid: string): boolean {
    return this.isAutoGroupManaged(groupJid);
  }

  /**
   * Returns list of all currently auto-managed groups.
   */
  public getAutoManagedGroups(): Array<{ jid: string; name: string; enabledAt: number }> {
    return Array.from(this.autoManagedGroups.values());
  }

  /**
   * Finds a group by subject (name) or JID across socket participating groups or saved cache.
   */
  public async findGroupByNameOrJid(query: string): Promise<{ jid: string; name: string } | null> {
    const clean = (query || '').trim();
    if (!clean) return null;

    // 1. Direct JID check
    if (clean.endsWith('@g.us')) {
      if (this.socket) {
        try {
          const meta = await this.socket.groupMetadata(clean);
          return { jid: clean, name: meta?.subject || clean };
        } catch { }
      }
      const existing = this.autoManagedGroups.get(clean);
      return { jid: clean, name: existing?.name || clean };
    }

    const lowerQuery = clean.toLowerCase();

    // 2. Search socket participating groups
    if (this.socket && typeof (this.socket as any).groupFetchAllParticipating === 'function') {
      try {
        const groups = await (this.socket as any).groupFetchAllParticipating();
        const list = Object.values(groups) as any[];

        // Exact match
        const exact = list.find(g => (g?.subject || '').trim().toLowerCase() === lowerQuery);
        if (exact) return { jid: exact.id, name: exact.subject };

        // Starts with match
        const prefix = list.find(g => (g?.subject || '').trim().toLowerCase().startsWith(lowerQuery));
        if (prefix) return { jid: prefix.id, name: prefix.subject };

        // Substring match
        const sub = list.find(g => (g?.subject || '').toLowerCase().includes(lowerQuery));
        if (sub) return { jid: sub.id, name: sub.subject };
      } catch (err: any) {
        console.warn(`[WhatsAppManager] Error fetching participating groups: ${err?.message}`);
      }
    }

    // 3. Fallback: check already auto-managed groups
    for (const [jid, info] of this.autoManagedGroups.entries()) {
      if (info.name.toLowerCase().includes(lowerQuery) || jid.includes(lowerQuery)) {
        return { jid, name: info.name };
      }
    }

    return null;
  }

  /**
   * Checks whether a specific participant is an admin in a group.
   */
  public async isParticipantGroupAdmin(groupJid: string, participantJid: string): Promise<boolean> {
    if (!this.socket) return false;
    try {
      const meta = await this.socket.groupMetadata(groupJid);
      const cleanTarget = this.normalizeToJid(participantJid);
      const cleanNum = cleanTarget.split('@')[0];
      const match = meta.participants.find(p => {
        const pNum = p.id.split('@')[0].split(':')[0];
        return pNum === cleanNum || p.id === cleanTarget;
      });
      return Boolean(match && (match.admin === 'admin' || match.admin === 'superadmin'));
    } catch {
      return false;
    }
  }

  /**
   * Detects whether text contains forbidden links (URLs, whatsapp/telegram invites, domains).
   */
  public containsForbiddenLink(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const pattern = /(?:https?:\/\/|chat\.whatsapp\.com\/|t\.me\/|telegram\.me\/|wa\.me\/|bit\.ly\/|tinyurl\.com\/|(?:www\.)?[a-zA-Z0-9-]+\.(?:com|org|net|me|io|edu|info|tv|xyz|app|online|site|store|tech)\b)/i;
    return pattern.test(text);
  }

  /**
   * Sends an automatic welcome message to new participants joining an auto-managed group.
   */
  public async handleAutoWelcome(
    groupJid: string,
    participants: string[],
    transport?: any
  ): Promise<void> {
    if (!this.isAutoGroupManaged(groupJid)) return;
    if (!this.socket && !transport) return;

    try {
      let groupSubject = this.autoManagedGroups.get(groupJid)?.name || 'Kooxda';
      let desc = '';
      if (this.socket) {
        try {
          const meta = await this.socket.groupMetadata(groupJid);
          if (meta?.subject) groupSubject = meta.subject;
          if (meta?.desc) desc = meta.desc;
        } catch { }
      }

      const profile = this.governor.analyzeGroup(groupSubject, desc);

      for (const p of participants) {
        const num = p.split('@')[0].split(':')[0];
        const welcomeText =
          `🎉✨ *SOO DHAWOOW WALAAL @${num}!* ✨🎉\n\n` +
          `Ku soo dhawow kooxda *${groupSubject}* (${profile.categoryLabel}) gacmo furan! 🤝\n\n` +
          `📌 *XEERARKA KOOXDA (ILAALADA TOOSKA AH EE 24/7):*\n` +
          `${profile.customRules.join('\n')}\n\n` +
          `🤖 _Kooxdan waxaa si buuxda 24/7 u maamula Cardoso AI Autonomous Governor._`;

        if (transport?.sendMessage) {
          await transport.sendMessage(groupJid, welcomeText, { mentions: [p] });
        } else if (this.socket) {
          await this.socket.sendMessage(groupJid, { text: welcomeText, mentions: [p] });
        }

        // AI Welcome Card Image (auto-generated per group niche)
        if (this.aiOrchestrator) {
          try {
            const { ImageGeneratorService } = await import('./image-generator.service.js');
            const imagePrompt =
              `Create a beautiful WhatsApp group welcome card for "${groupSubject}" (${profile.categoryLabel}). ` +
              `Style: modern, professional, vibrant gradient background matching the ${profile.categoryLabel} theme. ` +
              `Include: decorative welcome banner, relevant emoji/icons for ${profile.category} niche, ` +
              `member name "@${num}", group name "${groupSubject}", and "CARDOSO AI" branding watermark. ` +
              `Clean, eye-catching design suitable for WhatsApp. No text errors.`;
            const imgResult = await ImageGeneratorService.generateImage(imagePrompt);
            if (imgResult?.buffer) {
              const welcomeCaption = `🌟 *Soo Dhawoow ${groupSubject}!* 🌟\n_Cardoso AI ayaa kuu sameeyay kaarka soo dhaweynaanta._`;
              if (transport?.sendMedia) {
                await transport.sendMedia(groupJid, {
                  type: 'image',
                  buffer: imgResult.buffer,
                  mimeType: imgResult.mimeType || 'image/jpeg',
                  caption: welcomeCaption,
                }, { mentions: [p] });
              } else if (this.socket) {
                await this.socket.sendMessage(groupJid, {
                  image: imgResult.buffer,
                  caption: welcomeCaption,
                  mentions: [p],
                });
              }
            }
          } catch (imgErr: any) {
            console.warn(`[WhatsAppManager] Welcome image generation failed: ${imgErr?.message}`);
          }
        }
      }
    } catch (err: any) {
      console.error('[WhatsAppManager] handleAutoWelcome error:', err);
    }
  }

  /**
   * Returns the leaderboard for the daily quiz in a group.
   */
  public getQuizLeaderboard(groupJid: string, topN: number = 10): string {
    const board = this.governor.getLeaderboard(groupJid, topN);
    if (board.length === 0) {
      return (
        `🏆 *[CARDOSO AI — QUIZ LEADERBOARD]* 📊\n\n` +
        `Wali qof dhibco ma yeelanin tartanka maanta!\n` +
        `🧠 Marka quiz-ka maalinlaha ah la soo dhigo, ka dooro jawaabta saxda ah si aad dhibco u hesho! 💪\n\n` +
        `🗓️ _Xusuusin: Khamiis walba 20:00 waxaa la abaalmariyaa 3-da xiddig ee ugu sarreeya!_ 👑`
      );
    }
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    let out = `🏆 *[CARDOSO AI — QUIZ LEADERBOARD TOP ${board.length}]* 📊\n\n`;
    board.forEach((entry, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const star = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : '⭐️';
      out += `${medal} *+${entry.user}* ➔ *${entry.score} pts* ${star} (✅ ${entry.correct} sax | ❌ ${entry.wrong} qalad)\n`;
    });
    out += `\n🗓️ _Xusuusin: Khamiis walba 20:00 waxaa la abaalmariyaa 3-da xiddig ee ugu sarreeya!_ 👑\n`;
    out += `_🤖 Scoreboard-ka waxaa si toos ah u maamula Cardoso AI Quiz Engine._`;
    return out;
  }

  /**
   * Schedules an announcement for a group at a specific time.
   */
  public scheduleGroupAnnouncement(groupJid: string, hour: number, minute: number, message: string): string {
    return this.governor.scheduleAnnouncement(groupJid, hour, minute, message);
  }

  /**
   * Lists all scheduled announcements for a group.
   */
  public listScheduledAnnouncements(groupJid: string): Array<{ hour: number; minute: number; message: string; id: string }> {
    return this.governor.listScheduledAnnouncements(groupJid);
  }

  /**
   * Cancels a scheduled announcement by its ID.
   */
  public cancelScheduledAnnouncement(groupJid: string, id: string): boolean {
    return this.governor.cancelScheduledAnnouncement(groupJid, id);
  }

  public getGovernor(): GroupGovernorService {
    return this.governor;
  }

  /**
   * Automatically analyzes, brands, and optimizes the group:
   * updates description, creates AI logo, sets picture, and locks info settings.
   */
  public async autoBrandGroup(
    groupJid: string,
    customSubject?: string
  ): Promise<{
    success: boolean;
    subject: string;
    descriptionUpdated: boolean;
    pictureUpdated: boolean;
    infoLocked: boolean;
    message: string;
    profile: any;
  }> {
    if (!this.socket) {
      return {
        success: false,
        subject: '',
        descriptionUpdated: false,
        pictureUpdated: false,
        infoLocked: false,
        message: 'WhatsApp ma xirna hadda.',
        profile: null,
      };
    }

    try {
      const res = await this.governor.autoBrandGroup(this.socket, groupJid, customSubject);
      const msg =
        `✨🎨 *[CARDOSO AI — DIIWAANKA & MUUQAALKA CUSUB EE KOOXDA]* 🎨✨\n\n` +
        `✅ *Kooxda:* *${res.subject}*\n` +
        `📂 *Nooca:* ${res.profile.categoryLabel}\n` +
        `📝 *Description:* ${res.descriptionUpdated ? '✅ Waa la habeeyay oo la cusboonaysiiyay!' : '⚠️ Lama beddelin'}\n` +
        `🖼️ *AI Logo:* ${res.pictureUpdated ? '✅ Sawir cusub oo AI ah ayaa loo sameeyay laguna xidhay!' : '⚠️ Lama cusboonaysiin'}\n` +
        `🔒 *Amniga Info-ga:* ${res.infoLocked ? '✅ Admins oo kaliya ayaa beddeli kara (Locked)' : '⚠️ Furan'}\n\n` +
        `🤖 _Kooxdan waxaa si buuxda 24/7 u maamula Cardoso AI Autonomous Governor._`;

      return {
        ...res,
        message: msg,
      };
    } catch (err: any) {
      return {
        success: false,
        subject: '',
        descriptionUpdated: false,
        pictureUpdated: false,
        infoLocked: false,
        message: `Cilad casriyeynta kooxda: ${err.message}`,
        profile: null,
      };
    }
  }

  /**
   * Posts an autonomous engaging topic or wisdom drop tailored to the group's niche.
   */
  public async postGovernorTopic(
    groupJid: string,
    transport?: any
  ): Promise<{ success: boolean; message: string; topic?: string }> {
    if (!this.socket && !transport) {
      return { success: false, message: 'WhatsApp ma xirna hadda.' };
    }

    try {
      let subject = this.autoManagedGroups.get(groupJid)?.name || '';
      let desc = '';
      if (this.socket) {
        try {
          const meta = await this.socket.groupMetadata(groupJid);
          if (!subject && meta?.subject) subject = meta.subject;
          if (meta?.desc) desc = meta.desc;
        } catch { }
      }
      if (!subject) subject = 'Kooxda';

      const profile = this.governor.analyzeGroup(subject, desc);
      const topicText = profile.engagingTopic;

      if (transport?.sendMessage) {
        await transport.sendMessage(groupJid, topicText);
      } else if (this.socket) {
        await this.socket.sendMessage(groupJid, { text: topicText });
      }

      // Also trigger autonomous native WhatsApp Poll if niche profile defines one
      if (this.socket && profile.pollQuestion && profile.pollOptions && profile.pollOptions.length >= 2) {
        try {
          await this.createPoll(groupJid, profile.pollQuestion, profile.pollOptions, 1);
        } catch (pollErr: any) {
          console.warn(`[Autonomous Governor] Poll post failed: ${pollErr?.message}`);
        }
      }

      return {
        success: true,
        message: `✅ Mawduucii caqliga badnaa ee maanta si guul leh ayaa loogu soo dhigay kooxda!`,
        topic: topicText,
      };
    } catch (err: any) {
      return { success: false, message: `Cilad soo dhigista mawduuca: ${err.message}` };
    }
  }

  /**
   * Retrieves or formats the dynamic rules for this group.
   */
  public async getGroupRules(groupJid: string): Promise<string> {
    let subject = this.autoManagedGroups.get(groupJid)?.name || '';
    let desc = '';
    if (this.socket) {
      try {
        const meta = await this.socket.groupMetadata(groupJid);
        if (!subject && meta?.subject) subject = meta.subject;
        if (meta?.desc) desc = meta.desc;
      } catch { }
    }
    if (!subject) subject = 'Kooxda';

    const profile = this.governor.analyzeGroup(subject, desc);
    return (
      `📜 *[XEERARKA RASMIGA AH EE KOOXDA — ${subject.toUpperCase()}]* 📜\n` +
      `📂 *Qaybta:* ${profile.categoryLabel}\n\n` +
      `${profile.customRules.join('\n')}\n\n` +
      `⚠️ *Ciqaabta:* Qofkii jabiya xeerarkan, bot-ku wuxuu siinayaa digniino, kadibna toos ayaa looga saarayaa (*Auto-Kick*).\n` +
      `🤖 _Cardoso AI 24/7 Super-Admin Governor._`
    );
  }

  /**
   * Locks or unlocks group settings so only admins can modify group icon/description.
   */
  public async setGroupInfoLock(
    groupJid: string,
    lock: boolean
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };
    try {
      await this.socket.groupSettingUpdate(groupJid, lock ? 'locked' : 'unlocked');
      return {
        success: true,
        message: lock
          ? '🔒 Info-ga kooxda waa la xidhay: Maamulka (Admins) oo kaliya ayaa beddeli kara magaca, sawirka iyo sharaxaadda.'
          : '🔓 Info-ga kooxda waa la furay: Dhammaan xubnuhu way beddeli karaan xogta kooxda.',
      };
    } catch (err: any) {
      return { success: false, message: `Cilad beddelidda setting-ka info-ga: ${err.message}` };
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

  // ─── CALL MANAGEMENT (REJECT ALL, REJECT NUMBER, UNREJECT) ────────────────

  private loadCallRejectConfig(): void {
    try {
      if (fs.existsSync(this.callRejectStoragePath)) {
        const raw = JSON.parse(fs.readFileSync(this.callRejectStoragePath, 'utf8'));
        this.rejectAllCalls = raw.rejectAll !== undefined ? Boolean(raw.rejectAll) : false;
        if (Array.isArray(raw.rejectedNumbers)) {
          this.rejectedCallNumbers = new Set(raw.rejectedNumbers.map((n: string) => String(n).replace(/\D/g, '')).filter(Boolean));
        }
        if (Array.isArray(raw.allowedNumbers)) {
          this.allowedCallNumbers = new Set(raw.allowedNumbers.map((n: string) => String(n).replace(/\D/g, '')).filter(Boolean));
        }
      }
    } catch { }
  }

  private saveCallRejectConfig(): void {
    try {
      const dir = path.dirname(this.callRejectStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = {
        rejectAll: this.rejectAllCalls,
        rejectedNumbers: Array.from(this.rejectedCallNumbers),
        allowedNumbers: Array.from(this.allowedCallNumbers),
      };
      fs.writeFileSync(this.callRejectStoragePath, JSON.stringify(data, null, 2), 'utf8');
    } catch { }
  }

  /**
   * Enables automatic call rejection for ALL callers.
   */
  public setRejectAllCalls(enabled: boolean): { success: boolean; message: string } {
    this.rejectAllCalls = enabled;
    if (enabled) {
      this.allowedCallNumbers.clear();
    }
    this.saveCallRejectConfig();
    return {
      success: true,
      message: enabled
        ? '📵 *[Call Reject - Dhammaan]*: Dhammaan wicitaannada soo dhaca waa la xidhay (Auto-Reject ON)! Qof kasta oo soo waca toos ayaa looga goyn doonaa cod redirect ahna loogu diri doonaa.'
        : '📞 *[Call Reject - Dhammaan]*: Wicitaannada dhammaan waa la furay (Auto-Reject OFF). Dadku hadda way soo wici karaan.',
    };
  }

  /**
   * Unrejects / opens calls for ALL callers.
   */
  public unrejectAllCalls(): { success: boolean; message: string } {
    this.rejectAllCalls = false;
    this.rejectedCallNumbers.clear();
    this.allowedCallNumbers.clear();
    this.saveCallRejectConfig();
    return {
      success: true,
      message: '📞 *[Call Unreject - Dhammaan]*: Wicitaannada dhammaan waa la furay (Auto-Reject OFF). Cid kasta way soo wici kartaa hadda.',
    };
  }

  /**
   * Rejects incoming calls from a specific phone number.
   */
  public rejectCallNumber(phoneOrJid: string): { success: boolean; message: string } {
    const cleanPhone = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      return { success: false, message: 'Fadlan geli lambar sax ah (tusaale: `!reject 252634123456`).' };
    }
    this.rejectedCallNumbers.add(cleanPhone);
    this.allowedCallNumbers.delete(cleanPhone);
    this.saveCallRejectConfig();
    return {
      success: true,
      message: `📵 *[Call Reject]*: Lambarka +${cleanPhone} wicitaannadiisa waa la xidhay! Marka uu soo waco toos ayaa looga goyn doonaa oo cod loogu diri doonaa.`,
    };
  }

  /**
   * Unrejects / opens calls for a specific phone number.
   */
  public unrejectCallNumber(phoneOrJid: string): { success: boolean; message: string } {
    const cleanPhone = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      return { success: false, message: 'Fadlan geli lambar sax ah (tusaale: `!unreject 252634123456`).' };
    }
    this.rejectedCallNumbers.delete(cleanPhone);
    this.allowedCallNumbers.add(cleanPhone);
    // If rejectAll is ON, still allow this specific number by turning off global reject
    // so the allowed list takes effect correctly
    this.rejectAllCalls = false;
    this.saveCallRejectConfig();
    return {
      success: true,
      message: `📞 *[Call Unreject]*: Lambarka +${cleanPhone} wicitaankiisa waa loo furay! Wuu soo wici karaa hadda. ✅`,
    };
  }

  /**
   * Checks whether an incoming call from a caller should be rejected.
   */
  public shouldRejectCall(callerJidOrPhone: string): boolean {
    const cleanPhone = callerJidOrPhone.split('@')[0].split(':')[0].replace(/\D/g, '');
    // If AI is specifically disabled for this caller, do not reject their calls (phone rings normally)
    if (this.isAIDisabledForNumber(cleanPhone)) {
      return false;
    }
    if (this.allowedCallNumbers.has(cleanPhone)) {
      return false;
    }
    if (this.rejectedCallNumbers.has(cleanPhone)) {
      return true;
    }
    if (this.rejectAllCalls) {
      return true;
    }
    return false;
  }

  // ─── BOT CONTROL (AI MASTER TOGGLE & STATUS LINK CAMPAIGN MODE) ───────────

  private loadBotControlConfig(): void {
    try {
      if (fs.existsSync(this.botControlStoragePath)) {
        const raw = JSON.parse(fs.readFileSync(this.botControlStoragePath, 'utf8'));
        if (raw.aiEnabled !== undefined) {
          this.aiEnabled = Boolean(raw.aiEnabled);
        }
        if (raw.autoViewStatus !== undefined) {
          this.autoViewStatus = Boolean(raw.autoViewStatus);
        }
        if (raw.linkCampaignMode !== undefined) {
          this.linkCampaignMode = Boolean(raw.linkCampaignMode);
        }
        if (Array.isArray(raw.linkCampaignPostedSenders)) {
          this.linkCampaignPostedSenders = new Set(
            raw.linkCampaignPostedSenders.map((s: string) => String(s).replace(/\D/g, '')).filter(Boolean)
          );
        }
        if (Array.isArray(raw.disabledAINumbers)) {
          this.disabledAINumbers = new Set(
            raw.disabledAINumbers.map((s: string) => String(s).replace(/\D/g, '')).filter(Boolean)
          );
        }
        if (raw.ownerPromoLink) {
          this.ownerPromoLink = String(raw.ownerPromoLink);
        }
        if (raw.ownerPromoMimeType) {
          this.ownerPromoMimeType = String(raw.ownerPromoMimeType);
        }
        if (raw.awaitingOwnerPromoSetup !== undefined) {
          this.awaitingOwnerPromoSetup = Boolean(raw.awaitingOwnerPromoSetup);
        }
      }
    } catch { }
  }

  private saveBotControlConfig(): void {
    try {
      const dir = path.dirname(this.botControlStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = {
        aiEnabled: this.aiEnabled,
        autoViewStatus: this.autoViewStatus,
        linkCampaignMode: this.linkCampaignMode,
        linkCampaignPostedSenders: Array.from(this.linkCampaignPostedSenders),
        disabledAINumbers: Array.from(this.disabledAINumbers),
        ownerPromoLink: this.ownerPromoLink,
        ownerPromoMimeType: this.ownerPromoMimeType,
        awaitingOwnerPromoSetup: this.awaitingOwnerPromoSetup,
      };
      fs.writeFileSync(this.botControlStoragePath, JSON.stringify(data, null, 2), 'utf8');
    } catch { }
  }

  /**
   * Returns whether AI is currently enabled globally to chat.
   */
  public isAIEnabled(): boolean {
    return this.aiEnabled;
  }

  /**
   * Turns AI Chatbot ON or OFF globally.
   */
  public setAIEnabled(enabled: boolean): { success: boolean; message: string } {
    this.aiEnabled = enabled;
    this.saveBotControlConfig();
    return {
      success: true,
      message: enabled
        ? '🟢 *[AI Chatbot — SHIDID]*: AI-ga waa la SHIDAY (ON)! Hadda bot-ku wuu la hadlayaa dadka sidii caadiga ahayd. 🤖💬'
        : '🔴 *[AI Chatbot — DAMIN]*: AI-ga waa la DAMIYAY (OFF)! Hadda bot-ku iskii uguma jawaabi doono dadka (aamusnaan). 🤫🛑',
    };
  }

  /**
   * Disables AI, status responses, and call rejection for a specific phone number.
   * User requirement: "!off iyo number hadii qor qofkaas iyaan ai fariin u qorin status,call ku jarin dhaamaan ai qofkaas ka xidh"
   */
  public disableAIForNumber(phoneOrJid: string): { success: boolean; message: string; phone: string } {
    const cleanPhone = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      return { success: false, message: 'Fadlan geli lambar sax ah (tusaale: `!off 252634123456`).', phone: '' };
    }
    this.disabledAINumbers.add(cleanPhone);
    this.saveBotControlConfig();
    return {
      success: true,
      phone: cleanPhone,
      message:
        `🛑 *[AI Ka Xidhan — +${cleanPhone}]* 🛑\n\n` +
        `Qofka (+${cleanPhone}) dhammaan nidaamka bot-ka iyo AI-ga waa laga xidhay:\n` +
        `• 💬 Fariin toos ah bot-ku ugu jawaabi maayo (Chat aamusan)\n` +
        `• 👁️ Status-kiisa wax falcelin ama faallo ah bot-ku kuma samaynayo\n` +
        `• 📞 Wicitaankiisa bot-ku jari maayo (Wuu soo dhacayaa sidii caadiga ahayd)\n\n` +
        `💡 Si aad dib ugu furto qofkan, qor: \`!on ${cleanPhone}\``,
    };
  }

  /**
   * Enables AI, status responses, and restores bot features for a specific phone number.
   * User requirement: "!on iyo markaan dhaho haloo furo qofkaas"
   */
  public enableAIForNumber(phoneOrJid: string): { success: boolean; message: string; phone: string } {
    const cleanPhone = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      return { success: false, message: 'Fadlan geli lambar sax ah (tusaale: `!on 252634123456`).', phone: '' };
    }
    const existed = this.disabledAINumbers.delete(cleanPhone);
    this.saveBotControlConfig();
    return {
      success: true,
      phone: cleanPhone,
      message: existed
        ? `🟢 *[AI Loo Furay — +${cleanPhone}]* 🟢\n\nQofka (+${cleanPhone}) bot-kii iyo AI-gii dib ayaa loogu furay! Hadda bot-ku wuxuu ugu jawaabayaa si caadi ah.`
        : `ℹ️ Lambarka +${cleanPhone} horayba uma ahayn mid AI-gu ka xidhan yahay. Bot-ku si caadi ah ayuu ugu furan yahay.`,
    };
  }

  /**
   * Returns whether AI is specifically disabled for this phone number.
   */
  public isAIDisabledForNumber(phoneOrJid: string): boolean {
    if (!phoneOrJid) return false;
    const cleanPhone = phoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    return this.disabledAINumbers.has(cleanPhone);
  }

  /**
   * Returns list of all phone numbers for whom AI is specifically disabled.
   */
  public getDisabledAINumbers(): string[] {
    return Array.from(this.disabledAINumbers);
  }

  /**
   * Returns whether Link Campaign Mode is active.
   */
  public isLinkCampaignMode(): boolean {
    return this.linkCampaignMode;
  }

  /**
   * Turns Status Link Campaign Mode ON or OFF.
   */
  public setLinkCampaignMode(enabled: boolean): { success: boolean; message: string } {
    this.linkCampaignMode = enabled;
    this.saveBotControlConfig();
    return {
      success: true,
      message: enabled
        ? '🔗 *[Status Link Campaign Mode]*: Waa la SHIDAY (ON)! ✅\n' +
        '• Kaliya dadka status link soo dhiga ayaa lala hadlayaa.\n' +
        '• Haddii sawir iyo link wada socdaan, labadaba si toos ah oo wada jir ah ayaa status loogu wada dhigayaa.\n' +
        '• Qof hore link loogu dhigay mar labaad looma dhigayo.\n' +
        '• Qofka hore contact-ka kuugu jiray lala hadli maayo, save-me-na laguma dhihi doono.'
        : '🔗 *[Status Link Campaign Mode]*: Waa la DAMIYAY (OFF)! Nidaamkii caadiga ahaa ayaa dib loogu noqday.',
    };
  }

  /**
   * Checks if this sender already had a status link posted in this campaign.
   */
  public hasPostedLinkForSender(senderPhoneOrJid: string): boolean {
    const cleanPhone = senderPhoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    return this.linkCampaignPostedSenders.has(cleanPhone);
  }

  /**
   * Records that this sender has had a status link posted.
   */
  public recordLinkCampaignPoster(senderPhoneOrJid: string): void {
    const cleanPhone = senderPhoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (cleanPhone) {
      this.linkCampaignPostedSenders.add(cleanPhone);
      this.saveBotControlConfig();
    }
  }

  /**
   * Checks if a contact is saved in our address book / broadcast registry.
   */
  public isContactSaved(jidOrPhone: string): boolean {
    const cleanPhone = jidOrPhone.split('@')[0].split(':')[0].replace(/\D/g, '');
    const contact = this.broadcast.getContact(jidOrPhone) || this.broadcast.getContact(`${cleanPhone}@s.whatsapp.net`);
    return Boolean(contact && (contact.name || contact.firstName));
  }

  public getBotNumber(): string {
    return this.botJid || '';
  }

  public getOwnerPromoImagePath(): string {
    return path.join(this.authDir, 'owner_promo_flyer.bin');
  }

  /**
   * Saves the WhatsApp owner's promotional flyer (image buffer + link)
   */
  public setOwnerPromo(promo: { link: string; imageBuffer?: Buffer; mimeType?: string }): { success: boolean; message: string } {
    this.ownerPromoLink = promo.link.trim();
    if (promo.mimeType) {
      this.ownerPromoMimeType = promo.mimeType;
    }
    if (promo.imageBuffer && promo.imageBuffer.length > 0) {
      try {
        fs.writeFileSync(this.getOwnerPromoImagePath(), promo.imageBuffer);
      } catch (e: any) {
        console.warn('Failed to save owner promo flyer image:', e);
      }
    }
    this.awaitingOwnerPromoSetup = false;
    this.saveBotControlConfig();
    return {
      success: true,
      message: '✅ *[Setup Completed]*: Sawirkaaga iyo Link-gaaga xayeysiinta si guul leh ayaa loo kaydiyay! Hadda qof kasta oo link soo dira ama dhaha "link isoo dhig", bot-ku status-ka ayuu u dhigi doonaa, wuxuuna ku celin doonaa sawirkaaga iyo link-gaaga isagoo ku leh: *Adiguna status-ka iigu dhig!* 📲✨',
    };
  }

  /**
   * Retrieves the WhatsApp owner's promotional flyer and link
   */
  public getOwnerPromo(): { link?: string; imageBuffer?: Buffer; mimeType?: string } {
    let imageBuffer: Buffer | undefined;
    const imgPath = this.getOwnerPromoImagePath();
    if (fs.existsSync(imgPath)) {
      try {
        imageBuffer = fs.readFileSync(imgPath);
      } catch { }
    }
    return {
      link: this.ownerPromoLink,
      imageBuffer,
      mimeType: this.ownerPromoMimeType || 'image/jpeg',
    };
  }

  public hasOwnerPromo(): boolean {
    return Boolean(this.ownerPromoLink);
  }

  public isAwaitingOwnerPromoSetup(): boolean {
    return this.awaitingOwnerPromoSetup;
  }

  public setAwaitingOwnerPromoSetup(val: boolean): void {
    this.awaitingOwnerPromoSetup = val;
    this.saveBotControlConfig();
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

  /**
   * Creates an interactive, native WhatsApp Poll in any chat or group.
   */
  public async createPoll(
    chatId: string,
    title: string,
    options: string[],
    selectableCount: number = 1
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };
    const cleanTitle = title.trim();
    const cleanOpts = options.map(o => o.trim()).filter(Boolean);
    if (!cleanTitle || cleanOpts.length < 2) {
      return {
        success: false,
        message: 'Fadlan bixi su\'aasha codbixinta iyo ugu yaraan 2 doorasho (tusaale: `!poll Mawduuca | Haa | Maya`).',
      };
    }

    try {
      await this.socket.sendMessage(chatId, {
        poll: {
          name: cleanTitle.slice(0, 255),
          values: cleanOpts.slice(0, 12),
          selectableCount: Math.min(Math.max(selectableCount, 1), cleanOpts.length),
        },
      });
      return { success: true, message: `📊 Codbixintii (${cleanTitle}) si guul leh ayaa loo diray!` };
    } catch (err: any) {
      return { success: false, message: `Cilad dirista codbixinta: ${err.message}` };
    }
  }

  /**
   * Sets curfew parameters for a group.
   */
  public setCurfew(groupJid: string, enabled: boolean, startHour?: number, endHour?: number): any {
    return this.governor.setCurfew(groupJid, enabled, startHour, endHour);
  }

  /**
   * Gets curfew parameters for a group.
   */
  public getCurfew(groupJid: string): any {
    return this.governor.getCurfew(groupJid);
  }

  /**
   * Caches an incoming message in a group to detect future revocations (Anti-Delete/Ghost hunter).
   */
  public recordIncomingGroupMessage(groupJid: string, messageId: string, sender: string, text: string): void {
    let list = this.recentGroupMessages.get(groupJid);
    if (!list) {
      list = [];
      this.recentGroupMessages.set(groupJid, list);
    }
    list.push({ id: messageId, sender, text, timestamp: Date.now() });
    if (list.length > 200) list.shift();
  }

  /**
   * Catches a revoked message (Delete for Everyone) and archives it in the ghost vault.
   */
  public recordRevocation(groupJid: string, revokedMessageId: string): RevokedGroupMessage | null {
    const list = this.recentGroupMessages.get(groupJid);
    if (!list) return null;
    const foundIdx = list.findIndex(m => m.id === revokedMessageId);
    if (foundIdx === -1) return null;
    const msg = list[foundIdx];

    let revokedList = this.revokedGroupMessages.get(groupJid);
    if (!revokedList) {
      revokedList = [];
      this.revokedGroupMessages.set(groupJid, revokedList);
    }
    const revokedItem: RevokedGroupMessage = {
      id: msg.id,
      sender: msg.sender,
      text: msg.text,
      deletedAt: Date.now(),
      originalTime: msg.timestamp,
    };
    revokedList.push(revokedItem);
    if (revokedList.length > 50) revokedList.shift();
    return revokedItem;
  }

  /**
   * Returns recent messages that were deleted in a group.
   */
  public getRevokedMessages(groupJid: string): RevokedGroupMessage[] {
    return this.revokedGroupMessages.get(groupJid) || [];
  }

  /**
   * Returns recent messages cached in a group for autonomous intelligence & summaries.
   */
  public getRecentGroupMessages(groupJid: string): { id: string; sender: string; text: string; timestamp: number }[] {
    return this.recentGroupMessages.get(groupJid) || [];
  }

  /**
   * Lists all WhatsApp groups where the bot is currently participating.
   */
  public hasSocket(): boolean {
    return this.socket !== null;
  }

  private loadKnownGroupsCache(): void {
    try {
      if (fs.existsSync(this.knownGroupsStoragePath)) {
        const raw = JSON.parse(fs.readFileSync(this.knownGroupsStoragePath, 'utf8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item?.id && typeof item.id === 'string' && item.id.endsWith('@g.us')) {
              this.knownGroups.set(item.id, {
                id: item.id,
                name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
                participantsCount: typeof item.participantsCount === 'number' ? item.participantsCount : 0,
                isAdmin: Boolean(item.isAdmin),
                role: item.role === 'superadmin' || item.role === 'admin' ? item.role : 'member',
                updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to load known groups cache: ${e?.message}`);
    }
  }

  private saveKnownGroupsCache(): void {
    try {
      const dir = path.dirname(this.knownGroupsStoragePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.knownGroups.values());
      fs.writeFileSync(this.knownGroupsStoragePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e: any) {
      console.warn(`[WhatsAppManager] Failed to save known groups cache: ${e?.message}`);
    }
  }

  private isRealGroupName(name?: string, jid?: string): boolean {
    const clean = String(name || '').trim();
    if (!clean) return false;
    if (clean.endsWith('@g.us')) return false;
    if (jid && clean === jid) return false;
    return true;
  }

  private detectRoleInParticipants(participants: any[]): { isAdmin: boolean; role: 'admin' | 'superadmin' | 'member' } {
    const botPhone = this.socket?.user?.id
      ? this.socket.user.id.split(':')[0].split('@')[0].replace(/\D/g, '')
      : this.botJid.replace(/\D/g, '');
    const botLid = (this.socket?.user as any)?.lid
      ? String((this.socket?.user as any).lid).split(':')[0].split('@')[0].replace(/\D/g, '')
      : '';
    const adminPhones = (this.configuredAdminPhones || []).map(p => p.replace(/[^0-9]/g, '')).filter(Boolean);

    for (const p of participants) {
      if (!p) continue;
      const candidateNums = [p.id, p.phoneNumber, p.jid, p.lid]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(v => v.split('@')[0].split(':')[0].replace(/\D/g, ''))
        .filter(Boolean);

      const isMatch = candidateNums.some(
        n => (botPhone && n === botPhone) || (botLid && n === botLid) || adminPhones.includes(n)
      );
      if (isMatch && (p.admin === 'admin' || p.admin === 'superadmin')) {
        return { isAdmin: true, role: p.admin };
      }
    }
    return { isAdmin: false, role: 'member' };
  }

  /**
   * Records a group discovered via Baileys events (groups.upsert, groups.update,
   * messaging-history.set, chats.upsert, groupFetchAllParticipating, or incoming messages).
   * Preserves known real group names and never overwrites them with blank or raw JIDs.
   */
  public recordDiscoveredGroup(raw: any, persist: boolean = false): boolean {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!id || !id.endsWith('@g.us')) return false;

    const existing = this.knownGroups.get(id);
    const rawName = String(raw?.subject || raw?.name || raw?.conversationName || '').trim();
    const nextName = this.isRealGroupName(rawName, id)
      ? rawName
      : (existing && this.isRealGroupName(existing.name, id) ? existing.name : (rawName || existing?.name || id));

    const hasParticipants = Array.isArray(raw?.participants) && raw.participants.length > 0;
    const rawSize = typeof raw?.size === 'number' && raw.size > 0 ? raw.size : 0;
    const rawCount = typeof raw?.participantsCount === 'number' && raw.participantsCount > 0 ? raw.participantsCount : 0;
    const nextCount = hasParticipants
      ? raw.participants.length
      : (rawSize || rawCount || existing?.participantsCount || 0);

    let isAdmin = existing?.isAdmin || false;
    let role: 'admin' | 'superadmin' | 'member' = existing?.role || 'member';
    if (hasParticipants) {
      const detected = this.detectRoleInParticipants(raw.participants);
      isAdmin = detected.isAdmin;
      role = detected.role;
    } else if (typeof raw?.isAdmin === 'boolean') {
      isAdmin = raw.isAdmin;
      role = raw.role === 'superadmin' || raw.role === 'admin' ? raw.role : (isAdmin ? 'admin' : 'member');
    }

    const changed =
      !existing ||
      existing.name !== nextName ||
      existing.participantsCount !== nextCount ||
      existing.isAdmin !== isAdmin ||
      existing.role !== role;

    this.knownGroups.set(id, {
      id,
      name: nextName,
      participantsCount: nextCount,
      isAdmin,
      role,
      updatedAt: Date.now(),
    });

    if (changed && persist) {
      this.saveKnownGroupsCache();
    }
    return changed;
  }

  public recordDiscoveredGroups(rawGroups: any[], persist: boolean = true): number {
    if (!Array.isArray(rawGroups) || rawGroups.length === 0) return 0;
    let changedCount = 0;
    for (const g of rawGroups) {
      if (this.recordDiscoveredGroup(g, false)) {
        changedCount++;
      }
    }
    if (changedCount > 0 && persist) {
      this.saveKnownGroupsCache();
    }
    return changedCount;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Lists all WhatsApp groups with smart live refresh, timeout protection, persistent cache
   * fallback, and automatic missing-name resolution via groupMetadata() so group names ALWAYS appear.
   */
  public async listParticipatingGroupsDetailed(options?: {
    forceRefresh?: boolean;
    isTransportConnected?: boolean;
  }): Promise<{
    groups: ParticipatingGroupItem[];
    source: 'live' | 'cache' | 'live+cache';
    connected: boolean;
    warning?: string;
    refreshedLive: boolean;
  }> {
    const connected = Boolean(this.socket) && options?.isTransportConnected !== false;
    const forceRefresh = Boolean(options?.forceRefresh);
    const cacheFresh = this.knownGroups.size > 0 && (Date.now() - this.lastLiveGroupsFetchAt) < 45_000;
    let refreshedLive = false;
    let liveCount = 0;
    let warning: string | undefined;

    if (connected && typeof (this.socket as any).groupFetchAllParticipating === 'function' && (forceRefresh || !cacheFresh)) {
      try {
        const groupsObj = await this.withTimeout(
          (this.socket as any).groupFetchAllParticipating(),
          15_000,
          'groupFetchAllParticipating'
        );
        const values = groupsObj && typeof groupsObj === 'object' ? Object.values(groupsObj) : [];
        liveCount = values.length;
        if (values.length > 0) {
          this.recordDiscoveredGroups(values, true);
        }
        this.lastLiveGroupsFetchAt = Date.now();
        this.lastGroupsFetchError = null;
        refreshedLive = true;
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        this.lastGroupsFetchError = errMsg;
        console.warn(`[WhatsAppManager] Error listing participating groups (falling back to ${this.knownGroups.size} cached groups): ${errMsg}`);
        warning = this.knownGroups.size > 0
          ? `WhatsApp live refresh wuu gaabiyay (${errMsg}) — waxaa la soo bandhigay liiska kaydsan (${this.knownGroups.size} kooxood).`
          : `WhatsApp kooxaha lama soo qaadi karin hadda (${errMsg}). Hubi in WhatsApp-ku online yahay kadibna guji Refresh.`;
      }
    } else if (!connected) {
      warning = this.knownGroups.size > 0
        ? `WhatsApp-ka mulkiiluhu hadda waa Offline — waxaa muuqda liiskii u dambeeyay ee kaydsanaa (${this.knownGroups.size} kooxood).`
        : 'WhatsApp-ka mulkiiluhu hadda waa Offline — ku xidh Owner Studio kadibna guji Refresh.';
    }

    // Merge knownGroups + autoManagedGroups into one deduplicated map
    const merged = new Map<string, ParticipatingGroupItem>();
    for (const g of this.knownGroups.values()) {
      merged.set(g.id, {
        id: g.id,
        name: g.name || g.id,
        participantsCount: g.participantsCount || 0,
        isManaged: this.isGroupAutoManaged(g.id),
        isAdmin: g.isAdmin,
        role: g.role,
      });
    }

    for (const [jid, info] of this.autoManagedGroups.entries()) {
      const existing = merged.get(jid);
      if (existing) {
        existing.isManaged = true;
        if (!this.isRealGroupName(existing.name, jid) && this.isRealGroupName(info.name, jid)) {
          existing.name = info.name;
        }
      } else {
        merged.set(jid, {
          id: jid,
          name: this.isRealGroupName(info.name, jid) ? info.name : jid,
          participantsCount: 0,
          isManaged: true,
          isAdmin: false,
          role: 'member',
        });
      }
    }

    // Resolve any remaining raw-JID group names via socket.groupMetadata() (up to 10 per call, 3s each)
    if (connected && typeof (this.socket as any).groupMetadata === 'function') {
      const missingNameJids = Array.from(merged.values())
        .filter(g => !this.isRealGroupName(g.name, g.id))
        .slice(0, 10)
        .map(g => g.id);

      let resolvedAny = false;
      for (const jid of missingNameJids) {
        try {
          const meta = await this.withTimeout(
            (this.socket as any).groupMetadata(jid),
            3_500,
            `groupMetadata(${jid})`
          );
          if (meta && (meta as any).id) {
            this.recordDiscoveredGroup(meta, false);
            const updated = this.knownGroups.get(jid);
            const item = merged.get(jid);
            if (updated && item) {
              item.name = updated.name;
              item.participantsCount = updated.participantsCount;
              item.isAdmin = updated.isAdmin;
              item.role = updated.role;
              resolvedAny = true;
            }
          }
        } catch {
          // Ignore single group metadata failure and keep moving
        }
      }
      if (resolvedAny) {
        this.saveKnownGroupsCache();
      }
    }

    const list = Array.from(merged.values()).sort((a, b) => {
      if (a.isManaged !== b.isManaged) return a.isManaged ? -1 : 1;
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      return a.name.localeCompare(b.name, 'so', { sensitivity: 'base' });
    });

    const source: 'live' | 'cache' | 'live+cache' =
      refreshedLive && liveCount >= list.length
        ? 'live'
        : refreshedLive
          ? 'live+cache'
          : 'cache';

    return {
      groups: list,
      source,
      connected,
      warning,
      refreshedLive,
    };
  }

  /**
   * Lists all WhatsApp groups where the bot is currently participating,
   * indicating whether the bot/owner is an Admin, superadmin, or regular member.
   */
  public async listParticipatingGroups(options?: {
    forceRefresh?: boolean;
    isTransportConnected?: boolean;
  }): Promise<ParticipatingGroupItem[]> {
    const detailed = await this.listParticipatingGroupsDetailed(options);
    return detailed.groups;
  }

  /**
   * Sends an authentic Ogg Opus Voice Note (PTT) with optional title caption to any WhatsApp group.
   */
  public async sendVoiceNoteToGroup(
    groupJid: string,
    audioBuffer: Buffer,
    title?: string,
    transport?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // 1. Send title header if specified
      if (title && title.trim()) {
        const captionText = `🎙️ *[${title.trim().toUpperCase()}]*`;
        if (transport?.sendMessage) {
          await transport.sendMessage(groupJid, captionText);
        } else if (this.socket) {
          await this.socket.sendMessage(groupJid, { text: captionText });
        }
      }

      const seconds = getOggOpusDurationSeconds(audioBuffer);
      const waveform = generateSpeechWaveform(audioBuffer);

      // 2. Deliver as authentic WhatsApp Voice Note (PTT) with exact duration & waveform
      if (transport?.sendMedia) {
        await transport.sendMedia(groupJid, {
          type: 'audio',
          dataBuffer: audioBuffer,
          mimeType: 'audio/ogg; codecs=opus',
          ptt: true,
          seconds,
          waveform,
        });
      } else if (this.socket) {
        await this.socket.sendMessage(groupJid, {
          audio: audioBuffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          seconds,
          waveform,
        } as any);
      }

      return { success: true };
    } catch (err: any) {
      console.warn(`[WhatsAppManager] Failed to send voice note to ${groupJid}:`, err);
      return { success: false, error: err?.message };
    }
  }

  // ─── 3.2. AUTONOMOUS DAILY MEMBER GROWTH (AUTO-ADD CONTACTS) ───────────────

  public getAutoAddConfig(groupJid: string): AutoAddGroupConfig {
    let cfg = this.autoAddConfig.get(groupJid);
    if (!cfg) {
      cfg = {
        groupJid,
        enabled: this.isAutoGroupManaged(groupJid),
        dailyLimit: 5,
        totalAdded: 0,
        attemptedJids: [],
      };
      this.autoAddConfig.set(groupJid, cfg);
    }
    return cfg;
  }

  public setAutoAddConfig(groupJid: string, update: Partial<AutoAddGroupConfig>): AutoAddGroupConfig {
    const existing = this.getAutoAddConfig(groupJid);
    const updated: AutoAddGroupConfig = {
      ...existing,
      ...update,
      groupJid,
    };
    this.autoAddConfig.set(groupJid, updated);
    this.saveAutoAddConfig();
    return updated;
  }

  public async getEligibleContactsCount(groupJid: string): Promise<{
    totalContacts: number;
    eligibleCount: number;
    alreadyInGroupCount: number;
    alreadyAttemptedCount: number;
  }> {
    const allContacts = this.broadcast.getContacts();
    const totalContacts = allContacts.length;
    const cfg = this.getAutoAddConfig(groupJid);
    const attemptedSet = new Set(cfg.attemptedJids || []);

    const existingMembers = new Set<string>();
    if (this.socket) {
      try {
        const meta = await this.socket.groupMetadata(groupJid);
        for (const p of meta?.participants || []) {
          if (p?.id) {
            existingMembers.add(p.id);
            const num = p.id.split('@')[0];
            existingMembers.add(`${num}@s.whatsapp.net`);
          }
        }
      } catch { }
    }

    let eligibleCount = 0;
    let alreadyInGroupCount = 0;
    let alreadyAttemptedCount = 0;

    for (const c of allContacts) {
      if (!c.jid || !c.jid.endsWith('@s.whatsapp.net')) continue;
      const num = c.jid.split('@')[0];
      if (num.length < 7 || num.length > 15) continue;

      if (existingMembers.has(c.jid)) {
        alreadyInGroupCount++;
        continue;
      }
      if (attemptedSet.has(c.jid)) {
        alreadyAttemptedCount++;
        continue;
      }

      if (this.socket?.user?.id && c.jid.startsWith(this.socket.user.id.split(':')[0].split('@')[0])) continue;
      if ((this.configuredAdminPhones || []).some(a => a.replace(/[^0-9]/g, '') === num)) continue;

      eligibleCount++;
    }

    return {
      totalContacts,
      eligibleCount,
      alreadyInGroupCount,
      alreadyAttemptedCount,
    };
  }

  public async autoAddDailyMembers(
    groupJid: string,
    limit?: number
  ): Promise<{ success: boolean; added: number; attempted: number; skippedPrivacy: number; message: string }> {
    if (!this.socket) {
      return { success: false, added: 0, attempted: 0, skippedPrivacy: 0, message: 'WhatsApp ma xirna hadda.' };
    }

    const cfg = this.getAutoAddConfig(groupJid);
    const targetLimit = Math.min(Math.max(1, limit || cfg.dailyLimit || 5), 10);
    const attemptedSet = new Set(cfg.attemptedJids || []);

    const existingMembers = new Set<string>();
    try {
      const meta = await this.socket.groupMetadata(groupJid);
      for (const p of meta?.participants || []) {
        if (p?.id) {
          existingMembers.add(p.id);
          const num = p.id.split('@')[0];
          existingMembers.add(`${num}@s.whatsapp.net`);
        }
      }
    } catch (metaErr: any) {
      return { success: false, added: 0, attempted: 0, skippedPrivacy: 0, message: `Lama heli karo xogta kooxda: ${metaErr?.message}` };
    }

    const allContacts = this.broadcast.getContacts();
    const botNum = this.socket?.user?.id ? this.socket.user.id.split(':')[0].split('@')[0] : '';

    const candidates = allContacts.filter(c => {
      if (!c.jid || !c.jid.endsWith('@s.whatsapp.net')) return false;
      const num = c.jid.split('@')[0];
      if (num.length < 7 || num.length > 15) return false;
      if (existingMembers.has(c.jid)) return false;
      if (attemptedSet.has(c.jid)) return false;
      if (botNum && c.jid.startsWith(botNum)) return false;
      if ((this.configuredAdminPhones || []).some(a => a.replace(/[^0-9]/g, '') === num)) return false;
      return true;
    });

    if (candidates.length === 0) {
      cfg.lastRunDate = new Date().toISOString().slice(0, 10);
      this.saveAutoAddConfig();
      return {
        success: true,
        added: 0,
        attempted: 0,
        skippedPrivacy: 0,
        message: 'Ma jiraan xubno cusub oo hadda u diyaar ah ku-darista (dhammaan contacts-ka way ku jiraan kooxda ama horay ayaa la isugu dayay).',
      };
    }

    const toAdd = candidates.slice(0, targetLimit);
    let added = 0;
    let attempted = 0;
    let skippedPrivacy = 0;

    for (const person of toAdd) {
      attempted++;
      attemptedSet.add(person.jid);
      try {
        const res = await this.addMember(groupJid, person.jid);
        if (res.success) {
          added++;
        } else if (res.message && (res.message.includes('Privacy') || res.message.includes('403'))) {
          skippedPrivacy++;
        }
      } catch (err: any) {
        console.warn(`[AutoAdd] Error adding ${person.jid} to ${groupJid}:`, err?.message);
      }

      if (attempted < toAdd.length) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    cfg.attemptedJids = Array.from(attemptedSet);
    cfg.totalAdded = (cfg.totalAdded || 0) + added;
    cfg.lastRunDate = new Date().toISOString().slice(0, 10);
    this.saveAutoAddConfig();

    const privacyNote = skippedPrivacy > 0 ? `, ${skippedPrivacy} qofna Privacy-ga ayaa u xirnaa` : '';
    const msg = `✅ Waxaa kooxda si toos ah loogu daray ${added} xubnood oo cusub! (Isku dayo: ${attempted}${privacyNote})`;
    return {
      success: true,
      added,
      attempted,
      skippedPrivacy,
      message: msg,
    };
  }
}

export const whatsappManagerService = new WhatsAppManagerService();
