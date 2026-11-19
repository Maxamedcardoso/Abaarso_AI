import fs from 'fs';
import path from 'path';
import { AppConfig } from '../config/env.js';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { QuotaTracker } from '../ai/quota-tracker.js';
import { BroadcastService } from '../services/broadcast.service.js';
import { WhatsAppManagerService } from '../services/whatsapp-manager.service.js';
import { StatusReactorService } from '../services/status-reactor.service.js';
import { ReminderService } from '../services/reminder.service.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { MessageRouter } from '../pipeline/message-router.js';
import { WhatsAppBaileysTransport } from '../transports/whatsapp-baileys.js';
import { IMessagingTransport } from '../transports/transport.interface.js';
import { BotCategory, GuardedFeature, PlanFeatures, PlanGuard, PlanTier } from './plan-catalog.js';
import { normalizeSubscriptionPhone, TenantRecord, TenantRegistry, AdminUserRecord } from './tenant-registry.js';
import { getCategoryStarterTemplate } from './tenant-templates.js';
import { CloudStateSync } from './cloud-state-sync.js';
import { WhatsAppOnboardingService } from './whatsapp-onboarding.js';
import { generateSubscriberGuidePdfBuffer } from '../services/user-guide-pdf.service.js';

export interface TenantContext {
  tenantId: string;
  tenant: TenantRecord;
  isOwner: boolean;
  dataDir: string;
  authDir: string;
  memory: SQLiteStudentMemory;
  quotaTracker: QuotaTracker;
  ai: AIOrchestrator;
  broadcast: BroadcastService;
  whatsappManager: WhatsAppManagerService;
  statusReactor: StatusReactorService;
  reminderService: ReminderService;
  planGuard: PlanGuard;
  engine: StudentAdvisorEngine;
  router: MessageRouter;
  transport: WhatsAppBaileysTransport | null;
  started: boolean;
}

export interface TenantManagerOptions {
  startSockets?: boolean;
  maxActiveTenants?: number;
  expiryCheckIntervalMs?: number;
  publicBaseUrl?: string;
  cloudSync?: CloudStateSync;
}

export class TenantManager {
  public readonly registry: TenantRegistry;
  private readonly config: AppConfig;
  private readonly startSockets: boolean;
  private readonly maxActiveTenants: number;
  private readonly expiryCheckIntervalMs: number;
  private readonly publicBaseUrl: string;
  private cloudSync?: CloudStateSync;
  private readonly onboarding: WhatsAppOnboardingService;
  private contexts: Map<string, TenantContext> = new Map();
  private expiryTimer: NodeJS.Timeout | null = null;
  private portalOtps: Map<string, { code: string; tenantId: string; expiresAt: number; attempts: number }> = new Map();

  constructor(registry: TenantRegistry, config: AppConfig, options?: TenantManagerOptions) {
    this.registry = registry;
    this.config = config;
    this.startSockets = options?.startSockets ?? config.messaging.mode === 'baileys';
    this.maxActiveTenants = options?.maxActiveTenants ?? (Number(process.env.MAX_ACTIVE_TENANTS) || 25);
    this.expiryCheckIntervalMs = options?.expiryCheckIntervalMs ?? 60_000;
    this.publicBaseUrl = (options?.publicBaseUrl || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
    this.cloudSync = options?.cloudSync;
    this.onboarding = new WhatsAppOnboardingService(this);
  }

  public getTenantPortalUrl(tenant: TenantRecord): string {
    return `${this.publicBaseUrl}/client/${encodeURIComponent(tenant.id)}?token=${encodeURIComponent(tenant.accessToken)}`;
  }

  public getPublicPortalLoginUrl(): string {
    return `${this.publicBaseUrl}/portal`;
  }

  public setCloudSync(cloudSync?: CloudStateSync): void {
    this.cloudSync = cloudSync;
  }

  public getCloudSync(): CloudStateSync | undefined {
    return this.cloudSync;
  }

  public markRegistryDirty(urgent: boolean = false): void {
    this.cloudSync?.markDirty('registry', urgent);
  }

  public markTenantDirty(
    tenantId: string,
    kinds: Array<'db' | 'auth' | 'meta'> = ['db'],
    urgent: boolean = false
  ): void {
    if (!this.cloudSync || !tenantId) return;
    const safe = tenantId === 'owner' ? 'owner' : tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
    for (const kind of kinds) {
      this.cloudSync.markDirty(`tenant:${safe}:${kind}`, urgent);
    }
  }

  public getTenantPaths(tenant: TenantRecord): {
    isOwner: boolean;
    dataDir: string;
    dbPath: string;
    authDir: string;
    postedStatusPath: string;
    reactorStoragePath: string;
  } {
    const isOwner = tenant.id === 'owner';
    if (isOwner) {
      const baseDataDir = path.dirname(this.config.database.path) || './data';
      return {
        isOwner: true,
        dataDir: baseDataDir,
        dbPath: this.config.database.path,
        authDir: process.env.BAILEYS_AUTH_DIR || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'owner_auth') : './baileys_auth_info'),
        postedStatusPath: path.join(baseDataDir, 'posted-statuses.json'),
        reactorStoragePath: path.join(baseDataDir, 'status_reactor_config.json'),
      };
    }

