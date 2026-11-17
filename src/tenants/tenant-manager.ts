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
import { BotCategory, GuardedFeature, PlanFeatures, PlanGuard, PlanTier } from './plan-catalog.js';
import { normalizeSubscriptionPhone, TenantRecord, TenantRegistry } from './tenant-registry.js';
import { getCategoryStarterTemplate } from './tenant-templates.js';

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
}

export class TenantManager {
  public readonly registry: TenantRegistry;
  private readonly config: AppConfig;
  private readonly startSockets: boolean;
  private readonly maxActiveTenants: number;
  private readonly expiryCheckIntervalMs: number;
  private readonly publicBaseUrl: string;
  private contexts: Map<string, TenantContext> = new Map();
  private expiryTimer: NodeJS.Timeout | null = null;
  private portalOtps: Map<string, { code: string; tenantId: string; expiresAt: number; attempts: number }> = new Map();

  constructor(registry: TenantRegistry, config: AppConfig, options?: TenantManagerOptions) {
    this.registry = registry;
    this.config = config;
    this.startSockets = options?.startSockets ?? config.messaging.mode === 'baileys';
    this.maxActiveTenants = options?.maxActiveTenants ?? (Number(process.env.MAX_ACTIVE_TENANTS) || 25);
    this.expiryCheckIntervalMs = options?.expiryCheckIntervalMs ?? 60_000;
    this.publicBaseUrl = options?.publicBaseUrl || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
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
    });

    transport.onMessage(async (msg) => {
      await router.handleIncomingMessage(msg, transport);
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
  }): Promise<{ tenant: TenantRecord; autoApproved: boolean; alreadyPending?: boolean; message: string }> {
    const result = this.registry.registerSelfSignup(input);
    if (!result.success || !result.tenant) {
      throw new Error(result.message || 'Diiwaangelintu way fashilantay');
    }
    const autoApproved = Boolean(result.autoActivated);
    if (autoApproved) {
      await this.mountTenant(result.tenant, this.startSockets);
    } else if (!result.alreadyPending) {
      this.notifyAdminsOfPendingSignup(result.tenant).catch((err) => {
        console.warn('[TenantManager] Failed notifying admins of pending signup:', err?.message || err);
      });
    }
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
    if (!tenant) {
      return {
        sent: false,
        message: 'Lambarkan lama helin diiwaanka. Fadlan marka hore iska diiwaangeli bogga /join.',
        hasPin: false,
      };
    }

    const ownerCtx = this.getOwnerContext();
    const tenantCtx = this.getContext(tenant.id);
    const activeTransport = tenantCtx?.transport?.isConnected
      ? tenantCtx.transport
      : ownerCtx?.transport?.isConnected
      ? ownerCtx.transport
      : null;

    if (!activeTransport) {
      return {
        sent: false,
        hasPin: Boolean(tenant.hasPin),
        message: tenant.hasPin
          ? 'WhatsApp OTP hadda ma shidna — fadlan ku soo gal Lambarkaaga & PIN-kaaga.'
          : 'Server-ka WhatsApp hadda lama xidhna si OTP loo diro; fadlan la xidhiidh maamulka link-gaaga.',
      };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.portalOtps.set(cleanPhone, {
      code,
      tenantId: tenant.id,
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
      return { sent: false, hasPin: Boolean(tenant.hasPin), message: 'Dirista WhatsApp OTP way fashilantay, fadlan isku day PIN-ka.' };
    }
    return {
      sent: true,
      hasPin: Boolean(tenant.hasPin),
      message: `6-da lambar ee xaqiijinta waxaa loo diray WhatsApp-ka +${cleanPhone}!`,
    };
  }

  public verifyPortalOtp(rawPhone: string, rawCode: string): TenantRecord | null {
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
    return this.registry.getTenant(entry.tenantId);
  }

  public async notifyAdminsOfPendingSignup(tenant: TenantRecord): Promise<{ notified: number }> {
    const ownerCtx = this.getOwnerContext();
    if (!ownerCtx?.transport?.isConnected) {
      return { notified: 0 };
    }

    const recipients = this.registry.getAllActiveAdminPhones(this.config.security.adminPhoneNumbers);
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
      `Qof cusub ayaa hadda iska diiwaangeliyay bogga \`/join\`:\n` +
      `• *Magaca*: ${tenant.name}\n` +
      `• *Lambarka WhatsApp*: +${tenant.allowedPhone}\n` +
      `• *Qaybta Bot-ka*: ${categoryLabel}\n` +
      (tenant.signupNotes ? `• *Faahfaahin*: ${tenant.signupNotes}\n` : '') +
      `• *ID*: \`${tenant.id}\`\n\n` +
      `Markii uu lacagta bixiyo (ama bisha bilaashka ah loo oggolaado), hal mar guji *Approve* gudaha Dashboard-ka:\n` +
      `👉 ${this.publicBaseUrl}`;

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
    return this.mountTenant(tenant, this.startSockets);
  }

  public async approveAndStartTenant(
    id: string,
    options: { planTier: PlanTier; months?: number; durationDays?: number }
  ): Promise<TenantRecord | null> {
    const updated = this.registry.approveTenant(id, options);
    if (!updated) return null;
    await this.mountTenant(updated, this.startSockets);
    this.notifySubscriberOfApproval(updated).catch(() => {});
    return updated;
  }

  public async notifySubscriberOfApproval(tenant: TenantRecord): Promise<boolean> {
    const ownerCtx = this.getOwnerContext();
    if (!ownerCtx?.transport?.isConnected) return false;
    const cleanPhone = normalizeSubscriptionPhone(tenant.allowedPhone);
    if (!cleanPhone) return false;
    const portalLink = `${this.publicBaseUrl}/client/${encodeURIComponent(tenant.id)}?token=${encodeURIComponent(tenant.accessToken)}`;
    const msg =
      `🎉 *[CARDOSO AI — CODSIGAAGA WAA LA AQBALAY!]* 🎉\n\n` +
      `Hambalyo *${tenant.name}*, bot-kaagii WhatsApp hadda waa furan yahay!\n` +
      `🔗 *Link-gaaga Dashboard-ka (Kaydso):*\n${portalLink}\n\n` +
      `💡 Haddii uu kaa lumo link-gu, booqo \`${this.publicBaseUrl}/portal\` kuna soo gal lambarkaaga (+${cleanPhone}).`;
    return ownerCtx.transport.sendMessage(`${cleanPhone}@s.whatsapp.net`, msg).catch(() => false);
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
    return updated;
  }

  public async activateAndStartTenant(id: string): Promise<TenantRecord | null> {
    const updated = this.registry.activateTenant(id);
    if (!updated) return null;
    await this.mountTenant(updated, this.startSockets);
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
    return this.registry.deleteTenant(id);
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
    return true;
  }

  public async syncTenantContacts(id: string): Promise<{ synced: boolean; total: number }> {
    const ctx = this.contexts.get(id);
    if (!ctx?.transport) return { synced: false, total: 0 };
    return ctx.transport.syncContactsFromWhatsApp(true);
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
    return expiredList;
  }

  public async shutdown(): Promise<void> {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    for (const ctx of this.contexts.values()) {
      ctx.reminderService.stop();
      if (ctx.transport) {
        await ctx.transport.stopWithoutLogout().catch(() => {});
      }
      ctx.memory.close();
    }
    this.contexts.clear();
  }
}
