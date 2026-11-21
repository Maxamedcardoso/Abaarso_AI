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
    sendPresenceUpdate: async () => { },
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

suite.test('Normal mode (!link off, !view on): normal statuses get SEEN + React + Reply, while link/phone-number statuses skip reply and DM "save me" directly to the number', async () => {
  const { engine, reactor, mockSocket, receipts, sentMessages } = buildHarness();
  reactor.setOwnerName('Mohamed');
  const now = Math.floor(Date.now() / 1000);

  const normalCases: Array<{ id: string; participant: string; pushName: string; message: any }> = [
    {
      id: 'ST_ALL_BIZ',
      participant: '252631110001@s.whatsapp.net',
      pushName: 'Xasan',
      message: { conversation: 'Dhar cusub iyo kabo qiimo jaban ayaan haynaa, dalbo hadda!' },
    },
    {
      id: 'ST_ALL_EMOJI',
      participant: '252631110002@s.whatsapp.net',
      pushName: 'Ayaan',
      message: { conversation: '🔥🔥❤️' },
    },
    {
      id: 'ST_ALL_LINK',
      participant: '252631110003@s.whatsapp.net',
      pushName: 'Farxaan',
      message: { conversation: 'Daawo muuqaalkan cajiibka ah https://www.tiktok.com/@test/video/123456' },
    },
    {
      id: 'ST_ALL_AUDIO',
      participant: '252631110005@s.whatsapp.net',
      pushName: 'Hodan',
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } },
    },
    {
      id: 'ST_ALL_PTV',
      participant: '252631110006@s.whatsapp.net',
      pushName: 'Cali',
      message: { ptvMessage: { mimetype: 'video/mp4', caption: '🔥' } },
    },
    {
      id: 'ST_ALL_WRAPPED',
      participant: '252631110007@s.whatsapp.net',
      pushName: 'Fadumo',
      message: {
        statusMentionMessage: {
          message: {
            imageMessage: { mimetype: 'image/jpeg', caption: '❤️' },
          },
        },
      },
    },
  ];

  // Link/phone-number status posted by Suleyman containing another person's wa.me number
  const phoneLinkCase = {
    id: 'ST_ALL_PHONE',
    participant: '252631110004@s.whatsapp.net',
    pushName: 'Suleyman',
    message: { conversation: 'Fadlan i save garee: https://wa.me/252637654321' },
  };

  for (const c of [...normalCases, phoneLinkCase]) {
    await engine.handleStatusUpsert(
      {
        key: { remoteJid: 'status@broadcast', id: c.id, participant: c.participant, fromMe: false },
        pushName: c.pushName,
        messageTimestamp: now,
        message: c.message,
      },
      'notify',
      mockSocket
    );
  }

  await new Promise((r) => setTimeout(r, 1700));
  engine.disposeTimers();

  for (const c of normalCases) {
    const readRecp = receipts.find((r) => r.ids.includes(c.id) && r.type === 'read');
    assertTrue(Boolean(readRecp), `Status ${c.id} MUST be marked SEEN (read receipt)`);

    const react = sentMessages.find((m) => m.content?.react?.key?.id === c.id);
    assertTrue(Boolean(react), `Status ${c.id} MUST receive a reaction`);

    const reply = sentMessages.find((m) => m.jid === c.participant && m.content?.text && m.options?.quoted?.key?.id === c.id);
    assertTrue(Boolean(reply), `Status ${c.id} MUST receive a quoted reply`);
    assertFalse(/\bqaali\b/i.test(reply!.content.text), `Reply for ${c.id} must never contain "qaali"`);
  }

  // Phone/WhatsApp-link status in !link off + !view on mode:
  // 1. Marked SEEN
  assertTrue(
    receipts.some((r) => r.ids.includes('ST_ALL_PHONE') && r.type === 'read'),
    'Link/phone status MUST be marked SEEN'
  );
  // 2. NO reaction and NO reply to the status poster (Suleyman)
  assertFalse(
    sentMessages.some((m) => m.content?.react?.key?.id === 'ST_ALL_PHONE'),
    'Link/phone status must NOT receive a reaction to the status'
  );
  assertFalse(
    sentMessages.some((m) => m.jid === '252631110004@s.whatsapp.net'),
    'Link/phone status must NOT send a reply to the status poster'
  );
  // 3. Directly DM "save me Mohamed" to the extracted link phone number (252637654321)
  const saveMeDm = sentMessages.find((m) => m.jid === '252637654321@s.whatsapp.net');
  assertTrue(Boolean(saveMeDm), 'Link/phone status MUST directly DM the extracted link number');
  assertTrue(
    String(saveMeDm?.content?.text || '').toLowerCase().includes('save me'),
    'Direct DM to extracted link number must say "save me"'
  );

  // Audio and PTV video statuses must also receive a `played` receipt
  assertTrue(
    receipts.some((r) => r.ids.includes('ST_ALL_AUDIO') && r.type === 'played'),
    'Audio status must also emit played receipt'
  );
  assertTrue(
    receipts.some((r) => r.ids.includes('ST_ALL_PTV') && r.type === 'played'),
    'Video/PTV status must also emit played receipt'
  );
});

