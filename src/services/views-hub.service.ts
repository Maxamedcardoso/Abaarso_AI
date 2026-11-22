import { DatabaseSync } from 'node:sqlite';
import { normalizePhoneNumber } from './broadcast.service.js';

export type ViewsCategory = 'personal' | 'business' | 'student' | 'creator';

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
  ownerVipPhone: string;
  vipPriceLabel: string;
  announcement: string;
  totalVcfDownloads: number;
  updatedAt: number;
}

export interface JoinViewsInput {
  name: string;
  phone: string;
  city?: string;
  category?: string;
  tagline?: string;
  referredBy?: string;
}

export interface UpsertVipInput {
  name: string;
  phone: string;
  city?: string;
  category?: string;
  tagline?: string;
  avatarUrl?: string;
  durationDays?: number; // 0 or undefined -> unlimited
  vipPriority?: number;
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

export function normalizeViewsPhone(raw: string): string {
  const cleaned = String(raw || '').split('@')[0].split(':')[0].trim();
  return normalizePhoneNumber(cleaned).replace(/\D/g, '');
}

/**
 * ViewsHubService — Zero-Ban WhatsApp Status Views & 1-Click .vcf Contact Exchange Hub
 *
 * Stores contacts, VIP Pinned sponsors, batch progression, and download metrics directly
 * inside the Owner SQLite database so CloudStateSync (Neon Postgres) preserves all data
 * automatically across Render restarts/deployments.
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
      throw new Error('ViewsHub database is not initialized');
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
        owner_vip_phone TEXT DEFAULT '',
        vip_price_label TEXT DEFAULT '$5 / Bil',
        announcement TEXT DEFAULT '',
        total_vcf_downloads INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);

    const existingCfg = conn
      .prepare('SELECT id FROM views_hub_config WHERE id = ?')
      .get('default') as { id?: string } | undefined;

    if (!existingCfg) {
      conn
        .prepare(
          `INSERT INTO views_hub_config (id, hub_title, contact_prefix, current_batch, batch_target, owner_vip_phone, vip_price_label, announcement, total_vcf_downloads, updated_at)
           VALUES ('default', 'CARDOSO Views Hub', 'CV - ', 1, 100, ?, '$5 / Bil', '', 0, ?)`
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
      referralsCount: Number(row.referrals_count || 0),
      referredBy: String(row.referred_by || ''),
      status: row.status === 'banned' ? 'banned' : 'active',
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
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
      batchTarget: Math.max(10, Number(row.batch_target || 100)),
      ownerVipPhone: String(row.owner_vip_phone || this.defaultOwnerPhone || ''),
      vipPriceLabel: String(row.vip_price_label || '$5 / Bil'),
      announcement: String(row.announcement || ''),
      totalVcfDownloads: Number(row.total_vcf_downloads || 0),
      updatedAt: Number(row.updated_at || Date.now()),
    };
  }

  public updateConfig(partial: Partial<Omit<ViewsHubConfig, 'totalVcfDownloads' | 'updatedAt'>>): ViewsHubConfig {
    const conn = this.db();
    const current = this.getConfig();
    const next: ViewsHubConfig = {
      hubTitle: (partial.hubTitle ?? current.hubTitle).trim().slice(0, 80) || 'CARDOSO Views Hub',
      contactPrefix: String(partial.contactPrefix ?? current.contactPrefix).slice(0, 16),
      currentBatch: Math.max(1, Number(partial.currentBatch ?? current.currentBatch) || 1),
      batchTarget: Math.max(10, Math.min(2000, Number(partial.batchTarget ?? current.batchTarget) || 100)),
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
             owner_vip_phone = ?, vip_price_label = ?, announcement = ?, updated_at = ?
         WHERE id = 'default'`
      )
      .run(
        next.hubTitle,
        next.contactPrefix,
        next.currentBatch,
        next.batchTarget,
        next.ownerVipPhone,
        next.vipPriceLabel,
        next.announcement,
        next.updatedAt
      );

    return next;
  }

  public startNewBatch(): ViewsHubConfig {
    const cfg = this.getConfig();
    return this.updateConfig({ currentBatch: cfg.currentBatch + 1 });
  }

  public joinContact(input: JoinViewsInput): {
    alreadyJoined: boolean;
    contact: ViewsHubContact;
    batchRolledOver: boolean;
  } {
    const conn = this.db();
    const displayName = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const phone = normalizeViewsPhone(input.phone);
    if (!displayName || displayName.length < 2) {
      throw new Error('Fadlan geli magacaaga oo sax ah (ugu yaraan 2 xaraf).');
    }
    if (!phone || phone.length < 9 || phone.length > 15) {
      throw new Error('Fadlan geli lambar WhatsApp sax ah (tusaale: 0634xxxxxx ama 25261xxxxxxx).');
    }

    const city = String(input.city || 'Hargeysa').trim().slice(0, 40) || 'Hargeysa';
    const category = sanitizeCategory(input.category);
    const tagline = String(input.tagline || '').trim().slice(0, 120);
    const refPhone = normalizeViewsPhone(input.referredBy || '');
    const now = Date.now();

    const existing = conn.prepare('SELECT * FROM views_hub_contacts WHERE phone = ?').get(phone) as any;
    if (existing) {
      if (existing.status === 'banned') {
        throw new Error('Lambarkan waa laga mamnuucay Hub-ka.');
      }
      conn
        .prepare(
          `UPDATE views_hub_contacts
           SET display_name = ?, city = ?, category = ?,
               tagline = CASE WHEN ? <> '' THEN ? ELSE tagline END,
               updated_at = ?
           WHERE id = ?`
        )
        .run(displayName, city, category, tagline, tagline, now, existing.id);
      const updated = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(existing.id) as any;
      return {
        alreadyJoined: true,
        contact: this.mapContact(updated),
        batchRolledOver: false,
      };
    }

    const cfg = this.getConfig();
    let assignedBatch = cfg.currentBatch;
    let batchRolledOver = false;

    const currentCountRow = conn
      .prepare('SELECT COUNT(*) as cnt FROM views_hub_contacts WHERE status = ? AND batch_number = ? AND is_vip = 0')
      .get('active', assignedBatch) as { cnt?: number };

    if ((currentCountRow?.cnt || 0) >= cfg.batchTarget) {
      assignedBatch = cfg.currentBatch + 1;
      this.updateConfig({ currentBatch: assignedBatch });
      batchRolledOver = true;
    }

    const validRef = refPhone && refPhone !== phone ? refPhone : '';
    const insertRes = conn
      .prepare(
        `INSERT INTO views_hub_contacts
         (phone, display_name, city, category, tagline, avatar_url, batch_number, is_vip, vip_priority, vip_expires_at, downloads_count, referrals_count, referred_by, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, 0, 100, NULL, 0, 0, ?, 'active', ?, ?)`
      )
      .run(phone, displayName, city, category, tagline, assignedBatch, validRef, now, now);

    if (validRef) {
      conn
        .prepare('UPDATE views_hub_contacts SET referrals_count = referrals_count + 1, updated_at = ? WHERE phone = ?')
        .run(now, validRef);
    }

    const inserted = conn
      .prepare('SELECT * FROM views_hub_contacts WHERE id = ?')
      .get(Number(insertRes.lastInsertRowid)) as any;

    return {
      alreadyJoined: false,
      contact: this.mapContact(inserted),
      batchRolledOver,
    };
  }

  public upsertVipContact(input: UpsertVipInput): ViewsHubContact {
    const conn = this.db();
    const displayName = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const phone = normalizeViewsPhone(input.phone);
    if (!displayName || displayName.length < 2) {
      throw new Error('Magaca VIP-ga waa waajib.');
    }
    if (!phone || phone.length < 9 || phone.length > 15) {
      throw new Error('Lambarka WhatsApp ee VIP-gu ma saxna.');
    }

    const city = String(input.city || 'Hargeysa').trim().slice(0, 40) || 'Hargeysa';
    const category = sanitizeCategory(input.category || 'business');
    const tagline = String(input.tagline || '').trim().slice(0, 140);
    const avatarUrl = String(input.avatarUrl || '').trim();
    if (avatarUrl && avatarUrl.length > 250_000) {
      throw new Error('Sawirka VIP-gu aad buu u weyn yahay — fadlan mid ka yar soo geli.');
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
         (phone, display_name, city, category, tagline, avatar_url, batch_number, is_vip, vip_priority, vip_expires_at, downloads_count, referrals_count, referred_by, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 0, '', 'active', ?, ?)`
      )
      .run(phone, displayName, city, category, tagline, avatarUrl, cfg.currentBatch, vipPriority, vipExpiresAt, now, now);

    const inserted = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(Number(res.lastInsertRowid)) as any;
    return this.mapContact(inserted);
  }

  public updateContactAdmin(
    id: number,
    patch: { isVip?: boolean; durationDays?: number; vipPriority?: number; status?: 'active' | 'banned' }
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

    conn
      .prepare(
        `UPDATE views_hub_contacts
         SET is_vip = ?, vip_expires_at = ?, vip_priority = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nextIsVip, nextExpires, nextPriority, nextStatus, now, id);

    const updated = conn.prepare('SELECT * FROM views_hub_contacts WHERE id = ?').get(id) as any;
    return updated ? this.mapContact(updated) : null;
  }

  public deleteContact(id: number): boolean {
    const conn = this.db();
    const res = conn.prepare('DELETE FROM views_hub_contacts WHERE id = ?').run(id);
    return Number(res.changes || 0) > 0;
  }

  public listAllContactsAdmin(): {
    config: ViewsHubConfig;
    stats: {
      totalContacts: number;
      activeVipCount: number;
      currentBatchCount: number;
      batchTarget: number;
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
    const currentBatchCount = activeContacts.filter((c) => c.batchNumber === cfg.currentBatch || c.isVip).length;

    return {
      config: cfg,
      stats: {
        totalContacts: activeContacts.length,
        activeVipCount: activeVips.length,
        currentBatchCount,
        batchTarget: cfg.batchTarget,
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
        activeVipCount: vips.length,
        totalDownloads: cfg.totalVcfDownloads,
        cities,
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
        referralsCount: m.referralsCount,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Generates a standards-compliant vCard 3.0 (.vcf) file with CRLF endings compatible
   * with Android, Samsung, Xiaomi, and Apple iOS Contacts.
   * VIP Pinned sponsors are ALWAYS placed at the very top of every batch file.
   */
  public generateVcf(options?: {
    scope?: 'current' | 'all' | 'vip' | 'single';
    contactId?: number;
    city?: string;
    batch?: number;
    excludePhone?: string;
  }): { vcfText: string; filename: string; count: number; vipCount: number } {
    const conn = this.db();
    const cfg = this.getConfig();
    const scope = options?.scope || 'current';
    const cityFilter = String(options?.city || '').trim().toLowerCase();
    const excludePhone = normalizeViewsPhone(options?.excludePhone || '');

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

        // VIP Pinned contacts ALWAYS go at the top of the file!
        selected = [...activeVips, ...regular];
      }
    }

    // Deduplicate by phone & optionally skip downloader's own phone
    const seenPhones = new Set<string>();
    const finalContacts: ViewsHubContact[] = [];
    for (const c of selected) {
      if (!c.phone || seenPhones.has(c.phone)) continue;
      if (excludePhone && c.phone === excludePhone && scope !== 'single') continue;
      seenPhones.add(c.phone);
      finalContacts.push(c);
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

      cards.push(
        [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `N:;${safeName};;;`,
          `FN:${safeName}`,
          `TEL;TYPE=CELL,VOICE:+${c.phone}`,
          `ORG:${escapeVCardText(org)}`,
          `NOTE:${safeNote}`,
          'END:VCARD',
        ].join('\r\n')
      );
    }

    // Increment aggregate download counter + per-contact metric
    if (finalContacts.length > 0) {
      conn
        .prepare(`UPDATE views_hub_config SET total_vcf_downloads = total_vcf_downloads + 1, updated_at = ? WHERE id = 'default'`)
        .run(Date.now());
      if (scope === 'single' && finalContacts[0]) {
        conn
          .prepare('UPDATE views_hub_contacts SET downloads_count = downloads_count + 1 WHERE id = ?')
          .run(finalContacts[0].id);
      }
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
      vcfText: cards.join('\r\n') + (cards.length ? '\r\n' : ''),
      filename,
      count: finalContacts.length,
      vipCount,
    };
  }
}
