import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizePhoneNumber } from '../services/broadcast.service.js';
import { BotCategory, PLAN_CATALOG, PlanFeatures, PlanTier, resolveEffectiveFeatures } from './plan-catalog.js';

export type TenantStatus = 'pending' | 'active' | 'suspended' | 'expired' | 'rejected';

export interface TenantRecord {
  id: string;
  name: string;
  allowedPhone: string;
  category: BotCategory;
  planTier: PlanTier;
  status: TenantStatus;
  accessToken: string;
  monthsPurchased: number;
  trialUsed: boolean;
  startedAt: number | null;
  expiresAt: number | null;
  expiryNotified: boolean;
  featuresJson: string;
  effectiveFeatures: PlanFeatures;
  customGeminiKey: string;
  awayMode: boolean;
  extraAdmins: string[];
  signupNotes: string;
  promoCodeUsed: string;
  applicantChatId?: string;
  hasPin?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AdminUserRecord {
  id: string;
  username: string;
  displayName: string;
  phoneNumber: string;
  role: 'super_admin' | 'staff_admin';
  active: boolean;
  createdAt: number;
}

export interface PromoCodeRecord {
  code: string;
  planTier: PlanTier;
  durationDays: number;
  maxUses: number;
  usedCount: number;
  active: boolean;
  createdAt: number;
}

export interface SubscriptionEventRecord {
  id: number;
  tenantId: string;
  eventType: string;
  detail: string;
  createdAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeSubscriptionPhone(raw: string): string {
  return normalizePhoneNumber((raw || '').split('@')[0].split(':')[0]);
}

export class TenantRegistry {
  private db: DatabaseSync | null = null;
  private dbPath: string;

  constructor(dbPath: string = './data/tenants_registry.db') {
    this.dbPath = dbPath;
  }