suite.test('CB:status top-level stanza is acknowledged (<ack class="status">) and marked SEEN', async () => {
  const { engine, mockSocket, receipts } = buildHarness();
  const sentNodes: any[] = [];
  mockSocket.sendNode = async (n: any) => {
    sentNodes.push(n);
  };

  await engine.observeRawStatusNode(
    {
      tag: 'status',
      attrs: {
        id: 'ST_CB_STATUS_1',
        from: 'status@broadcast',
        participant: '252631112233@s.whatsapp.net',
        notify: 'Abdirahman',
        t: String(Math.floor(Date.now() / 1000)),
      },
    },
    mockSocket
  );
  engine.disposeTimers();

  const ack = sentNodes.find((n) => n.tag === 'ack' && n.attrs?.class === 'status' && n.attrs?.id === 'ST_CB_STATUS_1');
  assertTrue(Boolean(ack), 'CB:status stanza MUST be acknowledged with <ack class="status">');
  assertEqual(engine.getTelemetry().cbStatusAcked, 1, 'cbStatusAcked counter must increment');
  assertTrue(
    receipts.some((r) => r.ids.includes('ST_CB_STATUS_1') && r.type === 'read'),
    'CB:status contact story must be marked SEEN'
  );
});

suite.test('Encrypted CB:status stanza decrypts cleanly -> triggers SEEN + React + Reply (!link off) AND Link-DM (!link on)', async () => {
  // 1. Normal mode (!link off): encrypted CB:status stanza must decrypt, mark SEEN, react, AND reply!
  const h1 = buildHarness();
  const now = Math.floor(Date.now() / 1000);
  const plainStoryBytes = proto.Message.encode({
    conversation: 'Alxamdulilah maanta guul weyn ayaan gaadhay!',
  }).finish();

  const ackNodes1: any[] = [];
  h1.mockSocket.authState = { creds: { me: { id: '252634949642:16@s.whatsapp.net', lid: '999888777666:16@lid' } } };
  h1.mockSocket.sendNode = async (n: any) => { ackNodes1.push(n); };
  h1.mockSocket.signalRepository = {
    decryptGroupMessage: async () => Buffer.concat([Buffer.from(plainStoryBytes), Buffer.from([1])]),
  };

  await h1.engine.observeRawStatusNode(
    {
      tag: 'status',
      attrs: {
        id: 'ST_ENC_NORMAL_1',
        from: 'status@broadcast',
        participant: '233156930183363@lid',
        participant_pn: '252637340117@s.whatsapp.net',
        notify: 'Farxaan',
        t: String(now),
      },
      content: [
        { tag: 'enc', attrs: { v: '2', type: 'skmsg' }, content: new Uint8Array([1, 2, 3, 4]) },
      ],
    },
    h1.mockSocket
  );

  await new Promise((r) => setTimeout(r, 1700));
  h1.engine.disposeTimers();

  assertTrue(
    ackNodes1.some((n) => n.tag === 'ack' && n.attrs?.class === 'status' && n.attrs?.id === 'ST_ENC_NORMAL_1'),
    'Encrypted CB:status must be acknowledged'
  );
  assertTrue(
    h1.receipts.some((r) => r.ids.includes('ST_ENC_NORMAL_1') && r.type === 'read'),
    'Encrypted CB:status must be marked SEEN'
  );
  assertTrue(
    h1.sentMessages.some((m) => m.content?.react?.key?.id === 'ST_ENC_NORMAL_1'),
    'Encrypted CB:status must trigger reaction in normal mode'
  );
  assertTrue(
    h1.sentMessages.some((m) => m.jid === '252637340117@s.whatsapp.net' && m.content?.text && m.options?.quoted?.key?.id === 'ST_ENC_NORMAL_1'),
    'Encrypted CB:status must trigger quoted reply in normal mode'
  );

  // 2. Link Campaign Mode (!link on): encrypted CB:status with api.whatsapp.com/send/?phone=... must SEEN + DM ONLY extracted number!
  const h2 = buildHarness();
  h2.manager.setLinkCampaignMode(true);
  h2.reactor.setOwnerName('Mohamed');

  const linkStoryBytes = proto.Message.encode({
    extendedTextMessage: {
      text: 'Kala soo xidhiidh: https://api.whatsapp.com/send/?phone=%2B252615889900&text=hello',
    },
  }).finish();

  h2.mockSocket.authState = { creds: { me: { id: '252634949642:16@s.whatsapp.net', lid: '999888777666:16@lid' } } };
  h2.mockSocket.sendNode = async () => {};
  h2.mockSocket.onWhatsApp = async (phone: string) => [{ exists: true, jid: `${phone}@s.whatsapp.net` }];
  h2.mockSocket.signalRepository = {
    decryptGroupMessage: async () => Buffer.concat([Buffer.from(linkStoryBytes), Buffer.from([1])]),
  };

  await h2.engine.observeRawStatusNode(
    {
      tag: 'status',
      attrs: {
        id: 'ST_ENC_LINK_1',
        from: 'status@broadcast',
        participant: '55564662997052@lid',
        participant_pn: '252615210943@s.whatsapp.net',
        notify: 'Jecelow',
        t: String(now),
      },
      content: [
        { tag: 'enc', attrs: { v: '2', type: 'skmsg' }, content: new Uint8Array([5, 6, 7, 8]) },
      ],
    },
    h2.mockSocket
  );

  await new Promise((r) => setTimeout(r, 200));
  h2.engine.disposeTimers();

  assertTrue(
    h2.receipts.some((r) => r.ids.includes('ST_ENC_LINK_1') && r.type === 'read'),
    'Encrypted CB:status in !link on mode must be marked SEEN'
  );
  assertTrue(
    h2.sentMessages.some((m) => m.jid === '252615889900@s.whatsapp.net' && m.content?.text?.includes('save me')),
    'Encrypted CB:status in !link on mode MUST DM the extracted link phone number'
  );
  assertFalse(
    h2.sentMessages.some((m) => m.jid === '252615210943@s.whatsapp.net' || m.content?.react),
    'Encrypted CB:status in !link on mode must NOT react or reply to the status poster'
  );
});

