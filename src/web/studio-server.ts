import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { IMessagingTransport } from '../transports/transport.interface.js';
import { WhatsAppBaileysTransport } from '../transports/whatsapp-baileys.js';
import { BroadcastService, broadcastService } from '../services/broadcast.service.js';
import { WhatsAppManagerService, whatsappManagerService } from '../services/whatsapp-manager.service.js';
import { StatusReactorService, statusReactorService } from '../services/status-reactor.service.js';
import { VoiceReplyService } from '../services/voice-reply.service.js';
import { AppConfig } from '../config/env.js';
import { BotCategory, PlanTier } from '../tenants/plan-catalog.js';
import { TenantManager } from '../tenants/tenant-manager.js';
import { normalizeSubscriptionPhone, TenantRecord } from '../tenants/tenant-registry.js';
import { getCategoryStarterTemplate } from '../tenants/tenant-templates.js';
import { renderJoinHTML } from './views/join-page.js';
import { renderClientPortalHTML } from './views/client-page.js';
import { renderAdminDashboardHTML } from './views/admin-page.js';
import { renderPortalLoginHTML } from './views/portal-login-page.js';
import { renderAdminLoginHTML } from './views/admin-login-page.js';

export interface StudioServerOptions {
  port: number | string;
  memory: SQLiteStudentMemory;
  engine: StudentAdvisorEngine;
  transport: IMessagingTransport;
  config: AppConfig;
  tenantManager?: TenantManager;
  studioPasswordOverride?: string;
}