  public initialize(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        allowed_phone TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'personal',
        plan_tier TEXT NOT NULL DEFAULT 'trial_free',
        status TEXT NOT NULL DEFAULT 'pending',
        access_token TEXT NOT NULL,
        months_purchased INTEGER DEFAULT 0,
        trial_used INTEGER DEFAULT 0,
        started_at INTEGER,
        expires_at INTEGER,
        expiry_notified INTEGER DEFAULT 0,
        features_json TEXT DEFAULT '{}',
        custom_gemini_key TEXT DEFAULT '',
        away_mode INTEGER DEFAULT 0,
        extra_admins TEXT DEFAULT '[]',
        signup_notes TEXT DEFAULT '',
        promo_code_used TEXT DEFAULT '',
        pin_salt TEXT DEFAULT '',
        pin_hash TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tenants_phone ON tenants(allowed_phone);
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        phone_number TEXT DEFAULT '',
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff_admin',
        active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        plan_tier TEXT NOT NULL DEFAULT 'trial_free',
        duration_days INTEGER NOT NULL DEFAULT 30,
        max_uses INTEGER NOT NULL DEFAULT 30,
        used_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subscription_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        detail TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      );
    `);

    try { this.db.exec("ALTER TABLE tenants ADD COLUMN pin_salt TEXT DEFAULT ''"); } catch {}
    try { this.db.exec("ALTER TABLE tenants ADD COLUMN pin_hash TEXT DEFAULT ''"); } catch {}
    try { this.db.exec("ALTER TABLE tenants ADD COLUMN applicant_chat_id TEXT DEFAULT ''"); } catch {}
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private ensureDb(): DatabaseSync {
    if (!this.db) throw new Error('TenantRegistry not initialized');
    return this.db;
  }

  private mapTenantRow(row: any): TenantRecord {
    const planTier = (row.plan_tier || 'trial_free') as PlanTier;
    const customGeminiKey = row.custom_gemini_key || '';
    const featuresJson = row.features_json || '{}';
    let extraAdmins: string[] = [];
    try {
      const parsed = JSON.parse(row.extra_admins || '[]');
      if (Array.isArray(parsed)) {
        extraAdmins = parsed.map((n: any) => normalizeSubscriptionPhone(String(n))).filter(Boolean);
      }
    } catch {}

    return {
      id: row.id,
      name: row.name,
      allowedPhone: row.allowed_phone,
      category: (row.category || 'personal') as BotCategory,
      planTier,
      status: (row.status || 'pending') as TenantStatus,
      accessToken: row.access_token,
      monthsPurchased: Number(row.months_purchased || 0),
      trialUsed: Boolean(row.trial_used),
      startedAt: row.started_at ?? null,
      expiresAt: row.expires_at ?? null,
      expiryNotified: Boolean(row.expiry_notified),
      featuresJson,
      effectiveFeatures: resolveEffectiveFeatures(planTier, featuresJson, Boolean(customGeminiKey.trim())),
      customGeminiKey,
      awayMode: Boolean(row.away_mode),
      extraAdmins,
      signupNotes: row.signup_notes || '',
      promoCodeUsed: row.promo_code_used || '',
      applicantChatId: row.applicant_chat_id || '',
      hasPin: Boolean(row.pin_hash),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public setTenantPin(id: string, rawPin: string): boolean {
    const db = this.ensureDb();
    const cleanPin = String(rawPin || '').trim();
    if (cleanPin.length < 4) {
      throw new Error('PIN-ka Dashboard-ku waa inuu ahaadaa ugu yaraan 4 xaraf ama lambar.');
    }
    const { salt, hash } = this.hashPassword(cleanPin);
    const res = db.prepare('UPDATE tenants SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?')
      .run(salt, hash, Date.now(), id) as any;
    return Boolean(res?.changes > 0);
  }

  public verifyTenantPin(rawPhone: string, rawPin: string): TenantRecord | null {
    const db = this.ensureDb();
    const cleanPhone = normalizeSubscriptionPhone(rawPhone || '');
    const cleanPin = String(rawPin || '').trim();
    if (!cleanPhone || !cleanPin) return null;
    const row = db.prepare(
      "SELECT * FROM tenants WHERE allowed_phone = ? AND id != 'owner' ORDER BY created_at DESC LIMIT 1"
    ).get(cleanPhone) as any;
    if (!row || !row.pin_salt || !row.pin_hash) return null;

    const { hash } = this.hashPassword(cleanPin, row.pin_salt);
    const a = Buffer.from(row.pin_hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    return this.mapTenantRow(row);
  }

  private logEvent(tenantId: string, eventType: string, detail: string): void {
    const db = this.ensureDb();
    db.prepare(
      'INSERT INTO subscription_events (tenant_id, event_type, detail, created_at) VALUES (?, ?, ?, ?)'
    ).run(tenantId, eventType, detail, Date.now());
  }

  public getEventLogs(tenantId?: string, limit: number = 50): SubscriptionEventRecord[] {
    const db = this.ensureDb();
    const rows = tenantId
      ? db.prepare('SELECT * FROM subscription_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, limit)
      : db.prepare('SELECT * FROM subscription_events ORDER BY created_at DESC LIMIT ?').all(limit);
    return (rows as any[]).map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      eventType: r.event_type,
      detail: r.detail,
      createdAt: r.created_at,
    }));
  }

  public ensureOwnerTenant(ownerPhone: string = ''): TenantRecord {
    const existing = this.getTenant('owner');
    if (existing) {
      return existing;
    }

    const db = this.ensureDb();
    const now = Date.now();
    const token = crypto.randomBytes(24).toString('hex');
    const cleanPhone = normalizeSubscriptionPhone(ownerPhone);

    db.prepare(`
      INSERT INTO tenants (
        id, name, allowed_phone, category, plan_tier, status, access_token,
        months_purchased, trial_used, started_at, expires_at, expiry_notified,
        features_json, created_at, updated_at
      ) VALUES ('owner', 'CARDOSO Owner', ?, 'personal', 'owner', 'active', ?, 999, 1, ?, NULL, 0, '{}', ?, ?)
    `).run(cleanPhone, token, now, now, now);

    return this.getTenant('owner')!;
  }

  public getTenant(id: string): TenantRecord | null {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as any;
    return row ? this.mapTenantRow(row) : null;
  }

  public getTenantByPhone(rawPhone: string): TenantRecord | null {
    const db = this.ensureDb();
    const clean = normalizeSubscriptionPhone(rawPhone);
    if (!clean) return null;
    const row = db.prepare(
      "SELECT * FROM tenants WHERE allowed_phone = ? AND id != 'owner' ORDER BY created_at DESC LIMIT 1"
    ).get(clean) as any;
    return row ? this.mapTenantRow(row) : null;
  }

  public getTenantByApplicantChatId(chatId: string): TenantRecord | null {
    const db = this.ensureDb();
    const clean = (chatId || '').trim();
    if (!clean) return null;
    const row = db.prepare(
      "SELECT * FROM tenants WHERE applicant_chat_id = ? AND id != 'owner' ORDER BY created_at DESC LIMIT 1"
    ).get(clean) as any;
    return row ? this.mapTenantRow(row) : null;
  }

  public getTenantByIdOrPhone(target: string): TenantRecord | null {
    const raw = (target || '').trim();
    if (!raw) return null;
    const byId = this.getTenant(raw);
    if (byId) return byId;
    return this.getTenantByPhone(raw);
  }

  public listTenants(includeOwner: boolean = true): TenantRecord[] {
    const db = this.ensureDb();
    const rows = includeOwner
      ? db.prepare("SELECT * FROM tenants ORDER BY CASE WHEN id = 'owner' THEN 0 ELSE 1 END, created_at DESC").all()
      : db.prepare("SELECT * FROM tenants WHERE id != 'owner' ORDER BY created_at DESC").all();
    return (rows as any[]).map(r => this.mapTenantRow(r));
  }

  public verifyClientToken(id: string, token: string): TenantRecord | null {
    if (!id || !token) return null;
    const t = this.getTenant(id);
    if (!t) return null;
    const a = Buffer.from(t.accessToken, 'utf8');
    const b = Buffer.from(token.trim(), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    return t;
  }

  public isTenantActive(tenantOrId: string | TenantRecord): boolean {
    const t = typeof tenantOrId === 'string' ? this.getTenant(tenantOrId) : tenantOrId;
    if (!t) return false;
    if (t.status !== 'active') return false;
    if (t.planTier === 'owner' || t.expiresAt === null) return true;
    return t.expiresAt > Date.now();
  }

  public hasPhoneUsedFreeTrial(rawPhone: string): boolean {
    const db = this.ensureDb();
    const clean = normalizeSubscriptionPhone(rawPhone);
    if (!clean) return false;
    const row = db.prepare(
      'SELECT COUNT(*) as n FROM tenants WHERE allowed_phone = ? AND trial_used = 1'
    ).get(clean) as any;
    return Number(row?.n || 0) > 0;
  }

  /**
   * Public /join self-registration. Creates a 'pending' request by default awaiting
   * Super Admin approval after payment/verification, unless a valid Promo Code
   * with open seats is provided AND this phone number has not previously used a trial.
   */
  public registerSelfSignup(input: {
    name: string;
    phone: string;
    category: BotCategory;
    promoCode?: string;
    notes?: string;
    pin?: string;
    applicantChatId?: string;
  }): {
    success: boolean;
    message: string;
    tenant?: TenantRecord;
    autoActivated?: boolean;
    alreadyPending?: boolean;
  } {
    const db = this.ensureDb();
    const cleanName = (input.name || '').trim();
    const cleanPhone = normalizeSubscriptionPhone(input.phone || '');
    const cleanApplicantChatId = (input.applicantChatId || '').trim();
    const category: BotCategory = ['personal', 'business', 'education'].includes(input.category)
      ? input.category
      : 'personal';

    if (cleanName.length < 2) {
      return { success: false, message: 'Fadlan geli magacaaga ama magaca ganacsigaaga.' };
    }
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
      return { success: false, message: 'Fadlan geli lambar WhatsApp oo sax ah (tusaale 0634123456).' };
    }

    const existing = this.getTenantByPhone(cleanPhone);
    if (existing) {
      if (existing.status === 'pending') {
        if (cleanApplicantChatId && !existing.applicantChatId) {
          db.prepare('UPDATE tenants SET applicant_chat_id = ?, updated_at = ? WHERE id = ?')
            .run(cleanApplicantChatId, Date.now(), existing.id);
        }
        return {
          success: true,
          alreadyPending: true,
          autoActivated: false,
          tenant: this.getTenant(existing.id)!,
          message: 'Codsigaagii hore weli wuu ku jiraa liiska sugitaanka.',
        };
      }
      if (existing.status === 'active' && this.isTenantActive(existing)) {
        return {
          success: false,
          message: 'Lambarkan horay ayuu bot firfircoon ugu leeyahay. Fadlan la xidhiidh maamulka link-gaaga.',
        };
      }
    }

    const trialAlreadyUsed = this.hasPhoneUsedFreeTrial(cleanPhone);
    const rawPromo = (input.promoCode || '').trim().toUpperCase();
    let autoActivateDays = 0;
    let appliedPromo = '';

    if (rawPromo) {
      const promo = this.getPromoCode(rawPromo);
      if (!promo || !promo.active || promo.usedCount >= promo.maxUses) {
        return { success: false, message: 'Promo code-kan ma shaqeynayo ama kuraastiisii way dhammaadeen.' };
      }
      if (trialAlreadyUsed) {
        return {
          success: false,
          message: 'Lambarkan horay ayuu u qaatay tijaabadii bilaashka ahayd. Fadlan u soo dir codsi caadi ah si aad u bixiso kirada bisha.',
        };
      }
      autoActivateDays = promo.durationDays;
      appliedPromo = promo.code;
    }

    const now = Date.now();
    const id = `t_${crypto.randomBytes(5).toString('hex')}`;
    const accessToken = crypto.randomBytes(24).toString('hex');
    const isAutoActive = autoActivateDays > 0;
    const status: TenantStatus = isAutoActive ? 'active' : 'pending';
    const startedAt = isAutoActive ? now : null;
    const expiresAt = isAutoActive ? now + autoActivateDays * DAY_MS : null;

    db.prepare(`
      INSERT INTO tenants (
        id, name, allowed_phone, category, plan_tier, status, access_token,
        months_purchased, trial_used, started_at, expires_at, expiry_notified,
        features_json, signup_notes, promo_code_used, applicant_chat_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'trial_free', ?, ?, 0, ?, ?, ?, 0, '{}', ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanName,
      cleanPhone,
      category,
      status,
      accessToken,
      isAutoActive ? 1 : 0,
      startedAt,
      expiresAt,
      (input.notes || '').trim().slice(0, 1200),
      appliedPromo,
      cleanApplicantChatId,
      now,
      now
    );

