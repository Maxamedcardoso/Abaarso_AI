import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { PassThrough } from 'stream';
import { AppConfig } from '../src/config/env.js';
import { TenantRegistry } from '../src/tenants/tenant-registry.js';
import { TenantManager } from '../src/tenants/tenant-manager.js';
import { CloudSnapshotRow, CloudStateSync, ICloudSnapshotStore } from '../src/tenants/cloud-state-sync.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { ResponseCacheService } from '../src/services/response-cache.service.js';
import { detectInstantGreetingReply } from '../src/advisor/somali-dictionary.js';
import { PromptBuilder } from '../src/advisor/prompt-builder.js';
import { buildSomaliGeographyPromptHint, getSomaliGeographyOverview } from '../src/advisor/somali-geography.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { WhatsAppBaileysTransport } from '../src/transports/whatsapp-baileys.js';
import { createStudioServer } from '../src/web/studio-server.js';
import { IMessagingTransport, IncomingMessage } from '../src/transports/transport.interface.js';

function createTempAppConfig(tempRoot: string): AppConfig {
  return {
    nodeEnv: 'test',
    gemini: {
      apiKey: '',
      apiKeys: [],
      model: 'gemini-2.5-flash',
      dailyLimit: 250,
      rpmLimit: 15,
    },
    llamaFallback: {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'llama3.2:3b',
    },
    messaging: {
      mode: 'console',
      groupResponseMode: 'mention_only',
      prefix: '!ai',
    },
    security: {
      adminPhoneNumbers: ['252634000001'],
      allowedGroups: [],
      webhookVerifyToken: 'test-token',
    },
    database: {
      path: path.join(tempRoot, 'owner.db'),
      retentionDays: 30,
      maxContextMessages: 12,
    },
    server: {
      port: 0,
    },
  };
}

class MemorySnapshotStore implements ICloudSnapshotStore {
  public readonly rows = new Map<string, CloudSnapshotRow>();
  public initialized = false;
  public async initialize(): Promise<void> {
    this.initialized = true;
  }
  public async upsertSnapshot(scopeKey: string, payloadGz: Buffer, updatedAt: number): Promise<void> {
    this.rows.set(scopeKey, { scopeKey, payloadGz: Buffer.from(payloadGz), updatedAt });
  }
  public async listSnapshots(): Promise<CloudSnapshotRow[]> {
    return Array.from(this.rows.values()).map((r) => ({
      scopeKey: r.scopeKey,
      payloadGz: Buffer.from(r.payloadGz),
      updatedAt: r.updatedAt,
    }));
  }
  public async deleteSnapshotsByPrefix(prefix: string): Promise<void> {
    for (const key of Array.from(this.rows.keys())) {
      if (key.startsWith(prefix)) this.rows.delete(key);
    }
  }
  public async close(): Promise<void> {}
}

class MockTransport implements IMessagingTransport {
  public readonly name = 'mock';
  public readonly isConnected = true;
  public sentMessages: Array<{ chatId: string; text: string }> = [];
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null;
  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async sendMessage(chatId: string, text: string): Promise<boolean> {
    this.sentMessages.push({ chatId, text });
    return true;
  }
  public onMessage(h: (message: IncomingMessage) => Promise<void>): void {
    this.handler = h;
  }
  public getStatus() {
    return { name: this.name, connected: this.isConnected, activeChats: 1, lastActivity: Date.now() };
  }
}

