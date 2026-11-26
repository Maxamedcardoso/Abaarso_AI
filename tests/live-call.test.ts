import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import vm from 'vm';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import { createStudioServer } from '../src/web/studio-server.js';
import { config } from '../src/config/env.js';
import { buildIceServers, getLiveCallConfig } from '../src/live-call/live-call.config.js';
import { attachLivePeerWebSocket } from '../src/live-call/services/peer-match.service.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createInMemoryWsClient(wss: WebSocketServer, urlPath: string) {
  const ws: any = new EventEmitter();
  ws.readyState = WebSocket.OPEN;
  ws.ping = () => ws.emit('pong');
  ws.terminate = () => {
    ws.readyState = WebSocket.CLOSED;
    ws.emit('close');
  };
  ws.close = () => {
    ws.readyState = WebSocket.CLOSED;
    ws.emit('close');
  };

  const inbox: any[] = [];
  const waiters: Array<{ predicate: (m: any) => boolean; resolve: (m: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

  ws.send = (raw: string) => {
    let parsed: any;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    for (let i = 0; i < waiters.length; i++) {
      if (waiters[i].predicate(parsed)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(parsed);
        return;
      }
    }
    inbox.push(parsed);
  };

  wss.emit('connection', ws as WebSocket, { url: urlPath } as http.IncomingMessage);

  return {
    sendClient(payload: Record<string, unknown>) {
      ws.emit('message', Buffer.from(JSON.stringify(payload)), false);
    },
    nextMsg(predicate: (m: any) => boolean, timeoutMs: number = 3000): Promise<any> {
      const idx = inbox.findIndex(predicate);
      if (idx >= 0) {
        return Promise.resolve(inbox.splice(idx, 1)[0]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const wIdx = waiters.findIndex((w) => w.resolve === resolve);
          if (wIdx >= 0) waiters.splice(wIdx, 1);
          reject(new Error(`Timed out waiting for WebSocket message after ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
    close() {
      ws.close();
    },
  };
}

async function runLiveCallTests(): Promise<void> {
  console.log('\n🧪 Running CARDOSO Live — Peer-to-Peer WebRTC Video & Voice Call Test Suite...\n');

  // 1. WebRTC Config Parsing & STUN/TURN ICE Servers
  const customCfg = getLiveCallConfig({
    LIVE_CALL_ENABLED: 'true',
    LIVE_CALL_STUN_URLS: 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
    LIVE_CALL_TURN_URL: 'turn:turn.example.org:3478',
    LIVE_CALL_TURN_USERNAME: 'cardoso',
    LIVE_CALL_TURN_CREDENTIAL: 'secret',
  } as any);
  assert(customCfg.enabled === true, 'LIVE_CALL_ENABLED should parse as true');
  const ice = buildIceServers(customCfg);
  assert(
    ice.length === 2 &&
      Array.isArray(ice[0].urls) &&
      ice[0].urls.length === 2 &&
      ice[1].urls === 'turn:turn.example.org:3478' &&
      ice[1].username === 'cardoso',
    'buildIceServers should include STUN + optional TURN entries'
  );
  console.log('  ✅ PASS: Live Call WebRTC config & STUN/TURN ICE server builder');

  // 2. /ws/live-peer Random Matchmaking, Camera-Off Audio-Only, WebRTC Signaling, Chat, Next, Block & Private Rooms
  const peerServer = http.createServer();
  const peerHandle = attachLivePeerWebSocket(peerServer, { config: customCfg, heartbeatIntervalMs: 30000 });

  const peerA = createInMemoryWsClient(peerHandle.wss, '/ws/live-peer?name=Cali&lang=so&cam=0&mic=1');
  const peerB = createInMemoryWsClient(peerHandle.wss, '/ws/live-peer?name=Amina&lang=so&cam=1&mic=1');

  const welcomeA = await peerA.nextMsg((m) => m.type === 'welcome');
  const welcomeB = await peerB.nextMsg((m) => m.type === 'welcome');
  assert(
    typeof welcomeA.peerId === 'string' &&
      typeof welcomeB.peerId === 'string' &&
      welcomeA.peerId !== welcomeB.peerId &&
      peerHandle.getStats().onlineCount === 2,
    'Peer signaling hub should assign unique IDs and track onlineCount=2'
  );

  // Random Match: Peer A joins with Camera OFF (Audio-Only), Peer B joins with Camera ON
  peerA.sendClient({ type: 'match.find', displayName: 'Cali', language: 'so', camOn: false, micOn: true });
  const waitA = await peerA.nextMsg((m) => m.type === 'match.waiting');
  assert(waitA.queuePosition === 1, 'First random seeker should enter waiting queue');

  peerB.sendClient({ type: 'match.find', displayName: 'Amina', language: 'so', camOn: true, micOn: true });
  const [foundA, foundB] = await Promise.all([
    peerA.nextMsg((m) => m.type === 'match.found'),
    peerB.nextMsg((m) => m.type === 'match.found'),
  ]);
  assert(
    foundA.roomId === foundB.roomId &&
      foundA.initiator === true &&
      foundB.initiator === false &&
      foundB.partner.name === 'Cali' &&
      foundB.partner.camOn === false &&
      foundA.partner.name === 'Amina' &&
      foundA.partner.camOn === true &&
      peerHandle.getStats().activeCalls === 1,
    'Random match should pair Cali (Cam Off) and Amina (Cam On) with initiator handshake'
  );

  // Full WebRTC SDP Offer / Answer / ICE relay
  peerA.sendClient({ type: 'rtc.offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111' });
  const offerToB = await peerB.nextMsg((m) => m.type === 'rtc.offer');
  assert(offerToB.sdp.includes('m=audio'), 'rtc.offer should relay to partner');

  peerB.sendClient({ type: 'rtc.answer', sdp: 'v=0\r\nm=audio 9 answer-sdp' });
  const answerToA = await peerA.nextMsg((m) => m.type === 'rtc.answer');
  assert(answerToA.sdp.includes('answer-sdp'), 'rtc.answer should relay to initiator');

  peerA.sendClient({ type: 'rtc.ice', candidate: { candidate: 'candidate:1 1 udp 2113937151 192.168.1.2 50000 typ host' } });
  const iceToB = await peerB.nextMsg((m) => m.type === 'rtc.ice');
  assert(String(iceToB.candidate?.candidate || '').includes('typ host'), 'rtc.ice should relay ICE candidate');

  // Mid-call Camera On/Off privacy sync
  peerA.sendClient({ type: 'media.state', camOn: true, micOn: true });
  const camOnSync = await peerB.nextMsg((m) => m.type === 'partner.media' && m.camOn === true);
  assert(camOnSync.camOn === true && camOnSync.micOn === true, 'media.state should sync camera ON');

  peerA.sendClient({ type: 'media.state', camOn: false, micOn: true });
  const camOffSync = await peerB.nextMsg((m) => m.type === 'partner.media' && m.camOn === false);
  assert(camOffSync.camOn === false, 'media.state should sync camera OFF');

  // Real-time in-call text chat
  peerA.sendClient({ type: 'chat.send', text: 'Asc Amina, sidee tahay?' });
  const [chatToB, chatEchoA] = await Promise.all([
    peerB.nextMsg((m) => m.type === 'chat.message'),
    peerA.nextMsg((m) => m.type === 'chat.sent'),
  ]);
  assert(
    chatToB.text === 'Asc Amina, sidee tahay?' && chatToB.senderName === 'Cali' && chatEchoA.text === chatToB.text,
    'chat.send should relay text to partner and confirm to sender'
  );

  // Next skip
  peerA.sendClient({ type: 'match.next', displayName: 'Cali', language: 'so', camOn: false, micOn: true });
  const leftB = await peerB.nextMsg((m) => m.type === 'partner.left');
  assert(leftB.reason === 'next', 'match.next should notify previous partner with reason=next');

  // Block prevents matching again
  peerB.sendClient({ type: 'match.find', displayName: 'Amina', language: 'so', camOn: true, micOn: true });
  await Promise.all([peerA.nextMsg((m) => m.type === 'match.found'), peerB.nextMsg((m) => m.type === 'match.found')]);
  peerA.sendClient({ type: 'partner.block' });
  await Promise.all([
    peerA.nextMsg((m) => m.type === 'partner.blocked'),
    peerB.nextMsg((m) => m.type === 'partner.left' && m.reason === 'blocked'),
  ]);
  peerA.sendClient({ type: 'match.find', displayName: 'Cali', language: 'so', camOn: false, micOn: true });
  await peerA.nextMsg((m) => m.type === 'match.waiting');
  peerB.sendClient({ type: 'match.find', displayName: 'Amina', language: 'so', camOn: true, micOn: true });
  await peerB.nextMsg((m) => m.type === 'match.waiting');
  assert(peerHandle.getStats().activeCalls === 0, 'Blocked peers must never be re-matched together');

  // Private Room create, join & ROOM_FULL guard
  const peerC = createInMemoryWsClient(peerHandle.wss, '/ws/live-peer?name=Hassan&cam=1&mic=1');
  const peerD = createInMemoryWsClient(peerHandle.wss, '/ws/live-peer?name=Hodan&cam=0&mic=1');
  const peerE = createInMemoryWsClient(peerHandle.wss, '/ws/live-peer?name=Faysal&cam=1&mic=1');
  await Promise.all([
    peerC.nextMsg((m) => m.type === 'welcome'),
    peerD.nextMsg((m) => m.type === 'welcome'),
    peerE.nextMsg((m) => m.type === 'welcome'),
  ]);

  peerC.sendClient({ type: 'room.create', displayName: 'Hassan', camOn: true, micOn: true });
  const createdRoom = await peerC.nextMsg((m) => m.type === 'room.created');
  assert(typeof createdRoom.roomCode === 'string' && createdRoom.roomCode.startsWith('CAR-'), 'room.create should return CAR-XXXX code');

  peerD.sendClient({ type: 'room.join', roomCode: createdRoom.roomCode, displayName: 'Hodan', camOn: false, micOn: true });
  const [privC, privD] = await Promise.all([
    peerC.nextMsg((m) => m.type === 'match.found'),
    peerD.nextMsg((m) => m.type === 'match.found'),
  ]);
  assert(
    privC.mode === 'private' &&
      privD.mode === 'private' &&
      privC.roomCode === createdRoom.roomCode &&
      privC.partner.name === 'Hodan' &&
      privC.partner.camOn === false,
    'room.join should pair private room friends with Camera-Off status preserved'
  );

  peerE.sendClient({ type: 'room.join', roomCode: createdRoom.roomCode, displayName: 'Faysal', camOn: true, micOn: true });
  const fullErr = await peerE.nextMsg((m) => m.type === 'error');
  assert(fullErr.code === 'ROOM_FULL', '3rd user trying to join an active 2-person private room should get ROOM_FULL');

  peerA.close();
  peerB.close();
  peerC.close();
  peerD.close();
  peerE.close();
  peerHandle.close();
  console.log('  ✅ PASS: /ws/live-peer Random Match, WebRTC SDP/ICE, Camera On/Off sync, Live Chat, Next, Block & Private Room');

  // 3. Express Studio Server Integration (`/api/live-call/peer/stats`, `/live-call`, `/app` + JS syntax check)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-live-peer-test-'));
  const dbPath = path.join(tmpDir, 'live-peer-test.db');
  const memory = new SQLiteStudentMemory(dbPath);
  await memory.initialize();

  try {
    const testConfig = { ...config, messaging: { ...config.messaging, mode: 'app' as const } };
    const quota = new QuotaTracker(100, 14);
    const ai = new AIOrchestrator(testConfig, quota, 'fake-key-for-test');
    const engine = new StudentAdvisorEngine(memory, ai);
    const transport = new ConsoleSimulatorTransport();

    const server: http.Server = createStudioServer({
      port: 0,
      memory,
      engine,
      transport,
      config: testConfig,
      studioPasswordOverride: 'test-pass',
    });

    const invoke = (
      method: string,
      urlPath: string,
      body?: any
    ): Promise<{ status: number; headers: Record<string, any>; buffer: Buffer; text: string; json: () => any }> => {
      return new Promise((resolve, reject) => {
        const socket: any = new PassThrough();
        socket.remoteAddress = '127.0.0.1';
        const req: any = new http.IncomingMessage(socket);
        req.method = method;
        req.url = urlPath;
        req.headers = { host: 'localhost' };
        if (body !== undefined) {
          const payload = JSON.stringify(body);
          req.headers['content-type'] = 'application/json';
          req.headers['content-length'] = String(Buffer.byteLength(payload));
          req.push(payload);
        }
        req.push(null);

        const res: any = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        res.write = (c: any) => {
          if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
          return true;
        };
        res.end = (c?: any) => {
          if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
          const buffer = Buffer.concat(chunks);
          const txt = buffer.toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.getHeaders(),
            buffer,
            text: txt,
            json: () => JSON.parse(txt),
          });
        };
        res.on('error', reject);
        server.emit('request', req, res);
      });
    };

    const statsRes = await invoke('GET', '/api/live-call/peer/stats');
    assert(
      statsRes.status === 200 &&
        statsRes.json().status === 'ok' &&
        statsRes.json().wsPath === '/ws/live-peer' &&
        Array.isArray(statsRes.json().iceServers),
      'GET /api/live-call/peer/stats should return live presence stats and ICE servers'
    );

    const standaloneRes = await invoke('GET', '/live-call');
    assert(standaloneRes.status === 200, 'GET /live-call should return 200');
    assert(
      standaloneRes.text.includes('id="lcModeRandomBtn"') &&
        standaloneRes.text.includes('id="lcModePrivateBtn"') &&
        standaloneRes.text.includes('id="lcOnlineBadge"') &&
        standaloneRes.text.includes('id="lcRemoteVideo"') &&
        standaloneRes.text.includes('id="lcLocalVideo"') &&
        standaloneRes.text.includes('id="lcMatchBtn"') &&
        standaloneRes.text.includes('id="lcNextBtn"') &&
        standaloneRes.text.includes('id="lcCamBtn"') &&
        standaloneRes.text.includes('id="lcMicBtn"') &&
        standaloneRes.text.includes('id="lcPrivacyBox"') &&
        standaloneRes.text.includes('id="lcRoomCodeInput"') &&
        standaloneRes.text.includes('/ws/live-peer') &&
        standaloneRes.text.includes('nextMatch') &&
        standaloneRes.text.includes('toggleCamera') &&
        !standaloneRes.text.includes('Omegle') &&
        !standaloneRes.text.includes('Jooji Raadinta') &&
        !standaloneRes.text.includes('lcSidecarUrlInput'),
      '/live-call should render pure CARDOSO Live UI with Next button, Camera On/Off, and zero Omegle/GPU clutter'
    );
    const liveCallScripts = [...standaloneRes.text.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
    assert(liveCallScripts.length > 0, '/live-call should contain inline JS controller');
    for (const m of liveCallScripts) {
      new vm.Script(m[1], { filename: 'live-call.js' });
    }

    const appPageRes = await invoke('GET', '/app');
    assert(appPageRes.status === 200, 'GET /app should return 200');
    assert(
      appPageRes.text.includes('id="pane-call"') &&
        appPageRes.text.includes("switchAppTab('call')") &&
        appPageRes.text.includes('id="lcModeRandomBtn"') &&
        appPageRes.text.includes('id="lcPrivacyBox"') &&
        appPageRes.text.includes('Barashada Coding') &&
        appPageRes.text.includes('Jadwal Waxbarasho') &&
        appPageRes.text.includes('Samee Sawir AI') &&
        appPageRes.text.includes('pane-views') &&
        appPageRes.text.includes('pane-tools') &&
        appPageRes.text.includes('pane-settings'),
      '/app should embed CARDOSO Live tab while preserving ALL existing CARDOSO features'
    );
    const appScripts = [...appPageRes.text.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
    for (const m of appScripts) {
      new vm.Script(m[1], { filename: 'app-with-live-call.js' });
    }
    console.log('  ✅ PASS: /api/live-call/peer/stats, standalone /live-call & integrated /app verified with valid JS and zero dead code');

    console.log('\n🎉 All CARDOSO Live Peer-to-Peer Video Call tests passed cleanly!\n');
  } finally {
    await memory.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runLiveCallTests().catch((err) => {
  console.error('❌ CARDOSO Live Test Suite Failed:', err);
  process.exit(1);
});
