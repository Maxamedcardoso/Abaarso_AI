import { DatabaseSync } from 'node:sqlite';

export type ViewsCategory = 'personal' | 'business' | 'student' | 'creator';
export type ViewsDownloadMode = 'instant' | 'locked';

export interface ViewsHubContact {
  id: number;
  phone: string;
  displayName: string;
  city: string;
  category: ViewsCategory;
  tagline: string;
  avatarUrl: string;
  batchNumber: number;
  isVip: boolean;
  vipPriority: number;
  vipExpiresAt: number | null;
  downloadsCount: number;
  hasDownloaded: boolean;
  lastDownloadedAt: number | null;
  verifiedSaver: boolean;
  verifiedAt: number | null;
  referralsCount: number;
  referredBy: string;
  status: 'active' | 'banned';
  createdAt: number;
  updatedAt: number;
}

export interface ViewsHubConfig {
  hubTitle: string;
  contactPrefix: string;
  currentBatch: number;
  batchTarget: number;
  downloadMode: ViewsDownloadMode;
  unlockedBatches: number[];
  ownerVipPhone: string;
  vipPriceLabel: string;
  announcement: string;
  totalVcfDownloads: number;
  updatedAt: number;
}

export interface JoinViewsInput {
  name: string;
  phone: string;
  countryCode?: string;
  city?: string;
  category?: string;
  tagline?: string;
  referredBy?: string;
}

export interface UpsertVipInput {
  name: string;
  phone: string;
  countryCode?: string;
  city?: string;
  category?: string;
  tagline?: string;
  avatarUrl?: string;
  durationDays?: number; // 0 or undefined -> unlimited
  vipPriority?: number;
}

export class ViewsHubError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number = 400, code: string = 'VIEWS_ERROR') {
    super(message);
    this.name = 'ViewsHubError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function sanitizeCategory(raw?: string): ViewsCategory {
  if (raw === 'business' || raw === 'student' || raw === 'creator' || raw === 'personal') {
    return raw;
  }
  return 'personal';
}

function escapeVCardText(value: string): string {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .trim();
}

export function maskPhoneForPublic(digits: string): string {
  const clean = String(digits || '').replace(/\D/g, '');
  if (clean.length <= 6) return `+${clean}`;
  return `+${clean.slice(0, 5)} ••• ${clean.slice(-3)}`;
}

/**
 * Normalizes Somali (+252), Ethiopian/Somali Region (+251), Kenyan (+254), Djibouti (+253),
 * and international WhatsApp numbers into canonical E.164 digits (without leading +).
 *
 * Examples:
 * - "0634112233"                  -> "252634112233"
 * - "+252 063 411 2233"           -> "252634112233"
 * - "0915123456" (or cc='251')    -> "251915123456"
 * - "+251 0915 123 456"           -> "251915123456"
 * - "0712345678" with cc='251'    -> "251712345678"
 * - "00251915123456"              -> "251915123456"
 */
export function normalizeViewsPhone(raw: string, countryCode?: string): string {
  const stripped = String(raw || '').split('@')[0].split(':')[0].trim();
  let digits = stripped.replace(/\D/g, '');
  if (!digits) return '';

  // Remove international 00 prefix (e.g. 00251... -> 251..., 00252... -> 252...)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  const cc = String(countryCode || '').replace(/\D/g, '');

  // Strip mistaken leading 0 immediately after known East Africa country codes (e.g. 25109... -> 2519..., 252063... -> 25263...)
  if (/^(251|252|253|254)0\d{7,10}$/.test(digits)) {
    digits = digits.slice(0, 3) + digits.slice(4);
  }

  // Already has an explicit international country code (251/252/253/254 or >=11 digits not starting with 0)
  if (/^251[79]\d{8}$/.test(digits)) return digits;
  if (/^252[679]\d{7,8}$/.test(digits)) return digits;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^2537\d{7}$/.test(digits)) return digits;

  // If user selected an explicit country code in the UI
  if (cc) {
    if (digits.startsWith(cc) && digits.length >= cc.length + 7) {
      // Also clean stray 0 right after cc (e.g. cc=251, digits=2510912345678)
      if (digits[cc.length] === '0' && digits.length >= cc.length + 8) {
        return cc + digits.slice(cc.length + 1);
      }
      return digits;
    }
    const localNoZero = digits.startsWith('0') ? digits.slice(1) : digits;
    return cc + localNoZero;
  }

  // Auto-detect when no explicit countryCode was provided:
  // Ethiopia (+251): local 09[1-9]xxxxxxx (10 digits) or 9[1-9]xxxxxxx (9 digits)
  // Note: Somalia Puntland Golis is 090xxxxxxx (so 090 stays 252, while 091..099 is Ethiopia 251!)
  if (/^09[1-9]\d{7}$/.test(digits)) {
    return '251' + digits.slice(1);
  }
  if (/^9[1-9]\d{7}$/.test(digits)) {
    return '251' + digits;
  }

  // Somalia / Somaliland (+252): local 06x / 077 / 090 (10 digits) or 9-digit without leading 0
  if (/^0(?:6\d|77|90)\d{7}$/.test(digits)) {
    return '252' + digits.slice(1);
  }
  if (/^(?:6\d|77|90)\d{7}$/.test(digits)) {
    return '252' + digits;
  }

  // Local 07xxxxxxxx (if not 077 Somalia): default to Ethiopia +251 Safaricom if 10 digits
  if (/^07\d{8}$/.test(digits)) {
    return '251' + digits.slice(1);
  }

  return digits;
}

/**
 * ViewsHubService — Zero-Ban WhatsApp Status Views & 1-Click .vcf Contact Exchange Hub
 *
 * Stores contacts, VIP Pinned sponsors, batch progression, download tracking, and verified savers
 * inside the Owner SQLite database so CloudStateSync (Neon Postgres) persists all data automatically.
 */
