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

async function runPwaAppTests(): Promise<void> {
  console.log('\n🧪 Running Installable PWA App Test Suite...\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-pwa-test-'));
  const dbPath = path.join(tmpDir, 'pwa-test.db');
  const memory = new SQLiteStudentMemory(dbPath);
  await memory.initialize();

  const appTestConfig = { ...config, messaging: { ...config.messaging, mode: 'app' as const } };
  const quota = new QuotaTracker(100, 14);
  const ai = new AIOrchestrator(appTestConfig, quota, 'fake-key-for-test');
  const engine = new StudentAdvisorEngine(memory, ai);
  const transport = new ConsoleSimulatorTransport();

  const server: http.Server = createStudioServer({
    port: 0,
    memory,
    engine,
    transport,
    config: appTestConfig,
    studioPasswordOverride: 'test-pass',
  });

  const invokeServer = (
    method: string,
    urlPath: string,
    opts?: { headers?: Record<string, string>; body?: any }
  ): Promise<{ status: number; headers: Record<string, any>; buffer: Buffer; text: string; json: () => any }> => {
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
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.getHeaders(),
          buffer,
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

  try {
    // 1. Web App Manifest
    const manifestRes = await invokeServer('GET', '/manifest.webmanifest');
    assert(manifestRes.status === 200, 'manifest.webmanifest should return 200');
    assert(
      String(manifestRes.headers['content-type'] || '').includes('application/manifest+json'),
      'manifest should serve application/manifest+json'
    );
    const manifest = manifestRes.json();
    assert(manifest.display === 'standalone', 'manifest display should be standalone');
    assert(manifest.start_url === '/app', 'manifest start_url should be /app');
    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'manifest should define 192 & 512 PNG icons');
    console.log('  ✅ PASS: /manifest.webmanifest valid standalone PWA manifest');

    // 2. Service Worker
    const swRes = await invokeServer('GET', '/sw.js');
    assert(swRes.status === 200, '/sw.js should return 200');
    assert(String(swRes.headers['content-type'] || '').includes('javascript'), '/sw.js should serve JS');
    assert(swRes.text.includes('cardoso-ai-pwa-v4') && swRes.text.includes('/pwa/offline') && swRes.text.includes('.vcf') && swRes.text.includes('/api/'), '/sw.js should include cache v4, .vcf + /api/ bypass & offline fallback');
    new vm.Script(swRes.text, { filename: 'sw.js' });
    console.log('  ✅ PASS: /sw.js serves syntactically valid installable Service Worker');

    // 3. Generated PNG icons (verify PNG magic header & IHDR width/height)
    const iconChecks: Array<{ url: string; expectedSize: number }> = [
      { url: '/pwa/icon-192.png', expectedSize: 192 },
      { url: '/pwa/icon-512.png', expectedSize: 512 },
      { url: '/pwa/icon-512-maskable.png', expectedSize: 512 },
      { url: '/pwa/apple-touch-icon.png', expectedSize: 180 },
    ];
    for (const check of iconChecks) {
      const res = await invokeServer('GET', check.url);
      assert(res.status === 200, `${check.url} should return 200`);
      assert(String(res.headers['content-type'] || '').includes('image/png'), `${check.url} should be image/png`);
      const buf = res.buffer;
      assert(buf.length > 500, `${check.url} should have non-trivial PNG bytes`);
      const pngSig = buf.subarray(0, 8).toString('hex');
      assert(pngSig === '89504e470d0a1a0a', `${check.url} must start with PNG magic signature`);
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      assert(width === check.expectedSize && height === check.expectedSize, `${check.url} dimensions should be ${check.expectedSize}x${check.expectedSize}, got ${width}x${height}`);
    }
    console.log('  ✅ PASS: /pwa/icon-192.png, icon-512.png, maskable & apple-touch-icon are valid PNG binaries');

    // 4. SVG icon & Offline page
    const svgRes = await invokeServer('GET', '/pwa/icon.svg');
    assert(svgRes.status === 200 && svgRes.text.includes('<svg'), '/pwa/icon.svg should return valid SVG');
    const offlineRes = await invokeServer('GET', '/pwa/offline');
    assert(offlineRes.status === 200 && offlineRes.text.includes('Khadka Internet-ku'), '/pwa/offline should render Somali offline fallback');
    console.log('  ✅ PASS: /pwa/icon.svg and /pwa/offline render properly');

    // 5. Main /app shell & PWA tags across public views + Admin Dashboard (+ inline JS syntax check!)
    const adminAuth = 'Basic ' + Buffer.from('admin:test-pass').toString('base64');
    const routeChecks: Array<{ route: string; headers?: Record<string, string> }> = [
      { route: '/app' },
      { route: '/join' },
      { route: '/portal' },
      { route: '/admin-login' },
      { route: '/', headers: { Authorization: adminAuth } },
    ];
    for (const item of routeChecks) {
      const res = await invokeServer('GET', item.route, { headers: item.headers });
      assert(res.status === 200, `${item.route} should return 200, got ${res.status}`);
      assert(res.text.includes('/manifest.webmanifest'), `${item.route} should link manifest.webmanifest`);
      assert(res.text.includes('triggerCardosoInstall'), `${item.route} should include PWA install trigger`);
      const scriptMatches = [...res.text.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
      assert(scriptMatches.length > 0, `${item.route} should include inline script`);
      for (const m of scriptMatches) {
        new vm.Script(m[1], { filename: `${item.route}.js` });
      }
    }
    console.log('  ✅ PASS: /app, /join, /portal, /admin-login, and / expose valid JS & full PWA install handlers');

    // 6. Bootstrap & Prayer Times APIs
    const bootRes = await invokeServer('GET', '/api/app/bootstrap');
    assert(bootRes.status === 200, '/api/app/bootstrap should return 200');
    const bootJson = bootRes.json();
    assert(bootJson.status === 'ok' && bootJson.mode === 'app' && bootJson.capabilities?.pwaInstallable === true, 'bootstrap metadata invalid');

    const prayerRes = await invokeServer('GET', '/api/app/prayer-times');
    assert(prayerRes.status === 200, '/api/app/prayer-times should return 200');
    const prayerJson = prayerRes.json();
    assert(prayerJson.status === 'ok' && Array.isArray(prayerJson.prayers) && prayerJson.prayers.length === 5, 'prayer times should return 5 daily prayers');
    console.log('  ✅ PASS: /api/app/bootstrap and /api/app/prayer-times return live app data');

    // 7. Chat + SQLite Persistence + Right-to-be-Forgotten Delete
    const sessionId = 'test_pwa_sess_001';
    const emptyHistRes = await invokeServer('GET', `/api/app/history?sessionId=${sessionId}`);
    const emptyHist = emptyHistRes.json();
    assert(emptyHist.status === 'ok' && emptyHist.messages.length === 0, 'fresh session should have empty history');

    // Instant Somali greeting ("asc") works deterministically without external Gemini API quota
    const chatRes = await invokeServer('POST', '/api/app/chat', {
      body: {
        sessionId,
        message: 'asc',
        senderName: 'Mohamed',
        wantVoice: false,
      },
    });
    assert(chatRes.status === 200, '/api/app/chat should return 200');
    const chatJson = chatRes.json();
    assert(chatJson.status === 'ok' && typeof chatJson.reply === 'string' && chatJson.reply.length > 5, 'chat should return Somali greeting reply');

    const histRes = await invokeServer('GET', `/api/app/history?sessionId=${sessionId}`);
    const histJson = histRes.json();
    assert(histJson.status === 'ok' && histJson.messages.length === 2, `history should contain 2 saved turns, got ${histJson.messages?.length}`);
    assert(histJson.messages[0].role === 'user' && histJson.messages[1].role === 'model', 'history should preserve user->model order');

    const delRes = await invokeServer('DELETE', `/api/app/history?sessionId=${sessionId}`);
    const delJson = delRes.json();
    assert(delJson.status === 'ok' && delJson.deleted === true, 'DELETE /api/app/history should purge session');

    const afterDelRes = await invokeServer('GET', `/api/app/history?sessionId=${sessionId}`);
    const afterDel = afterDelRes.json();
    assert(afterDel.status === 'ok' && afterDel.messages.length === 0, 'history should be empty after deletion');
    console.log('  ✅ PASS: /api/app/chat persists history in SQLite and DELETE /api/app/history purges cleanly');

    console.log('\n🎉 All Installable PWA App tests passed!\n');
  } finally {
    await memory.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runPwaAppTests().catch((err) => {
  console.error('❌ PWA App Test Suite Failed:', err);
  process.exit(1);
});
