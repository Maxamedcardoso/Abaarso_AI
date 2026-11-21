import os from 'os';
import path from 'path';
import fs from 'fs';
import { proto } from '@whiskeysockets/baileys';
import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-status-engine-'));
process.env.DATA_DIR = tmpDir;

const { StatusEngineService, normalizeStatusJid } = await import('../src/services/status-engine.service.js');
const { StatusReactorService } = await import('../src/services/status-reactor.service.js');
const { WhatsAppManagerService } = await import('../src/services/whatsapp-manager.service.js');
const { BroadcastService } = await import('../src/services/broadcast.service.js');

const suite = new TestSuite('Clean Status Engine (Auto-View, LID/PN, CIPHERTEXT Retry, Single React & Reply)');

function buildHarness(opts: { seenDelayMs?: number; watchdogTimeoutMs?: number } = {}) {
  const authDir = path.join(tmpDir, `auth_${Math.random().toString(36).slice(2, 8)}`);
  const manager = new WhatsAppManagerService({
    authDir,
    statusStoragePath: path.join(authDir, 'posted.json'),
  });
  manager.setAutoViewStatus(true);
  manager.setLinkCampaignMode(false);

  const broadcast = new BroadcastService();
  const reactor = new StatusReactorService(
    path.join(authDir, 'reactor.json'),
    broadcast,
    ['252634949642'],
    manager
  );
  reactor.setConfig({
    enabled: true,
    autoReact: true,
    autoComment: true,
    mode: 'both',
    cooldownHours: 0,
    minDelaySeconds: 0,
    maxDelaySeconds: 0,
    aiEnhanced: false,
  });

  const engine = new StatusEngineService({
    tenantId: 'owner',
    whatsappManager: manager,
    statusReactor: reactor,
    broadcast,
    seenDelayMs: opts.seenDelayMs ?? 0,
    watchdogTimeoutMs: opts.watchdogTimeoutMs ?? 120,
  });

  const receipts: Array<{ jid: string; participant: string; ids: string[]; type: string }> = [];
  const sentMessages: Array<{ jid: string; content: any; options?: any }> = [];
  let flushCount = 0;
  let buffering = true;

  const mockSocket: any = {
    user: { id: '252634949642:0@s.whatsapp.net', lid: '999888777666:0@lid' },
    ev: {
      isBuffering: () => buffering,
      flush: () => {
        buffering = false;
        flushCount++;
      },
    },
    fetchPrivacySettings: async () => ({ readreceipts: 'all' }),
    sendReceipt: async (jid: string, participant: string, ids: string[], type: string) => {
      receipts.push({ jid, participant, ids, type });
    },
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid: string, content: any, options?: any) => {
      sentMessages.push({ jid, content, options });
      return { key: { id: `out_${sentMessages.length}` } };
    },
  };

  return { engine, manager, reactor, broadcast, mockSocket, receipts, sentMessages, getFlushCount: () => flushCount };
}

suite.test('normalizeStatusJid preserves both @lid and @s.whatsapp.net and strips device suffixes', () => {
  assertEqual(normalizeStatusJid('127943418368240:4@lid'), '127943418368240@lid');
  assertEqual(normalizeStatusJid('252634445566:12@s.whatsapp.net'), '252634445566@s.whatsapp.net');
  assertEqual(normalizeStatusJid('252634445566@c.us'), '252634445566@s.whatsapp.net');
  assertEqual(normalizeStatusJid(''), '');
});

suite.test('PN status: sends clean explicit type=read receipt, reacts ONCE via status@broadcast, and sends ONE reply', async () => {
  const { engine, mockSocket, receipts, sentMessages } = buildHarness();
  const now = Math.floor(Date.now() / 1000);

  // Stage 0: raw wire stanza must NOT send premature receipt before messages.upsert
  engine.observeRawStanza(
    {
      tag: 'message',
      attrs: { id: 'ST_PN_1', from: 'status@broadcast', participant: '252618881111:3@s.whatsapp.net', notify: 'Farxaan', t: String(now) },
    },
    mockSocket
  );
  assertEqual(receipts.length, 0, 'observeRawStanza must NOT send premature read receipt before delivery ack');

  // Stage 1: decrypted messages.upsert arrives
  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_PN_1', participant: '252618881111:3@s.whatsapp.net', fromMe: false },
      pushName: 'Farxaan',
      messageTimestamp: now,
      message: { conversation: 'Alxamdulilah maanta waan qalinjabiyey jaamacadda!' },
    },
    'notify',
    mockSocket
  );

  // Allow scheduled 0ms interaction + typing delay (~1.4s) to complete
  await new Promise((r) => setTimeout(r, 1700));
  engine.disposeTimers();

  assertEqual(receipts.length, 1, 'Must send exactly 1 read receipt for PN status');
  assertEqual(receipts[0].jid, 'status@broadcast');
  assertEqual(receipts[0].participant, '252618881111@s.whatsapp.net');
  assertEqual(receipts[0].type, 'read');

  const reactMsgs = sentMessages.filter((m) => m.content?.react);
  assertEqual(reactMsgs.length, 1, 'Must send EXACTLY ONE reaction (no double reaction!)');
  assertEqual(reactMsgs[0].jid, 'status@broadcast', 'PN reaction uses official status@broadcast');
  assertTrue(
    Array.isArray(reactMsgs[0].options?.statusJidList) &&
      reactMsgs[0].options.statusJidList.includes('252618881111@s.whatsapp.net'),
    'statusJidList must include author PN'
  );

  const commentMsgs = sentMessages.filter((m) => m.content?.text && m.options?.quoted);
  assertEqual(commentMsgs.length, 1, 'Must send ONE quoted status comment');
  assertEqual(commentMsgs[0].jid, '252618881111@s.whatsapp.net');

  const tel = engine.getTelemetry();
  assertEqual(tel.received, 1);
  assertEqual(tel.viewed, 1);
  assertEqual(tel.viewFailed, 0);
});

