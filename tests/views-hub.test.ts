import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import vm from 'vm';
import { PassThrough } from 'stream';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import { createStudioServer } from '../src/web/studio-server.js';
import { config } from '../src/config/env.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runViewsHubTests(): Promise<void> {
  console.log('\n🧪 Running CARDOSO Views & .vcf Contact Hub Test Suite...\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-views-hub-'));
  const dbPath = path.join(tmpDir, 'views-test.db');
  const memory = new SQLiteStudentMemory(dbPath);
  await memory.initialize();

  const testConfig = {
    ...config,
    messaging: { ...config.messaging, mode: 'app' as const },
    security: { ...config.security, adminPhoneNumbers: ['252634949642'] },
  };
  const quota = new QuotaTracker(100, 14);
  const ai = new AIOrchestrator(testConfig, quota, 'fake-key');
  const engine = new StudentAdvisorEngine(memory, ai);
  const transport = new ConsoleSimulatorTransport();

  const server = createStudioServer({
    port: 0,
    memory,
    engine,
    transport,
    config: testConfig,
    studioPasswordOverride: 'admin-secret',
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
        server.emit('request', req, res);
      } catch (err) {
        reject(err);
      }
    });
  };

  const adminAuth = 'Basic ' + Buffer.from('admin:admin-secret').toString('base64');

  try {
    // 1. Validate /views, /app, and / (Admin Studio) HTML + inline JS syntax
    for (const check of [
      { route: '/views' },
      { route: '/app' },
      { route: '/', headers: { Authorization: adminAuth } },
    ]) {
      const res = await invokeServer('GET', check.route, { headers: check.headers });
      assert(res.status === 200, `${check.route} should return 200, got ${res.status}: ${res.text.slice(0, 300)}`);
      assert(res.text.includes('/manifest.webmanifest'), `${check.route} should include PWA manifest`);
      const scripts = [...res.text.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
      assert(scripts.length > 0, `${check.route} must include script`);
      for (const m of scripts) {
        new vm.Script(m[1], { filename: `${check.route}.js` });
      }
    }
    console.log('  ✅ PASS: /views, /app, and Admin Studio render with valid JS syntax');

    // 2. Public Join + Normalization + Referral Tracking + Duplicate Handling
    const j1 = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Axmed Cali', phone: '0634112233', city: 'Hargeysa', category: 'personal', tagline: 'Daily status' },
    });
    assert(j1.status === 201, `first join should return 201, got ${j1.status}`);
    const c1 = j1.json().contact;
    assert(c1.phone === '252634112233', `phone should normalize to 252634112233, got ${c1.phone}`);

    const j2 = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Hodan Nuur', phone: '+252 61 555 7788', city: 'Muqdisho', category: 'student', referredBy: '0634112233' },
    });
    assert(j2.status === 201, 'second join should return 201');

    // Duplicate re-join should succeed smoothly with alreadyJoined: true
    const dup = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Axmed Cali Updated', phone: '252634112233', city: 'Hargeysa' },
    });
    assert(dup.status === 200 && dup.json().alreadyJoined === true, 'duplicate join should update cleanly');
    console.log('  ✅ PASS: /api/views/join normalizes Somali numbers, tracks referrals & handles re-joins');

    // 3. Admin Auth Guard + VIP Pinned Sponsor Creation
    const unauthVip = await invokeServer('POST', '/api/admin/views/vip', {
      body: { name: 'Hacker', phone: '252639999999' },
    });
    assert(unauthVip.status === 401, 'unauthenticated VIP creation must return 401');

    const vipRes = await invokeServer('POST', '/api/admin/views/vip', {
      headers: { Authorization: adminAuth },
      body: {
        name: 'Hargeysa Fashion VIP',
        phone: '0634998877',
        city: 'Hargeysa',
        tagline: 'Dhar casri ah & delivery bilaash ah!',
        durationDays: 30,
        vipPriority: 1,
      },
    });
    assert(vipRes.status === 201, `VIP creation should return 201, got ${vipRes.status}`);
    const vipContact = vipRes.json().contact;
    assert(vipContact.isVip === true && vipContact.phone === '252634998877', 'VIP contact should be active & normalized');
    console.log('  ✅ PASS: Admin VIP Pinned creation works and enforces auth');

    // 4. Public Summary masks regular phones but exposes VIP sponsors
    const sumRes = await invokeServer('GET', '/api/views/summary');
    assert(sumRes.status === 200, '/api/views/summary should return 200');
    const sum = sumRes.json();
    assert(sum.stats.totalContacts === 3, `totalContacts should be 3, got ${sum.stats.totalContacts}`);
    assert(sum.stats.activeVipCount === 1, 'activeVipCount should be 1');
    assert(sum.vips.length === 1 && sum.vips[0].phone === '252634998877', 'VIP phone should be exposed on VIP cards');
    const regularFeedItem = sum.recentMembers.find((m: any) => !m.isVip);
    assert(regularFeedItem && regularFeedItem.maskedPhone.includes('•••'), 'Regular member phone must be privacy-masked in public feed');
    console.log('  ✅ PASS: /api/views/summary masks regular phones and showcases VIP sponsors');

    // 5. vCard 3.0 (.vcf) Generation: VIP Pinned strictly FIRST, CRLF valid, exclude myPhone, city filter
    const vcfRes = await invokeServer('GET', '/api/views/download.vcf?scope=current&myPhone=252634112233');
    assert(vcfRes.status === 200, 'download.vcf should return 200');
    assert(String(vcfRes.headers['content-type'] || '').includes('text/vcard'), 'Content-Type should be text/vcard');
    assert(vcfRes.text.includes('BEGIN:VCARD\r\nVERSION:3.0\r\n'), 'vCard must use RFC 2426 vCard 3.0 CRLF format');
    assert(vcfRes.text.includes('TEL;TYPE=CELL,VOICE:+252634998877'), 'vCard must contain VIP phone');
    assert(vcfRes.text.includes('TEL;TYPE=CELL,VOICE:+252615557788'), 'vCard must contain batch peer phone');
    assert(!vcfRes.text.includes('+252634112233'), 'vCard should skip downloader own myPhone');
    const vipIdx = vcfRes.text.indexOf('VIP Hargeysa Fashion VIP');
    const peerIdx = vcfRes.text.indexOf('CV - Hodan Nuur');
    assert(vipIdx >= 0 && peerIdx > vipIdx, 'VIP Pinned contact must appear BEFORE regular contacts in .vcf');

    // City filter test: VIP still pinned + Muqdisho only
    const cityVcf = await invokeServer('GET', '/api/views/download.vcf?scope=current&city=Muqdisho');
    assert(cityVcf.text.includes('+252634998877') && cityVcf.text.includes('+252615557788'), 'City VCF should keep VIP + Muqdisho members');
    assert(!cityVcf.text.includes('+252634112233'), 'City VCF for Muqdisho should exclude Hargeysa free members');

    // Verify download counter incremented
    const sumAfter = (await invokeServer('GET', '/api/views/summary')).json();
    assert(sumAfter.stats.totalDownloads >= 2, 'totalDownloads counter should increment on .vcf downloads');
    console.log('  ✅ PASS: /api/views/download.vcf generates valid vCard 3.0 with VIPs pinned at top');

    // 6. Admin Config, New Batch, Toggle VIP, Delete
    const cfgRes = await invokeServer('PUT', '/api/admin/views/config', {
      headers: { Authorization: adminAuth },
      body: { contactPrefix: 'CS - ', batchTarget: 150, vipPriceLabel: '$7 / Bil', announcement: 'Batch #1 caawa!' },
    });
    assert(cfgRes.status === 200 && cfgRes.json().config.contactPrefix === 'CS - ', 'admin config update should persist');

    const batchRes = await invokeServer('POST', '/api/admin/views/new-batch', {
      headers: { Authorization: adminAuth },
    });
    assert(batchRes.status === 200 && batchRes.json().config.currentBatch === 2, 'new-batch should advance batch to #2');

    const delRes = await invokeServer('DELETE', `/api/admin/views/contacts/${c1.id}`, {
      headers: { Authorization: adminAuth },
    });
    assert(delRes.status === 200 && delRes.json().deleted === true, 'admin delete contact should succeed');
    console.log('  ✅ PASS: Admin config, new batch rollover, and contact management verified');

    console.log('\n🎉 All CARDOSO Views & .vcf Hub tests passed!\n');
  } finally {
    await memory.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runViewsHubTests().catch((err) => {
  console.error('❌ Views Hub Test Suite Failed:', err);
  process.exit(1);
});