export class ViewsHubService {
  private readonly getDb: () => DatabaseSync | null;
  private initialized: boolean = false;
  private defaultOwnerPhone: string;

  constructor(getDb: () => DatabaseSync | null, defaultOwnerPhone: string = '') {
    this.getDb = getDb;
    this.defaultOwnerPhone = normalizeViewsPhone(defaultOwnerPhone);
  }

  private db(): DatabaseSync {
    const conn = this.getDb();
    if (!conn) {
      throw new ViewsHubError('ViewsHub database is not initialized', 503, 'DB_NOT_READY');
    }
    if (!this.initialized) {
      this.initializeSchema(conn);
      this.initialized = true;
    }
    return conn;
  }

  public initialize(): void {
    const conn = this.getDb();
    if (!conn) return;
    this.initializeSchema(conn);
    this.initialized = true;
  }

  private initializeSchema(conn: DatabaseSync): void {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS views_hub_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        city TEXT DEFAULT 'Hargeysa',
        category TEXT DEFAULT 'personal',
        tagline TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        batch_number INTEGER DEFAULT 1,
        is_vip INTEGER DEFAULT 0,
        vip_priority INTEGER DEFAULT 100,
        vip_expires_at INTEGER DEFAULT NULL,
        downloads_count INTEGER DEFAULT 0,
        has_downloaded INTEGER DEFAULT 0,
        last_downloaded_at INTEGER DEFAULT NULL,
        verified_saver INTEGER DEFAULT 0,
        verified_at INTEGER DEFAULT NULL,
        referrals_count INTEGER DEFAULT 0,
        referred_by TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_views_batch ON views_hub_contacts(batch_number, status);
      CREATE INDEX IF NOT EXISTS idx_views_vip ON views_hub_contacts(is_vip, vip_priority);
      CREATE INDEX IF NOT EXISTS idx_views_city ON views_hub_contacts(city);

      CREATE TABLE IF NOT EXISTS views_hub_config (
        id TEXT PRIMARY KEY,
        hub_title TEXT DEFAULT 'CARDOSO Views Hub',
        contact_prefix TEXT DEFAULT 'CV - ',
        current_batch INTEGER DEFAULT 1,
        batch_target INTEGER DEFAULT 100,
        download_mode TEXT DEFAULT 'instant',
        unlocked_batches TEXT DEFAULT '[]',
        owner_vip_phone TEXT DEFAULT '',
        vip_price_label TEXT DEFAULT '$5 / Bil',
        announcement TEXT DEFAULT '',
        total_vcf_downloads INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS views_hub_groups (
        group_jid TEXT PRIMARY KEY,
        group_name TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        captured_count INTEGER DEFAULT 0,
        last_vcf_drop_at INTEGER DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Safe forward migrations for existing databases deployed on Render
    const contactMigrations = [
      'ALTER TABLE views_hub_contacts ADD COLUMN has_downloaded INTEGER DEFAULT 0;',
      'ALTER TABLE views_hub_contacts ADD COLUMN last_downloaded_at INTEGER DEFAULT NULL;',
      'ALTER TABLE views_hub_contacts ADD COLUMN verified_saver INTEGER DEFAULT 0;',
      'ALTER TABLE views_hub_contacts ADD COLUMN verified_at INTEGER DEFAULT NULL;',
      "ALTER TABLE views_hub_config ADD COLUMN download_mode TEXT DEFAULT 'instant';",
      "ALTER TABLE views_hub_config ADD COLUMN unlocked_batches TEXT DEFAULT '[]';",
    ];
    for (const sql of contactMigrations) {
      try {
        conn.exec(sql);
      } catch {
        // Column already exists
      }
    }

    const existingCfg = conn
      .prepare('SELECT id FROM views_hub_config WHERE id = ?')
      .get('default') as { id?: string } | undefined;

    if (!existingCfg) {
      conn
        .prepare(
          `INSERT INTO views_hub_config
           (id, hub_title, contact_prefix, current_batch, batch_target, download_mode, unlocked_batches, owner_vip_phone, vip_price_label, announcement, total_vcf_downloads, updated_at)
           VALUES ('default', 'CARDOSO Views Hub', 'CV - ', 1, 100, 'instant', '[]', ?, '$5 / Bil', '', 0, ?)`
        )
        .run(this.defaultOwnerPhone || '', Date.now());
    }
  }

  private mapContact(row: any): ViewsHubContact {
    const now = Date.now();
    const rawVip = Boolean(row.is_vip);
    const expiresAt = row.vip_expires_at != null ? Number(row.vip_expires_at) : null;
    const effectiveVip = rawVip && (expiresAt === null || expiresAt > now);

    return {
      id: Number(row.id),
      phone: String(row.phone || ''),
      displayName: String(row.display_name || ''),
      city: String(row.city || 'Hargeysa'),
      category: sanitizeCategory(row.category),
      tagline: String(row.tagline || ''),
      avatarUrl: String(row.avatar_url || ''),
      batchNumber: Number(row.batch_number || 1),
      isVip: effectiveVip,
      vipPriority: Number(row.vip_priority ?? 100),
      vipExpiresAt: expiresAt,
      downloadsCount: Number(row.downloads_count || 0),
      hasDownloaded: Boolean(row.has_downloaded),
      lastDownloadedAt: row.last_downloaded_at != null ? Number(row.last_downloaded_at) : null,
      verifiedSaver: Boolean(row.verified_saver),
      verifiedAt: row.verified_at != null ? Number(row.verified_at) : null,
      referralsCount: Number(row.referrals_count || 0),
      referredBy: String(row.referred_by || ''),
      status: row.status === 'banned' ? 'banned' : 'active',
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  }

  private parseUnlockedBatches(raw: unknown): number[] {
    try {
      const arr = JSON.parse(String(raw || '[]'));
      if (Array.isArray(arr)) {
        return Array.from(new Set(arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 1))).sort((a, b) => a - b);
      }
    } catch {}
    return [];
  }

  public getConfig(): ViewsHubConfig {
    const conn = this.db();
    const row = conn.prepare('SELECT * FROM views_hub_config WHERE id = ?').get('default') as any;
    if (!row) {
      return {
        hubTitle: 'CARDOSO Views Hub',
        contactPrefix: 'CV - ',
        currentBatch: 1,
        batchTarget: 100,
        downloadMode: 'instant',
        unlockedBatches: [],
        ownerVipPhone: this.defaultOwnerPhone,
        vipPriceLabel: '$5 / Bil',
        announcement: '',
        totalVcfDownloads: 0,
        updatedAt: Date.now(),
      };
    }
    return {
      hubTitle: String(row.hub_title || 'CARDOSO Views Hub'),
      contactPrefix: String(row.contact_prefix ?? 'CV - '),
      currentBatch: Math.max(1, Number(row.current_batch || 1)),
      batchTarget: Math.max(2, Number(row.batch_target || 100)),
      downloadMode: row.download_mode === 'locked' ? 'locked' : 'instant',
      unlockedBatches: this.parseUnlockedBatches(row.unlocked_batches),
      ownerVipPhone: String(row.owner_vip_phone || this.defaultOwnerPhone || ''),
      vipPriceLabel: String(row.vip_price_label || '$5 / Bil'),
      announcement: String(row.announcement || ''),
      totalVcfDownloads: Number(row.total_vcf_downloads || 0),
      updatedAt: Number(row.updated_at || Date.now()),
    };
  }

  public getBatchFreeCount(batchNumber: number): number {
    const conn = this.db();
    const row = conn
      .prepare('SELECT COUNT(*) as cnt FROM views_hub_contacts WHERE status = ? AND batch_number = ? AND is_vip = 0')
      .get('active', batchNumber) as { cnt?: number };
    return Number(row?.cnt || 0);
  }

  public isBatchDownloadUnlocked(batchNumber: number, cfgOverride?: ViewsHubConfig): boolean {
    const cfg = cfgOverride || this.getConfig();
    if (cfg.downloadMode === 'instant') return true;
    // Past completed batches (< currentBatch) are always unlocked
    if (batchNumber < cfg.currentBatch) return true;
    if (cfg.unlockedBatches.includes(batchNumber)) return true;
    return this.getBatchFreeCount(batchNumber) >= cfg.batchTarget;
  }

  public updateConfig(partial: Partial<Omit<ViewsHubConfig, 'totalVcfDownloads' | 'updatedAt'>>): ViewsHubConfig {
    const conn = this.db();
    const current = this.getConfig();
    const nextUnlocked =
      partial.unlockedBatches !== undefined
        ? Array.from(new Set(partial.unlockedBatches.map(Number).filter((n) => Number.isFinite(n) && n >= 1))).sort((a, b) => a - b)
        : current.unlockedBatches;

    const next: ViewsHubConfig = {
      hubTitle: (partial.hubTitle ?? current.hubTitle).trim().slice(0, 80) || 'CARDOSO Views Hub',
      contactPrefix: String(partial.contactPrefix ?? current.contactPrefix).slice(0, 16),
      currentBatch: Math.max(1, Number(partial.currentBatch ?? current.currentBatch) || 1),
      batchTarget: Math.max(2, Math.min(2000, Number(partial.batchTarget ?? current.batchTarget) || 100)),
      downloadMode:
        partial.downloadMode === 'locked'
          ? 'locked'
          : partial.downloadMode === 'instant'
          ? 'instant'
          : current.downloadMode,
      unlockedBatches: nextUnlocked,
      ownerVipPhone: partial.ownerVipPhone !== undefined ? normalizeViewsPhone(partial.ownerVipPhone) : current.ownerVipPhone,
      vipPriceLabel: (partial.vipPriceLabel ?? current.vipPriceLabel).trim().slice(0, 40) || '$5 / Bil',
      announcement: (partial.announcement ?? current.announcement).trim().slice(0, 260),
      totalVcfDownloads: current.totalVcfDownloads,
      updatedAt: Date.now(),
    };

    conn
      .prepare(
        `UPDATE views_hub_config
         SET hub_title = ?, contact_prefix = ?, current_batch = ?, batch_target = ?,
             download_mode = ?, unlocked_batches = ?, owner_vip_phone = ?,
             vip_price_label = ?, announcement = ?, updated_at = ?
         WHERE id = 'default'`
      )
      .run(
        next.hubTitle,
        next.contactPrefix,
        next.currentBatch,
        next.batchTarget,
        next.downloadMode,
        JSON.stringify(next.unlockedBatches),
        next.ownerVipPhone,
        next.vipPriceLabel,
        next.announcement,
        next.updatedAt
      );

    return next;
  }

  public unlockBatch(batchNumber?: number): ViewsHubConfig {
    const cfg = this.getConfig();
    const target = batchNumber || cfg.currentBatch;
    const nextUnlocked = Array.from(new Set([...cfg.unlockedBatches, target]));
    return this.updateConfig({ unlockedBatches: nextUnlocked });
  }

  /**
   * Strict batch rule: a new batch CANNOT be opened manually until the current batch reaches batchTarget.
   * When a batch hits batchTarget during signup, it already opens the next batch automatically!
   */
  public startNewBatch(): ViewsHubConfig {
    const cfg = this.getConfig();
    const currentCount = this.getBatchFreeCount(cfg.currentBatch);
    if (currentCount < cfg.batchTarget) {
      throw new ViewsHubError(
        `⛔ Batch #${cfg.currentBatch} weli ma buuxsamin (${currentCount} / ${cfg.batchTarget} Qof)! Batch cusub lama furi karo ilaa uu buuxsamo — marka ${cfg.batchTarget} la gaaro si toos ah ayuu Batch #${cfg.currentBatch + 1} u furmayaa.`,
        400,
        'BATCH_NOT_FULL'
      );
    }
    const nextUnlocked = Array.from(new Set([...cfg.unlockedBatches, cfg.currentBatch]));
    return this.updateConfig({
      currentBatch: cfg.currentBatch + 1,
      unlockedBatches: nextUnlocked,
    });
  }

  public lookupContactByPhone(rawPhone: string, countryCode?: string): ViewsHubContact {
    const conn = this.db();
    const phone = normalizeViewsPhone(rawPhone, countryCode);
    if (!phone || phone.length < 9 || phone.length > 15) {
      throw new ViewsHubError('Fadlan geli lambar WhatsApp sax ah (252 / 251 / 254...).', 400, 'INVALID_PHONE');
    }
    const row = conn.prepare('SELECT * FROM views_hub_contacts WHERE phone = ?').get(phone) as any;
    if (!row) {
      throw new ViewsHubError(
        'Lambarkan weli kama diiwaangashana Views Hub — fadlan marka hore isdiiwaangeli.',
        404,
        'NOT_FOUND'
      );
    }
    if (row.status === 'banned') {
      throw new ViewsHubError('Lambarkan waa laga mamnuucay Hub-ka.', 403, 'BANNED');
    }
    return this.mapContact(row);
  }

  public joinContact(input: JoinViewsInput): {
    contact: ViewsHubContact;
    batchCompleted: boolean;
    nextBatchOpened: number | null;
  } {
    const conn = this.db();
    const displayName = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const phone = normalizeViewsPhone(input.phone, input.countryCode);
    if (!displayName || displayName.length < 2) {
      throw new ViewsHubError('Fadlan geli magacaaga oo sax ah (ugu yaraan 2 xaraf).', 400, 'INVALID_NAME');
    }
    if (!phone || phone.length < 9 || phone.length > 15) {
      throw new ViewsHubError(
        'Fadlan geli lambar WhatsApp sax ah (tusaale: +252 63..., +251 91..., +254 7...).',
        400,
        'INVALID_PHONE'
      );
    }

    // Strict Duplicate Protection: same phone can NEVER be registered twice!
    const existing = conn.prepare('SELECT * FROM views_hub_contacts WHERE phone = ?').get(phone) as any;
    if (existing) {
      if (existing.status === 'banned') {
        throw new ViewsHubError('Lambarkan waa laga mamnuucay Hub-ka.', 403, 'BANNED');
      }
      throw new ViewsHubError(
        `⚠️ Lambarkan (+${phone}) horay ayaa loo diiwaangeliyay! Hal lambar laba jeer lama kaydin karo — guji "🔑 Horay Ma Isku Diiwaangelisay?" si aad .vcf-kaaga u furto.`,
        409,
        'DUPLICATE_PHONE'
      );
    }

    const city = String(input.city || 'Hargeysa').trim().slice(0, 40) || 'Hargeysa';
    const category = sanitizeCategory(input.category);
    const tagline = String(input.tagline || '').trim().slice(0, 120);
    const refPhone = normalizeViewsPhone(input.referredBy || '');
    const now = Date.now();

    const cfg = this.getConfig();
    let assignedBatch = cfg.currentBatch;

    // Guard in case currentBatch already filled (e.g. target lowered by admin): advance first
    const countBefore = this.getBatchFreeCount(assignedBatch);
    if (countBefore >= cfg.batchTarget) {
      const nextUnlocked = Array.from(new Set([...cfg.unlockedBatches, assignedBatch]));
      assignedBatch = assignedBatch + 1;
      this.updateConfig({ currentBatch: assignedBatch, unlockedBatches: nextUnlocked });
    }

    const validRef = refPhone && refPhone !== phone ? refPhone : '';
    const insertRes = conn
      .prepare(
        `INSERT INTO views_hub_contacts
         (phone, display_name, city, category, tagline, avatar_url, batch_number, is_vip, vip_priority, vip_expires_at,
          downloads_count, has_downloaded, last_downloaded_at, verified_saver, verified_at,
          referrals_count, referred_by, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, 0, 100, NULL, 0, 0, NULL, 0, NULL, 0, ?, 'active', ?, ?)`
      )
      .run(phone, displayName, city, category, tagline, assignedBatch, validRef, now, now);

    if (validRef) {
      conn
        .prepare('UPDATE views_hub_contacts SET referrals_count = referrals_count + 1, updated_at = ? WHERE phone = ?')
        .run(now, validRef);
    }

    // Check if THIS signup just filled the current batch -> auto-unlock it & auto-open next batch!
    const countAfter = this.getBatchFreeCount(assignedBatch);
    let batchCompleted = false;
    let nextBatchOpened: number | null = null;
    if (countAfter >= cfg.batchTarget) {
      batchCompleted = true;
      nextBatchOpened = assignedBatch + 1;
      const latestCfg = this.getConfig();
      const nextUnlocked = Array.from(new Set([...latestCfg.unlockedBatches, assignedBatch]));
      this.updateConfig({
        currentBatch: nextBatchOpened,
        unlockedBatches: nextUnlocked,
      });
    }

    const inserted = conn
      .prepare('SELECT * FROM views_hub_contacts WHERE id = ?')
      .get(Number(insertRes.lastInsertRowid)) as any;

    return {
      contact: this.mapContact(inserted),
      batchCompleted,
      nextBatchOpened,
    };
  }

  public markVerifiedSaver(rawPhone: string, countryCode?: string): ViewsHubContact {
    const conn = this.db();
    const phone = normalizeViewsPhone(rawPhone, countryCode);
    const existing = conn.prepare('SELECT * FROM views_hub_contacts WHERE phone = ?').get(phone) as any;
    if (!existing) {
      throw new ViewsHubError('Lambarkan kama diiwaangashana Hub-ka.', 404, 'NOT_FOUND');
    }
    const now = Date.now();
    conn
      .prepare('UPDATE views_hub_contacts SET verified_saver = 1, verified_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, existing.id);
    const updated = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(existing.id) as any;
    return this.mapContact(updated);
  }

  public upsertVipContact(input: UpsertVipInput): ViewsHubContact {
    const conn = this.db();
    const displayName = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const phone = normalizeViewsPhone(input.phone, input.countryCode);
    if (!displayName || displayName.length < 2) {
      throw new ViewsHubError('Magaca VIP-ga waa waajib.', 400, 'INVALID_NAME');
    }
    if (!phone || phone.length < 9 || phone.length > 15) {
      throw new ViewsHubError('Lambarka WhatsApp ee VIP-gu ma saxna (+252 / +251...).', 400, 'INVALID_PHONE');
    }

    const city = String(input.city || 'Hargeysa').trim().slice(0, 40) || 'Hargeysa';
    const category = sanitizeCategory(input.category || 'business');
    const tagline = String(input.tagline || '').trim().slice(0, 140);
    const avatarUrl = String(input.avatarUrl || '').trim();
    if (avatarUrl && avatarUrl.length > 250_000) {
      throw new ViewsHubError('Sawirka VIP-gu aad buu u weyn yahay — fadlan mid ka yar soo geli.', 400, 'IMAGE_TOO_LARGE');
    }
    const vipPriority = Math.max(1, Math.min(999, Number(input.vipPriority ?? 10) || 10));
    const days = Number(input.durationDays ?? 30);
    const now = Date.now();
    const vipExpiresAt = days > 0 ? now + days * DAY_MS : null;
    const cfg = this.getConfig();

    const existing = conn.prepare('SELECT * FROM views_hub_contacts WHERE phone = ?').get(phone) as any;
    if (existing) {
      conn
        .prepare(
          `UPDATE views_hub_contacts
           SET display_name = ?, city = ?, category = ?, tagline = ?,
               avatar_url = CASE WHEN ? <> '' THEN ? ELSE avatar_url END,
               is_vip = 1, vip_priority = ?, vip_expires_at = ?, status = 'active', updated_at = ?
           WHERE id = ?`
        )
        .run(
          displayName,
          city,
          category,
          tagline,
          avatarUrl,
          avatarUrl,
          vipPriority,
          vipExpiresAt,
          now,
          existing.id
        );
      const updated = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(existing.id) as any;
      return this.mapContact(updated);
    }

    const res = conn
      .prepare(
        `INSERT INTO views_hub_contacts
         (phone, display_name, city, category, tagline, avatar_url, batch_number, is_vip, vip_priority, vip_expires_at,
          downloads_count, has_downloaded, last_downloaded_at, verified_saver, verified_at,
          referrals_count, referred_by, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 0, NULL, 1, ?, 0, '', 'active', ?, ?)`
      )
      .run(phone, displayName, city, category, tagline, avatarUrl, cfg.currentBatch, vipPriority, vipExpiresAt, now, now, now);

    const inserted = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(Number(res.lastInsertRowid)) as any;
    return this.mapContact(inserted);
  }

  public updateContactAdmin(
    id: number,
    patch: { isVip?: boolean; durationDays?: number; vipPriority?: number; status?: 'active' | 'banned'; verifiedSaver?: boolean }
  ): ViewsHubContact | null {
    const conn = this.db();
    const existing = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(id) as any;
    if (!existing) return null;

    const now = Date.now();
    const nextIsVip = patch.isVip !== undefined ? (patch.isVip ? 1 : 0) : existing.is_vip;
    let nextExpires = existing.vip_expires_at;
    if (patch.isVip === false) {
      nextExpires = null;
    } else if (patch.durationDays !== undefined) {
      const d = Number(patch.durationDays);
      if (d <= 0) {
        nextExpires = null;
      } else {
        const base = existing.vip_expires_at && Number(existing.vip_expires_at) > now ? Number(existing.vip_expires_at) : now;
        nextExpires = base + d * DAY_MS;
      }
    }
    const nextPriority =
      patch.vipPriority !== undefined ? Math.max(1, Math.min(999, Number(patch.vipPriority) || 10)) : existing.vip_priority;
    const nextStatus = patch.status === 'banned' ? 'banned' : patch.status === 'active' ? 'active' : existing.status;
    const nextVerified = patch.verifiedSaver !== undefined ? (patch.verifiedSaver ? 1 : 0) : existing.verified_saver;
    const nextVerifiedAt = patch.verifiedSaver ? now : existing.verified_at;

    conn
      .prepare(
        `UPDATE views_hub_contacts
         SET is_vip = ?, vip_expires_at = ?, vip_priority = ?, status = ?,
             verified_saver = ?, verified_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nextIsVip, nextExpires, nextPriority, nextStatus, nextVerified, nextVerifiedAt, now, id);

    const updated = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(id) as any;
    return updated ? this.mapContact(updated) : null;
  }

  public deleteContact(id: number): boolean {
    const conn = this.db();
    const res = conn.prepare('DELETE FROM views_hub_contacts WHERE id = ?').run(id);
    return Number(res.changes || 0) > 0;
  }

  // ─── Auto-Capture Views Groups (`!views-group on / drop / off`) ────────────

  public setViewsGroup(groupJid: string, enabled: boolean, groupName?: string): {
    groupJid: string;
    groupName: string;
    enabled: boolean;
    capturedCount: number;
  } {
    const conn = this.db();
    const jid = String(groupJid || '').trim();
    const now = Date.now();
    const existing = conn.prepare('SELECT * FROM views_hub_groups WHERE group_jid = ?').get(jid) as any;
    if (existing) {
      const nextName = (groupName || existing.group_name || '').trim().slice(0, 100);
      conn
        .prepare('UPDATE views_hub_groups SET enabled = ?, group_name = ?, updated_at = ? WHERE group_jid = ?')
        .run(enabled ? 1 : 0, nextName, now, jid);
      return {
        groupJid: jid,
        groupName: nextName,
        enabled,
        capturedCount: Number(existing.captured_count || 0),
      };
    }

    const cleanName = (groupName || '').trim().slice(0, 100);
    conn
      .prepare(
        `INSERT INTO views_hub_groups (group_jid, group_name, enabled, captured_count, last_vcf_drop_at, created_at, updated_at)
         VALUES (?, ?, ?, 0, NULL, ?, ?)`
      )
      .run(jid, cleanName, enabled ? 1 : 0, now, now);
    return {
      groupJid: jid,
      groupName: cleanName,
      enabled,
      capturedCount: 0,
    };
  }

  public isViewsGroupEnabled(groupJid: string): boolean {
    const conn = this.db();
    const row = conn.prepare('SELECT enabled FROM views_hub_groups WHERE group_jid = ?').get(groupJid) as { enabled?: number } | undefined;
    return Boolean(row?.enabled);
  }

  public getViewsGroup(groupJid: string): {
    groupJid: string;
    groupName: string;
    enabled: boolean;
    capturedCount: number;
    lastVcfDropAt: number | null;
  } | null {
    const conn = this.db();
    const row = conn.prepare('SELECT * FROM views_hub_groups WHERE group_jid = ?').get(groupJid) as any;
    if (!row) return null;
    return {
      groupJid: String(row.group_jid),
      groupName: String(row.group_name || ''),
      enabled: Boolean(row.enabled),
      capturedCount: Number(row.captured_count || 0),
      lastVcfDropAt: row.last_vcf_drop_at != null ? Number(row.last_vcf_drop_at) : null,
    };
  }

  public recordGroupVcfDrop(groupJid: string): void {
    const conn = this.db();
    const now = Date.now();
    conn
      .prepare('UPDATE views_hub_groups SET last_vcf_drop_at = ?, updated_at = ? WHERE group_jid = ?')
      .run(now, now, groupJid);
  }

  /**
   * Bulk-registers members from a WhatsApp Views Group (existing members on `!views-group on`
   * OR newly joined members on `group-participants.update`).
   * Strictly skips duplicates, invalid phones, and the bot's own number.
   * Tracks every batch that filled up so the caller can automatically drop the completed .vcf into the group!
   */
  public bulkRegisterFromGroup(
    groupJid: string,
    members: Array<{ phone: string; name?: string }>,
    excludePhones: string[] = []
  ): {
    added: number;
    skippedDuplicates: number;
    skippedInvalid: number;
    completedBatches: number[];
    currentBatch: number;
    currentBatchFreeCount: number;
    batchTarget: number;
  } {
    const conn = this.db();
    const excludeSet = new Set(excludePhones.map((p) => normalizeViewsPhone(p)).filter(Boolean));

    let added = 0;
    let skippedDuplicates = 0;
    let skippedInvalid = 0;
    const completedBatches: number[] = [];

    for (const m of members) {
      const phone = normalizeViewsPhone(m.phone);
      if (!phone || phone.length < 9 || phone.length > 15) {
        skippedInvalid++;
        continue;
      }
      if (excludeSet.has(phone)) {
        continue;
      }

      const city = phone.startsWith('251')
        ? 'Jigjiga'
        : phone.startsWith('254')
        ? 'Nairobi'
        : 'Hargeysa';
      const displayName = (m.name && m.name.trim().length >= 2 ? m.name.trim() : '') || `Xubin ${phone.slice(-4)}`;

      try {
        const res = this.joinContact({
          name: displayName,
          phone,
          city,
          category: 'personal',
        });
        added++;
        if (res.batchCompleted && !completedBatches.includes(res.contact.batchNumber)) {
          completedBatches.push(res.contact.batchNumber);
        }
      } catch (err: any) {
        if (err instanceof ViewsHubError && err.code === 'DUPLICATE_PHONE') {
          skippedDuplicates++;
        } else {
          skippedInvalid++;
        }
      }
    }

    if (added > 0) {
      conn
        .prepare('UPDATE views_hub_groups SET captured_count = captured_count + ?, updated_at = ? WHERE group_jid = ?')
        .run(added, Date.now(), groupJid);
    }

    const cfg = this.getConfig();
    return {
      added,
      skippedDuplicates,
      skippedInvalid,
      completedBatches,
      currentBatch: cfg.currentBatch,
      currentBatchFreeCount: this.getBatchFreeCount(cfg.currentBatch),
      batchTarget: cfg.batchTarget,
    };
  }

  public listAllContactsAdmin(): {
    config: ViewsHubConfig;
    stats: {
      totalContacts: number;
      activeVipCount: number;
      currentBatchFreeCount: number;
      currentBatchCount: number;
      batchTarget: number;
      canStartNextBatch: boolean;
      currentBatchUnlocked: boolean;
      downloadedMembersCount: number;
      verifiedSaversCount: number;
      totalDownloads: number;
    };
    contacts: ViewsHubContact[];
  } {
    const conn = this.db();
    const cfg = this.getConfig();
    const rows = conn
      .prepare('SELECT * FROM views_hub_contacts ORDER BY is_vip DESC, vip_priority ASC, created_at DESC LIMIT 1000')
      .all() as any[];

    const contacts = rows.map((r) => this.mapContact(r));
    const activeContacts = contacts.filter((c) => c.status === 'active');
    const activeVips = activeContacts.filter((c) => c.isVip);
    const currentBatchFreeCount = activeContacts.filter((c) => !c.isVip && c.batchNumber === cfg.currentBatch).length;
    const currentBatchCount = currentBatchFreeCount + activeVips.length;

    return {
      config: cfg,
      stats: {
        totalContacts: activeContacts.length,
        activeVipCount: activeVips.length,
        currentBatchFreeCount,
        currentBatchCount,
        batchTarget: cfg.batchTarget,
        canStartNextBatch: currentBatchFreeCount >= cfg.batchTarget,
        currentBatchUnlocked: this.isBatchDownloadUnlocked(cfg.currentBatch, cfg),
        downloadedMembersCount: activeContacts.filter((c) => c.hasDownloaded).length,
        verifiedSaversCount: activeContacts.filter((c) => c.verifiedSaver).length,
        totalDownloads: cfg.totalVcfDownloads,
      },
      contacts,
    };
  }

  public getPublicSummary(options?: { city?: string }) {
    const conn = this.db();
    const cfg = this.getConfig();
    const cityFilter = String(options?.city || '').trim();
    const now = Date.now();

    const allActiveRows = conn
      .prepare('SELECT * FROM views_hub_contacts WHERE status = ? ORDER BY is_vip DESC, vip_priority ASC, created_at DESC')
      .all('active') as any[];

    const allActive = allActiveRows.map((r) => this.mapContact(r));
    const vips = allActive.filter((c) => c.isVip);

    const currentBatchFreeCount = allActive.filter((c) => !c.isVip && c.batchNumber === cfg.currentBatch).length;
    const currentBatchTotalCount = currentBatchFreeCount + vips.length;
    const progressPct = Math.min(100, Math.round((currentBatchFreeCount / Math.max(1, cfg.batchTarget)) * 100));
    const currentBatchUnlocked = this.isBatchDownloadUnlocked(cfg.currentBatch, cfg);

    // Build batch list (completed batches + current batch) so users can download completed batches cleanly
    const batchNums = new Set<number>([cfg.currentBatch]);
    for (const c of allActive) {
      if (!c.isVip && c.batchNumber >= 1) batchNums.add(c.batchNumber);
    }
    const batches = Array.from(batchNums)
      .sort((a, b) => b - a)
      .map((num) => {
        const freeCount = allActive.filter((c) => !c.isVip && c.batchNumber === num).length;
        return {
          batchNumber: num,
          freeCount,
          totalWithVips: freeCount + vips.length,
          isFull: freeCount >= cfg.batchTarget || num < cfg.currentBatch,
          isUnlocked: this.isBatchDownloadUnlocked(num, cfg),
        };
      });

    const cityMap = new Map<string, number>();
    for (const c of allActive) {
      cityMap.set(c.city, (cityMap.get(c.city) || 0) + 1);
    }
    const cities = Array.from(cityMap.entries())
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count);

    const filteredMembers = cityFilter
      ? allActive.filter((c) => c.city.toLowerCase() === cityFilter.toLowerCase())
      : allActive;

    return {
      config: cfg,
      stats: {
        totalContacts: allActive.length,
        currentBatch: cfg.currentBatch,
        currentBatchFreeCount,
        currentBatchTotalCount,
        batchTarget: cfg.batchTarget,
        progressPct,
        downloadMode: cfg.downloadMode,
        currentBatchUnlocked,
        activeVipCount: vips.length,
        verifiedSaversCount: allActive.filter((c) => c.verifiedSaver).length,
        totalDownloads: cfg.totalVcfDownloads,
        cities,
        batches,
      },
      vips: vips.map((v) => ({
        id: v.id,
        displayName: v.displayName,
        phone: v.phone,
        city: v.city,
        category: v.category,
        tagline: v.tagline,
        avatarUrl: v.avatarUrl,
        vipPriority: v.vipPriority,
        daysLeft: v.vipExpiresAt ? Math.max(0, Math.ceil((v.vipExpiresAt - now) / DAY_MS)) : null,
      })),
      recentMembers: filteredMembers.slice(0, 36).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        maskedPhone: maskPhoneForPublic(m.phone),
        city: m.city,
        category: m.category,
        tagline: m.tagline,
        batchNumber: m.batchNumber,
        isVip: m.isVip,
        hasDownloaded: m.hasDownloaded,
        verifiedSaver: m.verifiedSaver,
        referralsCount: m.referralsCount,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Generates a standards-compliant vCard 3.0 (.vcf) file with stable UID per phone
   * so Android & iPhone NEVER create duplicate contacts when re-importing batches.
   */
  public generateVcf(options?: {
    scope?: 'current' | 'all' | 'vip' | 'single';
    contactId?: number;
    city?: string;
    batch?: number;
    excludePhone?: string;
    isAdminBypass?: boolean;
  }): { vcfText: string; filename: string; count: number; vipCount: number } {
    const conn = this.db();
    const cfg = this.getConfig();
    const scope = options?.scope || 'current';
    const cityFilter = String(options?.city || '').trim().toLowerCase();
    const downloaderPhone = normalizeViewsPhone(options?.excludePhone || '');

    // Enforce Batch Lock Mode for non-admin batch/all downloads (VIP & single VIP stay unlocked!)
    if (!options?.isAdminBypass && cfg.downloadMode === 'locked' && (scope === 'current' || scope === 'all')) {
      const targetBatch = options?.batch || cfg.currentBatch;
      if (!this.isBatchDownloadUnlocked(targetBatch, cfg)) {
        const countNow = this.getBatchFreeCount(targetBatch);
        throw new ViewsHubError(
          `🔒 Batch #${targetBatch} weli wuu xiran yahay (${countNow} / ${cfg.batchTarget} Qof). Markuu gaaro ${cfg.batchTarget} qof si toos ah ayuu u furmayaa — u dir asxaabtaada si degdeg loo furo!`,
          423,
          'BATCH_LOCKED'
        );
      }
    }

    let selected: ViewsHubContact[] = [];

    if (scope === 'single' && options?.contactId) {
      const row = conn
        .prepare('SELECT * FROM views_hub_contacts WHERE id = ? AND status = ?')
        .get(options.contactId, 'active') as any;
      if (row) selected = [this.mapContact(row)];
    } else {
      const rows = conn
        .prepare('SELECT * FROM views_hub_contacts WHERE status = ? ORDER BY is_vip DESC, vip_priority ASC, created_at DESC')
        .all('active') as any[];
      const allActive = rows.map((r) => this.mapContact(r));
      const activeVips = allActive.filter((c) => c.isVip);

      if (scope === 'vip') {
        selected = activeVips;
      } else {
        const targetBatch = options?.batch || cfg.currentBatch;
        let regular =
          scope === 'all'
            ? allActive.filter((c) => !c.isVip)
            : allActive.filter((c) => !c.isVip && c.batchNumber === targetBatch);

        if (cityFilter) {
          regular = regular.filter((c) => c.city.toLowerCase() === cityFilter);
        }

        // VIP Pinned contacts ALWAYS appear at the very top!
        selected = [...activeVips, ...regular];
      }
    }

    // Strictly deduplicate by normalized phone digits
    const dedup = (skipSelf: boolean): ViewsHubContact[] => {
      const seenPhones = new Set<string>();
      const out: ViewsHubContact[] = [];
      for (const c of selected) {
        const norm = normalizeViewsPhone(c.phone);
        if (!norm || seenPhones.has(norm)) continue;
        if (skipSelf && downloaderPhone && norm === downloaderPhone && scope !== 'single') continue;
        seenPhones.add(norm);
        out.push({ ...c, phone: norm });
      }
      return out;
    };

    let finalContacts = dedup(true);
    // Prevent 0-byte "Download failed" when only 1 contact exists in the pool so far
    if (finalContacts.length === 0 && selected.length > 0) {
      finalContacts = dedup(false);
    }

    if (finalContacts.length === 0) {
      throw new ViewsHubError(
        'Weli ma jiraan contacts ku jira qaybtan oo la soo dejiyo — fadlan u dir asxaabtaada ama dooro "Dhammaan Pool-ka".',
        404,
        'NO_CONTACTS'
      );
    }

    const prefix = cfg.contactPrefix || 'CV - ';
    const cards: string[] = [];
    let vipCount = 0;

    for (const c of finalContacts) {
      if (c.isVip) vipCount++;
      const labelName = c.isVip ? `VIP ${c.displayName}` : `${prefix}${c.displayName}`;
      const safeName = escapeVCardText(labelName);
      const noteParts = [c.city];
      if (c.tagline) noteParts.push(c.tagline);
      noteParts.push(c.isVip ? 'CARDOSO Views VIP' : `CARDOSO Views Batch #${c.batchNumber}`);
      const safeNote = escapeVCardText(noteParts.filter(Boolean).join(' - '));
      const org = c.isVip ? 'CARDOSO Views VIP' : 'CARDOSO Views Hub';

      // Stable UID per phone ensures Android & iOS merge/update instead of creating duplicate phonebook entries!
      cards.push(
        [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `UID:cardoso-views-${c.phone}`,
          `N:;${safeName};;;`,
          `FN:${safeName}`,
          `TEL;TYPE=CELL,VOICE:+${c.phone}`,
          `ORG:${escapeVCardText(org)}`,
          `NOTE:${safeNote}`,
          'END:VCARD',
        ].join('\r\n')
      );
    }

    const now = Date.now();
    conn
      .prepare(`UPDATE views_hub_config SET total_vcf_downloads = total_vcf_downloads + 1, updated_at = ? WHERE id = 'default'`)
      .run(now);

    if (scope === 'single' && finalContacts[0]) {
      conn
        .prepare('UPDATE views_hub_contacts SET downloads_count = downloads_count + 1 WHERE id = ?')
        .run(finalContacts[0].id);
    }

    // Track per-member download so Admin Studio shows who actually downloaded the .vcf!
    if (downloaderPhone) {
      conn
        .prepare(
          `UPDATE views_hub_contacts
           SET has_downloaded = 1, downloads_count = downloads_count + 1, last_downloaded_at = ?, updated_at = ?
           WHERE phone = ?`
        )
        .run(now, now, downloaderPhone);
    }

    const safeCitySlug = cityFilter ? `_${cityFilter.replace(/[^a-z0-9]/gi, '')}` : '';
    const filename =
      scope === 'single' && finalContacts[0]
        ? `CARDOSO_VIP_${finalContacts[0].displayName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)}.vcf`
        : scope === 'vip'
        ? 'CARDOSO_Views_VIP_Contacts.vcf'
        : scope === 'all'
        ? `CARDOSO_Views_All${safeCitySlug}.vcf`
        : `CARDOSO_Views_Batch_${options?.batch || cfg.currentBatch}${safeCitySlug}.vcf`;

    return {
      vcfText: cards.join('\r\n') + '\r\n',
      filename,
      count: finalContacts.length,
      vipCount,
    };
  }
}