function parseCookies(header?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!header) return map;
  for (const item of header.split(';')) {
    const idx = item.indexOf('=');
    if (idx > 0) {
      const k = item.slice(0, idx).trim();
      const v = item.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

interface AdminSessionInfo {
  username: string;
  displayName: string;
  role: string;
  expiresAt: number;
}
const adminSessions = new Map<string, AdminSessionInfo>();

function sanitizeTenantForResponse(t: TenantRecord, isClientSelf: boolean = false) {
  return {
    id: t.id,
    name: t.name,
    allowedPhone: t.allowedPhone,
    category: t.category,
    planTier: t.planTier,
    status: t.status,
    accessToken: (isClientSelf || t.id === 'owner') ? t.accessToken : undefined,
    monthsPurchased: t.monthsPurchased,
    trialUsed: t.trialUsed,
    startedAt: t.startedAt,
    expiresAt: t.expiresAt,
    effectiveFeatures: t.effectiveFeatures,
    hasCustomGeminiKey: Boolean(t.customGeminiKey),
    awayMode: t.awayMode,
    extraAdmins: t.extraAdmins,
    signupNotes: t.signupNotes,
    promoCodeUsed: t.promoCodeUsed,
    hasPin: Boolean(t.hasPin),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function sanitizeCategory(raw: any): BotCategory {
  if (raw === 'business' || raw === 'education' || raw === 'personal') return raw;
  return 'personal';
}

function sanitizePlanTier(raw: any, fallback: PlanTier = 'trial_free'): PlanTier {
  if (raw === 'trial_free' || raw === 'starter' || raw === 'business' || raw === 'education') {
    return raw;
  }
  return fallback;
}

export function createStudioServer(options: StudioServerOptions): http.Server {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const { config, tenantManager } = options;
  const studioPassword = options.studioPasswordOverride ?? (process.env.STUDIO_PASSWORD ? process.env.STUDIO_PASSWORD : 'maxamed11@');

  if (!studioPassword) {
    console.warn('⚠️ [Studio] STUDIO_PASSWORD lama dejin — Admin dashboard-ku wuu xidhan yahay ilaa STUDIO_PASSWORD ama Admin user la dejiyo.');
  }

  const getOwnerRefs = (): {
    memory: SQLiteStudentMemory;
    engine: StudentAdvisorEngine;
    transport: IMessagingTransport;
    broadcast: BroadcastService;
    whatsappManager: WhatsAppManagerService;
    statusReactor: StatusReactorService;
  } => {
    const ownerCtx = tenantManager?.getOwnerContext();
    if (ownerCtx) {
      return {
        memory: ownerCtx.memory,
        engine: ownerCtx.engine,
        transport: ownerCtx.transport || options.transport,
        broadcast: ownerCtx.broadcast,
        whatsappManager: ownerCtx.whatsappManager,
        statusReactor: ownerCtx.statusReactor,
      };
    }
    return {
      memory: options.memory,
      engine: options.engine,
      transport: options.transport,
      broadcast: broadcastService,
      whatsappManager: whatsappManagerService,
      statusReactor: statusReactorService,
    };
  };

  // ─── 1. Public Health & Self-Signup Endpoints (No Admin Password) ──────────
  app.get(['/health', '/healthz'], (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'CARDOSO AI — Multi-Tenant WhatsApp SaaS Platform',
      mode: config.messaging.mode,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/join', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderJoinHTML());
  });

  app.get('/portal', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPortalLoginHTML());
  });

  app.get('/admin-login', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderAdminLoginHTML());
  });

  app.post('/api/public/portal-login', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const rawPhone = String(req.body?.phone || '').trim();
    const pin = String(req.body?.pin || '').trim();
    const cleanPhone = normalizeSubscriptionPhone(rawPhone);

    // 1. Check if user is an Admin or Super Admin
    const adminUser = tenantManager.registry.verifyAdminByPhoneAndPin(rawPhone, pin);
    if (adminUser) {
      const adminToken = 'adm_' + crypto.randomBytes(32).toString('hex');
      adminSessions.set(adminToken, {
        username: adminUser.username,
        displayName: adminUser.displayName,
        role: adminUser.role,
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
      });
      res.setHeader('Set-Cookie', `cardoso_admin_session=${adminToken}; Path=/; Max-Age=604800; SameSite=Lax`);
      res.json({
        status: 'ok',
        isAdmin: true,
        portalUrl: `/?admin_token=${adminToken}`,
        admin: adminUser,
        message: `Ku soo dhawoow Dashboard-ka Maamulka, ${adminUser.displayName}!`,
      });
      return;
    }

    // 2. Check if user is the Owner
    const isOwnerPhone = tenantManager.isOwnerPhone(rawPhone) ||
      (cleanPhone && tenantManager.registry.getTenant('owner')?.allowedPhone &&
       normalizeSubscriptionPhone(tenantManager.registry.getTenant('owner')!.allowedPhone) === cleanPhone);
    const ownerTenantPin = tenantManager.registry.verifyTenantPin(rawPhone, pin);
    const matchesStudioPassword = Boolean(studioPassword && pin === studioPassword);
    const isOwnerLogin = matchesStudioPassword || (isOwnerPhone && ownerTenantPin?.id === 'owner');

    if (isOwnerLogin) {
      const adminToken = 'adm_' + crypto.randomBytes(32).toString('hex');
      adminSessions.set(adminToken, {
        username: rawPhone || 'owner',
        displayName: 'Owner Super Admin',
        role: 'super_admin',
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
      });
      res.setHeader('Set-Cookie', `cardoso_admin_session=${adminToken}; Path=/; Max-Age=604800; SameSite=Lax`);
      res.json({
        status: 'ok',
        isAdmin: true,
        portalUrl: `/?admin_token=${adminToken}`,
        admin: {
          id: 'adm_owner',
          username: 'owner',
          displayName: 'Owner Super Admin',
          phoneNumber: cleanPhone || tenantManager.registry.getTenant('owner')?.allowedPhone || config.security.adminPhoneNumbers[0] || '252634949642',
          role: 'super_admin',
          active: true,
          createdAt: Date.now(),
        },
        message: 'Ku soo dhawoow Dashboard-ka Maamulka (Owner)!',
      });
      return;
    }

    // 3. Fall through to subscriber verification
    const tenant = tenantManager.registry.verifyTenantPin(rawPhone, pin);
    if (!tenant) {
      res.status(401).json({ status: 'error', message: 'Lambarka ama PIN-ka ma saxna.' });
      return;
    }
    const portalUrl = `/client/${encodeURIComponent(tenant.id)}?token=${encodeURIComponent(tenant.accessToken)}`;
    res.json({
      status: 'ok',
      isAdmin: false,
      portalUrl,
      tenant: sanitizeTenantForResponse(tenant, true),
    });
  });

  app.post('/api/public/portal-otp/request', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const phone = String(req.body?.phone || '').trim();
    const result = await tenantManager.requestPortalOtp(phone);
    res.status(result.sent ? 200 : 400).json({
      status: result.sent ? 'ok' : 'error',
      ...result,
    });
  });

  app.post('/api/public/portal-otp/verify', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const phone = String(req.body?.phone || '').trim();
    const code = String(req.body?.code || '').trim();
    const result = tenantManager.verifyPortalOtp(phone, code);
    if (!result) {
      res.status(401).json({ status: 'error', message: 'Code-ka xaqiijinta ma saxna ama wuu dhacay.' });
      return;
    }
    if ((result as any).isAdmin) {
      const adminUser = (result as any).adminUser;
      const adminToken = 'adm_' + crypto.randomBytes(32).toString('hex');
      adminSessions.set(adminToken, {
        username: adminUser?.username || 'admin',
        displayName: adminUser?.displayName || 'Admin',
        role: adminUser?.role || 'staff_admin',
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
      });
      res.setHeader('Set-Cookie', `cardoso_admin_session=${adminToken}; Path=/; Max-Age=604800; SameSite=Lax`);
      res.json({
        status: 'ok',
        isAdmin: true,
        portalUrl: `/?admin_token=${adminToken}`,
        admin: adminUser,
      });
      return;
    }
    const portalUrl = `/client/${encodeURIComponent(result.id)}?token=${encodeURIComponent(result.accessToken)}`;
    res.json({ status: 'ok', isAdmin: false, portalUrl, tenant: sanitizeTenantForResponse(result, true) });
  });

  app.get('/api/public/template', (req: Request, res: Response) => {
    const category = sanitizeCategory(req.query.category);
    const name = typeof req.query.name === 'string' ? req.query.name : undefined;
    const template = getCategoryStarterTemplate(category, name);
    res.json({ status: 'ok', template });
  });

  app.post('/api/public/join', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Multi-tenant mode ma firfircoona.' });
      return;
    }
    try {
      const { name, phone, category, promoCode, notes, pin } = req.body || {};
      const result = await tenantManager.registerPublicSignup({
        name: String(name || ''),
        phone: String(phone || ''),
        category: sanitizeCategory(category),
        promoCode: promoCode ? String(promoCode) : undefined,
        notes: notes ? String(notes) : undefined,
        pin: pin ? String(pin) : undefined,
      });

      const t = result.tenant;
      const portalUrl = `/client/${encodeURIComponent(t.id)}?token=${encodeURIComponent(t.accessToken)}`;
      res.status(201).json({
        status: 'ok',
        autoApproved: result.autoApproved,
        portalUrl,
        tenant: {
          id: t.id,
          name: t.name,
          allowedPhone: t.allowedPhone,
          category: t.category,
          status: t.status,
          planTier: t.planTier,
        },
      });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err?.message || 'Diiwaangelintu way fashilantay' });
    }
  });

  // ─── 2. Token-Protected Client Self-Service Portal & APIs ──────────────────
  const resolveAuthenticatedClient = (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Multi-tenant mode ma shaqaynayo.' });
      return null;
    }
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const token =
      (typeof req.query.token === 'string' && req.query.token) ||
      (typeof req.headers['x-client-token'] === 'string' && req.headers['x-client-token']) ||
      (req.body && typeof req.body.token === 'string' ? req.body.token : '');

    const tenant = tenantManager.registry.verifyClientToken(rawId, token);
    if (!tenant) {
      res.status(401).json({ status: 'error', message: 'Link-ga ama token-kaaga ma saxna.' });
      return null;
    }
    return tenant;
  };

  app.get('/client/:id', (req: Request, res: Response) => {
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant) return;
    const token = String(req.query.token || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderClientPortalHTML(tenant.id, token, tenant.category));
  });

  app.get('/api/client/:id/status', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant) return;

    const isActive = tenantManager.registry.isTenantActive(tenant);
    const ctx = tenantManager.getContext(tenant.id);
    const leads = ctx ? await ctx.memory.getLeads(500) : [];

    res.json({
      status: 'ok',
      isActive,
      tenant: sanitizeTenantForResponse(tenant),
      whatsapp: {
        connected: Boolean(ctx?.transport?.isConnected),
        botNumber: ctx?.transport?.getBotNumber() || null,
        currentQR: ctx?.transport?.currentQR || null,
        currentPairingCode: ctx?.transport?.currentPairingCode || null,
        pairingError: ctx?.transport?.pairingError || null,
        securityBlockReason: ctx?.transport?.lastSecurityBlockReason || null,
      },
      contacts: ctx?.broadcast.getStats() || { total: 0, withNames: 0, sent: 0, remaining: 0, sentToday: 0, dailyLimit: 0, optedOut: 0 },
      leadsCount: leads.length,
      usage: ctx?.quotaTracker.getFeatureUsage() || { aiCalls: 0, voiceCalls: 0, imageCalls: 0, broadcastCalls: 0 },
    });
  });

  const requireActiveClientCtx = async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return null;
    }
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant) return null;
    if (!tenantManager.registry.isTenantActive(tenant)) {
      res.status(403).json({
        status: 'error',
        message: `Akoonkan hadda ma firfircoona (${tenant.status}). Fadlan la xidhiidh maamulka si loo furo ama loo cusboonaysiiyo.`,
      });
      return null;
    }
    const ctx = await tenantManager.mountTenant(tenant, false);
    return { tenant, ctx };
  };

  app.get('/api/client/:id/config', async (req: Request, res: Response) => {
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant || !tenantManager) return;
    const ctx = await tenantManager.mountTenant(tenant, false);
    const botConfig = await ctx.memory.getBotConfig();
    res.json({
      status: 'ok',
      config: botConfig,
      tenant: sanitizeTenantForResponse(tenant),
    });
  });

  app.post('/api/client/:id/config', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair || !tenantManager) return;
    const { tenant, ctx } = pair;
    try {
      const { category, botName, businessName, systemRole, knowledgeBase } = req.body || {};
      await ctx.memory.saveBotConfig({
        botName: (botName || '').trim(),
        businessName: (businessName || '').trim(),
        systemRole: (systemRole || '').trim(),
        knowledgeBase: (knowledgeBase || '').trim(),
      });
      if (category) {
        tenantManager.updateTenantAndRefresh(tenant.id, { category: sanitizeCategory(category) });
      }
      tenantManager.markTenantDirty(tenant.id, ['db'], true);
      res.json({ status: 'ok', message: 'Maskaxda bot-ka & hab-dhaqanka si guul leh ayaa loo keydiyay!' });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.put('/api/client/:id/settings', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair || !tenantManager) return;
    const { tenant } = pair;
    const { awayMode, customGeminiKey, extraAdmins, pin } = req.body || {};
    try {
      if (pin !== undefined && String(pin).trim().length > 0) {
        tenantManager.registry.setTenantPin(tenant.id, String(pin));
        tenantManager.markRegistryDirty(true);
      }
      const updated = tenantManager.updateTenantAndRefresh(tenant.id, {
        ...(awayMode !== undefined ? { awayMode: Boolean(awayMode) } : {}),
        ...(customGeminiKey !== undefined ? { customGeminiKey: String(customGeminiKey) } : {}),
        ...(Array.isArray(extraAdmins) ? { extraAdmins: extraAdmins.map((s: any) => String(s || '')) } : {}),
      });
      if (updated) {
        tenantManager.markRegistryDirty(true);
      }
      res.json({
        status: 'ok',
        tenant: updated ? sanitizeTenantForResponse(updated) : null,
      });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err?.message || 'Settings update failed' });
    }
  });

  app.post('/api/client/:id/pair', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair || !tenantManager) return;
    const result = await tenantManager.requestPairingCode(pair.tenant.id, req.body?.phone);
    if (result.success) {
      res.json({ status: 'ok', code: result.code, formattedCode: result.formattedCode, phone: result.phone });
    } else {
      res.status(400).json({ status: 'error', message: result.error || 'Pairing code lama soo saari karin' });
    }
  });

  app.post('/api/client/:id/sync-contacts', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair || !tenantManager) return;
    const result = await tenantManager.syncTenantContacts(pair.tenant.id);
    res.json({ status: 'ok', ...result });
  });

  app.post('/api/client/:id/unlink', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair || !tenantManager) return;
    await tenantManager.unlinkTenantSession(pair.tenant.id);
    res.json({ status: 'ok', message: 'WhatsApp session waa la furay.' });
  });

  app.post('/api/client/:id/test-chat', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    try {
      const userMessage = String(req.body?.message || '').trim();
      if (!userMessage) {
        res.status(400).json({ status: 'error', message: 'Fariintu ma bannaana' });
        return;
      }
      const output = await pair.ctx.engine.processMessage({
        rawSenderId: 'client_web_preview_user',
        chatId: 'client_web_preview_chat',
        isGroup: false,
        content: userMessage,
        senderName: 'Macmiil Tijaabo',
      });
      res.json({ status: 'ok', reply: output.replyText });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/client/:id/leads', async (req: Request, res: Response) => {
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant || !tenantManager) return;
    const ctx = await tenantManager.mountTenant(tenant, false);
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allLeads = await ctx.memory.getLeads(200);
    const leads = statusFilter ? allLeads.filter((l) => l.status === statusFilter) : allLeads;
    res.json({ status: 'ok', leads });
  });

  app.patch('/api/client/:id/leads/:leadId', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const leadId = Number(req.params.leadId);
    const nextStatus = req.body?.status;
    if (!['new', 'contacted', 'resolved', 'closed'].includes(nextStatus)) {
      res.status(400).json({ status: 'error', message: 'Invalid lead status' });
      return;
    }
    const ok = await pair.ctx.memory.updateLeadStatus(leadId, nextStatus);
    if (ok) {
      tenantManager?.markTenantDirty(pair.tenant.id, ['db'], false);
    }
    res.json({ status: ok ? 'ok' : 'error' });
  });

  app.get('/api/client/:id/auto-replies', async (req: Request, res: Response) => {
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant || !tenantManager) return;
    const ctx = await tenantManager.mountTenant(tenant, false);
    const autoReplies = await ctx.memory.getAutoReplies();
    res.json({ status: 'ok', autoReplies });
  });

  app.post('/api/client/:id/auto-replies', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const { keyword, replyText } = req.body || {};
    if (!keyword || !replyText) {
      res.status(400).json({ status: 'error', message: 'Ereyga iyo jawaabta waa waajib' });
      return;
    }
    await pair.ctx.memory.saveAutoReply(String(keyword), String(replyText));
    tenantManager?.markTenantDirty(pair.tenant.id, ['db'], false);
    res.json({ status: 'ok', message: 'Auto-reply waa la keydiyay' });
  });

  app.delete('/api/client/:id/auto-replies/:keyword', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const kw = Array.isArray(req.params.keyword) ? req.params.keyword[0] : req.params.keyword;
    if (kw) {
      await pair.ctx.memory.deleteAutoReply(kw);
      tenantManager?.markTenantDirty(pair.tenant.id, ['db'], false);
    }
    res.json({ status: 'ok' });
  });

  app.get('/api/client/:id/status/reactor', async (req: Request, res: Response) => {
    const tenant = resolveAuthenticatedClient(req, res);
    if (!tenant || !tenantManager) return;
    const ctx = await tenantManager.mountTenant(tenant, false);
    res.json({
      status: 'ok',
      autoView: ctx.whatsappManager.isAutoViewStatusEnabled(),
      config: ctx.statusReactor.getConfig(),
      recent: ctx.statusReactor.getRecentInteractions(),
    });
  });

  app.post('/api/client/:id/status/master-view', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const isEn = Boolean(req.body?.enabled);
    if (isEn) {
      const check = pair.ctx.planGuard.checkFeature('status_reactor');
      if (!check.allowed) {
        res.status(403).json({ status: 'error', message: check.reason });
        return;
      }
    }
    pair.ctx.whatsappManager.setAutoViewStatus(isEn);
    const updated = pair.ctx.statusReactor.setConfig({
      enabled: isEn,
      autoReact: isEn,
      autoComment: isEn,
      mode: 'both',
    });
    tenantManager?.markTenantDirty(pair.tenant.id, ['meta'], false);
    res.json({
      status: 'ok',
      config: updated,
      message: isEn ? 'Status Reactor & Auto-View ON' : 'Status Reactor OFF',
    });
  });

  app.post('/api/client/:id/status/post', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const check = pair.ctx.planGuard.checkFeature('status_post');
    if (!check.allowed) {
      res.status(403).json({ status: 'error', message: check.reason });
      return;
    }
    const text = String(req.body?.text || '').trim();
    if (!text) {
      res.status(400).json({ status: 'error', message: 'Qor qoraalka status-ka' });
      return;
    }
    const result = await pair.ctx.whatsappManager.postTextStatus(text, { backgroundColor: req.body?.color });
    if (result?.success) {
      tenantManager?.markTenantDirty(pair.tenant.id, ['meta'], false);
    }
    res.json(result);
  });

  app.post('/api/client/:id/broadcast', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const check = pair.ctx.planGuard.checkFeature('broadcast');
    if (!check.allowed) {
      res.status(403).json({ status: 'error', message: check.reason });
      return;
    }
    const text = String(req.body?.text || '').trim();
    if (!text) {
      res.status(400).json({ status: 'error', message: 'Fadlan qor fariinta' });
      return;
    }
    if (!pair.ctx.transport) {
      res.status(400).json({ status: 'error', message: 'WhatsApp ma xidhna' });
      return;
    }
    const result = await pair.ctx.broadcast.startDirectBroadcast('client_portal', text, pair.ctx.transport, 50);
    if (result.success) {
      pair.ctx.planGuard.recordUsage('broadcast');
    }
    res.json({ status: 'ok', message: result.message, success: result.success });
  });

  app.post('/api/client/:id/broadcast/abort', async (req: Request, res: Response) => {
    const pair = await requireActiveClientCtx(req, res);
    if (!pair) return;
    const aborted = pair.ctx.broadcast.abortBroadcast();
    res.json({ status: 'ok', aborted, message: aborted ? '🛑 Broadcast waa la joojiyay' : 'Ma jirto fariin socota' });
  });

  // ─── 3. Multi-Admin Authentication Middleware (Owner + Sub-Admins) ────────
  const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
    const dbAdmins = tenantManager ? tenantManager.registry.listAdminUsers() : [];
    if (!studioPassword && dbAdmins.length === 0) {
      res.status(503).send('Studio is locked. Set STUDIO_PASSWORD environment variable to enable the dashboard.');
      return;
    }

    // 1. Session Token Auth (via Query, Header, or Cookie)
    const cookies = parseCookies(req.headers.cookie);
    const queryToken = typeof req.query.admin_token === 'string' ? req.query.admin_token : '';
    const headerToken = typeof req.headers['x-admin-token'] === 'string' ? req.headers['x-admin-token'] : '';
    const cookieToken = cookies['cardoso_admin_session'] || '';

    const token = queryToken || headerToken || cookieToken;
    if (token) {
      const session = adminSessions.get(token);
      if (session && session.expiresAt > Date.now()) {
        (req as any).adminLabel = `${session.displayName} (${session.role})`;
        if (queryToken && !cookieToken) {
          res.setHeader('Set-Cookie', `cardoso_admin_session=${token}; Path=/; Max-Age=604800; SameSite=Lax`);
        }
        next();
        return;
      }
    }

    // 2. HTTP Basic Auth (for backwards compatibility / direct API clients)
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const username = idx >= 0 ? decoded.slice(0, idx) : '';
      const password = idx >= 0 ? decoded.slice(idx + 1) : decoded;

      if (studioPassword && password === studioPassword) {
        (req as any).adminLabel = username ? `${username} (Owner)` : 'Owner Super Admin';
        next();
        return;
      }

      if (tenantManager && username && password) {
        const verified = tenantManager.registry.verifyAdminUser(username, password);
        if (verified) {
          (req as any).adminLabel = `${verified.displayName} (${verified.role})`;
          next();
          return;
        }
      }
    }

    // 3. If browser navigates directly to root HTML page, redirect to /admin-login
    if (req.method === 'GET' && req.accepts && req.accepts('html') && (req.path === '/' || req.path === '/admin' || req.path === '/dashboard')) {
      res.redirect('/admin-login');
      return;
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="CARDOSO AI Admin Studio"');
    res.status(401).send('Furaha sirta ah ayaa loo baahan yahay.');
  };

  app.use(requireAdminAuth);

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = (typeof req.query.admin_token === 'string' && req.query.admin_token) ||
      (typeof req.headers['x-admin-token'] === 'string' && req.headers['x-admin-token']) ||
      cookies['cardoso_admin_session'];
    if (token) {
      adminSessions.delete(token);
    }
    res.setHeader('Set-Cookie', 'cardoso_admin_session=; Path=/; Max-Age=0; SameSite=Lax');
    res.json({ status: 'ok', message: 'Logged out' });
  });

  // ─── 4. Super Admin SaaS Management APIs ───────────────────────────────────
  app.get('/api/admin/tenants', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Multi-tenant mode ma shaqaynayo.' });
      return;
    }
    const list = tenantManager.registry.listTenants(false).map((t) => {
      const ctx = tenantManager.getContext(t.id);
      return {
        ...sanitizeTenantForResponse(t, false),
        runtime: {
          connected: Boolean(ctx?.transport?.isConnected),
          botNumber: ctx?.transport?.getBotNumber() || null,
          contactsCount: ctx?.broadcast.getStats().total || 0,
        },
      };
    });

    const summary = {
      total: list.length,
      active: list.filter((t) => t.status === 'active').length,
      pending: list.filter((t) => t.status === 'pending').length,
      expired: list.filter((t) => t.status === 'expired').length,
      suspended: list.filter((t) => t.status === 'suspended').length,
      expiringSoon: tenantManager.registry.getExpiringSoon(3).length,
      adminUsers: tenantManager.registry.listAdminUsers().length,
    };

    res.json({ status: 'ok', tenants: list, summary });
  });

  app.post('/api/admin/tenants', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Multi-tenant mode ma shaqaynayo.' });
      return;
    }
    try {
      const { name, phone, category, planTier, months, durationDays, customGeminiKey, notes } = req.body || {};
      const ctx = await tenantManager.createAndStartSubscriber({
        name: String(name || ''),
        phone: String(phone || ''),
        category: sanitizeCategory(category),
        planTier: sanitizePlanTier(planTier, 'trial_free'),
        months: months ? Number(months) : 1,
        durationDays: durationDays ? Number(durationDays) : undefined,
        customGeminiKey: customGeminiKey ? String(customGeminiKey) : undefined,
        notes: notes ? String(notes) : undefined,
      });
      res.status(201).json({
        status: 'ok',
        tenant: sanitizeTenantForResponse(ctx.tenant, false),
      });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err?.message || 'Lama abuuri karin' });
    }
  });

  app.patch('/api/admin/tenants/:id', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { name, allowedPhone, category, planTier, features, customGeminiKey, awayMode, extraAdmins } = req.body || {};
    const updated = tenantManager.updateTenantAndRefresh(id, {
      ...(name !== undefined ? { name: String(name) } : {}),
      ...(allowedPhone !== undefined ? { allowedPhone: String(allowedPhone) } : {}),
      ...(category !== undefined ? { category: sanitizeCategory(category) } : {}),
      ...(planTier !== undefined ? { planTier: sanitizePlanTier(planTier) } : {}),
      ...(features && typeof features === 'object' ? { features } : {}),
      ...(customGeminiKey !== undefined ? { customGeminiKey: String(customGeminiKey) } : {}),
      ...(awayMode !== undefined ? { awayMode: Boolean(awayMode) } : {}),
      ...(Array.isArray(extraAdmins) ? { extraAdmins } : {}),
    });
    if (!updated) {
      res.status(404).json({ status: 'error', message: 'Subscriber not found' });
      return;
    }
    res.json({ status: 'ok', tenant: sanitizeTenantForResponse(updated) });
  });

  app.post('/api/admin/tenants/:id/approve', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await tenantManager.approveAndStartTenant(id, {
      planTier: sanitizePlanTier(req.body?.planTier, 'trial_free'),
      months: req.body?.months ? Number(req.body.months) : 1,
      durationDays: req.body?.durationDays ? Number(req.body.durationDays) : undefined,
    });
    if (!updated) {
      res.status(404).json({ status: 'error', message: 'Tenant not found' });
      return;
    }
    res.json({
      status: 'ok',
      tenant: sanitizeTenantForResponse(updated),
      pairingCode: (updated as any).generatedPairingCode || null,
    });
  });

  app.post('/api/admin/tenants/:id/reject', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = tenantManager.registry.rejectTenant(id);
    if (updated) tenantManager.markRegistryDirty(true);
    res.json({ status: updated ? 'ok' : 'error', tenant: updated ? sanitizeTenantForResponse(updated) : null });
  });

  app.post('/api/admin/tenants/:id/renew', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const months = Number(req.body?.months || 1);
    const nextTier = req.body?.planTier ? sanitizePlanTier(req.body.planTier) : undefined;
    const durationDays = req.body?.durationDays ? Number(req.body.durationDays) : undefined;
    const updated = await tenantManager.renewAndRestartTenant(id, months, nextTier, durationDays);
    if (!updated) {
      res.status(404).json({ status: 'error', message: 'Subscriber not found' });
      return;
    }
    res.json({ status: 'ok', tenant: sanitizeTenantForResponse(updated) });
  });

  app.post('/api/admin/tenants/:id/suspend', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await tenantManager.suspendAndStopTenant(id, req.body?.reason);
    res.json({ status: updated ? 'ok' : 'error', tenant: updated ? sanitizeTenantForResponse(updated) : null });
  });

  app.post('/api/admin/tenants/:id/activate', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await tenantManager.activateAndStartTenant(id);
    res.json({ status: updated ? 'ok' : 'error', tenant: updated ? sanitizeTenantForResponse(updated) : null });
  });

  app.delete('/api/admin/tenants/:id', async (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = await tenantManager.deleteTenantAndCleanup(id);
    res.json({ status: ok ? 'ok' : 'error' });
  });

  // Multi-Admin User CRUD
  app.get('/api/admin/admins', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    res.json({ status: 'ok', admins: tenantManager.registry.listAdminUsers() });
  });

  app.post('/api/admin/admins', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    try {
      const admin = tenantManager.registry.createAdminUser({
        username: String(req.body?.username || ''),
        password: String(req.body?.password || ''),
        displayName: String(req.body?.displayName || ''),
        phoneNumber: req.body?.phoneNumber ? String(req.body.phoneNumber) : '',
        role: req.body?.role === 'super_admin' ? 'super_admin' : 'staff_admin',
      });
      tenantManager.markRegistryDirty(true);
      res.status(201).json({ status: 'ok', admin });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err?.message || 'Admin lama abuuri karin' });
    }
  });

  app.patch('/api/admin/admins/:id', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = tenantManager.registry.toggleAdminUser(id, Boolean(req.body?.active));
    if (ok) tenantManager.markRegistryDirty(true);
    res.json({ status: ok ? 'ok' : 'error' });
  });

  app.delete('/api/admin/admins/:id', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = tenantManager.registry.deleteAdminUser(id);
    if (ok) tenantManager.markRegistryDirty(true);
    res.json({ status: ok ? 'ok' : 'error' });
  });

  // Promo Codes CRUD
  app.get('/api/admin/promos', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    res.json({ status: 'ok', promos: tenantManager.registry.listPromoCodes() });
  });

  app.post('/api/admin/promos', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    try {
      const promo = tenantManager.registry.createPromoCode({
        code: String(req.body?.code || ''),
        planTier: sanitizePlanTier(req.body?.planTier, 'trial_free'),
        durationDays: Number(req.body?.durationDays || 30),
        maxUses: Number(req.body?.maxUses || 10),
      });
      tenantManager.markRegistryDirty(true);
      res.status(201).json({ status: 'ok', promo });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err?.message || 'Promo code lama abuuri karin' });
    }
  });

  app.patch('/api/admin/promos/:code', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.status(503).json({ status: 'error', message: 'Unavailable' });
      return;
    }
    const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const ok = tenantManager.registry.togglePromoCode(code, Boolean(req.body?.active));
    if (ok) tenantManager.markRegistryDirty(true);
    res.json({ status: ok ? 'ok' : 'error' });
  });

  // Cloud State Backup Status & Manual Sync (Neon $0 Postgres Persistence)
  app.get('/api/admin/cloud-sync', (req: Request, res: Response) => {
    const cloudSync = tenantManager?.getCloudSync();
    if (!cloudSync) {
      res.json({
        status: 'ok',
        enabled: false,
        initialized: false,
        lastSyncedAt: null,
        lastError: null,
        pendingDirtyCount: 0,
      });
      return;
    }
    res.json({
      status: 'ok',
      enabled: true,
      ...cloudSync.getStatus(),
    });
  });

  app.post('/api/admin/cloud-sync', async (req: Request, res: Response) => {
    const cloudSync = tenantManager?.getCloudSync();
    if (!tenantManager || !cloudSync) {
      res.status(400).json({
        status: 'error',
        message: 'CLOUD_DB_URL lama gelin Render Environment Variables. Ku dar Neon PostgreSQL URL ($0) si backup joogto ah u shaqeeyo.',
      });
      return;
    }
    try {
      const tenantIds = tenantManager.registry.listTenants(true).map((t) => t.id);
      const result = await cloudSync.syncAllActiveNow(tenantIds);
      res.json({
        status: 'ok',
        synced: result.synced,
        ...cloudSync.getStatus(),
        message: `Backup-ka Cloud DB waa guuleystay (${result.synced} files synced).`,
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err?.message || 'Cloud sync failed' });
    }
  });

  // ─── 5. Owner Bot Endpoints (Backwards Compatible) ─────────────────────────
  app.get('/api/status', (req: Request, res: Response) => {
    const { transport, broadcast } = getOwnerRefs();
    const isBaileys = transport instanceof WhatsAppBaileysTransport;
    const isConnected = isBaileys ? (transport as WhatsAppBaileysTransport).isConnected : true;
    const currentQR = isBaileys ? (transport as WhatsAppBaileysTransport).currentQR : null;
    const currentPairingCode = isBaileys ? (transport as WhatsAppBaileysTransport).currentPairingCode : null;
    const botNumber = isBaileys ? (transport as WhatsAppBaileysTransport).getBotNumber() : null;
    const stats = broadcast.getStats();

    res.json({
      status: 'ok',
      mode: config.messaging.mode,
      isConnected,
      currentQR,
      currentPairingCode,
      botNumber,
      contacts: stats,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.post('/api/owner/pair', async (req: Request, res: Response) => {
    const { transport } = getOwnerRefs();
    if (!(transport instanceof WhatsAppBaileysTransport)) {
      res.status(400).json({ status: 'error', message: 'Baileys transport is not active.' });
      return;
    }
    const phone = String(req.body?.phone || config.security.adminPhoneNumbers[0] || '');
    const result = await transport.requestPairingCodeForTenant(phone);
    if (result.success) {
      res.json({ status: 'ok', code: result.code, formattedCode: result.formattedCode, phone: result.phone });
    } else {
      res.status(400).json({ status: 'error', message: result.error || 'Pairing failed' });
    }
  });

  app.post('/api/owner/sync-contacts', async (req: Request, res: Response) => {
    const { transport } = getOwnerRefs();
    if (!(transport instanceof WhatsAppBaileysTransport)) {
      res.status(400).json({ status: 'error', message: 'Baileys transport is not active.' });
      return;
    }
    const result = await transport.syncContactsFromWhatsApp(true);
    if (result.synced) {
      tenantManager?.markTenantDirty('owner', ['db'], false);
    }
    res.json({ status: 'ok', ...result });
  });

  app.get('/api/owner/leads', async (req: Request, res: Response) => {
    const { memory } = getOwnerRefs();
    const leads = await memory.getLeads(150);
    res.json({ status: 'ok', leads });
  });

  app.get('/api/owner/groups', async (req: Request, res: Response) => {
    try {
      const { whatsappManager, transport } = getOwnerRefs();
      if (!whatsappManager.hasSocket() && transport && typeof (transport as any).getSocket === 'function') {
        const sock = (transport as any).getSocket();
        if (sock) whatsappManager.setSocket(sock);
      }
      const groups = await whatsappManager.listParticipatingGroups();
      res.json({ status: 'ok', groups });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message, groups: [] });
    }
  });

  app.post('/api/owner/send-voice-group', async (req: Request, res: Response) => {
    try {
      const { groupJids, groupJid, title, audioBase64, text, audioUrl } = req.body || {};
      const targets: string[] = Array.isArray(groupJids) ? groupJids : (groupJid ? [groupJid] : []);
      if (targets.length === 0) {
        res.status(400).json({ status: 'error', message: 'Fadlan dooro ugu yaraan hal koox' });
        return;
      }

      let opusBuffer: Buffer | null = null;
      if (audioUrl && String(audioUrl).trim()) {
        const cleanUrl = String(audioUrl).trim();
        try {
          const fetchRes = await fetch(cleanUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });
          if (!fetchRes.ok) {
            res.status(400).json({ status: 'error', message: `Link-ga codka lama soo dejin karin (HTTP ${fetchRes.status}: ${fetchRes.statusText})` });
            return;
          }
          const rawBuf = Buffer.from(await fetchRes.arrayBuffer());
          if (rawBuf.length === 0) {
            res.status(400).json({ status: 'error', message: 'Faylka laga soo dejiyay link-ga waa faaruq (0 bytes)' });
            return;
          }
          if (rawBuf.slice(0, 4).toString() === 'OggS') {
            opusBuffer = rawBuf;
          } else {
            opusBuffer = await VoiceReplyService.convertMp3ToOggOpus(rawBuf);
          }
        } catch (fetchErr: any) {
          res.status(400).json({ status: 'error', message: `Cilad soo dejinta link-ga codka: ${fetchErr?.message}` });
          return;
        }
      } else if (audioBase64) {
        const rawBuf = Buffer.from(audioBase64.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
        if (rawBuf.slice(0, 4).toString() === 'OggS') {
          opusBuffer = rawBuf;
        } else {
          opusBuffer = await VoiceReplyService.convertMp3ToOggOpus(rawBuf);
        }
      } else if (text && String(text).trim()) {
        const synth = await VoiceReplyService.synthesizeVoice(String(text).trim(), 'so');
        if (synth) opusBuffer = synth.buffer;
      }

      if (!opusBuffer || opusBuffer.length === 0) {
        res.status(400).json({ status: 'error', message: 'Fadlan soo geli link, fayl cod ah, ama qor qoraal cod loo rogo' });
        return;
      }

      const { whatsappManager, transport } = getOwnerRefs();
      const results: Array<{ jid: string; success: boolean; error?: string }> = [];
      for (const jid of targets) {
        const sent = await whatsappManager.sendVoiceNoteToGroup(jid, opusBuffer, title, transport);
        results.push({ jid, ...sent });
      }

      const sentCount = results.filter(r => r.success).length;
      res.json({
        status: 'ok',
        message: `🎙️ Voice Note-kii si guul leh ayaa loogu diray ${sentCount} kooxood!`,
        sentCount,
        results,
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/owner/auto-add/status', async (req: Request, res: Response) => {
    try {
      const groupJid = String(req.query.groupJid || '').trim();
      const { whatsappManager } = getOwnerRefs();
      if (!groupJid) {
        res.status(400).json({ status: 'error', message: 'groupJid is required' });
        return;
      }
      const config = whatsappManager.getAutoAddConfig(groupJid);
      const counts = await whatsappManager.getEligibleContactsCount(groupJid);
      res.json({ status: 'ok', config, counts });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/owner/auto-add/toggle', async (req: Request, res: Response) => {
    try {
      const { groupJid, enabled, dailyLimit } = req.body || {};
      if (!groupJid) {
        res.status(400).json({ status: 'error', message: 'groupJid is required' });
        return;
      }
      const { whatsappManager } = getOwnerRefs();
      const updated = whatsappManager.setAutoAddConfig(groupJid, {
        enabled: Boolean(enabled),
        ...(typeof dailyLimit === 'number' ? { dailyLimit } : {}),
      });
      res.json({
        status: 'ok',
        message: updated.enabled ? '🟢 Ku-darista tooska ah waa la shiday' : '🛑 Ku-darista tooska ah waa la damiyay',
        config: updated,
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/owner/auto-add/run', async (req: Request, res: Response) => {
    try {
      const { groupJid, limit } = req.body || {};
      if (!groupJid) {
        res.status(400).json({ status: 'error', message: 'groupJid is required' });
        return;
      }
      const { whatsappManager } = getOwnerRefs();
      const result = await whatsappManager.autoAddDailyMembers(groupJid, typeof limit === 'number' ? limit : 5);
      res.json({ status: 'ok', ...result });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/config', async (req: Request, res: Response) => {
    try {
      const { memory } = getOwnerRefs();
      const botConfig = await memory.getBotConfig();
      res.json({ status: 'ok', config: botConfig });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/config', async (req: Request, res: Response) => {
    try {
      const { memory } = getOwnerRefs();
      const { botName, businessName, systemRole, knowledgeBase } = req.body;
      await memory.saveBotConfig({
        botName: (botName || '').trim(),
        businessName: (businessName || '').trim(),
        systemRole: (systemRole || '').trim(),
        knowledgeBase: (knowledgeBase || '').trim(),
      });
      tenantManager?.markTenantDirty('owner', ['db'], true);
      res.json({
        status: 'ok',
        message: '✅ Tababarka bot-ka iyo xogta meheradda si guul leh ayaa loo kaydiyay!',
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/test-chat', async (req: Request, res: Response) => {
    try {
      const { engine } = getOwnerRefs();
      const userMessage = (req.body.message || '').trim();
      if (!userMessage) {
        res.status(400).json({ status: 'error', message: 'Fariintu ma bannaana' });
        return;
      }

      const output = await engine.processMessage({
        rawSenderId: 'web_preview_user',
        chatId: 'web_preview_chat',
        isGroup: false,
        content: userMessage,
        senderName: 'Macmiil Web',
      });

      res.json({ status: 'ok', reply: output.replyText });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/broadcast', async (req: Request, res: Response) => {
    try {
      const { broadcast, transport } = getOwnerRefs();
      const text = (req.body.text || '').trim();
      if (!text) {
        res.status(400).json({ status: 'error', message: 'Fadlan qor qoraalka fariinta' });
        return;
      }

      const result = await broadcast.startDirectBroadcast('web_admin', text, transport, 50);
      res.json({ status: 'ok', message: result.message, success: result.success });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/broadcast/abort', (req: Request, res: Response) => {
    const { broadcast } = getOwnerRefs();
    const aborted = broadcast.abortBroadcast();
    res.json({ status: 'ok', aborted, message: aborted ? '🛑 Fariin-wadareedka waa la joojiyay' : 'Hadda ma jirto fariin socota' });
  });

  app.post('/api/unlink', async (req: Request, res: Response) => {
    const { transport } = getOwnerRefs();
    if (transport instanceof WhatsAppBaileysTransport) {
      await (transport as WhatsAppBaileysTransport).unlinkSession();
      await tenantManager?.getCloudSync()?.deleteAuthSnapshot('owner').catch(() => {});
      res.json({ status: 'ok', message: 'WhatsApp session waa la xidhay. QR cusub ayaa soo baxaya.' });
    } else {
      res.status(400).json({ status: 'error', message: 'Baileys transport is not active.' });
    }
  });

  app.post('/api/status/post', async (req: Request, res: Response) => {
    try {
      const { whatsappManager } = getOwnerRefs();
      const { text, color, font } = req.body;
      if (!text || !text.trim()) {
        res.status(400).json({ status: 'error', message: 'Fadlan qor qoraalka status-ka' });
        return;
      }
      const result = await whatsappManager.postTextStatus(text, {
        backgroundColor: color,
        font: font ? parseInt(font, 10) : undefined,
      });
      if (result?.success) {
        tenantManager?.markTenantDirty('owner', ['meta'], false);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/status/post-ai', async (req: Request, res: Response) => {
    try {
      const { whatsappManager } = getOwnerRefs();
      const { topic } = req.body;
      const result = await whatsappManager.generateAndPostAIStatus(topic);
      if (result?.success) {
        tenantManager?.markTenantDirty('owner', ['meta'], false);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/status/autoview', (req: Request, res: Response) => {
    const { whatsappManager } = getOwnerRefs();
    res.json({
      status: 'ok',
      enabled: whatsappManager.isAutoViewStatusEnabled(),
    });
  });

  app.post('/api/status/autoview', (req: Request, res: Response) => {
    const { whatsappManager } = getOwnerRefs();
    const { enabled } = req.body;
    whatsappManager.setAutoViewStatus(Boolean(enabled));
    tenantManager?.markTenantDirty('owner', ['meta'], false);
    res.json({
      status: 'ok',
      enabled: whatsappManager.isAutoViewStatusEnabled(),
      message: `Auto-View Status is now ${whatsappManager.isAutoViewStatusEnabled() ? 'ENABLED' : 'DISABLED'}`,
    });
  });

  app.get('/api/status/reactor', (req: Request, res: Response) => {
    const { statusReactor } = getOwnerRefs();
    res.json({
      status: 'ok',
      config: statusReactor.getConfig(),
      recent: statusReactor.getRecentInteractions(),
    });
  });

  app.post('/api/status/reactor', (req: Request, res: Response) => {
    const { statusReactor } = getOwnerRefs();
    const { enabled, autoReact, autoComment, mode, cooldownHours } = req.body;
    const updated = statusReactor.setConfig({
      ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(autoReact !== undefined ? { autoReact: Boolean(autoReact) } : {}),
      ...(autoComment !== undefined ? { autoComment: Boolean(autoComment) } : {}),
      ...(mode ? { mode } : {}),
      ...(cooldownHours !== undefined ? { cooldownHours: Number(cooldownHours) } : {}),
    });
    tenantManager?.markTenantDirty('owner', ['meta'], false);
    res.json({
      status: 'ok',
      config: updated,
      message: 'Status reactor settings updated successfully',
    });
  });

  app.post('/api/status/master-view', (req: Request, res: Response) => {
    const { whatsappManager, statusReactor } = getOwnerRefs();
    const { enabled } = req.body;
    const isEn = Boolean(enabled);
    whatsappManager.setAutoViewStatus(isEn);
    const updated = statusReactor.setConfig({
      enabled: isEn,
      autoReact: isEn,
      autoComment: isEn,
      mode: 'both',
    });
    tenantManager?.markTenantDirty('owner', ['meta'], false);
    res.json({
      status: 'ok',
      autoView: whatsappManager.isAutoViewStatusEnabled(),
      config: updated,
      message: `All-in-One Status Suite is now ${isEn ? 'ENABLED (ALL ON)' : 'DISABLED (ALL OFF)'}`,
    });
  });

  app.post('/api/direct-reply', async (req: Request, res: Response) => {
    try {
      const { whatsappManager, transport } = getOwnerRefs();
      const { phone, message: replyText } = req.body;
      if (!phone || !replyText) {
        res.status(400).json({ status: 'error', message: 'Fadlan geli lambarka iyo fariinta' });
        return;
      }
      const result = await whatsappManager.sendDirectReply(phone, replyText, transport);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/auto-replies', async (req: Request, res: Response) => {
    try {
      const { memory } = getOwnerRefs();
      const replies = memory.getAutoReplies ? await memory.getAutoReplies() : [];
      res.json({ status: 'ok', autoReplies: replies });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/auto-replies', async (req: Request, res: Response) => {
    try {
      const { memory } = getOwnerRefs();
      const { keyword, replyText } = req.body;
      if (!keyword || !replyText) {
        res.status(400).json({ status: 'error', message: 'Ereyga iyo jawaabta waa waajib' });
        return;
      }
      if (memory.saveAutoReply) {
        await memory.saveAutoReply(keyword, replyText);
        tenantManager?.markTenantDirty('owner', ['db'], false);
      }
      res.json({ status: 'ok', message: 'Auto-reply si guul leh ayaa loo keydiyay' });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.delete('/api/auto-replies/:keyword', async (req: Request, res: Response) => {
    try {
      const { memory } = getOwnerRefs();
      const keyword = (Array.isArray(req.params.keyword) ? req.params.keyword[0] : req.params.keyword) || '';
      if (memory.deleteAutoReply && keyword) {
        await memory.deleteAutoReply(keyword);
        tenantManager?.markTenantDirty('owner', ['db'], false);
      }
      res.json({ status: 'ok', message: `Auto-reply '${keyword}' waa la tirtiray` });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // ─── 6. Main Super Admin SaaS Dashboard UI ─────────────────────────────────
  app.get(['/', '/admin', '/dashboard'], (req: Request, res: Response) => {
    const adminLabel = (req as any).adminLabel || 'Owner Super Admin';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderAdminDashboardHTML(adminLabel));
  });

  return http.createServer(app);
}