    if (appliedPromo) {
      db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(appliedPromo);
    }

    if (input.pin && input.pin.trim().length > 0) {
      if (input.pin.trim().length < 4) {
        db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
        return { success: false, message: 'PIN-ka Dashboard-ku waa inuu ahaadaa ugu yaraan 4 xaraf ama lambar.' };
      }
      this.setTenantPin(id, input.pin.trim());
    }

    this.logEvent(
      id,
      isAutoActive ? 'promo_auto_activated' : 'self_signup_pending',
      isAutoActive
        ? `Activated via promo ${appliedPromo} for ${autoActivateDays} days (${cleanPhone})`
        : `Self-signup submitted by ${cleanName} (${cleanPhone}, ${category})`
    );

    return {
      success: true,
      autoActivated: isAutoActive,
      tenant: this.getTenant(id)!,
      message: isAutoActive
        ? 'Hambalyo! Akoonkaaga waa la furay, hadda waad ku xidhan kartaa WhatsApp-ka.'
        : 'Codsigaagu si guul leh ayuu u gaadhay maamulka! Markii la aqbalo, isla link-gan ayaad ka arkaysaa Pairing Code-ka.',
    };
  }

  /**
   * Direct Super Admin client creation (starts 'active' immediately).
   */
  public createActiveTenant(input: {
    name: string;
    phone: string;
    category: BotCategory;
    planTier: PlanTier;
    months?: number;
    durationDays?: number;
    dailyAiOverride?: number;
    customGeminiKey?: string;
    notes?: string;
    pin?: string;
  }): TenantRecord {
    const db = this.ensureDb();
    const cleanName = input.name.trim();
    const cleanPhone = normalizeSubscriptionPhone(input.phone);
    if (!cleanName || cleanPhone.length < 8) {
      throw new Error('Magaca iyo lambarka WhatsApp ee saxda ah waa waajib.');
    }

    const now = Date.now();
    const id = `t_${crypto.randomBytes(5).toString('hex')}`;
    const accessToken = crypto.randomBytes(24).toString('hex');
    const months = Math.max(0, Number(input.months ?? (input.durationDays ? 0 : 1)));
    const days = input.durationDays ?? (months > 0 ? months * 30 : PLAN_CATALOG[input.planTier].defaultDays);
    const expiresAt = input.planTier === 'owner' ? null : now + days * DAY_MS;
    const featuresObj: Partial<PlanFeatures> = {};
    if (input.dailyAiOverride && input.dailyAiOverride > 0) {
      featuresObj.maxDailyAiCalls = input.dailyAiOverride;
    }

    db.prepare(`
      INSERT INTO tenants (
        id, name, allowed_phone, category, plan_tier, status, access_token,
        months_purchased, trial_used, started_at, expires_at, expiry_notified,
        features_json, custom_gemini_key, signup_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanName,
      cleanPhone,
      input.category,
      input.planTier,
      accessToken,
      months,
      input.planTier === 'trial_free' ? 1 : 0,
      now,
      expiresAt,
      JSON.stringify(featuresObj),
      (input.customGeminiKey || '').trim(),
      (input.notes || '').trim(),
      now,
      now
    );

    if (input.pin && input.pin.trim().length >= 4) {
      this.setTenantPin(id, input.pin.trim());
    }

    this.logEvent(id, 'admin_created', `Created by admin: ${input.planTier} (${days} days, ${cleanPhone})`);
    return this.getTenant(id)!;
  }

  public approveTenant(
    id: string,
    opts: { planTier: PlanTier; months?: number; durationDays?: number }
  ): TenantRecord | null {
    const tenant = this.getTenant(id);
    if (!tenant) return null;
    const db = this.ensureDb();
    const now = Date.now();
    const months = Math.max(0, Number(opts.months ?? (opts.durationDays ? 0 : 1)));
    const days = opts.durationDays ?? (months > 0 ? months * 30 : PLAN_CATALOG[opts.planTier].defaultDays);
    const expiresAt = opts.planTier === 'owner' ? null : now + days * DAY_MS;

    db.prepare(`
      UPDATE tenants
      SET status = 'active',
          plan_tier = ?,
          months_purchased = months_purchased + ?,
          trial_used = CASE WHEN ? = 'trial_free' THEN 1 ELSE trial_used END,
          started_at = COALESCE(started_at, ?),
          expires_at = ?,
          expiry_notified = 0,
          updated_at = ?
      WHERE id = ?
    `).run(opts.planTier, months, opts.planTier, now, expiresAt, now, id);

    this.logEvent(id, 'approved', `Approved as ${opts.planTier} for ${days} days`);
    return this.getTenant(id);
  }

  public renewSubscription(
    id: string,
    months: number = 1,
    newPlanTier?: PlanTier,
    durationDays?: number
  ): TenantRecord | null {
    const tenant = this.getTenant(id);
    if (!tenant) return null;
    const db = this.ensureDb();
    const now = Date.now();
    const tier = newPlanTier || (tenant.planTier === 'trial_free' ? (tenant.category === 'business' ? 'business' : tenant.category === 'education' ? 'education' : 'starter') : tenant.planTier);
    const daysToAdd = durationDays ?? Math.max(1, months) * 30;
    const baseTime = tenant.expiresAt && tenant.expiresAt > now ? tenant.expiresAt : now;
    const newExpiresAt = tier === 'owner' ? null : baseTime + daysToAdd * DAY_MS;

    db.prepare(`
      UPDATE tenants
      SET status = 'active',
          plan_tier = ?,
          months_purchased = months_purchased + ?,
          started_at = COALESCE(started_at, ?),
          expires_at = ?,
          expiry_notified = 0,
          updated_at = ?
      WHERE id = ?
    `).run(tier, Math.max(0, months), now, newExpiresAt, now, id);

    this.logEvent(id, 'renewed', `Renewed ${tier} (+${daysToAdd} days)`);
    return this.getTenant(id);
  }

  public suspendTenant(id: string, reason: string = 'Suspended by admin'): TenantRecord | null {
    const db = this.ensureDb();
    if (!this.getTenant(id) || id === 'owner') return null;
    const now = Date.now();
    db.prepare("UPDATE tenants SET status = 'suspended', updated_at = ? WHERE id = ?").run(now, id);
    this.logEvent(id, 'suspended', reason);
    return this.getTenant(id);
  }

  public rejectTenant(id: string): TenantRecord | null {
    const db = this.ensureDb();
    if (!this.getTenant(id) || id === 'owner') return null;
    const now = Date.now();
    db.prepare("UPDATE tenants SET status = 'rejected', updated_at = ? WHERE id = ?").run(now, id);
    this.logEvent(id, 'rejected', 'Signup request rejected by admin');
    return this.getTenant(id);
  }

  public activateTenant(id: string): TenantRecord | null {
    const tenant = this.getTenant(id);
    if (!tenant) return null;
    const db = this.ensureDb();
    const now = Date.now();
    const needsExtension = tenant.planTier !== 'owner' && (!tenant.expiresAt || tenant.expiresAt <= now);
    const nextExpiry = needsExtension ? now + 30 * DAY_MS : tenant.expiresAt;
    db.prepare("UPDATE tenants SET status = 'active', expires_at = ?, updated_at = ? WHERE id = ?")
      .run(nextExpiry, now, id);
    this.logEvent(id, 'activated', needsExtension ? 'Activated with default 30d window' : 'Re-activated');
    return this.getTenant(id);
  }

  public updateTenantSettings(
    id: string,
    updates: {
      name?: string;
      allowedPhone?: string;
      category?: BotCategory;
      planTier?: PlanTier;
      features?: Partial<PlanFeatures>;
      customGeminiKey?: string;
      awayMode?: boolean;
      extraAdmins?: string[];
    }
  ): TenantRecord | null {
    const current = this.getTenant(id);
    if (!current) return null;
    const db = this.ensureDb();
    const now = Date.now();

    const nextName = updates.name?.trim() || current.name;
    const nextPhone = updates.allowedPhone !== undefined ? normalizeSubscriptionPhone(updates.allowedPhone) : current.allowedPhone;
    const nextCategory = updates.category || current.category;
    const nextTier = updates.planTier || current.planTier;
    let nextFeaturesJson = current.featuresJson;
    if (updates.features) {
      let existingObj: Record<string, any> = {};
      try { existingObj = JSON.parse(current.featuresJson || '{}'); } catch {}
      nextFeaturesJson = JSON.stringify({ ...existingObj, ...updates.features });
    }
    const nextKey = updates.customGeminiKey !== undefined ? updates.customGeminiKey.trim() : current.customGeminiKey;
    const nextAway = updates.awayMode !== undefined ? (updates.awayMode ? 1 : 0) : (current.awayMode ? 1 : 0);
    const nextExtraAdmins = updates.extraAdmins !== undefined
      ? JSON.stringify(updates.extraAdmins.map(normalizeSubscriptionPhone).filter(Boolean))
      : JSON.stringify(current.extraAdmins);

    db.prepare(`
      UPDATE tenants
      SET name = ?, allowed_phone = ?, category = ?, plan_tier = ?,
          features_json = ?, custom_gemini_key = ?, away_mode = ?, extra_admins = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, nextPhone, nextCategory, nextTier, nextFeaturesJson, nextKey, nextAway, nextExtraAdmins, now, id);

    return this.getTenant(id);
  }