suite.test('LID status WITH participant_pn: sends read receipt to BOTH @lid and @s.whatsapp.net and never drops', async () => {
  const { engine, mockSocket, receipts, sentMessages } = buildHarness();
  const now = Math.floor(Date.now() / 1000);

  engine.observeRawStanza(
    {
      tag: 'message',
      attrs: {
        id: 'ST_LID_PN_1',
        from: 'status@broadcast',
        participant: '127943418368240:4@lid',
        participant_pn: '252635554444@s.whatsapp.net',
        notify: 'Ayaan',
        t: String(now),
      },
    },
    mockSocket
  );

  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_LID_PN_1', participant: '127943418368240:4@lid', fromMe: false },
      messageTimestamp: now,
      message: { conversation: 'Jimco wanaagsan asxaabta dhammaan!' },
    },
    'notify',
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 1700));
  engine.disposeTimers();

  const receiptTargets = receipts.map((r) => r.participant);
  assertTrue(receiptTargets.includes('127943418368240@lid'), 'Must acknowledge normalized @lid participant');
  assertTrue(receiptTargets.includes('252635554444@s.whatsapp.net'), 'Must also acknowledge resolved @s.whatsapp.net PN');

  const reactMsgs = sentMessages.filter((m) => m.content?.react);
  assertEqual(reactMsgs.length, 1, 'Must react once using resolved PN status@broadcast');
  assertEqual(reactMsgs[0].jid, 'status@broadcast');
  assertTrue(reactMsgs[0].options.statusJidList.includes('252635554444@s.whatsapp.net'));

  const commentMsgs = sentMessages.filter((m) => m.content?.text && m.options?.quoted);
  assertEqual(commentMsgs.length, 1);
  assertEqual(commentMsgs[0].jid, '252635554444@s.whatsapp.net');
});

suite.test('LID-only status WITH :device suffix (no PN): NEVER chops @lid, marks seen, and sends clean peer react + reply', async () => {
  const { engine, mockSocket, receipts, sentMessages } = buildHarness();
  const now = Math.floor(Date.now() / 1000);

  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_LID_ONLY_1', participant: '127943418368240:7@lid', fromMe: false },
      pushName: 'Khadar',
      messageTimestamp: now,
      message: { conversation: 'Hahaha waar ninkan eega kkkk yaabka!' },
    },
    'notify',
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 1700));
  engine.disposeTimers();

  assertEqual(receipts.length, 1);
  assertEqual(receipts[0].participant, '127943418368240@lid', 'LID suffix MUST stay intact!');

  const reactMsgs = sentMessages.filter((m) => m.content?.react);
  assertEqual(reactMsgs.length, 1, 'LID-only status must still get reacted cleanly');
  assertEqual(reactMsgs[0].jid, '127943418368240@lid', 'LID-only reaction uses direct peer path so Baileys does not mangle @lid');

  const commentMsgs = sentMessages.filter((m) => m.content?.text && m.options?.quoted);
  assertEqual(commentMsgs.length, 1, 'LID-only status must NOT be dropped by StatusReactor!');
  assertEqual(commentMsgs[0].jid, '127943418368240@lid');
});