async function runTests() {
  console.log('\n🧪 Running Multi-Tenant Commercial SaaS Integration Tests...\n');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-mt-test-'));

  let registry: TenantRegistry | null = null;
  let manager: TenantManager | null = null;

  try {
    const config = createTempAppConfig(tempRoot);
    const registryPath = path.join(tempRoot, 'tenants_registry.db');
    registry = new TenantRegistry(registryPath);
    registry.initialize();

    manager = new TenantManager(registry, config, {
      startSockets: false,
      maxActiveTenants: 20,
      expiryCheckIntervalMs: 600_000,
    });
    await manager.initialize();

    // ─── TEST 1: Dual Registration, Promo Codes & Trial Anti-Abuse ──────────
    const signupRes = await manager.registerPublicSignup({
      name: 'Hargeysa Electronics',
      phone: '0634112233',
      category: 'business',
      notes: 'Iibka moobilada iyo laptops',
    });
    assert.strictEqual(signupRes.autoApproved, false, 'Public /join without promo must start pending');
    assert.strictEqual(signupRes.tenant.status, 'pending');
    assert.strictEqual(signupRes.tenant.allowedPhone, '252634112233', 'Phone must normalize 063 -> 25263');
    assert.strictEqual(registry.isTenantActive(signupRes.tenant), false);

    // Approve & start subscriber
    const approved = await manager.approveAndStartTenant(signupRes.tenant.id, {
      planTier: 'trial_free',
      months: 1,
    });
    assert(approved && approved.status === 'active', 'Approved tenant should become active');
    assert.strictEqual(approved!.trialUsed, true);
    assert(approved!.expiresAt && approved!.expiresAt > Date.now());

    // Simulate expiry then block second free trial via promo on same phone
    await manager.runExpirySweep((approved!.expiresAt || Date.now()) + 1000);
    registry.createPromoCode({ code: 'FREE30', planTier: 'trial_free', durationDays: 30, maxUses: 1 });
    await assert.rejects(
      async () => {
        await manager!.registerPublicSignup({
          name: 'Retry Same Number',
          phone: '252634112233',
          category: 'personal',
          promoCode: 'FREE30',
        });
      },
      /horay ayuu u qaatay/i,
      'Same phone must not get a second free trial via promo code'
    );

    // Promo auto-approval for brand new user, then exhaustion on 2nd use
    const promoSignup = await manager.registerPublicSignup({
      name: 'Fardowsa Personal',
      phone: '0634556677',
      category: 'personal',
      promoCode: 'FREE30',
    });
    assert.strictEqual(promoSignup.autoApproved, true);
    assert.strictEqual(promoSignup.tenant.status, 'active');

    await assert.rejects(
      async () => {
        await manager!.registerPublicSignup({
          name: 'Third User',
          phone: '0634998877',
          category: 'education',
          promoCode: 'FREE30',
        });
      },
      /kuraastiisii way dhammaadeen/i
    );

    // Direct Admin Creation starts active immediately
    const directEduCtx = await manager.createAndStartSubscriber({
      name: 'Hargeysa Tech Academy',
      phone: '0634223344',
      category: 'education',
      planTier: 'education',
      months: 1,
    });
    assert.strictEqual(directEduCtx.tenant.status, 'active');
    assert.strictEqual(directEduCtx.tenant.category, 'education');
    console.log('✅ Test 1 passed: Dual registration, trial anti-abuse, promo seats & direct creation.');

    // ─── TEST 2: Strict Multi-Tenant Data, Contact & Cache Isolation ────────
    // Renew Tenant 1 (business) back to active so we have 3 distinct active categories concurrently
    await manager.renewAndRestartTenant(signupRes.tenant.id, 1, 'business');
    const bizCtx = manager.getContext(signupRes.tenant.id)!;
    const persCtx = manager.getContext(promoSignup.tenant.id)!;
    const eduCtx = directEduCtx;

    assert.notStrictEqual(bizCtx.dataDir, persCtx.dataDir);
    assert.notStrictEqual(bizCtx.authDir, persCtx.authDir);

    const bizBotCfg = await bizCtx.memory.getBotConfig();
    const eduBotCfg = await eduCtx.memory.getBotConfig();
    assert(bizBotCfg.knowledgeBase !== eduBotCfg.knowledgeBase, 'Starter templates must differ per category');

    // Add contact only in Business tenant -> must NOT leak into Personal or Education tenants
    bizCtx.broadcast.recordContact('252634888111@s.whatsapp.net', 'Cali Macmiil', false, true);
    assert(bizCtx.broadcast.getStats().total >= 1);
    assert.strictEqual(persCtx.broadcast.getStats().total, 0, 'Personal tenant must have 0 leaked contacts');
    assert.strictEqual(eduCtx.broadcast.getStats().total, 0, 'Education tenant must have 0 leaked contacts');

    // Scoped response cache isolation
    ResponseCacheService.set('qiimaha waa imisa', 'so', 'Business Reply $25', 60_000, bizCtx.tenantId);
    assert.strictEqual(ResponseCacheService.get('qiimaha waa imisa', 'so', bizCtx.tenantId), 'Business Reply $25');
    assert.strictEqual(ResponseCacheService.get('qiimaha waa imisa', 'so', persCtx.tenantId), null);
    console.log('✅ Test 2 passed: Complete multi-tenant DB, template, contact & cache isolation.');

    // ─── TEST 3: Role-Adaptive Persona, People Recognition & Lead Capture ───
    const bizGreeting = detectInstantGreetingReply('asc', {
      userName: 'Axmed Jaamac',
      userGender: 'male',
      roleCategory: 'business',
      businessName: 'Hargeysa Electronics',
    });
    assert(bizGreeting && bizGreeting.includes('Axmed') && bizGreeting.includes('Hargeysa Electronics'));

    const returningPersonalGreeting = detectInstantGreetingReply('asc', {
      userName: 'Hodan',
      userGender: 'female',
      roleCategory: 'personal',
      isReturning: true,
    });
    assert(returningPersonalGreeting && returningPersonalGreeting.includes('Hodan') && returningPersonalGreeting.includes('abaayo'));

    const sysPromptBiz = PromptBuilder.buildSystemInstruction({
      detectedLanguage: 'so',
      roleCategory: 'business',
      savedContactName: 'Maryan Cali',
      isReturningUser: true,
      totalMessagesCount: 7,
      ownerDisplayName: 'Hargeysa Electronics',
    });
    assert(sysPromptBiz.includes('BUSINESS SALES') && sysPromptBiz.includes('Maryan Cali') && sysPromptBiz.includes('<!-- lead:'));

    const sysPromptAway = PromptBuilder.buildSystemInstruction({
      detectedLanguage: 'so',
      roleCategory: 'personal',
      awayMode: true,
      ownerDisplayName: 'Fardowsa',
    });
    assert(sysPromptAway.includes('AWAY MODE ACTIVE'));

    // Lead capture through StudentAdvisorEngine with mocked AI
    const fakeAi: any = {
      generateResponse: async () => ({
        text: 'Mahadsanid walaal Axmed! Dalabkaagii waan diiwaangeliyay.\n<!-- lead: {"category":"order","summary":"2x Saacadood ($30)"} -->',
        provider: 'mock',
        modelUsed: 'mock-flash',
        latencyMs: 5,
      }),
    };
    const leadMem = new SQLiteStudentMemory(path.join(tempRoot, 'lead_capture.db'));
    await leadMem.initialize();
    const leadEngine = new StudentAdvisorEngine(leadMem, fakeAi, {
      cacheScope: 'lead_test',
      tenantCategory: 'business',
      ownerDisplayName: 'Hargeysa Electronics',
    });
    const leadReply = await leadEngine.processMessage({
      rawSenderId: '252634777000@s.whatsapp.net',
      chatId: '252634777000@s.whatsapp.net',
      isGroup: false,
      content: 'Waxaan rabaa inaan dalbado laba saacadood oo madow ah fadlan',
      senderName: 'Axmed',
    });
    assert(!leadReply.replyText.includes('<!-- lead:'), 'Hidden lead tag must be stripped from WhatsApp reply');
    const capturedLeads = await leadMem.getLeads(10);
    assert.strictEqual(capturedLeads.length, 1);
    assert.strictEqual(capturedLeads[0].summary, '2x Saacadood ($30)');
    await leadMem.close();
    console.log('✅ Test 3 passed: People recognition, role behavior, Away Mode & Lead capture verified.');

    // ─── TEST 4: PlanGuard Feature Gating & BYOK Limit Lift ──────────────────
    const gatedCtx = await manager.createAndStartSubscriber({
      name: 'Gated Starter Shop',
      phone: '0634667788',
      category: 'business',
      planTier: 'starter',
      months: 1,
    });
    manager.updateTenantAndRefresh(gatedCtx.tenantId, {
      features: { maxDailyAiCalls: 2, allowStatusPosting: false },
    });
    assert.strictEqual(gatedCtx.planGuard.checkFeature('status_post').allowed, false);
    assert.strictEqual(gatedCtx.planGuard.checkFeature('ai').allowed, true);
    gatedCtx.planGuard.recordUsage('ai');
    gatedCtx.planGuard.recordUsage('ai');
    assert.strictEqual(gatedCtx.planGuard.checkFeature('ai').allowed, false, '3rd AI call must hit daily cap of 2');

    // Bring Own Free Key (BYOK) lifts cap to >= 1400/day
    const afterByok = manager.updateTenantAndRefresh(gatedCtx.tenantId, {
      customGeminiKey: 'AIzaSyTestCustomFreeKey12345',
    });
    assert(afterByok && afterByok.effectiveFeatures.maxDailyAiCalls >= 1400);
    assert.strictEqual(gatedCtx.planGuard.checkFeature('ai').allowed, true);
    console.log('✅ Test 4 passed: PlanGuard feature caps and BYOK free-key upgrade verified.');

    // ─── TEST 5: Expiry Sweep & Renewal Preservation ────────────────────────
    const expSubCtx = await manager.createAndStartSubscriber({
      name: 'Expiry Test Client',
      phone: '0634334455',
      category: 'business',
      planTier: 'business',
      durationDays: 1,
    });
    expSubCtx.broadcast.recordContact('252634123999@s.whatsapp.net', 'Sacdiya', false, true);
    await expSubCtx.memory.recordLead({
      chatId: '252634123999@s.whatsapp.net',
      senderName: 'Sacdiya',
      senderPhone: '252634123999',
      category: 'order',
      summary: '1x Hijab Set',
    });

    const futureMs = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const expiredBatch = await manager.runExpirySweep(futureMs);
    assert(expiredBatch.some((t) => t.id === expSubCtx.tenantId));
    assert.strictEqual(registry.getTenant(expSubCtx.tenantId)?.status, 'expired');

    const mockTr = new MockTransport();
    const dropRes = await expSubCtx.router.handleIncomingMessage(
      {
        id: 'msg_exp_1',
        senderId: '252634123999@s.whatsapp.net',
        chatId: '252634123999@s.whatsapp.net',
        senderName: 'Sacdiya',
        content: 'Asc',
        isGroup: false,
        isMentioned: false,
        isFromMe: false,
        rawTimestamp: Date.now(),
      },
      mockTr
    );
    assert.strictEqual(dropRes.handled, false, 'Expired tenant router must drop incoming messages');

    // Data preserved & restored upon renewal
    await manager.renewAndRestartTenant(expSubCtx.tenantId, 1, 'business');
    assert.strictEqual(registry.getTenant(expSubCtx.tenantId)?.status, 'active');
    assert.strictEqual(expSubCtx.broadcast.getStats().total, 1, 'Contacts preserved across expiry & renewal');
    assert.strictEqual((await expSubCtx.memory.getLeads(10)).length, 1, 'Leads preserved across expiry & renewal');
    console.log('✅ Test 5 passed: Monthly expiry sweep & renewal data preservation verified.');

    // ─── TEST 6: Phone-Number Lock & Pairing Validation ─────────────────────
    assert.strictEqual(WhatsAppBaileysTransport.phonesMatch('252634949642', '0634949642'), true);
    assert.strictEqual(WhatsAppBaileysTransport.phonesMatch('252634949642', '252634111222'), false);
    const lockedTransport = new WhatsAppBaileysTransport({
      authDir: path.join(tempRoot, 'locked_auth'),
      tenantId: 'locked_test',
      allowedPhone: '252634112233',
      allowEnvSessionRestore: false,
    });
    const badPair = await lockedTransport.requestPairingCodeForTenant('252634999999');
    assert.strictEqual(badPair.success, false, 'Pairing request with mismatched phone must be blocked');

    // Verify stale unregistered creds.json (incomplete link attempt) is purged, while paired creds stay intact
    const staleAuthDir = path.join(tempRoot, 'stale_unreg_auth');
    fs.mkdirSync(staleAuthDir, { recursive: true });
    fs.writeFileSync(path.join(staleAuthDir, 'creds.json'), JSON.stringify({ registered: false, me: { id: '252634112233@s.whatsapp.net' } }));
    const staleTr = new WhatsAppBaileysTransport({ authDir: staleAuthDir, tenantId: 'stale_t', allowEnvSessionRestore: false });
    (staleTr as any).purgeUnregisteredAuthDir();
    assert.strictEqual(fs.existsSync(staleAuthDir), false, 'Incomplete unregistered creds.json must be wiped before new pairing');

    const pairedAuthDir = path.join(tempRoot, 'paired_515_auth');
    fs.mkdirSync(pairedAuthDir, { recursive: true });
    fs.writeFileSync(path.join(pairedAuthDir, 'creds.json'), JSON.stringify({ registered: false, account: { details: 'valid' }, me: { id: '252634112233:1@s.whatsapp.net' } }));
    const pairedTr = new WhatsAppBaileysTransport({ authDir: pairedAuthDir, tenantId: 'paired_t', allowEnvSessionRestore: false });
    (pairedTr as any).purgeUnregisteredAuthDir();
    assert.strictEqual(fs.existsSync(path.join(pairedAuthDir, 'creds.json')), true, 'Valid paired session during 515 transition must NOT be wiped');

    // Atomic creds backup & corrupt recovery across restarts
    (pairedTr as any).writeAtomicCredsBackup();
    assert.strictEqual(fs.existsSync(path.join(pairedAuthDir, 'creds.backup.json')), true);
    fs.writeFileSync(path.join(pairedAuthDir, 'creds.json'), '{corrupted_mid_write');
    const recoveredState = (pairedTr as any).readDiskCredsState();
    assert.strictEqual(recoveredState.registered, true, 'Corrupt creds.json must recover cleanly from atomic backup');
    console.log('✅ Test 6 passed: Phone-number lock, creds hygiene & atomic backup recovery verified.');

    // ─── TEST 7: Multi-Admin & Express Studio HTTP API Flow ─────────────────
    const staffAdmin = registry.createAdminUser({
      username: 'sub_admin1',
      password: 'secret_password_99',
      displayName: 'Cabdi Staff',
      phoneNumber: '252634777888',
      role: 'staff_admin',
    });
    assert.strictEqual(staffAdmin.username, 'sub_admin1');
    assert(registry.verifyAdminUser('sub_admin1', 'secret_password_99'));
    assert.strictEqual(registry.verifyAdminUser('sub_admin1', 'wrong'), null);
    assert(registry.getAllActiveAdminPhones(['252634000001']).includes('252634777888'));

    // Per-tenant extra WhatsApp admin check on MessageRouter
    manager.updateTenantAndRefresh(bizCtx.tenantId, { extraAdmins: ['0634555000'] });
    assert.strictEqual(bizCtx.router.isAdmin('252634555000@s.whatsapp.net'), true);

    const ownerCtx = manager.getOwnerContext()!;
    const httpServer = createStudioServer({
      port: 0,
      memory: ownerCtx.memory,
      engine: ownerCtx.engine,
      transport: mockTr,
      config,
      tenantManager: manager,
      studioPasswordOverride: 'owner_master_pass',
    });

    const invokeServer = (
      method: string,
      urlPath: string,
      opts?: { headers?: Record<string, string>; body?: any }
    ): Promise<{ status: number; headers: Record<string, any>; text: string; json: () => any }> => {
      return new Promise((resolve, reject) => {
        const socket: any = new PassThrough();
        socket.remoteAddress = '127.0.0.1';
        const req: any = new http.IncomingMessage(socket);
        req.method = method;
        req.url = urlPath;
        req.headers = {
          host: 'localhost',
          ...Object.fromEntries(Object.entries(opts?.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
        };

        if (opts?.body !== undefined) {
          const payload = JSON.stringify(opts.body);
          req.headers['content-type'] = 'application/json';
          req.headers['content-length'] = String(Buffer.byteLength(payload));
          req.push(payload);
        }
        req.push(null);

        const res: any = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        res.write = (chunk: any) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        };
        res.end = (chunk?: any) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.getHeaders(),
            text,
            json: () => JSON.parse(text),
          });
          return res;
        };

        try {
          httpServer.emit('request', req, res);
        } catch (err) {
          reject(err);
        }
      });
    };

    const assertValidHtmlScripts = (html: string, label: string) => {
      const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
      assert(matches.length > 0, `${label} must include script block`);
      for (const m of matches) {
        new vm.Script(m[1], { filename: `${label}.js` });
      }
    };

    // Public /join page
    const joinHtml = await invokeServer('GET', '/join');
    assert.strictEqual(joinHtml.status, 200);
    assert(joinHtml.text.includes('CARDOSO') && joinHtml.text.includes('/api/public/join'));
    assert(
      joinHtml.text.includes('id="fields-personal"') &&
      joinHtml.text.includes('id="fields-business"') &&
      joinHtml.text.includes('id="fields-education"') &&
      joinHtml.text.includes('id="bizDeliveryScope"') &&
      joinHtml.text.includes('Labadaba: Magaalada gudaheeda') &&
      joinHtml.text.includes('id="bizCatalogFile"') &&
      joinHtml.text.includes('id="eduCoursesFile"') &&
      joinHtml.text.includes('parseImportedCatalogText') &&
      joinHtml.text.includes('ROLE_UI_META') &&
      joinHtml.text.includes('buildRoleNotes'),
      '/join must render distinct dynamic form blocks, Dual Delivery select & Catalog File Import'
    );
    assert(!joinHtml.text.includes('fonts.googleapis.com'), 'Must not require external fonts');
    assertValidHtmlScripts(joinHtml.text, '/join');

    // Super Admin / page
    const staffAuthHeader = 'Basic ' + Buffer.from('sub_admin1:secret_password_99').toString('base64');
    const adminHtml = await invokeServer('GET', '/', { headers: { Authorization: staffAuthHeader } });
    assert.strictEqual(adminHtml.status, 200);
    assertValidHtmlScripts(adminHtml.text, '/');

    // Public /portal page
    const portalHtml = await invokeServer('GET', '/portal');
    assert.strictEqual(portalHtml.status, 200);
    assertValidHtmlScripts(portalHtml.text, '/portal');

    // Public /api/public/join submission with PIN
    const pubJoinRes = await invokeServer('POST', '/api/public/join', {
      body: {
        name: 'HTTP Web Client',
        phone: '0634121212',
        category: 'personal',
        notes: 'Away responder',
        pin: '4321',
      },
    });
    assert.strictEqual(pubJoinRes.status, 201);
    const pubData: any = pubJoinRes.json();
    assert.strictEqual(pubData.tenant.status, 'pending');
    const webTenantId = pubData.tenant.id;
    const webPortalUrl = pubData.portalUrl;
    const webToken = new URLSearchParams(webPortalUrl.split('?')[1]).get('token')!;

    // Unauthenticated admin access rejected
    const noAuthAdmin = await invokeServer('GET', '/api/admin/tenants');
    assert.strictEqual(noAuthAdmin.status, 401);

    // Staff Admin Basic Auth succeeds
    const authAdminRes = await invokeServer('GET', '/api/admin/tenants', {
      headers: { Authorization: staffAuthHeader },
    });
    assert.strictEqual(authAdminRes.status, 200);

    // Admin approves client via HTTP
    const approveHttpRes = await invokeServer('POST', `/api/admin/tenants/${webTenantId}/approve`, {
      headers: { Authorization: staffAuthHeader },
      body: { planTier: 'trial_free', months: 1 },
    });
    assert.strictEqual(approveHttpRes.status, 200);

    // Client portal rejects wrong token
    const badTokenRes = await invokeServer('GET', `/client/${webTenantId}?token=invalidtoken`);
    assert.strictEqual(badTokenRes.status, 401);

    // Personal client portal omits Business/Pro Leads & API Key/Usage tabs
    const clientPageRes = await invokeServer('GET', `/client/${webTenantId}?token=${encodeURIComponent(webToken)}`);
    assert.strictEqual(clientPageRes.status, 200);
    assert(
      !clientPageRes.text.includes('id="tabBtnLeads"') &&
      !clientPageRes.text.includes('id="tabBtnPlan"') &&
      !clientPageRes.text.includes('Fariimaha &amp; Dalabaadka') &&
      !clientPageRes.text.includes('Free API Key, Admins &amp; Usage'),
      'Personal client portal must hide Leads and Plan tabs'
    );
    assertValidHtmlScripts(clientPageRes.text, '/client/:id');

    // Business client portal includes Leads, Plan tabs, and KB Import button
    const bizPortalRes = await invokeServer('GET', `/client/${bizCtx.tenant.id}?token=${encodeURIComponent(bizCtx.tenant.accessToken)}`);
    assert.strictEqual(bizPortalRes.status, 200);
    assert(
      bizPortalRes.text.includes('id="tabBtnLeads"') &&
      bizPortalRes.text.includes('id="tabBtnPlan"') &&
      bizPortalRes.text.includes('id="clientKbFile"'),
      'Business client portal must display Leads, Plan tabs and Import Xog button'
    );
    assertValidHtmlScripts(bizPortalRes.text, '/client/:id(business)');

    const clientStatusRes = await invokeServer('GET', `/api/client/${webTenantId}/status?token=${encodeURIComponent(webToken)}`);
    const clientStatus: any = clientStatusRes.json();
    assert.strictEqual(clientStatus.isActive, true);

    const saveConfigRes = await invokeServer('POST', `/api/client/${webTenantId}/config?token=${encodeURIComponent(webToken)}`, {
      body: {
        category: 'personal',
        botName: 'Kaaliye Web',
        businessName: 'Axmed HTTP',
        systemRole: 'Personal assistant',
        knowledgeBase: 'Waxaan joogaa Hargeysa.',
      },
    });
    assert.strictEqual(saveConfigRes.status, 200);

    // Returning client /portal login via PIN (wrong fails, right returns portalUrl)
    const badPinRes = await invokeServer('POST', '/api/public/portal-login', {
      body: { phone: '0634121212', pin: '0000' },
    });
    assert.strictEqual(badPinRes.status, 401);

    const okPinRes = await invokeServer('POST', '/api/public/portal-login', {
      body: { phone: '252634121212', pin: '4321' },
    });
    assert.strictEqual(okPinRes.status, 200);
    assert.strictEqual(okPinRes.json().portalUrl, webPortalUrl);

    // Update PIN via Client settings and log in via WhatsApp OTP
    await invokeServer('PUT', `/api/client/${webTenantId}/settings?token=${encodeURIComponent(webToken)}`, {
      body: { pin: '9876' },
    });
    const okNewPin = await invokeServer('POST', '/api/public/portal-login', {
      body: { phone: '0634121212', pin: '9876' },
    });
    assert.strictEqual(okNewPin.status, 200);

    // WhatsApp 6-digit OTP verification flow
    const prevOwnerTransport = ownerCtx.transport;
    (ownerCtx as any).transport = mockTr;
    try {
      mockTr.sentMessages = [];
      const otpReq = await invokeServer('POST', '/api/public/portal-otp/request', {
        body: { phone: '0634121212' },
      });
      assert.strictEqual(otpReq.status, 200);
      assert(mockTr.sentMessages.length === 1);
      const otpCodeMatch = mockTr.sentMessages[0].text.match(/\*(\d{6})\*/);
      assert(otpCodeMatch, 'WhatsApp OTP message must contain 6-digit code');

      const badOtp = await invokeServer('POST', '/api/public/portal-otp/verify', {
        body: { phone: '0634121212', code: '111111' },
      });
      assert.strictEqual(badOtp.status, 401);

      const okOtp = await invokeServer('POST', '/api/public/portal-otp/verify', {
        body: { phone: '0634121212', code: otpCodeMatch![1] },
      });
      assert.strictEqual(okOtp.status, 200);
      assert.strictEqual(okOtp.json().portalUrl, webPortalUrl);
    } finally {
      (ownerCtx as any).transport = prevOwnerTransport;
    }

    console.log('✅ Test 7 passed: Multi-admin Basic Auth, /portal PIN & OTP login, and SaaS HTTP endpoints verified.');

    // ─── TEST 8: CloudStateSync ($0 Forever Render Wipe & Restart Recovery) ─────────
    const cloudTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-cloud-sync-'));
    const memStore = new MemorySnapshotStore();
    const prevBaileysAuth = process.env.BAILEYS_AUTH_DIR;
    const ownerAuthDir = path.join(cloudTempRoot, 'owner_auth');
    process.env.BAILEYS_AUTH_DIR = ownerAuthDir;

    let cloudRegistryA: TenantRegistry | null = null;
    let cloudManagerA: TenantManager | null = null;
    let cloudRegistryB: TenantRegistry | null = null;
    let cloudManagerB: TenantManager | null = null;
    try {
      const cfg = createTempAppConfig(cloudTempRoot);
      const regPath = path.join(cloudTempRoot, 'tenants_registry.db');

      const syncA = new CloudStateSync({
        store: memStore,
        baseDataDir: cloudTempRoot,
        registryDbPath: regPath,
        ownerDbPath: cfg.database.path,
        ownerAuthDir,
        debounceMs: 30,
      });
      await syncA.initialize();

      cloudRegistryA = new TenantRegistry(regPath);
      cloudRegistryA.initialize();
      cloudManagerA = new TenantManager(cloudRegistryA, cfg, {
        startSockets: false,
        maxActiveTenants: 10,
        expiryCheckIntervalMs: 600_000,
        cloudSync: syncA,
      });
      await cloudManagerA.initialize();

      const khadraCtx = await cloudManagerA.createAndStartSubscriber({
        name: 'Khadra Boutique',
        phone: '252634887766',
        category: 'business',
        planTier: 'starter',
        months: 1,
        pin: '2468',
      });
      await khadraCtx.memory.saveBotConfig({
        botName: 'Khadra Assistant',
        businessName: 'Khadra Boutique',
        systemRole: 'Sales bot',
        knowledgeBase: 'Qiimaha shaadhka waa $15 via Zaad.',
      });
      await khadraCtx.memory.recordLead({
        chatId: '252634998877@s.whatsapp.net',
        senderPhone: '252634998877',
        senderName: 'Farxaan',
        category: 'order',
        summary: '1x Shaadh Madow ($15)',
      });

      // Seed valid registered Baileys auth files for both Owner & Khadra
      fs.mkdirSync(ownerAuthDir, { recursive: true });
      fs.writeFileSync(
        path.join(ownerAuthDir, 'creds.json'),
        JSON.stringify({ registered: true, me: { id: '252634000001:1@s.whatsapp.net' } })
      );
      fs.mkdirSync(khadraCtx.authDir, { recursive: true });
      fs.writeFileSync(
        path.join(khadraCtx.authDir, 'creds.json'),
        JSON.stringify({ registered: true, me: { id: '252634887766:2@s.whatsapp.net' } })
      );
      fs.writeFileSync(
        path.join(khadraCtx.authDir, 'app-state-sync-key-1.json'),
        JSON.stringify({ keyData: 'mock-signal-key' })
      );

      // Flush cleanly via shutdown (simulates Render container stopping before redeploy)
      await cloudManagerA.shutdown();
      cloudManagerA = null;
      cloudRegistryA.close();
      cloudRegistryA = null;

      assert(memStore.rows.has('registry'), 'Cloud DB must store registry snapshot');
      assert(memStore.rows.has(`tenant:${khadraCtx.tenantId}:db`), 'Cloud DB must store subscriber SQLite DB');
      assert(memStore.rows.has(`tenant:${khadraCtx.tenantId}:auth`), 'Cloud DB must store subscriber registered auth bundle');
      assert(memStore.rows.has('tenant:owner:auth'), 'Cloud DB must store owner registered auth bundle');

      // Simulate complete Render container filesystem wipe!
      fs.rmSync(cloudTempRoot, { recursive: true, force: true });
      fs.mkdirSync(cloudTempRoot, { recursive: true });
      assert(!fs.existsSync(regPath), 'Local registry.db must be wiped before restore test');

      // New container boot restores state BEFORE opening SQLite / Baileys
      const syncB = new CloudStateSync({
        store: memStore,
        baseDataDir: cloudTempRoot,
        registryDbPath: regPath,
        ownerDbPath: cfg.database.path,
        ownerAuthDir,
        debounceMs: 30,
      });
      await syncB.initialize();
      const restored = await syncB.restoreAllIfMissing();
      assert(restored.restoredCount >= 4, `Expected >=4 restored snapshots, got ${restored.restoredCount}`);

      cloudRegistryB = new TenantRegistry(regPath);
      cloudRegistryB.initialize();
      cloudManagerB = new TenantManager(cloudRegistryB, cfg, {
        startSockets: false,
        maxActiveTenants: 10,
        expiryCheckIntervalMs: 600_000,
        cloudSync: syncB,
      });
      await cloudManagerB.initialize();

      // Verify subscriber record + PIN + SQLite knowledge + Leads + WhatsApp auth files all survived!
      const pinCheck = cloudRegistryB.verifyTenantPin('252634887766', '2468');
      assert(pinCheck && pinCheck.id === khadraCtx.tenantId, 'Restored subscriber must keep exact ID and PIN');

      const restoredCtx = cloudManagerB.getContext(khadraCtx.tenantId);
      assert(restoredCtx, 'Restored active subscriber must mount automatically');
      const restoredCfg = await restoredCtx!.memory.getBotConfig();
      assert(restoredCfg.knowledgeBase.includes('$15 via Zaad'), 'Restored subscriber knowledge base must survive wipe');
      const restoredLeads = await restoredCtx!.memory.getLeads(10);
      assert.strictEqual(restoredLeads.length, 1, 'Restored subscriber leads must survive wipe');
      assert.strictEqual(restoredLeads[0].senderName, 'Farxaan');

      assert(fs.existsSync(path.join(ownerAuthDir, 'creds.json')), 'Owner WhatsApp creds.json must be restored');
      const khadraCredsRaw = fs.readFileSync(path.join(restoredCtx!.authDir, 'creds.json'), 'utf8');
      assert.strictEqual(JSON.parse(khadraCredsRaw).registered, true, 'Subscriber registered WhatsApp creds.json must be restored');
      assert(
        fs.existsSync(path.join(restoredCtx!.authDir, 'app-state-sync-key-1.json')),
        'Subscriber Signal key bundle files must be restored'
      );

      // Verify explicit unlink deletes cloud auth snapshot so unlinked WhatsApp does not ghost-restore
      await cloudManagerB.unlinkTenantSession(khadraCtx.tenantId);
      assert(!memStore.rows.has(`tenant:${khadraCtx.tenantId}:auth`), 'Explicit unlink must remove cloud auth snapshot');

      console.log('✅ Test 8 passed: CloudStateSync full container wipe recovery (registry, PINs, leads, KB & WhatsApp auth) verified!');
    } finally {
      if (cloudManagerA) await cloudManagerA.shutdown().catch(() => {});
      if (cloudRegistryA) cloudRegistryA.close();
      if (cloudManagerB) await cloudManagerB.shutdown().catch(() => {});
      if (cloudRegistryB) cloudRegistryB.close();
      if (prevBaileysAuth === undefined) delete process.env.BAILEYS_AUTH_DIR;
      else process.env.BAILEYS_AUTH_DIR = prevBaileysAuth;
      try {
        fs.rmSync(cloudTempRoot, { recursive: true, force: true });
      } catch {}
    }

    // ─── TEST 9: Somali Cities & Districts Knowledge + Catalog Importer ──────
    const overview = getSomaliGeographyOverview();
    assert(
      overview.includes('Hargeysa') &&
      overview.includes('Burco') &&
      overview.includes('Muqdisho') &&
      overview.includes('Boosaaso') &&
      overview.includes('Garoowe') &&
      overview.includes('Baydhabo') &&
      overview.includes('Kismaayo') &&
      overview.includes('Jabuuti') &&
      overview.includes('Jigjiga'),
      'Geography overview must cover all major Somali cities across regions'
    );

    const hargHint = buildSomaliGeographyPromptHint('Asc xaafadda 26 June ma keentaan?', 'Goobta: Hargeysa');
    assert(
      hargHint && hargHint.includes('Hargeysa') && hargHint.includes('26 June') && hargHint.includes('Jigjiga Yar'),
      'Must map 26 June neighborhood cleanly to Hargeysa and list sibling districts'
    );

    const burcoHint = buildSomaliGeographyPromptHint('Dalab waxaan u rabaa Lixle iyo Faarax Oomaar');
    assert(burcoHint && burcoHint.includes('Burco') && burcoHint.includes('Lixle'), 'Must map Lixle cleanly to Burco');

    const mogHint = buildSomaliGeographyPromptHint('Waxaan joogaa KM4 iyo Suuq Bacaad');
    assert(
      mogHint && mogHint.includes('Muqdisho') && mogHint.includes('Hodan') && mogHint.includes('Yaqshiid'),
      'Must map KM4 and Suuq Bacaad to Muqdisho districts'
    );

    const sharedDistrictHint = buildSomaliGeographyPromptHint('Waxaan joogaa Hodan');
    assert(
      sharedDistrictHint && sharedDistrictHint.includes('multiple cities') && sharedDistrictHint.includes('Muqdisho') && sharedDistrictHint.includes('Burco'),
      'Must disambiguate shared district names like Hodan across Somali cities'
    );

    const enrichedLocPrompt = PromptBuilder.enrichUserPrompt('Asc New Bosaso delivery ma jirtaa?', 'so', 'Boosaaso');
    assert(enrichedLocPrompt.includes('Boosaaso') && enrichedLocPrompt.includes('New Bosaso'), 'enrichUserPrompt must inject Somali geography reference');

    // Execute rendered COMMON_CLIENT_JS parseImportedCatalogText via vm
    const joinScriptMatch = joinHtml.text.match(/<script>([\s\S]*?)<\/script>/i);
    assert(joinScriptMatch, 'join script needed for importer runtime check');
    const vmCtx: any = {
      window: {},
      addEventListener: () => {},
      document: {
        getElementById: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      navigator: { clipboard: { writeText: async () => {} } },
      setTimeout,
      clearTimeout,
    };
    vmCtx.window = vmCtx;
    vm.runInNewContext(joinScriptMatch![1], vmCtx);

    const csvParsed = vmCtx.parseImportedCatalogText('Alaabta,Qiimaha,Faahfaahin\nShaadh Casri ah,$15,Midab Madow\nKabo Sport,$28,Size 42', 'alaab.csv');
    assert.strictEqual(csvParsed.count, 2);
    assert(csvParsed.formatted.includes('Shaadh Casri ah — $15 (Midab Madow)'));

    const jsonParsed = vmCtx.parseImportedCatalogText('[{"name":"Baati","price":"$12","description":"Bombaay"},{"name":"Hijab","price":"$8"}]', 'catalog.json');
    assert.strictEqual(jsonParsed.count, 2);
    assert(jsonParsed.formatted.includes('- Baati — $12 (Bombaay)') && jsonParsed.formatted.includes('- Hijab — $8'));

    console.log('✅ Test 9 passed: Somali cities/districts knowledge, disambiguation & CSV/JSON catalog importer verified!');

    console.log('\n🎉 ALL MULTI-TENANT SAAS TESTS PASSED CLEANLY!\n');
  } finally {
    if (manager) await manager.shutdown().catch(() => {});
    if (registry) registry.close();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('❌ Multi-tenant test failed:', err);
  process.exit(1);
});