suite.test('Reply delivery resiliently falls back from failing PN to LID when primary target throws', async () => {
  const { engine, mockSocket, sentMessages } = buildHarness();
  const now = Math.floor(Date.now() / 1000);
  const origSend = mockSocket.sendMessage;

  mockSocket.sendMessage = async (jid: string, content: any, options?: any) => {
    if (jid === '252635559999@s.whatsapp.net' && content?.text) {
      throw new Error('No session record for PN');
    }
    return origSend(jid, content, options);
  };

  engine.observeRawStanza(
    {
      tag: 'message',
      attrs: {
        id: 'ST_FALLBACK_1',
        from: 'status@broadcast',
        participant: '127943418368299@lid',
        participant_pn: '252635559999@s.whatsapp.net',
        notify: 'Khadar',
        t: String(now),
      },
    },
    mockSocket
  );

  await engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_FALLBACK_1', participant: '127943418368299@lid', fromMe: false },
      pushName: 'Khadar',
      messageTimestamp: now,
      message: { conversation: 'Jimco wanaagsan dhammaan asxaabta!' },
    },
    'notify',
    mockSocket
  );

  await new Promise((r) => setTimeout(r, 1700));
  engine.disposeTimers();

  const lidReply = sentMessages.find((m) => m.jid === '127943418368299@lid' && m.content?.text);
  assertTrue(Boolean(lidReply), 'Status reply must fall back to @lid target when PN target fails');
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