suite.test('CIPHERTEXT stub followed by retried decrypted status: waits cleanly, does NOT poison viewedIds, then views + reacts', async () => {
  const { engine, mockSocket, receipts, sentMessages } = buildHarness({ watchdogTimeoutMs: 5000 });
  const now = Math.floor(Date.now() / 1000);

  engine.observeRawStanza(
    { tag: 'message', attrs: { id: 'ST_RETRY_1', from: 'status@broadcast', participant: '252619991111@s.whatsapp.net', t: String(now) } },
    mockSocket
  );

  // First arrival: undecrypted CIPHERTEXT stub
  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_RETRY_1', participant: '252619991111@s.whatsapp.net', fromMe: false },
      messageTimestamp: now,
      messageStubType: proto.WebMessageInfo.StubType.CIPHERTEXT,
    },
    'notify',
    mockSocket
  );
  assertEqual(receipts.length, 0, 'Must NOT send premature read receipt on CIPHERTEXT stub while retry is in flight');
  assertEqual(engine.getTelemetry().ciphertextRetries, 1);

  // Second arrival: retried decrypted payload arrives!
  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_RETRY_1', participant: '252619991111@s.whatsapp.net', fromMe: false },
      pushName: 'Cabdi',
      messageTimestamp: now,
      message: { conversation: 'Jimco barakaysan dhammaan asxaabta!' },
    },
    'notify',
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 1700));
  engine.disposeTimers();

  assertEqual(receipts.length, 1, 'Retried status MUST be marked seen once decrypted');
  assertEqual(sentMessages.filter((m) => m.content?.react).length, 1, 'Retried status must also be reacted');
});

suite.test('Undecryptable status whose retry never arrives: fallback watchdog STILL marks it SEEN', async () => {
  const { engine, mockSocket, receipts } = buildHarness({ watchdogTimeoutMs: 80 });
  const now = Math.floor(Date.now() / 1000);

  engine.observeRawStanza(
    {
      tag: 'message',
      attrs: { id: 'ST_WATCHDOG_1', from: 'status@broadcast', participant: '252617770000@s.whatsapp.net', notify: 'Xasan', t: String(now) },
    },
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 200));
  engine.disposeTimers();

  assertEqual(receipts.length, 1, 'Fallback watchdog must mark undecryptable status SEEN');
  assertEqual(receipts[0].participant, '252617770000@s.whatsapp.net');
  assertEqual(engine.getTelemetry().watchdogViews, 1);
});

suite.test('Own status (PN OR own @lid): recorded as posted status, NEVER marked seen or reacted', async () => {
  const { engine, manager, mockSocket, receipts, sentMessages } = buildHarness({ watchdogTimeoutMs: 80 });
  const now = Math.floor(Date.now() / 1000);

  engine.observeRawStanza(
    { tag: 'message', attrs: { id: 'ST_OWN_LID', from: 'status@broadcast', participant: '999888777666:1@lid', t: String(now) } },
    mockSocket
  );

  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_OWN_LID', participant: '999888777666:1@lid', fromMe: false },
      messageTimestamp: now,
      message: { conversation: 'Status aan anigu soo dhigay' },
    },
    'notify',
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 150));
  engine.disposeTimers();

  assertTrue(manager.hasPostedStatus('ST_OWN_LID'), 'Own LID status must be recorded as posted status');
  assertEqual(receipts.length, 0, 'Must NEVER send seen receipt to own status');
  assertEqual(sentMessages.length, 0, 'Must NEVER react/comment on own status');
  assertEqual(engine.getTelemetry().skippedOwn, 1);
});

suite.test('phone_number_status skips react & comment cleanly (zero double reaction!) and sends DM', async () => {
  const { engine, mockSocket, receipts, sentMessages } = buildHarness();
  const now = Math.floor(Date.now() / 1000);

  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_PHONE_1', participant: '252631234567@s.whatsapp.net', fromMe: false },
      pushName: 'Suleyman',
      messageTimestamp: now,
      message: { conversation: 'Fadlan i save garee: https://wa.me/252637654321' },
    },
    'notify',
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 250));
  engine.disposeTimers();

  assertEqual(receipts.length, 1, 'Status with phone number must still be marked SEEN');
  assertEqual(sentMessages.filter((m) => m.content?.react).length, 0, 'Must NEVER send premature reaction to phone_number_status');
  const dms = sentMessages.filter((m) => m.jid === '252637654321@s.whatsapp.net');
  assertEqual(dms.length, 1, 'Must send save-me DM to extracted phone number');
});

suite.test('Detects Read Receipts privacy=none warning and flushes stuck offline event buffer', async () => {
  const { engine, mockSocket, getFlushCount } = buildHarness();
  mockSocket.fetchPrivacySettings = async () => ({ readreceipts: 'none' });

  const privacy = await engine.checkReadReceiptsPrivacy(mockSocket);
  assertEqual(privacy, 'none');
  assertEqual(engine.getTelemetry().readReceiptsPrivacy, 'none');

  const now = Math.floor(Date.now() / 1000);
  engine.observeRawStanza(
    { tag: 'message', attrs: { id: 'ST_OFFLINE_1', from: 'status@broadcast', participant: '252611112222@s.whatsapp.net', offline: '1', t: String(now) } },
    mockSocket
  );
  await new Promise((r) => setTimeout(r, 800));
  engine.disposeTimers();
  assertTrue(getFlushCount() >= 1, 'Offline status stanza must trigger stuck Baileys event-buffer flush');
});

const result = await suite.run();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}
if (result.failed > 0) process.exit(1);
process.exit(0);
