import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import vm from 'vm';
import { PassThrough } from 'stream';
import { WhatsAppManagerService, whatsappManagerService } from '../src/services/whatsapp-manager.service.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { createStudioServer } from '../src/web/studio-server.js';
import { renderAdminDashboardHTML } from '../src/web/views/admin-page.js';
import { config } from '../src/config/env.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runVoiceGroupsTests(): Promise<void> {
  console.log('\n🧪 Running Voice Note to Groups & Group Names Persistence Test Suite...\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-voice-groups-'));
  const authDir = path.join(tmpDir, 'auth');
  fs.mkdirSync(authDir, { recursive: true });

  try {
    // 1. Live fetch + LID admin detection + disk persistence
    const mgr1 = new WhatsAppManagerService({
      authDir,
      statusStoragePath: path.join(tmpDir, 'statuses.json'),
      adminPhones: ['252634949642'],
    });

    const mockLiveSocket: any = {
      user: { id: '252634949642:1@s.whatsapp.net', lid: '998877665544@lid' },
      groupFetchAllParticipating: async () => ({
        '120363001@g.us': {
          id: '120363001@g.us',
          subject: 'Hargeysa Tech Hub',
          participants: [
            { id: '111111111111@lid', phoneNumber: '252634949642@s.whatsapp.net', admin: 'superadmin' },
            { id: '252611111111@s.whatsapp.net', admin: null },
          ],
        },
        '120363002@g.us': {
          id: '120363002@g.us',
          subject: 'Ardayda Barashada AI',
          size: 45,
          participants: [{ id: '252612222222@s.whatsapp.net', admin: 'admin' }],
        },
      }),
    };

    mgr1.setSocket(mockLiveSocket);
    const liveRes = await mgr1.listParticipatingGroupsDetailed({
      forceRefresh: true,
      isTransportConnected: true,
    });
    assert(liveRes.groups.length === 2, `Expected 2 groups from live fetch, got ${liveRes.groups.length}`);
    assert(liveRes.source === 'live', `Expected source=live, got ${liveRes.source}`);
    const techGroup = liveRes.groups.find((g) => g.id === '120363001@g.us');
    assert(techGroup && techGroup.name === 'Hargeysa Tech Hub', 'Group subject name must match');
    assert(techGroup?.isAdmin === true && techGroup?.role === 'superadmin', 'LID participant phoneNumber admin detection must work');
    const aiGroup = liveRes.groups.find((g) => g.id === '120363002@g.us');
    assert(aiGroup && aiGroup.name === 'Ardayda Barashada AI', 'Second group subject name must match');
    console.log('  ✅ PASS: Live fetch caches group names, detects LID admin roles & persists to disk');

    // 2. Real group names must NEVER be overwritten by blank/JID-only updates
    mgr1.recordDiscoveredGroup({ id: '120363001@g.us' }, false);
    mgr1.recordDiscoveredGroup({ id: '120363001@g.us', name: '120363001@g.us' }, false);
    const afterBlank = await mgr1.listParticipatingGroups({ forceRefresh: false, isTransportConnected: false });
    const techAfter = afterBlank.find((g) => g.id === '120363001@g.us');
    assert(techAfter?.name === 'Hargeysa Tech Hub', 'Real group name must never be overwritten by raw JID');
    console.log('  ✅ PASS: Existing real group names preserved against partial/empty updates');

    // 3. Reload after restart + resilient fallback when groupFetchAllParticipating throws rate-overlimit
    const mgr2 = new WhatsAppManagerService({
      authDir,
      statusStoragePath: path.join(tmpDir, 'statuses.json'),
      adminPhones: ['252634949642'],
    });
    const failingSocket: any = {
      user: { id: '252634949642:1@s.whatsapp.net' },
      groupFetchAllParticipating: async () => {
        throw new Error('rate-overlimit');
      },
      groupMetadata: async (jid: string) => ({
        id: jid,
        subject: 'Kooxda Ganacsiga Muqdisho',
        participants: [{ id: '252634949642@s.whatsapp.net', admin: 'admin' }],
      }),
    };
    mgr2.setSocket(failingSocket);
    // Also add an unresolved JID-only group (e.g. discovered from incoming group message)
    mgr2.recordDiscoveredGroup({ id: '120363003@g.us' }, false);

    const fallbackRes = await mgr2.listParticipatingGroupsDetailed({
      forceRefresh: true,
      isTransportConnected: true,
    });
    assert(fallbackRes.groups.length === 3, `Expected 3 groups after cache reload + fallback, got ${fallbackRes.groups.length}`);
    assert(Boolean(fallbackRes.warning), 'Should include clear Somali warning when live fetch fails');
    const resolved3 = fallbackRes.groups.find((g) => g.id === '120363003@g.us');
    assert(resolved3?.name === 'Kooxda Ganacsiga Muqdisho', `Expected missing name resolved via groupMetadata, got ${resolved3?.name}`);
    console.log('  ✅ PASS: Survives restart & rate-overlimit via disk cache + resolves missing names via groupMetadata');

    // 4. Admin Dashboard HTML inline script syntax check + refresh button wiring
    const adminHtml = renderAdminDashboardHTML('Owner Admin');
    const scripts = [...adminHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    assert(scripts.length >= 1, 'Admin HTML must contain client script');
    for (let i = 0; i < scripts.length; i++) {
      new vm.Script(scripts[i][1], { filename: `admin-page-script-${i}.js` });
    }
    assert(adminHtml.includes('loadGroupsForVoice(true)'), 'Refresh button must call loadGroupsForVoice(true)');
    assert(adminHtml.includes('voiceGroupsStatusSub'), 'Admin page must display group status summary');
    console.log('  ✅ PASS: Admin Dashboard HTML inline JS compiles cleanly & wires refresh/diagnostics');

    // 5. HTTP GET /api/owner/groups endpoint returns groups, source, connected & warning cleanly
    const dbPath = path.join(tmpDir, 'studio.db');
    const memory = new SQLiteStudentMemory(dbPath);
    await memory.initialize();
    const quota = new QuotaTracker(100, 14);
    const ai = new AIOrchestrator(config, quota, 'fake-key');
    const engine = new StudentAdvisorEngine(memory, ai);
    const fakeTransport: any = {
      name: 'mock-baileys',
      isConnected: true,
      getSocket: () => mockLiveSocket,
      start: async () => {},
      stop: async () => {},
      sendMessage: async () => true,
      onMessage: () => {},
      getStatus: () => ({ name: 'mock', connected: true, activeChats: 0, lastActivity: null }),
    };

    const server = createStudioServer({
      port: 0,
      memory,
      engine,
      transport: fakeTransport,
      config,
      studioPasswordOverride: 'admin-secret',
    });

    const authHeader = 'Basic ' + Buffer.from('owner:admin-secret').toString('base64');
    const apiRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const sock: any = new PassThrough();
      sock.remoteAddress = '127.0.0.1';
      const req: any = new http.IncomingMessage(sock);
      req.method = 'GET';
      req.url = '/api/owner/groups?refresh=1';
      req.headers = { host: 'localhost', authorization: authHeader };
      req.push(null);

      const res: any = new http.ServerResponse(req);
      const chunks: Buffer[] = [];
      res.write = (c: any) => {
        if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
        return true;
      };
      res.end = (c?: any) => {
        if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
        const txt = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: JSON.parse(txt) });
        return res;
      };
      try {
        server.emit('request', req, res);
      } catch (e) {
        reject(e);
      }
    });

    assert(apiRes.status === 200, `Expected HTTP 200 from /api/owner/groups, got ${apiRes.status}`);
    assert(apiRes.body.status === 'ok', 'API status should be ok');
    assert(Array.isArray(apiRes.body.groups) && apiRes.body.groups.length >= 2, 'API must return participating groups');
    assert(
      apiRes.body.groups.some((g: any) => g.name === 'Hargeysa Tech Hub'),
      'API must include real group subject names'
    );
    assert(apiRes.body.connected === true, 'API must report connected=true');
    console.log('  ✅ PASS: GET /api/owner/groups?refresh=1 returns full group names & diagnostics');

    memory.close();
    mgr1.stopAutonomousGovernorLoop();
    mgr2.stopAutonomousGovernorLoop();
    whatsappManagerService.setSocket(null);
    whatsappManagerService.stopAutonomousGovernorLoop();
    console.log('\n🎉 ALL VOICE NOTE TO GROUPS TESTS PASSED!\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runVoiceGroupsTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Voice Groups test failed:', err);
    process.exit(1);
  });