suite.test('Photo + link/number status automatically DMs owner promo PHOTO + LINK to the extracted number owner (both !link off & !link on)', async () => {
  const promoImageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const ownerPromoLink = 'https://api.whatsapp.com/send?phone=252634949642&text=maxamed';
  const now = Math.floor(Date.now() / 1000);

  // Case 1: !link off + !view on -> photo + link status DMs owner promo PHOTO + LINK + "save me"
  const h1 = buildHarness();
  h1.manager.setLinkCampaignMode(false);
  h1.manager.setAutoViewStatus(true);
  h1.manager.setOwnerPromo({
    link: ownerPromoLink,
    imageBuffer: promoImageBytes,
    mimeType: 'image/jpeg',
  });
  h1.reactor.setOwnerName('Mohamed');

  await h1.engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_PHOTO_LINK_1', participant: '252631119991@s.whatsapp.net', fromMe: false },
      pushName: 'Khadra',
      messageTimestamp: now,
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Save garee sxb: https://wa.me/252638889900',
        },
      },
    },
    'notify',
    h1.mockSocket
  );
  // Also test text-only link status right beside it -> must still send plain "save me Mohamed" (NO image)
  await h1.engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_TEXT_LINK_ONLY', participant: '252631119992@s.whatsapp.net', fromMe: false },
      pushName: 'Libaan',
      messageTimestamp: now,
      message: {
        conversation: 'Fadlan save: https://wa.me/252631234567',
      },
    },
    'notify',
    h1.mockSocket
  );
  h1.engine.disposeTimers();

  assertTrue(
    h1.receipts.some((r) => r.ids.includes('ST_PHOTO_LINK_1') && r.type === 'read'),
    'Photo+link status must be marked SEEN'
  );
  assertFalse(
    h1.sentMessages.some((m) => m.jid === '252631119991@s.whatsapp.net' || m.content?.react?.key?.id === 'ST_PHOTO_LINK_1'),
    'Photo+link status must NOT react or reply to the status poster'
  );
  const photoPromoDm = h1.sentMessages.find((m) => m.jid === '252638889900@s.whatsapp.net');
  assertTrue(Boolean(photoPromoDm), 'Photo+link status must DM the owner of the extracted phone number');
  assertTrue(Buffer.isBuffer(photoPromoDm?.content?.image), 'DM for photo+link status must attach owner promo image buffer');
  assertEqual(
    Buffer.compare(photoPromoDm!.content.image, promoImageBytes),
    0,
    'DM image must match saved owner promo photo'
  );
  assertTrue(
    String(photoPromoDm?.content?.caption || '').includes(ownerPromoLink),
    'DM image caption must include owner promo link'
  );
  assertTrue(
    String(photoPromoDm?.content?.caption || '').toLowerCase().includes('save me mohamed'),
    'DM image caption must include save me <ownerName>'
  );
  assertFalse(
    /\bqaali\b/i.test(String(photoPromoDm?.content?.caption || '')),
    'DM caption must never contain "qaali"'
  );

  const textOnlyDm = h1.sentMessages.find((m) => m.jid === '252631234567@s.whatsapp.net');
  assertTrue(Boolean(textOnlyDm), 'Text-only link status must still DM extracted number');
  assertFalse(Boolean(textOnlyDm?.content?.image), 'Text-only link status must NOT send promo image');
  assertEqual(textOnlyDm?.content?.text, 'save me Mohamed', 'Text-only link status must send plain save me text');

  // Case 2: !link on + wrapped image status (statusMentionMessage) -> ALSO sends owner promo PHOTO + LINK
  const h2 = buildHarness();
  h2.manager.setLinkCampaignMode(true);
  h2.manager.setOwnerPromo({
    link: ownerPromoLink,
    imageBuffer: promoImageBytes,
    mimeType: 'image/png',
  });
  h2.reactor.setOwnerName('Mohamed');

  await h2.engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_PHOTO_LINK_2', participant: '252615000111@s.whatsapp.net', fromMe: false },
      pushName: 'Nimco',
      messageTimestamp: now,
      message: {
        statusMentionMessage: {
          message: {
            imageMessage: {
              mimetype: 'image/jpeg',
              caption: 'Link-ga saaxiibkay: https://api.whatsapp.com/send?phone=252617778899',
            },
          },
        },
      },
    },
    'notify',
    h2.mockSocket
  );
  h2.engine.disposeTimers();

  const linkModePromoDm = h2.sentMessages.find((m) => m.jid === '252617778899@s.whatsapp.net');
  assertTrue(Boolean(linkModePromoDm), '!link on mode must DM extracted number owner for photo+link status');
  assertTrue(Buffer.isBuffer(linkModePromoDm?.content?.image), '!link on mode must attach owner promo photo');
  assertEqual(linkModePromoDm?.content?.mimetype, 'image/png', 'Promo image mimetype should match saved promo mimetype');
  assertTrue(
    String(linkModePromoDm?.content?.caption || '').includes(ownerPromoLink),
    '!link on mode caption must include owner promo link'
  );
  assertFalse(
    h2.sentMessages.some((m) => m.jid === '252615000111@s.whatsapp.net' || m.content?.react),
    '!link on mode must NOT react or reply to poster'
  );

  // Case 3: Owner has promo LINK saved WITHOUT promo image -> falls back cleanly to text containing link + save me
  const h3 = buildHarness();
  h3.manager.setLinkCampaignMode(false);
  h3.manager.setOwnerPromo({ link: ownerPromoLink });
  h3.reactor.setOwnerName('Mohamed');

  await h3.engine.handleStatusUpsert(
    {
      key: { remoteJid: 'status@broadcast', id: 'ST_PHOTO_LINK_3', participant: '252639991111@s.whatsapp.net', fromMe: false },
      pushName: 'Guuleed',
      messageTimestamp: now,
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'wa.me/252634443322',
        },
      },
    },
    'notify',
    h3.mockSocket
  );
  h3.engine.disposeTimers();

  const fallbackLinkDm = h3.sentMessages.find((m) => m.jid === '252634443322@s.whatsapp.net');
  assertTrue(Boolean(fallbackLinkDm), 'Fallback photo+link DM must still deliver when owner has link without image');
  assertTrue(
    String(fallbackLinkDm?.content?.text || '').includes(ownerPromoLink),
    'Fallback DM text must include owner promo link'
  );
  assertTrue(
    String(fallbackLinkDm?.content?.text || '').toLowerCase().includes('save me mohamed'),
    'Fallback DM text must include save me <ownerName>'
  );
});

const result = await suite.run();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch { }
if (result.failed > 0) process.exit(1);
process.exit(0);
