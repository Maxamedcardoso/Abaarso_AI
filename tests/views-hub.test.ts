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
import { normalizeViewsPhone } from '../src/services/views-hub.service.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { config } from '../src/config/env.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runViewsHubTests(): Promise<void> {
  console.log('\n🧪 Running CARDOSO Views & .vcf Contact Hub Test Suite...\n');

  // 0. Phone Normalization Unit Checks (+252 Somalia AND +251 Ethiopia / Jigjiga!)
  assert(normalizeViewsPhone('0634112233') === '252634112233', 'Somalia 063 -> 25263');
  assert(normalizeViewsPhone('+252 063 411 2233') === '252634112233', 'Somalia +252 063 -> strip extra 0');
  assert(normalizeViewsPhone('0915123456') === '251915123456', 'Ethiopia 0915 -> 251915');
  assert(normalizeViewsPhone('+251 0915 123 456') === '251915123456', 'Ethiopia +251 0915 -> strip extra 0');
  assert(normalizeViewsPhone('915123456', '251') === '251915123456', 'Ethiopia 915 + cc=251 -> 251915');
  assert(normalizeViewsPhone('0712345678', '251') === '251712345678', 'Ethiopia Safaricom 07 + cc=251 -> 2517');
  assert(normalizeViewsPhone('00251922334455') === '251922334455', '00251 -> 251');
  assert(normalizeViewsPhone('0907112233') === '252907112233', 'Puntland Golis 090 stays 25290');
  console.log('  ✅ PASS: +252 Somalia & +251 Ethiopia (Jigjiga/DDS) phone normalization verified');

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
    // 1. Validate /views, /app, and Admin Studio HTML + inline JS syntax
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

    // 2. Set batchTarget=2 and downloadMode='locked' to test Lock + Auto-Rollover + Premature Block!
    const cfgRes = await invokeServer('PUT', '/api/admin/views/config', {
      headers: { Authorization: adminAuth },
      body: { contactPrefix: 'CV - ', batchTarget: 2, downloadMode: 'locked', vipPriceLabel: '$5 / Bil' },
    });
    assert(cfgRes.status === 200 && cfgRes.json().config.downloadMode === 'locked', 'config locked mode should save');

    // 3. First Join (+252) & Strict Duplicate Rejection (409) & Returning Lookup
    const j1 = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Axmed Cali', phone: '0634112233', countryCode: '252', city: 'Hargeysa' },
    });
    assert(j1.status === 201 && j1.json().contact.phone === '252634112233', 'first join should succeed');

    // Duplicate join in ANY format MUST be rejected with 409!
    const dup1 = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Axmed Duplicate', phone: '+252 063 411 2233', city: 'Hargeysa' },
    });
    assert(dup1.status === 409 && dup1.json().code === 'DUPLICATE_PHONE', `duplicate phone must return 409, got ${dup1.status}`);

    // Returning lookup works cleanly without creating duplicate
    const lookRes = await invokeServer('POST', '/api/views/lookup', {
      body: { phone: '0634112233', countryCode: '252' },
    });
    assert(lookRes.status === 200 && lookRes.json().contact.phone === '252634112233', 'returning lookup should succeed');
    console.log('  ✅ PASS: Strict duplicate rejection (409) & returning lookup verified');

    // 4. Premature New Batch MUST be blocked while Batch #1 is 1/2 (NOT full)
    const prematureBatch = await invokeServer('POST', '/api/admin/views/new-batch', {
      headers: { Authorization: adminAuth },
    });
    assert(
      prematureBatch.status === 400 && prematureBatch.json().code === 'BATCH_NOT_FULL',
      `premature new batch must be rejected with 400 BATCH_NOT_FULL, got ${prematureBatch.status}`
    );

    // 5. While Batch #1 is 1/2 in locked mode, public download returns 423 BATCH_LOCKED (not 0-byte failure!)
    const lockedDl = await invokeServer('GET', '/api/views/download.vcf?scope=current&batch=1&myPhone=252634112233');
    assert(lockedDl.status === 423 && lockedDl.json().code === 'BATCH_LOCKED', `locked batch should return 423, got ${lockedDl.status}`);
    console.log('  ✅ PASS: Premature new batch blocked & locked batch returns 423 BATCH_LOCKED');

    // 6. Add VIP Pinned Sponsor (+251 Ethiopia / Jigjiga!) — VIP .vcf MUST remain downloadable even when batch is locked!
    const vipRes = await invokeServer('POST', '/api/admin/views/vip', {
      headers: { Authorization: adminAuth },
      body: {
        name: 'Jigjiga Fashion VIP',
        countryCode: '251',
        phone: '0915998877',
        city: 'Jigjiga',
        tagline: 'Dhar casri ah Jigjiga!',
        durationDays: 30,
        vipPriority: 1,
      },
    });
    assert(vipRes.status === 201 && vipRes.json().contact.phone === '251915998877', 'Ethiopia +251 VIP should save cleanly');

    const vipOnlyVcf = await invokeServer('GET', '/api/views/download.vcf?scope=vip');
    assert(vipOnlyVcf.status === 200 && vipOnlyVcf.text.includes('+251915998877'), 'VIP .vcf must stay unlocked');
    assert(vipOnlyVcf.text.includes('UID:cardoso-views-251915998877'), 'vCard must include stable UID preventing duplicate phonebook saves');

    // 7. Second free join (+251 Ethiopia) fills Batch #1 (2/2) -> AUTOMATICALLY unlocks Batch #1 AND opens Batch #2!
    const j2 = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Hodan Jigjiga', countryCode: '251', phone: '0915556677', city: 'Jigjiga', referredBy: '0634112233' },
    });
    assert(j2.status === 201, 'second join should succeed');
    const j2Json = j2.json();
    assert(j2Json.contact.phone === '251915556677', 'Ethiopia 0915 must normalize to 251915556677');
    assert(j2Json.contact.batchNumber === 1, '2nd member should stay in Batch #1');
    assert(j2Json.batchCompleted === true && j2Json.nextBatchOpened === 2, 'Filling Batch #1 must auto-open Batch #2!');

    // Verify Batch #1 is now UNLOCKED and downloads cleanly with Content-Length, VIP first, and tracks hasDownloaded!
    const batch1Vcf = await invokeServer('GET', '/api/views/download.vcf?scope=current&batch=1&myPhone=252634112233');
    assert(batch1Vcf.status === 200, `completed Batch #1 should unlock and return 200, got ${batch1Vcf.status}`);
    assert(Number(batch1Vcf.headers['content-length']) > 100, 'Content-Length header must be non-zero');
    assert(batch1Vcf.text.includes('UID:cardoso-views-251915998877'), 'Batch #1 VCF must contain VIP UID');
    assert(batch1Vcf.text.includes('UID:cardoso-views-251915556677'), 'Batch #1 VCF must contain peer +251 UID');
    assert(!batch1Vcf.text.includes('+252634112233'), 'Batch #1 VCF skips downloader own phone when peers exist');
    assert(
      batch1Vcf.text.indexOf('VIP Jigjiga Fashion VIP') < batch1Vcf.text.indexOf('CV - Hodan Jigjiga'),
      'VIP must be pinned before regular members'
    );

    // Verify 3rd member automatically lands in Batch #2!
    const j3 = await invokeServer('POST', '/api/views/join', {
      body: { name: 'Fartuun', countryCode: '252', phone: '615889900', city: 'Muqdisho' },
    });
    assert(j3.status === 201 && j3.json().contact.batchNumber === 2, '3rd member must automatically enter Batch #2');
    console.log('  ✅ PASS: Auto-batch rollover on full (Batch #1 -> #2) & vCard UID/Content-Length verified');

    // 8. Verify 1-tap Verified Saver + Admin Overview Download/Verified tracking
    const verRes = await invokeServer('POST', '/api/views/verify', {
      body: { phone: '0634112233', countryCode: '252' },
    });
    assert(verRes.status === 200 && verRes.json().contact.verifiedSaver === true, 'verify saver should mark verifiedSaver=true');

    const adminOverview = (await invokeServer('GET', '/api/admin/views/overview', { headers: { Authorization: adminAuth } })).json();
    const axmedRow = adminOverview.contacts.find((c: any) => c.phone === '252634112233');
    assert(axmedRow && axmedRow.hasDownloaded === true && axmedRow.verifiedSaver === true, 'Admin overview must show hasDownloaded & verifiedSaver');
    assert(adminOverview.stats.downloadedMembersCount >= 1 && adminOverview.stats.verifiedSaversCount >= 1, 'Admin stats must count downloaded & verified savers');

    // 9. Admin manual unlock on Batch #2 works + Admin Master .vcf download works
    const unlock2 = await invokeServer('POST', '/api/admin/views/unlock-batch', {
      headers: { Authorization: adminAuth },
      body: { batchNumber: 2 },
    });
    assert(unlock2.status === 200, 'admin unlock-batch should succeed');

    const adminMasterVcf = await invokeServer('GET', '/api/admin/views/download.vcf?scope=all', {
      headers: { Authorization: adminAuth },
    });
    assert(adminMasterVcf.status === 200 && adminMasterVcf.text.includes('+251915998877'), 'Admin master VCF download should work');
    console.log('  ✅ PASS: Download tracker, Verified Saver, Manual Unlock & Admin Master VCF verified');

    // 10. WhatsApp `!views` in Groups (0% Ban: replies IN GROUP with anti-flood cooldown!) & `views` in Private Chat
    await invokeServer('PUT', '/api/admin/views/config', {
      headers: { Authorization: adminAuth },
      body: { downloadMode: 'instant', batchTarget: 10 },
    });

    const router = new MessageRouter(engine, testConfig, undefined, undefined, memory, {
      tenantId: 'owner',
      publicBaseUrl: 'https://cardoso.example.com',
    });

    const sentTexts: Array<{ chatId: string; text: string }> = [];
    const sentDocs: Array<{ chatId: string; fileName: string; mimeType: string; content: string; caption: string }> = [];
    const mockWaTransport: any = {
      name: 'mock-wa',
      isConnected: true,
      sendMessage: async (chatId: string, text: string) => {
        sentTexts.push({ chatId, text });
        return true;
      },
      sendMedia: async (chatId: string, media: any) => {
        sentDocs.push({
          chatId,
          fileName: media.fileName || '',
          mimeType: media.mimeType || '',
          content: media.dataBuffer ? media.dataBuffer.toString('utf8') : '',
          caption: media.caption || '',
        });
        return true;
      },
    };

    const groupJid = '120363000111222333@g.us';

    // Group user #1 writes `!views` -> auto-registered AND receives .vcf document IN THE GROUP (never private cold DM!)
    const grpRes1 = await router.handleIncomingMessage(
      {
        id: 'grp_v_1',
        senderId: '252637001122@s.whatsapp.net',
        senderPhone: '252637001122',
        senderName: 'Cali Group',
        chatId: groupJid,
        isGroup: true,
        content: '!views',
        rawTimestamp: Date.now(),
        isMentioned: false,
        isFromMe: false,
      },
      mockWaTransport
    );
    assert(grpRes1.handled === true, 'Group !views must be handled');
    assert(sentDocs.length === 1 && sentDocs[0].chatId === groupJid, 'First group !views must send .vcf IN THE GROUP');
    assert(sentDocs[0].mimeType === 'text/vcard' && sentDocs[0].content.includes('BEGIN:VCARD'), 'Group doc must be valid vCard');
    assert(sentDocs[0].content.includes('+252637001122'), 'Group .vcf must include newly joined user');

    // Group user #2 (+251 Ethiopia) writes `!views` 2 seconds later -> registered cleanly + concise group text (NO .vcf flood, NO private DM!)
    const grpRes2 = await router.handleIncomingMessage(
      {
        id: 'grp_v_2',
        senderId: '251911223344@s.whatsapp.net',
        senderPhone: '251911223344',
        senderName: 'Muna Jigjiga',
        chatId: groupJid,
        isGroup: true,
        content: '!views',
        rawTimestamp: Date.now(),
        isMentioned: false,
        isFromMe: false,
      },
      mockWaTransport
    );
    assert(grpRes2.handled === true, 'Second group !views must be handled');
    assert(sentDocs.length === 1, 'Group cooldown must prevent spamming duplicate .vcf files back-to-back');
    assert(sentTexts.length === 1 && sentTexts[0].chatId === groupJid, 'Cooldown reply must stay IN THE GROUP (0 cold DMs!)');

    // Private chat user writes `views` -> receives .vcf directly inside Private Chat!
    const dmRes = await router.handleIncomingMessage(
      {
        id: 'dm_v_1',
        senderId: '251922334455@s.whatsapp.net',
        senderPhone: '251922334455',
        senderName: 'Sacdiya',
        chatId: '251922334455@s.whatsapp.net',
        isGroup: false,
        content: 'views',
        rawTimestamp: Date.now(),
        isMentioned: false,
        isFromMe: false,
      },
      mockWaTransport
    );
    assert(dmRes.handled === true, 'Private chat "views" must be handled');
    assert(sentDocs.length === 2 && sentDocs[1].chatId === '251922334455@s.whatsapp.net', 'Private chat must receive .vcf directly');
    assert(sentDocs[1].content.includes('+251911223344'), 'Private .vcf must include previously joined +251 group member');
    console.log('  ✅ PASS: WhatsApp Group `!views` (0 cold DMs + anti-flood cooldown) & Private `views` auto-.vcf verified');

    console.log('\n🎉 All CARDOSO Views & .vcf Hub upgraded tests passed!\n');
  } finally {
    await memory.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runViewsHubTests().catch((err) => {
  console.error('❌ Views Hub Test Suite Failed:', err);
  process.exit(1);
});