    const safeId = tenant.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const baseDataDir = path.dirname(this.config.database.path) || './data';
    const tenantDir = path.join(baseDataDir, 'tenants', safeId);
    return {
      isOwner: false,
      dataDir: tenantDir,
      dbPath: path.join(tenantDir, 'tenant.db'),
      authDir: path.join(tenantDir, 'auth'),
      postedStatusPath: path.join(tenantDir, 'posted-statuses.json'),
      reactorStoragePath: path.join(tenantDir, 'status_reactor.json'),
    };
  }

  public async initialize(): Promise<void> {
    const ownerPhone = this.config.security.adminPhoneNumbers[0] || '';
    const owner = this.registry.ensureOwnerTenant(ownerPhone);

    // Mount primary Owner instance (connects WhatsApp only when startSockets is enabled)
    await this.mountTenant(owner, this.startSockets);

    // Clear any expired subscribers before mounting active clients
    await this.runExpirySweep();

    const subscribers = this.registry
      .listTenants(false)
      .filter((t) => this.registry.isTenantActive(t))
      .slice(0, this.maxActiveTenants);

    for (const sub of subscribers) {
      try {
        await this.mountTenant(sub, this.startSockets);
      } catch (err: any) {
        console.error(`⚠️ [TenantManager] Failed mounting subscriber ${sub.id} (${sub.name}):`, err?.message || err);
      }
    }

    this.expiryTimer = setInterval(() => {
      this.runExpirySweep().catch((err) => {
        console.warn('[TenantManager] Expiry sweep error:', err?.message || err);
      });
    }, this.expiryCheckIntervalMs);
    if (typeof this.expiryTimer.unref === 'function') {
      this.expiryTimer.unref();
    }
  }

  public isOwnerPhone(rawPhone: string): boolean {
    const clean = normalizeSubscriptionPhone(rawPhone || '');
    if (!clean) return false;
    for (const p of this.config.security.adminPhoneNumbers || []) {
      if (normalizeSubscriptionPhone(p) === clean) return true;
    }
    const ownerTenant = this.registry.getTenant('owner');
    if (ownerTenant?.allowedPhone && normalizeSubscriptionPhone(ownerTenant.allowedPhone) === clean) {
      return true;
    }
    const botNum = this.getOwnerContext()?.transport?.getBotNumber?.();
    if (botNum && normalizeSubscriptionPhone(botNum) === clean) {
      return true;
    }
    return false;
  }

  public isOwnerChat(chatId: string): boolean {
    if (!chatId) return false;
    const clean = normalizeSubscriptionPhone(chatId.split('@')[0]);
    return this.isOwnerPhone(clean);
  }

  public getTenantAdminPhones(tenantId: string): string[] {
    const t = this.registry.getTenant(tenantId);
    if (!t) return [...this.config.security.adminPhoneNumbers];
    if (t.id === 'owner') {
      const registryAdmins = this.registry.getAllActiveAdminPhones(this.config.security.adminPhoneNumbers);
      return Array.from(new Set([...registryAdmins, ...(t.extraAdmins || [])].filter(Boolean)));
    }
    return Array.from(new Set([t.allowedPhone, ...(t.extraAdmins || [])].filter(Boolean)));
  }

  private buildPlanGuard(tenantId: string, quota: QuotaTracker, fallbackFeatures: PlanFeatures): PlanGuard {
    const getFeatures = (): PlanFeatures => {
      const latest = this.registry.getTenant(tenantId);
      return latest ? latest.effectiveFeatures : fallbackFeatures;
    };

    const checkFeature = (feature: GuardedFeature): { allowed: boolean; reason?: string; remaining?: number } => {
      const latest = this.registry.getTenant(tenantId);
      if (latest && latest.id !== 'owner' && !this.registry.isTenantActive(latest)) {
        return {
          allowed: false,
          reason: `Rukhsadda akoonkan (${latest.status}) ma shaqaynayso. Fadlan cusboonaysii qorshahaaga.`,
          remaining: 0,
        };
      }

      const f = getFeatures();
      const usage = quota.getFeatureUsage();

      switch (feature) {
        case 'ai': {
          const remaining = Math.max(0, f.maxDailyAiCalls - usage.aiCalls);
          return remaining > 0
            ? { allowed: true, remaining }
            : {
                allowed: false,
                remaining: 0,
                reason: `Xadkii fariimaha AI ee maanta (${usage.aiCalls}/${f.maxDailyAiCalls}) wuu buuxsamay. Ku dar Gemini Key bilaash ah ama kor u qaad qorshahaaga.`,
              };
        }
        case 'voice': {
          const remaining = Math.max(0, f.maxDailyVoice - usage.voiceCalls);
          return remaining > 0
            ? { allowed: true, remaining }
            : {
                allowed: false,
                remaining: 0,
                reason: `Xadkii jawaabaha codka (Voice) ee maanta (${usage.voiceCalls}/${f.maxDailyVoice}) wuu buuxsamay.`,
              };
        }
        case 'image': {
          const remaining = Math.max(0, f.maxDailyImages - usage.imageCalls);
          return remaining > 0
            ? { allowed: true, remaining }
            : {
                allowed: false,
                remaining: 0,
                reason: `Xadkii sawir-samaynta AI ee maanta (${usage.imageCalls}/${f.maxDailyImages}) wuu buuxsamay.`,
              };
        }
        case 'broadcast': {
          const remaining = Math.max(0, f.maxDailyBroadcast - usage.broadcastCalls);
          return remaining > 0
            ? { allowed: true, remaining }
            : {
                allowed: false,
                remaining: 0,
                reason: `Xadkii fariin-wadareedka (Broadcast) ee maanta (${usage.broadcastCalls}/${f.maxDailyBroadcast}) wuu buuxsamay.`,
              };
        }
        case 'status_reactor':
          return f.allowStatusReactor
            ? { allowed: true }
            : { allowed: false, reason: 'Status AI Reactor kuma jiro qorshahaaga hadda.' };
        case 'status_post':
          return f.allowStatusPosting
            ? { allowed: true }
            : { allowed: false, reason: 'Status Posting kuma jiro qorshahaaga hadda.' };
        case 'leads':
          return f.allowLeadsCapture
            ? { allowed: true }
            : { allowed: false, reason: 'Diiwaangelinta Macmiisha (Leads) kuma jirto qorshahaaga hadda.' };
        default:
          return { allowed: true };
      }
    };

    const recordUsage = (feature: 'ai' | 'voice' | 'image' | 'broadcast'): void => {
      quota.recordFeatureUsage(feature);
    };

    return { getFeatures, checkFeature, recordUsage };
  }

  public async mountTenant(tenant: TenantRecord, startSocket: boolean = this.startSockets): Promise<TenantContext> {
    const existing = this.contexts.get(tenant.id);
    if (existing) {
      this.refreshContextSettings(existing, tenant);
      if (startSocket && existing.transport && !existing.started) {
        existing.started = true;
        existing.transport.start().catch((err) => {
          console.error(`⚠️ [TenantManager] Socket start failed for ${tenant.id}:`, err?.message || err);
        });
      }
      return existing;
    }

    const paths = this.getTenantPaths(tenant);
    if (!fs.existsSync(paths.dataDir)) {
      fs.mkdirSync(paths.dataDir, { recursive: true });
    }
    if (!fs.existsSync(paths.authDir)) {
      fs.mkdirSync(paths.authDir, { recursive: true });
    }

    const memory = new SQLiteStudentMemory(paths.dbPath);
    await memory.initialize();

    // Seed category starter knowledge once for fresh subscriber databases (preserving any manual edits)
    const currentBotConfig = await memory.getBotConfig();
    if (!paths.isOwner && !currentBotConfig.knowledgeBase?.trim() && !currentBotConfig.systemRole?.trim()) {
      const tpl = getCategoryStarterTemplate(tenant.category, tenant.name);
      const extraSignup = tenant.signupNotes?.trim()
        ? `\n\nXogta aad soo gelisay diiwaangelinta:\n${tenant.signupNotes.trim()}\n`
        : '';
      await memory.saveBotConfig({
        botName: tenant.name || tpl.botName,
        businessName: tenant.name || tpl.businessName,
        systemRole: tpl.systemRole,
        knowledgeBase: `${tpl.knowledgeBase}${extraSignup}`,
      });
    }

    const broadcast = new BroadcastService(memory, {
      dailyLimit: tenant.effectiveFeatures.maxDailyBroadcast,
    }, {
      disableAutoFileImport: !paths.isOwner,
    });
    broadcast.setMemory(memory);
    await broadcast.loadPersistedContacts();

    const adminPhones = this.getTenantAdminPhones(tenant.id);
    const whatsappManager = new WhatsAppManagerService({
      authDir: paths.authDir,
      statusStoragePath: paths.postedStatusPath,
      broadcast,
      adminPhones,
    });

    const statusReactor = new StatusReactorService(paths.reactorStoragePath, broadcast, adminPhones);
    statusReactor.setOwnerName(tenant.name || 'Mohamed');

    const quotaTracker = new QuotaTracker(
      tenant.effectiveFeatures.maxDailyAiCalls,
      this.config.gemini.rpmLimit,
      paths.dataDir
    );

    const ai = new AIOrchestrator(this.config, quotaTracker, tenant.customGeminiKey || undefined);
    await ai.initialize();

    whatsappManager.setAIOrchestrator(ai);
    statusReactor.setAIOrchestrator(ai);

    const planGuard = this.buildPlanGuard(tenant.id, quotaTracker, tenant.effectiveFeatures);
    const reminderService = new ReminderService();

    const engine = new StudentAdvisorEngine(memory, ai, {
      broadcast,
      reminderService,
      cacheScope: tenant.id,
      tenantCategory: tenant.category,
      ownerDisplayName: tenant.name,
      isAwayMode: () => Boolean(this.registry.getTenant(tenant.id)?.awayMode),
      planGuard,
    });

    const scopedConfig: AppConfig = {
      ...this.config,
      security: {
        ...this.config.security,
        adminPhoneNumbers: adminPhones,
      },
      database: {
        ...this.config.database,
        path: paths.dbPath,
      },
    };

    const router = new MessageRouter(engine, scopedConfig, undefined, undefined, memory, {
      broadcast,
      whatsappManager,
      statusReactor,
      planGuard,
      subscriptionCheck: () => {
        const latest = this.registry.getTenant(tenant.id);
        if (!latest) return { active: false, reason: 'Account deleted' };
        if (latest.id === 'owner') return { active: true };
        return this.registry.isTenantActive(latest)
          ? { active: true }
          : { active: false, reason: `Subscription ${latest.status}` };
      },
      getExtraAdmins: () => this.getTenantAdminPhones(tenant.id),
      onboardingHandler: paths.isOwner
        ? (msg, tr, isAdm) => this.onboarding.handleMessage(msg, tr, isAdm)
        : undefined,
      sendGuidePdfHandler: (chatId, tr) => this.sendSubscriberGuidePdf(tenant, chatId, null, tr),
    });

    const transport = new WhatsAppBaileysTransport({
      authDir: paths.authDir,
      tenantId: tenant.id,
      allowedPhone: paths.isOwner ? undefined : tenant.allowedPhone,
      autoSyncContactsOnEmpty: true,
      allowEnvSessionRestore: paths.isOwner,
      broadcastService: broadcast,
      whatsappManager,
      statusReactor,
      onConnectionChange: (state) => {
        if (state.connected) {
          this.markTenantDirty(tenant.id, ['auth'], true);
        }
      },
      onCredsSaved: () => {
        this.markTenantDirty(tenant.id, ['auth'], false);
      },
    });

    transport.onMessage(async (msg) => {
      await router.handleIncomingMessage(msg, transport);
      this.markTenantDirty(tenant.id, ['db'], false);
    });

    reminderService.setSendFunction(async (chatId: string, text: string) => {
      if (transport.isConnected) {
        await transport.sendMessage(chatId, text);
      }
    });
    reminderService.start();

    const ctx: TenantContext = {
      tenantId: tenant.id,
      tenant,
      isOwner: paths.isOwner,
      dataDir: paths.dataDir,
      authDir: paths.authDir,
      memory,
      quotaTracker,
      ai,
      broadcast,
      whatsappManager,
      statusReactor,
      reminderService,
      planGuard,
      engine,
      router,
      transport,
      started: false,
    };

    this.contexts.set(tenant.id, ctx);

    if (startSocket && (!tenant.id || tenant.id === 'owner' || this.registry.isTenantActive(tenant))) {
      ctx.started = true;
      transport.start().catch((err) => {
        console.error(`⚠️ [TenantManager] Transport start failed for ${tenant.id}:`, err?.message || err);
      });
    }

    return ctx;
  }

  private refreshContextSettings(ctx: TenantContext, updated: TenantRecord): void {
    ctx.tenant = updated;
    const adminPhones = this.getTenantAdminPhones(updated.id);
    ctx.whatsappManager.setAdminPhones(adminPhones);
    ctx.statusReactor.setAdminPhones(adminPhones);
    ctx.quotaTracker.setDailyLimit(updated.effectiveFeatures.maxDailyAiCalls);
    ctx.broadcast.setSafetyConfig({ dailyLimit: updated.effectiveFeatures.maxDailyBroadcast });
    ctx.ai.setCustomApiKey(updated.customGeminiKey || undefined, this.config);
    ctx.engine.setTenantCategory(updated.category, updated.name);
    if (ctx.transport && !ctx.isOwner) {
      ctx.transport.setAllowedPhone(updated.allowedPhone);
    }
  }

  public getContext(tenantId: string): TenantContext | undefined {
    return this.contexts.get(tenantId);
  }

  public getOwnerContext(): TenantContext | undefined {
    return this.contexts.get('owner');
  }

  public listContexts(): TenantContext[] {
    return Array.from(this.contexts.values());
  }

  public async registerPublicSignup(input: {
    name: string;
    phone: string;
    category: BotCategory;
    promoCode?: string;
    notes?: string;
    pin?: string;
    applicantChatId?: string;
    ownerOnlyNotification?: boolean;
  }): Promise<{ tenant: TenantRecord; autoApproved: boolean; alreadyPending?: boolean; message: string }> {
    const result = this.registry.registerSelfSignup(input);
    if (!result.success || !result.tenant) {
      throw new Error(result.message || 'Diiwaangelintu way fashilantay');
    }
    const autoApproved = Boolean(result.autoActivated);
    if (autoApproved) {
      await this.mountTenant(result.tenant, false);
      this.markTenantDirty(result.tenant.id, ['db'], true);
    } else if (!result.alreadyPending) {
      await this.notifyAdminsOfPendingSignup(result.tenant, { ownerOnly: Boolean(input.ownerOnlyNotification) }).catch((err) => {
        console.warn('[TenantManager] Failed notifying admins of pending signup:', err?.message || err);
      });
    }
    this.markRegistryDirty(true);
    return {
      tenant: result.tenant,
      autoApproved,
      alreadyPending: result.alreadyPending,
      message: result.message,
    };
  }

  public async requestPortalOtp(rawPhone: string): Promise<{ sent: boolean; message: string; hasPin: boolean }> {
    const cleanPhone = normalizeSubscriptionPhone(rawPhone || '');
    if (cleanPhone.length < 8) {
      return { sent: false, message: 'Fadlan geli lambar WhatsApp oo sax ah.', hasPin: false };
    }
    const tenant = this.registry.getTenantByPhone(cleanPhone);
    const adminUser = !tenant ? this.registry.getAdminByPhone(cleanPhone) : null;
    const isOwner = !tenant && !adminUser ? this.isOwnerPhone(cleanPhone) : false;

    if (!tenant && !adminUser && !isOwner) {
      return {
        sent: false,
        message: 'Lambarkan lama helin diiwaanka. Fadlan marka hore iska diiwaangeli bogga /join.',
        hasPin: false,
      };
    }

    const ownerCtx = this.getOwnerContext();
    const tenantCtx = tenant ? this.getContext(tenant.id) : null;
    const activeTransport = tenantCtx?.transport?.isConnected
      ? tenantCtx.transport
      : ownerCtx?.transport?.isConnected
      ? ownerCtx.transport
      : null;

    if (!activeTransport) {
      const hasPin = Boolean(tenant?.hasPin || adminUser || isOwner);
      return {
        sent: false,
        hasPin,
        message: hasPin
          ? 'WhatsApp OTP hadda ma shidna — fadlan ku soo gal Lambarkaaga & PIN-kaaga.'
          : 'Server-ka WhatsApp hadda lama xidhna si OTP loo diro; fadlan la xidhiidh maamulka link-gaaga.',
      };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const targetId = tenant ? tenant.id : adminUser ? `admin:${adminUser.id}` : 'admin:owner';
    this.portalOtps.set(cleanPhone, {
      code,
      tenantId: targetId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    const jid = `${cleanPhone}@s.whatsapp.net`;
    const ok = await activeTransport
      .sendMessage(
        jid,
        `🔑 *[CARDOSO AI — CODE-KA XAQIJINTA PORTAL-KA]*\n\n` +
          `Code-kaagu waa: *${code}*\n` +
          `Wuxuu dhacayaa 10 daqiiqo gudahood. Ha la wadaagin qof kale.`
      )
      .catch(() => false);

    if (!ok) {
      return { sent: false, hasPin: Boolean(tenant?.hasPin || adminUser || isOwner), message: 'Dirista WhatsApp OTP way fashilantay, fadlan isku day PIN-ka.' };
    }
    return {
      sent: true,
      hasPin: Boolean(tenant?.hasPin || adminUser || isOwner),
      message: `6-da lambar ee xaqiijinta waxaa loo diray WhatsApp-ka +${cleanPhone}!`,
    };
  }

  public verifyPortalOtp(rawPhone: string, rawCode: string): (TenantRecord & { isAdmin?: boolean; adminUser?: AdminUserRecord }) | null {
    const cleanPhone = normalizeSubscriptionPhone(rawPhone || '');
    const cleanCode = String(rawCode || '').replace(/\s+/g, '');
    const entry = this.portalOtps.get(cleanPhone);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.portalOtps.delete(cleanPhone);
      return null;
    }
    entry.attempts++;
    if (entry.attempts > 5) {
      this.portalOtps.delete(cleanPhone);
      return null;
    }
    if (entry.code !== cleanCode) {
      return null;
    }
    this.portalOtps.delete(cleanPhone);
    if (entry.tenantId.startsWith('admin:')) {
      const adminId = entry.tenantId.slice('admin:'.length);
      const adminUser = adminId === 'owner'
        ? { id: 'adm_owner', username: 'owner', displayName: 'Owner Super Admin', phoneNumber: cleanPhone, role: 'super_admin' as const, active: true, createdAt: Date.now() }
        : this.registry.listAdminUsers().find(a => a.id === adminId) || null;
      return {
        id: 'owner',
        name: adminUser?.displayName || 'Admin',
        allowedPhone: cleanPhone,
        category: 'personal',
        planTier: 'owner',
        status: 'active',
        accessToken: '',
        monthsPurchased: 999,
        trialUsed: false,
        startedAt: Date.now(),
        expiresAt: null,
        expiryNotified: false,
        featuresJson: '{}',
        customGeminiKey: '',
        awayMode: false,
        extraAdmins: [],
        signupNotes: '',
        promoCodeUsed: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hasPin: true,
        effectiveFeatures: {} as any,
        isAdmin: true,
        adminUser: adminUser || undefined,
      };
    }
    return this.registry.getTenant(entry.tenantId);
  }

  public async notifyAdminsOfPendingSignup(
    tenant: TenantRecord,
    options?: { ownerOnly?: boolean }
  ): Promise<{ notified: number }> {
    const ownerCtx = this.getOwnerContext();
    if (!ownerCtx?.transport?.isConnected) {
      return { notified: 0 };
    }

    const recipientSet = new Set<string>();

    // 1. Gather all owner phone numbers
    for (const p of this.config.security.adminPhoneNumbers || []) {
      const clean = normalizeSubscriptionPhone(p);
      if (clean) recipientSet.add(clean);
    }
    const ownerTenantPhone = this.registry.getTenant('owner')?.allowedPhone;
    if (ownerTenantPhone) {
      const clean = normalizeSubscriptionPhone(ownerTenantPhone);
      if (clean) recipientSet.add(clean);
    }
    const botOwnerPhone = ownerCtx.transport?.getBotNumber?.();
    if (botOwnerPhone) {
      const clean = normalizeSubscriptionPhone(botOwnerPhone);
      if (clean) recipientSet.add(clean);
    }

    // 2. If not restricted to owner only (e.g. signups from dashboard /join), include all active Super Admins & Staff Admins
    if (!options?.ownerOnly) {
      const adminPhones = this.registry.getAllActiveAdminPhones();
      for (const p of adminPhones) {
        const clean = normalizeSubscriptionPhone(p);
        if (clean) recipientSet.add(clean);
      }
    }

    const recipients = Array.from(recipientSet);
    if (recipients.length === 0) {
      return { notified: 0 };
    }

    const categoryLabel =
      tenant.category === 'business'
        ? 'Ganacsato (Business)'
        : tenant.category === 'education'
        ? 'Waxbarasho (Education)'
        : 'Qof Caadi ah (Personal)';

    const msg =
      `🔔 *[CARDOSO AI — CODSI RUKHSAD CUSUB]* 🔔\n\n` +
      `Qof cusub ayaa hadda iska diiwaangeliyay${tenant.applicantChatId ? ' (WhatsApp `!join`)' : ' (`/join`)'}:\n` +
      `• *Magaca*: ${tenant.name}\n` +
      `• *Lambarka WhatsApp*: +${tenant.allowedPhone}\n` +
      `• *Qaybta Bot-ka*: ${categoryLabel}\n` +
      (tenant.signupNotes ? `• *Faahfaahin*: ${tenant.signupNotes}\n` : '') +
      `• *ID*: \`${tenant.id}\`\n\n` +
      `✅ *Halkaan WhatsApp ka Ogolow (Number & PDF u fur):*\n` +
      `👉 \`!approve ${tenant.id}\`  (ama \`!aqbal ${tenant.id}\`)\n` +
      `❌ *Diid Codsiga:* \`!reject ${tenant.id}\`\n\n` +
      `🌐 Ama ka maamul Dashboard-ka: ${this.publicBaseUrl}`;

    let sent = 0;
    for (const phone of recipients) {
      const clean = normalizeSubscriptionPhone(phone);
      if (!clean) continue;
      const ok = await ownerCtx.transport.sendMessage(`${clean}@s.whatsapp.net`, msg).catch(() => false);
      if (ok) sent++;
    }
    return { notified: sent };
  }

  public async createAndStartSubscriber(input: {
    name: string;
    phone: string;
    category: BotCategory;
    planTier: PlanTier;
    months?: number;
    durationDays?: number;
    customGeminiKey?: string;
    notes?: string;
    pin?: string;
  }): Promise<TenantContext> {
    const tenant = this.registry.createActiveTenant(input);
    const ctx = await this.mountTenant(tenant, this.startSockets);
    this.markRegistryDirty(true);
    this.markTenantDirty(tenant.id, ['db'], true);
    return ctx;
  }

  public async approveAndStartTenant(
    id: string,
    options: { planTier: PlanTier; months?: number; durationDays?: number }
  ): Promise<(TenantRecord & { generatedPairingCode?: string | null }) | null> {
    const updated = this.registry.approveTenant(id, options);
    if (!updated) return null;
    await this.mountTenant(updated, false);
    this.markRegistryDirty(true);
    this.markTenantDirty(updated.id, ['db'], true);
    const { pairingCode } = await this.approveAndSendOnboardingBundle(updated);
    return Object.assign(updated, { generatedPairingCode: pairingCode });
  }

  public async approveAndSendOnboardingBundle(
    tenant: TenantRecord
  ): Promise<{ pairingCode: string | null; notified: boolean; pdfSent: boolean }> {
    let pairingCode: string | null = null;
    if (this.startSockets && tenant.id !== 'owner') {
      const pairRes = await this.requestPairingCode(tenant.id, tenant.allowedPhone).catch(() => null);
      if (pairRes?.success && pairRes.formattedCode) {
        pairingCode = pairRes.formattedCode;
      }
    }
    const { notified, pdfSent } = await this.deliverOnboardingToSubscriber(tenant, pairingCode);
    return { pairingCode, notified, pdfSent };
  }

  private resolveApplicantTargets(tenant: TenantRecord): string[] {
    const targets: string[] = [];
    if (tenant.applicantChatId && tenant.applicantChatId.trim()) {
      targets.push(tenant.applicantChatId.trim());
    }
    const cleanPhone = normalizeSubscriptionPhone(tenant.allowedPhone);
    if (cleanPhone) {
      targets.push(`${cleanPhone}@s.whatsapp.net`);
    }
    return Array.from(new Set(targets));
  }

  public async sendSubscriberGuidePdf(
    tenant: TenantRecord,
    targetChatId: string,
    pairingCode: string | null = null,
    explicitTransport?: IMessagingTransport
  ): Promise<boolean> {
    const transport = explicitTransport || this.getOwnerContext()?.transport || this.getContext(tenant.id)?.transport;
    if (!transport?.isConnected || !transport.sendMedia) return false;
    const portalUrl = this.getTenantPortalUrl(tenant);
    const pdfBuffer = generateSubscriberGuidePdfBuffer({
      subscriberName: tenant.name,
      phone: normalizeSubscriptionPhone(tenant.allowedPhone),
      category: tenant.category,
      portalUrl,
      pairingCode,
    });
    return transport
      .sendMedia(targetChatId, {
        type: 'document',
        dataBuffer: pdfBuffer,
        mimeType: 'application/pdf',
        fileName: 'CARDOSO_AI_Buugga_Isticmaalka.pdf',
        caption: '📄 *Buugga Amarrada & Sida Loo Isticmaalo CARDOSO AI (PDF)* — Keydso!',
      })
      .catch(() => false);
  }

  private async deliverOnboardingToSubscriber(
    tenant: TenantRecord,
    pairingCode: string | null
  ): Promise<{ notified: boolean; pdfSent: boolean }> {
    const ownerCtx = this.getOwnerContext();
    if (!ownerCtx?.transport?.isConnected) {
      return { notified: false, pdfSent: false };
    }
    const cleanPhone = normalizeSubscriptionPhone(tenant.allowedPhone);
    const targets = this.resolveApplicantTargets(tenant);
    if (targets.length === 0) return { notified: false, pdfSent: false };

    const portalLink = this.getTenantPortalUrl(tenant);
    const loginPortalLink = this.getPublicPortalLoginUrl();
    const pairingSection = pairingCode
      ? `🔑 *LAMBARKAAGA 8-DA GOD EE KU XIDHISTA WHATSAPP:*\n` +
        `👉 *${pairingCode}*\n\n` +
        `📲 *Sida Loo Geliyo (2 daqiiqo gudahood):*\n` +
        `1. Fur WhatsApp ➔ *Linked Devices* ➔ *Link a Device*\n` +
        `2. Hoosta taabo *"Link with phone number instead"*\n` +
        `3. Geli koodhka: *${pairingCode}*\n` +
        `_(Haddii koodhku dhaco, halkaan ku qor *!pair* ama ka furo Link-ga Dashboard-kaaga hoose)_\n\n`
      : `🔑 *Si aad u hesho Lambarka 8-da God ee WhatsApp:*\n` +
        `Halkan ku soo qor *!pair* ama fur Link-ga Dashboard-kaaga hoose oo guji *"Soo Saar 8-Lambar"*\n\n`;

    const msg =
      `🎉 *[CARDOSO AI — CODSIGAAGA WAA LA AQBALAY!]* 🎉\n\n` +
      `Hambalyo *${tenant.name}*, bot-kaagii WhatsApp (+${cleanPhone}) hadda waa furan yahay!\n\n` +
      pairingSection +
      `🌐 *LINK-GA DASHBOARD-KAAGA GAARKA AH (Guji oo Kaydso):*\n${portalLink}\n\n` +
      `🔐 Haddii uu kaa lumo link-gu, mar kasta ka soo gal: ${loginPortalLink}\n_(Geli lambarkaaga +${cleanPhone} & PIN-kii aad samaysatay)_\n\n` +
      `📄 *Hoos waxaa kuugu soo dhacaya faylka PDF-ka* oo ay ku qoran yihiin dhammaan amarrada & sida loo isticmaalo!`;

    let notified = false;
    let pdfSent = false;
    const primaryTarget = targets[0];
    const okMsg = await ownerCtx.transport.sendMessage(primaryTarget, msg).catch(() => false);
    if (okMsg) notified = true;
    const okPdf = await this.sendSubscriberGuidePdf(tenant, primaryTarget, pairingCode, ownerCtx.transport);
    if (okPdf) pdfSent = true;

    return { notified, pdfSent };
  }

  public async notifySubscriberOfApproval(tenant: TenantRecord): Promise<boolean> {
    const { notified } = await this.deliverOnboardingToSubscriber(tenant, null);
    return notified;
  }

  public async renewAndRestartTenant(
    id: string,
    months: number = 1,
    newPlanTier?: PlanTier,
    durationDays?: number
  ): Promise<TenantRecord | null> {
    const updated = this.registry.renewSubscription(id, months, newPlanTier, durationDays);
    if (!updated) return null;
    await this.mountTenant(updated, this.startSockets);
    this.markRegistryDirty(true);
    return updated;
  }

  public async suspendAndStopTenant(id: string, reason?: string): Promise<TenantRecord | null> {
    const updated = this.registry.suspendTenant(id, reason);
    if (!updated) return null;
    const ctx = this.contexts.get(id);
    if (ctx) {
      ctx.tenant = updated;
      ctx.started = false;
      if (ctx.transport) {
        await ctx.transport.stopWithoutLogout();
      }
    }
    this.markRegistryDirty(true);
    return updated;
  }

  public async activateAndStartTenant(id: string): Promise<TenantRecord | null> {
    const updated = this.registry.activateTenant(id);
    if (!updated) return null;
    await this.mountTenant(updated, this.startSockets);
    this.markRegistryDirty(true);
    return updated;
  }

  public updateTenantAndRefresh(
    id: string,
    updates: Parameters<TenantRegistry['updateTenantSettings']>[1]
  ): TenantRecord | null {
    const updated = this.registry.updateTenantSettings(id, updates);
    if (!updated) return null;
    const ctx = this.contexts.get(id);
    if (ctx) {
      this.refreshContextSettings(ctx, updated);
    }
    this.markRegistryDirty(false);
    return updated;
  }

  public async deleteTenantAndCleanup(id: string): Promise<boolean> {
    if (id === 'owner') return false;
    const ctx = this.contexts.get(id);
    if (ctx) {
      ctx.reminderService.stop();
      if (ctx.transport) {
        await ctx.transport.stopWithoutLogout();
      }
      ctx.memory.close();
      this.contexts.delete(id);
    }
    const deleted = this.registry.deleteTenant(id);
    if (deleted) {
      await this.cloudSync?.deleteTenantSnapshots(id).catch(() => {});
      this.markRegistryDirty(true);
    }
    return deleted;
  }

  public async requestPairingCode(
    id: string,
    phone?: string
  ): Promise<{ success: boolean; code?: string; formattedCode?: string; phone?: string; error?: string }> {
    const tenant = this.registry.getTenant(id);
    if (!tenant) return { success: false, error: 'Subscriber lama helin.' };
    if (tenant.id !== 'owner' && !this.registry.isTenantActive(tenant)) {
      return { success: false, error: `Akoonkan hadda wuxuu ku jiraa xaaladda "${tenant.status}".` };
    }
    const ctx = await this.mountTenant(tenant, false);
    if (!ctx.transport) return { success: false, error: 'Transport ma diyaarsana.' };
    ctx.started = true;
    return ctx.transport.requestPairingCodeForTenant(phone || tenant.allowedPhone);
  }

  public async unlinkTenantSession(id: string): Promise<boolean> {
    const ctx = this.contexts.get(id);
    if (!ctx?.transport) return false;
    await ctx.transport.unlinkSession();
    await this.cloudSync?.deleteAuthSnapshot(id).catch(() => {});
    return true;
  }

  public async syncTenantContacts(id: string): Promise<{ synced: boolean; total: number }> {
    const ctx = this.contexts.get(id);
    if (!ctx?.transport) return { synced: false, total: 0 };
    const result = await ctx.transport.syncContactsFromWhatsApp(true);
    if (result.synced) {
      this.markTenantDirty(id, ['db'], false);
    }
    return result;
  }

  public async runExpirySweep(now: number = Date.now()): Promise<TenantRecord[]> {
    const expiredList = this.registry.markExpiredTenants(now);
    for (const tenant of expiredList) {
      const ctx = this.contexts.get(tenant.id);
      if (ctx) {
        ctx.tenant = tenant;
        ctx.started = false;
        if (ctx.transport?.isConnected) {
          const selfJid = `${normalizeSubscriptionPhone(tenant.allowedPhone)}@s.whatsapp.net`;
          const notice =
            `⏳ *[CARDOSO AI — RUKHSADDAADA WAA DHAMMAATAY]*\n\n` +
            `Salaan *${tenant.name}*, bishaada adeegga CARDOSO AI way dhammaatay.\n` +
            `Contacts-kaagii, fariimahaagii, iyo xogtaadii oo dhan si ammaan ah ayay u kaydsan yihiin (lama tirtirin).\n\n` +
            `Si aad bot-kaaga isla markiiba dib ugu shiddo, fadlan la xidhiidh maamulka si laguugu cusboonaysiiyo (+1 Bil). Mahadsanid! 🙏`;
          await ctx.transport.sendMessage(selfJid, notice).catch(() => {});
        }
        if (ctx.transport) {
          await ctx.transport.stopWithoutLogout();
        }
      }
    }
    if (expiredList.length > 0) {
      this.markRegistryDirty(true);
    }
    return expiredList;
  }

  public async shutdown(): Promise<void> {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    const tenantIds = Array.from(this.contexts.keys());
    for (const ctx of this.contexts.values()) {
      ctx.reminderService.stop();
      if (ctx.transport) {
        await ctx.transport.stopWithoutLogout().catch(() => {});
      }
      ctx.memory.close();
    }
    this.contexts.clear();
    await this.cloudSync?.shutdown(tenantIds).catch(() => {});
  }
}