  public markExpiredTenants(now: number = Date.now()): TenantRecord[] {
    const db = this.ensureDb();
    const dueRows = db.prepare(`
      SELECT * FROM tenants
      WHERE id != 'owner' AND status = 'active' AND plan_tier != 'owner'
        AND expires_at IS NOT NULL AND expires_at <= ?
    `).all(now) as any[];

    if (dueRows.length === 0) return [];

    const expired: TenantRecord[] = [];
    for (const row of dueRows) {
      db.prepare("UPDATE tenants SET status = 'expired', expiry_notified = 1, updated_at = ? WHERE id = ?")
        .run(now, row.id);
      this.logEvent(row.id, 'expired', 'Subscription period ended automatically');
      const updated = this.getTenant(row.id);
      if (updated) expired.push(updated);
    }
    return expired;
  }

  public getExpiringSoon(withinDays: number = 3): TenantRecord[] {
    const db = this.ensureDb();
    const now = Date.now();
    const cutoff = now + withinDays * DAY_MS;
    const rows = db.prepare(`
      SELECT * FROM tenants
      WHERE id != 'owner' AND status = 'active' AND plan_tier != 'owner'
        AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?
      ORDER BY expires_at ASC
    `).all(now, cutoff) as any[];
    return rows.map(r => this.mapTenantRow(r));
  }

