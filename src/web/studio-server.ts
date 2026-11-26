import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import zlib from 'zlib';
import crypto from 'crypto';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { IMessagingTransport } from '../transports/transport.interface.js';
import { WhatsAppBaileysTransport } from '../transports/whatsapp-baileys.js';
import { BroadcastService, broadcastService } from '../services/broadcast.service.js';
import { WhatsAppManagerService, whatsappManagerService } from '../services/whatsapp-manager.service.js';
import { StatusReactorService, statusReactorService } from '../services/status-reactor.service.js';
import {
  DEFAULT_CARDOSO_PROMO_DIALOGUE,
  DialogueTurn,
  PodcastSoundMode,
  PodcastStyle,
  VoiceReplyService,
} from '../services/voice-reply.service.js';
import { MediaUrlDownloaderService } from '../services/media-url-downloader.service.js';
import { PrayerTimesService } from '../services/prayer-times.service.js';
import { ViewsHubError, ViewsHubService } from '../services/views-hub.service.js';
import { AppConfig } from '../config/env.js';
import { BotCategory, PlanTier } from '../tenants/plan-catalog.js';
import { TenantManager } from '../tenants/tenant-manager.js';
import { normalizeSubscriptionPhone, TenantRecord } from '../tenants/tenant-registry.js';
import { getCategoryStarterTemplate } from '../tenants/tenant-templates.js';
import {
  buildWebManifest,
  getAppIconPng,
  getAppIconSvg,
  getServiceWorkerJS,
  renderOfflineHTML,
} from './pwa-assets.js';
import { renderJoinHTML } from './views/join-page.js';
import { renderClientPortalHTML } from './views/client-page.js';
import { renderAdminDashboardHTML } from './views/admin-page.js';
import { renderPortalLoginHTML } from './views/portal-login-page.js';
import { renderAdminLoginHTML } from './views/admin-login-page.js';
import { renderPwaAppHTML } from './views/app-page.js';
import { renderViewsHubHTML } from './views/views-hub-page.js';
import { createLiveCallRouter } from '../live-call/live-call.routes.js';
import { attachLivePeerWebSocket, LivePeerWebSocketHandle } from '../live-call/services/peer-match.service.js';
import { getLiveCallConfig } from '../live-call/live-call.config.js';

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
  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));

  // Zero-dependency Brotli + Gzip compression (~6x smaller HTML/JS/JSON on mobile networks!)
  app.use((req: Request, res: Response, next) => {
    const acceptEnc = String(req.headers['accept-encoding'] || '');
    const supportsBr = /\bbr\b/i.test(acceptEnc);
    const supportsGzip = /\bgzip\b/i.test(acceptEnc);
    if (!supportsBr && !supportsGzip) {
      next();
      return;
    }
    const origSend = res.send.bind(res);
    (res as any).send = (body?: any) => {
      if (res.headersSent || res.getHeader('Content-Encoding')) {
        return origSend(body);
      }
      if (body === undefined || body === null) {
        return origSend(body);
      }
      const ct = String(res.getHeader('Content-Type') || '').toLowerCase();
      const isTextLike =
        typeof body === 'string' ||
        ct.includes('text/') ||
        ct.includes('json') ||
        ct.includes('javascript') ||
        ct.includes('svg') ||
        ct.includes('manifest');
      if (!isTextLike) {
        return origSend(body);
      }
      const rawBuf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      if (rawBuf.length < 1024) {
        return origSend(body);
      }
      try {
        const useBr = supportsBr && typeof zlib.brotliCompressSync === 'function';
        const compressed = useBr
          ? zlib.brotliCompressSync(rawBuf, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
          })
          : zlib.gzipSync(rawBuf, { level: 6 });
        res.setHeader('Content-Encoding', useBr ? 'br' : 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', String(compressed.length));
        if (!res.getHeader('Content-Type')) {
          res.setHeader('Content-Type', typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
        }
        res.end(compressed);
        return res;
      } catch {
        return origSend(body);
      }
    };
    next();
  });
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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

  // ─── 1. Public Health, Installable PWA App, Views Hub & Self-Signup ────────
  const prayerTimesService = new PrayerTimesService();
  const viewsHub = new ViewsHubService(
    () => getOwnerRefs().memory.getDatabase(),
    config.security.adminPhoneNumbers[0] || ''
  );
  try {
    viewsHub.initialize();
  } catch (err: any) {
    console.warn('[ViewsHub] Deferred initialization:', err?.message || err);
  }

  app.get('/views', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderViewsHubHTML());
  });

  app.get('/api/views/summary', (req: Request, res: Response) => {
    try {
      const city = typeof req.query.city === 'string' ? req.query.city : undefined;
      const summary = viewsHub.getPublicSummary({ city });
      res.json({ status: 'ok', ...summary });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/views/join', (req: Request, res: Response) => {
    try {
      const { name, phone, countryCode, city, category, tagline, referredBy } = req.body || {};
      const result = viewsHub.joinContact({
        name: String(name || ''),
        phone: String(phone || ''),
        countryCode: typeof countryCode === 'string' ? countryCode : undefined,
        city: typeof city === 'string' ? city : undefined,
        category: typeof category === 'string' ? category : undefined,
        tagline: typeof tagline === 'string' ? tagline : undefined,
        referredBy: typeof referredBy === 'string' ? referredBy : undefined,
      });
      tenantManager?.markTenantDirty('owner', ['db'], false);
      res.status(201).json({
        status: 'ok',
        batchCompleted: result.batchCompleted,
        nextBatchOpened: result.nextBatchOpened,
        contact: {
          id: result.contact.id,
          displayName: result.contact.displayName,
          phone: result.contact.phone,
          city: result.contact.city,
          category: result.contact.category,
          batchNumber: result.contact.batchNumber,
          isVip: result.contact.isVip,
          hasDownloaded: result.contact.hasDownloaded,
          verifiedSaver: result.contact.verifiedSaver,
        },
      });
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 400;
      res.status(status).json({
        status: 'error',
        code: err instanceof ViewsHubError ? err.code : 'JOIN_FAILED',
        message: err.message || 'Isdiiwaangelinta Views Hub way fashilantay',
      });
    }
  });

  app.post('/api/views/lookup', (req: Request, res: Response) => {
    try {
      const { phone, countryCode } = req.body || {};
      const contact = viewsHub.lookupContactByPhone(
        String(phone || ''),
        typeof countryCode === 'string' ? countryCode : undefined
      );
      res.json({
        status: 'ok',
        contact: {
          id: contact.id,
          displayName: contact.displayName,
          phone: contact.phone,
          city: contact.city,
          category: contact.category,
          batchNumber: contact.batchNumber,
          isVip: contact.isVip,
          hasDownloaded: contact.hasDownloaded,
          verifiedSaver: contact.verifiedSaver,
        },
      });
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 400;
      res.status(status).json({
        status: 'error',
        code: err instanceof ViewsHubError ? err.code : 'LOOKUP_FAILED',
        message: err.message || 'Lambarka lama helin',
      });
    }
  });

  app.post('/api/views/verify', (req: Request, res: Response) => {
    try {
      const { phone, countryCode } = req.body || {};
      const contact = viewsHub.markVerifiedSaver(
        String(phone || ''),
        typeof countryCode === 'string' ? countryCode : undefined
      );
      tenantManager?.markTenantDirty('owner', ['db'], false);
      res.json({
        status: 'ok',
        message: '✅ Waad ku mahadsan tahay! Xaqiijintaada waa la diiwaangeliyay.',
        contact: {
          id: contact.id,
          displayName: contact.displayName,
          phone: contact.phone,
          verifiedSaver: contact.verifiedSaver,
        },
      });
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 400;
      res.status(status).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/views/download.vcf', (req: Request, res: Response) => {
    try {
      const scopeRaw = String(req.query.scope || 'current').trim();
      const scope: 'current' | 'all' | 'vip' | 'single' =
        scopeRaw === 'all' || scopeRaw === 'vip' || scopeRaw === 'single' ? scopeRaw : 'current';
      const contactId = req.query.id ? Number(req.query.id) : undefined;
      const city = typeof req.query.city === 'string' ? req.query.city : undefined;
      const batch = req.query.batch ? Number(req.query.batch) : undefined;
      const excludePhone = typeof req.query.myPhone === 'string' ? req.query.myPhone : undefined;

      const generated = viewsHub.generateVcf({
        scope,
        contactId,
        city,
        batch,
        excludePhone,
        isAdminBypass: false,
      });
      tenantManager?.markTenantDirty('owner', ['db'], false);

      const vcfBuf = Buffer.from(generated.vcfText, 'utf8');
      res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${generated.filename}"`);
      res.setHeader('Content-Length', String(vcfBuf.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Contacts-Count', String(generated.count));
      res.setHeader('X-Vip-Count', String(generated.vipCount));
      res.send(vcfBuf);
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 500;
      res.status(status).json({
        status: 'error',
        code: err instanceof ViewsHubError ? err.code : 'DOWNLOAD_FAILED',
        message: err.message || 'Faylka .vcf lama soo dejin karin',
      });
    }
  });

  const resolveAppTarget = async (tenantIdRaw?: unknown, tokenRaw?: unknown) => {
    const tid = String(tenantIdRaw || '').trim();
    const tok = String(tokenRaw || '').trim();
    if (tid && tok && tenantManager) {
      const tenant = tenantManager.registry.getTenant(tid);
      if (tenant && tenant.accessToken === tok && tenant.status === 'active') {
        const ctx = await tenantManager.mountTenant(tenant, false);
        return {
          tenantId: tenant.id,
          memory: ctx.memory,
          engine: ctx.engine,
          transport: ctx.transport,
          botFallbackName: tenant.name || 'CARDOSO AI',
        };
      }
    }
    const owner = getOwnerRefs();
    return {
      tenantId: 'owner',
      memory: owner.memory,
      engine: owner.engine,
      transport: owner.transport,
      botFallbackName: 'CARDOSO AI',
    };
  };

  app.get('/manifest.webmanifest', async (req: Request, res: Response) => {
    let botName = 'CARDOSO AI — Smart Assistant App';
    try {
      const { memory } = getOwnerRefs();
      const cfg = await memory.getBotConfig();
      if (cfg?.botName && cfg.botName.trim()) {
        botName = `${cfg.botName.trim()} — Smart App`;
      }
    } catch { }
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(JSON.stringify(buildWebManifest({ name: botName })));
  });

  app.get('/sw.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(getServiceWorkerJS());
  });

  app.get('/pwa/icon.svg', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getAppIconSvg());
  });

  app.get('/pwa/icon-192.png', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getAppIconPng(192, false));
  });

  app.get('/pwa/icon-512.png', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getAppIconPng(512, false));
  });

  app.get('/pwa/icon-512-maskable.png', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getAppIconPng(512, true));
  });

  app.get('/pwa/apple-touch-icon.png', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getAppIconPng(180, true));
  });

  app.get('/pwa/offline', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderOfflineHTML());
  });

  interface CachedHtmlEntry {
    etag: string;
    raw: Buffer;
    gzip: Buffer;
    br: Buffer;
    createdAt: number;
  }
  const pwaHtmlCache = new Map<string, CachedHtmlEntry>();
  const PWA_CACHE_TTL_MS = 5 * 60 * 1000;

  const compactAppHtml = (html: string): string => {
    // 1. Compact CSS inside <style>...</style>
    let out = html.replace(/<style>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
      const compactCss = css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*([{}:;,])\s*/g, '$1')
        .trim();
      return `<style>${compactCss}</style>`;
    });
    // 2. Safely strip leading/trailing indentation per line (preserving newlines so JS // comments & ASI stay 100% intact)
    out = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^<!--[\s\S]*-->$/.test(line))
      .join('\n');
    return out;
  };

  const sendCachedPwaApp = async (req: Request, res: Response): Promise<void> => {
    const tenantId = typeof req.query.tenant === 'string' ? req.query.tenant.trim() : '';
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const target = await resolveAppTarget(tenantId, token);
    let botName = target.botFallbackName;
    let businessName = '';
    try {
      const cfg = await target.memory.getBotConfig();
      if (cfg?.botName?.trim()) botName = cfg.botName.trim();
      if (cfg?.businessName?.trim()) businessName = cfg.businessName.trim();
    } catch { }

    const safeTenant = target.tenantId === 'owner' ? '' : target.tenantId;
    const safeToken = target.tenantId === 'owner' ? '' : token;
    const cacheKey = `${botName}|${businessName}|${safeTenant}|${safeToken}|${config.messaging.mode}`;
    const now = Date.now();
    let entry = pwaHtmlCache.get(cacheKey);
    if (!entry || now - entry.createdAt > PWA_CACHE_TTL_MS) {
      if (pwaHtmlCache.size >= 24) {
        pwaHtmlCache.clear();
      }
      const html = compactAppHtml(
        renderPwaAppHTML({
          botName,
          businessName,
          tenantId: safeTenant,
          tenantToken: safeToken,
          mode: config.messaging.mode,
        })
      );
      const raw = Buffer.from(html, 'utf8');
      const gzip = zlib.gzipSync(raw, { level: 9 });
      const br =
        typeof zlib.brotliCompressSync === 'function'
          ? zlib.brotliCompressSync(raw, {
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
              [zlib.constants.BROTLI_PARAM_QUALITY]: 10,
            },
          })
          : gzip;
      const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
      entry = { etag: `W/"app-${hash}"`, raw, gzip, br, createdAt: now };
      pwaHtmlCache.set(cacheKey, entry);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');
    res.setHeader('ETag', entry.etag);
    res.setHeader('Vary', 'Accept-Encoding');

    if (String(req.headers['if-none-match'] || '').trim() === entry.etag) {
      res.status(304).end();
      return;
    }

    const acceptEnc = String(req.headers['accept-encoding'] || '');
    if (/\bbr\b/i.test(acceptEnc) && typeof zlib.brotliCompressSync === 'function') {
      res.setHeader('Content-Encoding', 'br');
      res.setHeader('Content-Length', String(entry.br.length));
      res.end(entry.br);
      return;
    }
    if (/\bgzip\b/i.test(acceptEnc)) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(entry.gzip.length));
      res.end(entry.gzip);
      return;
    }
    res.setHeader('Content-Length', String(entry.raw.length));
    res.end(entry.raw);
  };

  app.get('/app', async (req: Request, res: Response) => {
    await sendCachedPwaApp(req, res);
  });

  app.get('/api/app/bootstrap', async (req: Request, res: Response) => {
    try {
      const target = await resolveAppTarget(req.query.tenantId, req.query.token);
      let botName = target.botFallbackName;
      let businessName = '';
      try {
        const cfg = await target.memory.getBotConfig();
        if (cfg?.botName?.trim()) botName = cfg.botName.trim();
        if (cfg?.businessName?.trim()) businessName = cfg.businessName.trim();
      } catch { }
      res.json({
        status: 'ok',
        botName,
        businessName,
        tenantId: target.tenantId,
        mode: config.messaging.mode,
        whatsappConnected: Boolean(target.transport?.isConnected),
        capabilities: {
          chat: true,
          voiceTts: true,
          visionUpload: true,
          prayerTimes: true,
          pwaInstallable: true,
          liveVideoCall: true,
        },
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/app/prayer-times', (_req: Request, res: Response) => {
    const eat = prayerTimesService.getEATDate();
    const schedule = prayerTimesService.getTodaySchedule(eat);
    const nowMinutes = eat.getHours() * 60 + eat.getMinutes();
    let nextPrayer = schedule.prayers.find((p) => p.hour * 60 + p.minute > nowMinutes);
    if (!nextPrayer) nextPrayer = schedule.prayers[0];

    res.json({
      status: 'ok',
      dateStr: schedule.dateStr,
      currentTimeEAT: prayerTimesService.formatTime(eat.getHours(), eat.getMinutes()),
      nextPrayerKey: nextPrayer?.key || 'fajr',
      prayers: schedule.prayers.map((p) => ({
        key: p.key,
        somaliName: p.somaliName,
        arabicName: p.arabicName,
        timeStr: prayerTimesService.formatTime(p.hour, p.minute),
      })),
      featuredAyah: nextPrayer
        ? {
          prayerName: nextPrayer.somaliName,
          arabic: nextPrayer.quranAyahArabic,
          somali: nextPrayer.quranAyahSomali,
          ref: nextPrayer.quranSurahRef,
        }
        : null,
    });
  });

  app.get('/api/app/history', async (req: Request, res: Response) => {
    try {
      const rawSessionId = String(req.query.sessionId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (!rawSessionId) {
        res.json({ status: 'ok', messages: [] });
        return;
      }
      const target = await resolveAppTarget(req.query.tenantId, req.query.token);
      const messages = await target.memory.getHistoryByRawIdentifier(`pwa_${rawSessionId}`, 50);
      res.json({ status: 'ok', messages });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.delete('/api/app/history', async (req: Request, res: Response) => {
    try {
      const rawSessionId = String(req.query.sessionId || req.body?.sessionId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64);
      if (!rawSessionId) {
        res.json({ status: 'ok', deleted: false });
        return;
      }
      const target = await resolveAppTarget(
        req.query.tenantId || req.body?.tenantId,
        req.query.token || req.body?.token
      );
      const deleted = await target.memory.deleteHistoryByRawIdentifier(`pwa_${rawSessionId}`);
      if (deleted) {
        tenantManager?.markTenantDirty(target.tenantId, ['db'], false);
      }
      res.json({ status: 'ok', deleted });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/app/chat', async (req: Request, res: Response) => {
    try {
      const rawSessionId = String(req.body?.sessionId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64);
      const sessionKey = rawSessionId || 'guest';
      const userMessage = String(req.body?.message || '').trim();
      const senderName = String(req.body?.senderName || '').trim().slice(0, 60) || undefined;
      const wantVoice = Boolean(req.body?.wantVoice);
      const rawMedia = req.body?.media;

      let mediaPayload:
        | { type: 'image' | 'audio' | 'document' | 'video'; mimeType: string; dataBase64: string; fileName?: string }
        | undefined;
      if (rawMedia && typeof rawMedia === 'object' && typeof rawMedia.dataBase64 === 'string' && rawMedia.dataBase64.length > 0) {
        const mType = rawMedia.type;
        if (mType === 'image' || mType === 'audio' || mType === 'document' || mType === 'video') {
          mediaPayload = {
            type: mType,
            mimeType: String(rawMedia.mimeType || (mType === 'image' ? 'image/jpeg' : 'audio/webm')),
            dataBase64: rawMedia.dataBase64,
            fileName: typeof rawMedia.fileName === 'string' ? rawMedia.fileName.slice(0, 120) : undefined,
          };
        }
      }

      if (!userMessage && !mediaPayload) {
        res.status(400).json({ status: 'error', message: 'Fariintu ma bannaana' });
        return;
      }

      const target = await resolveAppTarget(req.body?.tenantId, req.body?.token);
      const output = await target.engine.processMessage({
        rawSenderId: `pwa_${sessionKey}`,
        chatId: `pwa_chat_${sessionKey}`,
        isGroup: false,
        content: userMessage || (mediaPayload?.type === 'audio' ? '🎙️ Fariin cod ah' : '📷 Sawir'),
        senderName,
        media: mediaPayload,
        forceVoiceReply: false,
        forbidVoiceReply: true,
      });

      let replyMedia:
        | { type: 'image' | 'audio' | 'document' | 'video'; mimeType: string; dataBase64: string; caption?: string }
        | undefined;

      if (output.replyMedia && output.replyMedia.dataBuffer) {
        replyMedia = {
          type: output.replyMedia.type,
          mimeType: output.replyMedia.mimeType,
          dataBase64: output.replyMedia.dataBuffer.toString('base64'),
          caption: output.replyMedia.caption,
        };
      } else if (wantVoice && output.replyText && output.replyText !== '[SILENCE]') {
        const mp3 = await VoiceReplyService.synthesizeMp3ForWeb(output.replyText, output.language || 'so');
        if (mp3) {
          replyMedia = {
            type: 'audio',
            mimeType: mp3.mimeType,
            dataBase64: mp3.buffer.toString('base64'),
          };
        }
      }

      tenantManager?.markTenantDirty(target.tenantId, ['db'], false);

      res.json({
        status: 'ok',
        reply: output.replyText,
        intent: output.intent,
        language: output.language,
        latencyMs: output.latencyMs,
        replyMedia,
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/app/tts', async (req: Request, res: Response) => {
    try {
      const text = String(req.body?.text || '').trim();
      const language = String(req.body?.language || 'so').trim();
      if (!text) {
        res.status(400).json({ status: 'error', message: 'Qoraalku ma bannaana' });
        return;
      }
      const audio = await VoiceReplyService.synthesizeMp3ForWeb(text, language);
      if (!audio) {
        res.status(503).json({ status: 'error', message: 'Codka hadda lama samayn karin — mar kale isku day' });
        return;
      }
      res.setHeader('Content-Type', audio.mimeType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(audio.buffer);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/app/podcast', async (req: Request, res: Response) => {
    try {
      const rawTopic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const rawScript = typeof req.body?.script === 'string' ? req.body.script.trim() : '';
      const rawTurns = Array.isArray(req.body?.turns) ? (req.body.turns as DialogueTurn[]) : null;
      const formatRaw = String(req.body?.format || 'mp3').toLowerCase();
      const format: 'mp3' | 'ogg' | 'mp4' = formatRaw === 'ogg' ? 'ogg' : formatRaw === 'mp4' ? 'mp4' : 'mp3';
      const returnJson = Boolean(req.body?.returnJson);

      const styleRaw = String(req.body?.style || 'debate').toLowerCase();
      const style: PodcastStyle =
        styleRaw === 'study' || styleRaw === 'story' || styleRaw === 'ad' || styleRaw === 'diini'
          ? styleRaw
          : 'debate';
      const durationMinutes = Math.max(0.5, Math.min(5, Number(req.body?.durationMinutes) || (style === 'ad' ? 0.75 : 1.5)));
      const soundRaw = String(req.body?.soundMode || (style === 'diini' ? 'clean' : 'chime')).toLowerCase();
      const soundMode: PodcastSoundMode =
        style === 'diini' ? 'clean' : soundRaw === 'ambient' || soundRaw === 'clean' ? soundRaw : 'chime';

      let effectiveTopic = rawTopic;
      let sourceText: string | undefined = typeof req.body?.sourceText === 'string' ? req.body.sourceText.trim() : undefined;

      if (effectiveTopic && /^https?:\/\//i.test(effectiveTopic)) {
        const article = await VoiceReplyService.fetchArticleExcerptForPodcast(effectiveTopic);
        if (article) {
          sourceText = [sourceText, article.excerpt].filter(Boolean).join('\n\n');
          effectiveTopic = article.title || effectiveTopic;
        }
      }

      let turns: DialogueTurn[] = DEFAULT_CARDOSO_PROMO_DIALOGUE;
      if (effectiveTopic || sourceText) {
        const { engine } = getOwnerRefs();
        turns = await VoiceReplyService.generateTopicDialogueTurns(
          effectiveTopic,
          engine?.getAIOrchestrator?.(),
          { style, durationMinutes, sourceText }
        );
      } else if (rawTurns && rawTurns.length > 0) {
        turns = rawTurns;
      } else if (rawScript) {
        turns = VoiceReplyService.isExplicitDialogueScript(rawScript)
          ? VoiceReplyService.parseDialogueScript(rawScript)
          : await VoiceReplyService.generateTopicDialogueTurns(
            rawScript,
            getOwnerRefs().engine?.getAIOrchestrator?.(),
            { style, durationMinutes }
          );
      }

      const audioFormat: 'mp3' | 'ogg' = format === 'ogg' ? 'ogg' : 'mp3';
      const audio = await VoiceReplyService.synthesizeSomaliDialogue(turns, {
        outputFormat: audioFormat,
        soundMode,
      });
      if (!audio) {
        res.status(503).json({ status: 'error', message: 'Podcast-ka hadda lama samayn karin — mar kale isku day' });
        return;
      }

      let outBuffer: Buffer = audio.buffer;
      let outMime = audio.mimeType;
      let ext: 'mp3' | 'ogg' | 'mp4' = audioFormat;

      if (format === 'mp4') {
        outBuffer = await VoiceReplyService.renderPodcastVideoAudiogram(audio.buffer, {
          title: effectiveTopic || 'CARDOSO AI PODCAST',
          styleLabel: 'SAFA & MOHAMED · CARDOSO AI',
        });
        outMime = 'video/mp4';
        ext = 'mp4';
      }

      if (returnJson) {
        res.json({
          status: 'ok',
          mimeType: outMime,
          fileExt: ext,
          seconds: audio.seconds,
          turnCount: audio.turnCount,
          style,
          durationMinutes,
          soundMode,
          transcript: audio.transcript,
          mediaBase64: outBuffer.toString('base64'),
        });
        return;
      }

      res.setHeader('Content-Type', outMime);
      res.setHeader('Content-Disposition', `inline; filename="cardoso-ai-safa-mohamed-podcast.${ext}"`);
      res.setHeader('Content-Length', String(outBuffer.length));
      res.setHeader('X-Podcast-Duration', String(audio.seconds));
      res.setHeader('X-Podcast-Turns', String(audio.turnCount));
      res.setHeader('Cache-Control', 'no-store');
      res.send(outBuffer);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message || 'Khalad ayaa ka dhacay samaynta podcast-ka' });
    }
  });

  // ─── 1b. CARDOSO Live Peer-to-Peer Video & Voice Call APIs (/api/live-call/*) ────
  const liveCallCfg = getLiveCallConfig();
  let livePeerWsHandle: LivePeerWebSocketHandle | null = null;

  app.use(
    createLiveCallRouter({
      resolveAppTarget,
      getPeerStats: () => (livePeerWsHandle ? livePeerWsHandle.getStats() : { onlineCount: 0, waitingCount: 0, activeCalls: 0 }),
      config: liveCallCfg,
    })
  );

  app.head(['/health', '/healthz'], (_req: Request, res: Response) => {
    res.status(200).end();
  });

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

    // 3. Public visitors opening the root URL (`/`) receive the User App directly (200 OK, zero redirect round-trip!),
    //    never Admin Login! Authenticated admins get Admin Dashboard; unauthenticated admins use `/admin`, `/dashboard`, or `/admin-login`.
    if (req.method === 'GET' && req.path === '/') {
      void sendCachedPwaApp(req, res).catch(() => res.redirect('/app'));
      return;
    }
    if (req.method === 'GET' && req.accepts && req.accepts('html') && (req.path === '/admin' || req.path === '/dashboard')) {
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

  // ─── 3b. Admin Views & .vcf Hub Management APIs ───────────────────────────
  app.get('/api/admin/views/overview', (_req: Request, res: Response) => {
    try {
      const overview = viewsHub.listAllContactsAdmin();
      res.json({ status: 'ok', ...overview });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/admin/views/vip', (req: Request, res: Response) => {
    try {
      const { name, phone, countryCode, city, category, tagline, avatarUrl, durationDays, vipPriority } = req.body || {};
      const contact = viewsHub.upsertVipContact({
        name: String(name || ''),
        phone: String(phone || ''),
        countryCode: typeof countryCode === 'string' ? countryCode : undefined,
        city: typeof city === 'string' ? city : undefined,
        category: typeof category === 'string' ? category : undefined,
        tagline: typeof tagline === 'string' ? tagline : undefined,
        avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : undefined,
        durationDays: durationDays !== undefined ? Number(durationDays) : 30,
        vipPriority: vipPriority !== undefined ? Number(vipPriority) : 10,
      });
      tenantManager?.markTenantDirty('owner', ['db'], true);
      res.status(201).json({
        status: 'ok',
        message: `👑 ${contact.displayName} waxaa lagu xiray VIP Pinned!`,
        contact,
      });
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 400;
      res.status(status).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/admin/views/download.vcf', (req: Request, res: Response) => {
    try {
      const scopeRaw = String(req.query.scope || 'all').trim();
      const scope: 'current' | 'all' | 'vip' | 'single' =
        scopeRaw === 'current' || scopeRaw === 'vip' || scopeRaw === 'single' ? scopeRaw : 'all';
      const generated = viewsHub.generateVcf({ scope, isAdminBypass: true });
      const vcfBuf = Buffer.from(generated.vcfText, 'utf8');
      res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${generated.filename}"`);
      res.setHeader('Content-Length', String(vcfBuf.length));
      res.setHeader('Cache-Control', 'no-store');
      res.send(vcfBuf);
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 404;
      res.status(status).json({ status: 'error', message: err.message });
    }
  });

  app.patch('/api/admin/views/contacts/:id', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const { isVip, durationDays, vipPriority, status, verifiedSaver } = req.body || {};
      const updated = viewsHub.updateContactAdmin(id, {
        ...(isVip !== undefined ? { isVip: Boolean(isVip) } : {}),
        ...(durationDays !== undefined ? { durationDays: Number(durationDays) } : {}),
        ...(vipPriority !== undefined ? { vipPriority: Number(vipPriority) } : {}),
        ...(verifiedSaver !== undefined ? { verifiedSaver: Boolean(verifiedSaver) } : {}),
        ...(status === 'active' || status === 'banned' ? { status } : {}),
      });
      if (!updated) {
        res.status(404).json({ status: 'error', message: 'Contact lama helin' });
        return;
      }
      tenantManager?.markTenantDirty('owner', ['db'], true);
      res.json({ status: 'ok', contact: updated });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err.message });
    }
  });

  app.delete('/api/admin/views/contacts/:id', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const deleted = viewsHub.deleteContact(id);
      if (deleted) {
        tenantManager?.markTenantDirty('owner', ['db'], true);
      }
      res.json({ status: 'ok', deleted });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.put('/api/admin/views/config', (req: Request, res: Response) => {
    try {
      const { hubTitle, contactPrefix, batchTarget, downloadMode, ownerVipPhone, vipPriceLabel, announcement } =
        req.body || {};
      const updated = viewsHub.updateConfig({
        ...(hubTitle !== undefined ? { hubTitle: String(hubTitle) } : {}),
        ...(contactPrefix !== undefined ? { contactPrefix: String(contactPrefix) } : {}),
        ...(batchTarget !== undefined ? { batchTarget: Number(batchTarget) } : {}),
        ...(downloadMode === 'locked' || downloadMode === 'instant' ? { downloadMode } : {}),
        ...(ownerVipPhone !== undefined ? { ownerVipPhone: String(ownerVipPhone) } : {}),
        ...(vipPriceLabel !== undefined ? { vipPriceLabel: String(vipPriceLabel) } : {}),
        ...(announcement !== undefined ? { announcement: String(announcement) } : {}),
      });
      tenantManager?.markTenantDirty('owner', ['db'], true);
      res.json({ status: 'ok', config: updated, message: '✅ Dejinta Views Hub waa la keydiyay!' });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/admin/views/unlock-batch', (req: Request, res: Response) => {
    try {
      const batchNumber = req.body?.batchNumber ? Number(req.body.batchNumber) : undefined;
      const updated = viewsHub.unlockBatch(batchNumber);
      tenantManager?.markTenantDirty('owner', ['db'], true);
      res.json({
        status: 'ok',
        config: updated,
        message: `🔓 Batch #${batchNumber || updated.currentBatch} waa la furay — dadku hadda .vcf way soo dejin karaan!`,
      });
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/admin/views/new-batch', (_req: Request, res: Response) => {
    try {
      const updated = viewsHub.startNewBatch();
      tenantManager?.markTenantDirty('owner', ['db'], true);
      res.json({
        status: 'ok',
        config: updated,
        message: `📦 Batch cusub (#${updated.currentBatch}) waa la bilaabay!`,
      });
    } catch (err: any) {
      const status = err instanceof ViewsHubError ? err.statusCode : 500;
      res.status(status).json({
        status: 'error',
        code: err instanceof ViewsHubError ? err.code : 'NEW_BATCH_FAILED',
        message: err.message,
      });
    }
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
      const isTransportConnected = Boolean((transport as any)?.isConnected);
      if (!whatsappManager.hasSocket() && transport && typeof (transport as any).getSocket === 'function') {
        const sock = (transport as any).getSocket();
        if (sock) whatsappManager.setSocket(sock);
      }
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const result = await whatsappManager.listParticipatingGroupsDetailed({
        forceRefresh,
        isTransportConnected,
      });
      if (result.refreshedLive && result.groups.length > 0) {
        tenantManager?.markTenantDirty('owner', ['auth'], false);
      }
      res.json({
        status: 'ok',
        groups: result.groups,
        connected: result.connected,
        source: result.source,
        warning: result.warning || null,
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message, groups: [] });
    }
  });

  // ─── Preview Converted Voice Note from Any Video/Audio URL (TikTok, YouTube, etc.) ───
  app.post('/api/owner/preview-voice-url', async (req: Request, res: Response) => {
    try {
      const { audioUrl } = req.body || {};
      if (!audioUrl || !String(audioUrl).trim()) {
        res.status(400).json({ status: 'error', message: 'Fadlan geli link-ga codka/videoga' });
        return;
      }
      const { buffer, source } = await MediaUrlDownloaderService.downloadAsOggOpus(String(audioUrl));
      res.setHeader('Content-Type', 'audio/ogg');
      res.setHeader('X-Audio-Source', source);
      res.send(buffer);
    } catch (err: any) {
      res.status(400).json({ status: 'error', message: `❌ Link-ga codka lama soo dejin karin: ${err?.message}` });
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
        try {
          const downloaded = await MediaUrlDownloaderService.downloadAsOggOpus(String(audioUrl));
          opusBuffer = downloaded.buffer;
        } catch (fetchErr: any) {
          res.status(400).json({ status: 'error', message: `❌ Link-ga codka lama soo dejin karin: ${fetchErr?.message}` });
          return;
        }
      } else if (audioBase64) {
        const rawBuf = Buffer.from(String(audioBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
        opusBuffer = await VoiceReplyService.convertMediaToOggOpusStrict(rawBuf);
      } else if (text && String(text).trim()) {
        const synth = await VoiceReplyService.synthesizeVoice(String(text).trim(), 'so');
        if (synth) {
          opusBuffer = synth.buffer.slice(0, 4).toString('ascii') === 'OggS'
            ? synth.buffer
            : await VoiceReplyService.convertMp3ToOggOpus(synth.buffer);
        }
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
      await tenantManager?.getCloudSync()?.deleteAuthSnapshot('owner').catch(() => { });
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

  app.post('/api/status/post-podcast', async (req: Request, res: Response) => {
    try {
      const { whatsappManager, engine } = getOwnerRefs();
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const styleRaw = String(req.body?.style || 'debate').toLowerCase();
      const style: PodcastStyle =
        styleRaw === 'study' || styleRaw === 'story' || styleRaw === 'ad' || styleRaw === 'diini'
          ? styleRaw
          : 'debate';
      const durationMinutes = Math.max(0.5, Math.min(3, Number(req.body?.durationMinutes) || 0.85));
      const mode = req.body?.mode === 'video' ? 'video' : 'voice';

      let audioRes = null;
      if (!topic) {
        audioRes = await VoiceReplyService.getCardosoPromoVoiceNote();
      } else {
        const turns = await VoiceReplyService.generateTopicDialogueTurns(
          topic,
          engine?.getAIOrchestrator?.(),
          { style, durationMinutes }
        );
        audioRes = await VoiceReplyService.synthesizeSomaliDialogue(turns, {
          outputFormat: mode === 'video' ? 'mp3' : 'ogg',
          soundMode: style === 'diini' ? 'clean' : 'chime',
        });
      }

      if (!audioRes) {
        res.status(503).json({ success: false, message: 'Codka Podcast-ka hadda lama samayn karin.' });
        return;
      }

      if (mode === 'video') {
        const mp4Buf = await VoiceReplyService.renderPodcastVideoAudiogram(audioRes.buffer, {
          title: topic || 'CARDOSO AI PODCAST',
          styleLabel: 'SAFA & MOHAMED · CARDOSO AI',
        });
        const posted = await whatsappManager.postMediaStatus({
          buffer: mp4Buf,
          mimeType: 'video/mp4',
          type: 'video',
          caption: `🎬 *CARDOSO AI PODCAST — Safa & Mohamed*\n📌 ${topic || 'CARDOSO AI'}`,
        });
        if (posted.success) tenantManager?.markTenantDirty('owner', ['meta'], false);
        res.json(posted);
        return;
      }

      const posted = await whatsappManager.postVoiceStatusSeries(audioRes.buffer, {
        caption: topic || 'CARDOSO AI — Safa & Mohamed Podcast',
      });
      if (posted.success) tenantManager?.markTenantDirty('owner', ['meta'], false);
      res.json(posted);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
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

  const httpServer = http.createServer(app);
  livePeerWsHandle = attachLivePeerWebSocket(httpServer, {
    config: liveCallCfg,
  });
  (httpServer as any).__livePeerWsHandle = livePeerWsHandle;

  return httpServer;
}