  public deleteTenant(id: string): boolean {
    if (!id || id === 'owner') return false;
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM tenants WHERE id = ?').run(id) as any;
    return Boolean(res?.changes > 0);
  }

  // ─── Multi-Admin User Management ────────────────────────────────────────────
  private hashPassword(password: string, salt?: string): { salt: string; hash: string } {
    const usedSalt = salt || crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, usedSalt, 64).toString('hex');
    return { salt: usedSalt, hash: derived };
  }

  public createAdminUser(input: {
    username: string;
    password: string;
    displayName: string;
    phoneNumber?: string;
    role?: 'super_admin' | 'staff_admin';
  }): AdminUserRecord {
    const db = this.ensureDb();
    const cleanUser = input.username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    if (cleanUser.length < 3) throw new Error('Username waa inuu ahaadaa ugu yaraan 3 xaraf.');
    if (!input.password || input.password.length < 4) throw new Error('Password waa inuu ahaadaa ugu yaraan 4 xaraf.');

    const id = `adm_${crypto.randomBytes(4).toString('hex')}`;
    const { salt, hash } = this.hashPassword(input.password);
    const cleanPhone = normalizeSubscriptionPhone(input.phoneNumber || '');
    const now = Date.now();
    const role = input.role === 'super_admin' ? 'super_admin' : 'staff_admin';

    db.prepare(`
      INSERT INTO admin_users (id, username, display_name, phone_number, password_salt, password_hash, role, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, cleanUser, (input.displayName || cleanUser).trim(), cleanPhone, salt, hash, role, now);

    return {
      id,
      username: cleanUser,
      displayName: (input.displayName || cleanUser).trim(),
      phoneNumber: cleanPhone,
      role,
      active: true,
      createdAt: now,
    };
  }

  public verifyAdminUser(username: string, password: string): AdminUserRecord | null {
    const db = this.ensureDb();
    const cleanUser = (username || '').trim().toLowerCase();
    if (!cleanUser || !password) return null;
    const row = db.prepare('SELECT * FROM admin_users WHERE username = ? AND active = 1').get(cleanUser) as any;
    if (!row) return null;

    const { hash } = this.hashPassword(password, row.password_salt);
    const a = Buffer.from(row.password_hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      phoneNumber: row.phone_number || '',
      role: row.role,
      active: Boolean(row.active),
      createdAt: row.created_at,
    };
  }

  public listAdminUsers(): AdminUserRecord[] {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM admin_users ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      phoneNumber: r.phone_number || '',
      role: r.role,
      active: Boolean(r.active),
      createdAt: r.created_at,
    }));
  }

  public toggleAdminUser(id: string, active: boolean): boolean {
    const db = this.ensureDb();
    const res = db.prepare('UPDATE admin_users SET active = ? WHERE id = ?').run(active ? 1 : 0, id) as any;
    return Boolean(res?.changes > 0);
  }

  public deleteAdminUser(id: string): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM admin_users WHERE id = ?').run(id) as any;
    return Boolean(res?.changes > 0);
  }

  public getAllActiveAdminPhones(envPhones: string[] = []): string[] {
    const db = this.ensureDb();
    const set = new Set<string>();
    for (const p of envPhones) {
      const clean = normalizeSubscriptionPhone(p);
      if (clean) set.add(clean);
    }
    const rows = db.prepare("SELECT phone_number FROM admin_users WHERE active = 1 AND phone_number != ''").all() as any[];
    for (const r of rows) {
      const clean = normalizeSubscriptionPhone(r.phone_number);
      if (clean) set.add(clean);
    }
    return Array.from(set);
  }

  // ─── Promo Codes ────────────────────────────────────────────────────────────
  public createPromoCode(input: {
    code: string;
    planTier?: PlanTier;
    durationDays?: number;
    maxUses?: number;
  }): PromoCodeRecord {
    const db = this.ensureDb();
    const cleanCode = input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (cleanCode.length < 3) throw new Error('Promo code waa inuu ahaadaa ugu yaraan 3 xaraf.');
    const now = Date.now();
    const planTier = input.planTier || 'trial_free';
    const durationDays = Math.max(1, Number(input.durationDays || 30));
    const maxUses = Math.max(1, Number(input.maxUses || 30));

    db.prepare(`
      INSERT INTO promo_codes (code, plan_tier, duration_days, max_uses, used_count, active, created_at)
      VALUES (?, ?, ?, ?, 0, 1, ?)
      ON CONFLICT(code) DO UPDATE SET plan_tier = excluded.plan_tier, duration_days = excluded.duration_days, max_uses = excluded.max_uses, active = 1
    `).run(cleanCode, planTier, durationDays, maxUses, now);

    return this.getPromoCode(cleanCode)!;
  }

  public getPromoCode(code: string): PromoCodeRecord | null {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code.trim().toUpperCase()) as any;
    if (!row) return null;
    return {
      code: row.code,
      planTier: row.plan_tier as PlanTier,
      durationDays: Number(row.duration_days),
      maxUses: Number(row.max_uses),
      usedCount: Number(row.used_count),
      active: Boolean(row.active),
      createdAt: Number(row.created_at),
    };
  }

  public listPromoCodes(): PromoCodeRecord[] {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      code: r.code,
      planTier: r.plan_tier as PlanTier,
      durationDays: Number(r.duration_days),
      maxUses: Number(r.max_uses),
      usedCount: Number(r.used_count),
      active: Boolean(r.active),
      createdAt: Number(r.created_at),
    }));
  }

  public togglePromoCode(code: string, active: boolean): boolean {
    const db = this.ensureDb();
    const res = db.prepare('UPDATE promo_codes SET active = ? WHERE code = ?').run(active ? 1 : 0, code.trim().toUpperCase()) as any;
    return Boolean(res?.changes > 0);
  }
}

