import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import { MetaCloudWebhookTransport } from '../src/transports/meta-cloud-webhook.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import fs from 'fs';

const suite = new TestSuite('Phase 7: Messaging Integration & Router Guardrails');

const testDb = './data/test_phase7.db';

suite.test('ConsoleSimulatorTransport starts, stops, and receives simulated student messages', async () => {
  const consoleTransport = new ConsoleSimulatorTransport();
  await consoleTransport.start();
  assertTrue(consoleTransport.isConnected, 'Should be connected after start');

  let receivedMessageContent = '';
  consoleTransport.onMessage(async (msg) => {
    receivedMessageContent = msg.content;
  });

  await consoleTransport.simulateMessage({
    content: 'Asc walaal sidee tahay?',
    senderId: '252619999999',
  });

  assertEqual(receivedMessageContent, 'Asc walaal sidee tahay?', 'Handler should receive exact message text');

  await consoleTransport.stop();
  assertFalse(consoleTransport.isConnected, 'Should be disconnected after stop');
});

suite.test('MetaCloudWebhookTransport handles verification handshake and rejects invalid tokens', async () => {
  const verifyToken = 'test_secret_token_123';
  const transport = new MetaCloudWebhookTransport({
    port: 3999,
    verifyToken,
  });

  // Test correct verification token
  const goodVerification = transport.verifyWebhookToken('subscribe', verifyToken, 'CHALLENGE_ACCEPTED_777');
  assertTrue(goodVerification.verified, 'Correct token must verify successfully');
  assertEqual(goodVerification.challenge, 'CHALLENGE_ACCEPTED_777', 'Must echo challenge string');

  // Test wrong verification token
  const badVerification = transport.verifyWebhookToken('subscribe', 'WRONG_TOKEN', 'CHALLENGE_X');
  assertFalse(badVerification.verified, 'Wrong token must be rejected');

  // Test invalid mode
  const badMode = transport.verifyWebhookToken('unsubscribe', verifyToken, 'CHALLENGE_X');
  assertFalse(badMode.verified, 'Wrong mode must be rejected');
});

suite.test('MessageRouter drops duplicate messages within deduplication window', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);
  const router = new MessageRouter(engine, config);

  const mockTransport = new ConsoleSimulatorTransport();
  await mockTransport.start();

  const msgId = 'unique_wamid_998877';

  // First dispatch: handled
  const res1 = await router.handleIncomingMessage({
    id: msgId,
    senderId: '252610000001',
    chatId: 'direct_chat',
    isGroup: false,
    content: 'Asc walaal',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);

  assertTrue(res1.handled, 'First message should be handled');

  // Second dispatch of exact same ID: duplicate dropped
  const res2 = await router.handleIncomingMessage({
    id: msgId,
    senderId: '252610000001',
    chatId: 'direct_chat',
    isGroup: false,
    content: 'Asc walaal',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);

  assertFalse(res2.handled, 'Duplicate message ID must be dropped');
  assertEqual(res2.reason, 'Duplicate message ID dropped', 'Reason must specify duplicate');

  await mockTransport.stop();
  await memory.close();
});

suite.test('MessageRouter enforces group mention-only filter and admin controls', async () => {
  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const testConfig = {
    ...config,
    security: {
      ...config.security,
      allowedGroups: [],
      adminPhoneNumbers: ['252610000099'],
    },
    messaging: {
      ...config.messaging,
      groupResponseMode: 'mention_only' as const,
      prefix: '!abarso',
    },
  };

  const router = new MessageRouter(engine, testConfig);
  const mockTransport = new ConsoleSimulatorTransport();

  // 1. Group message without mention or prefix: ignored
  const groupIgnored = await router.handleIncomingMessage({
    id: 'grp_msg_1',
    senderId: '252610000001',
    chatId: 'student_group@g.us',
    isGroup: true,
    content: 'Hey guys does anyone have class notes?',
    rawTimestamp: Date.now(),
    isMentioned: false,
  }, mockTransport);

  assertFalse(groupIgnored.handled, 'Group message without mention must be ignored');

  // 2. Group message with @mention: processed
  const groupMentioned = await router.handleIncomingMessage({
    id: 'grp_msg_2',
    senderId: '252610000001',
    chatId: 'student_group@g.us',
    isGroup: true,
    content: '@abarso sideen u bartaa Python?',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);

  assertTrue(groupMentioned.handled, 'Group message with mention must be processed');

  // 3. Admin command to disable group
  const adminOff = await router.handleIncomingMessage({
    id: 'admin_msg_1',
    senderId: '252610000099', // Recognized admin
    chatId: 'student_group@g.us',
    isGroup: true,
    content: '!abarso off',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);

  assertTrue(adminOff.handled, 'Admin off command handled');

  // 4. Message sent to disabled group: blocked
  const blockedAfterOff = await router.handleIncomingMessage({
    id: 'grp_msg_3',
    senderId: '252610000001',
    chatId: 'student_group@g.us',
    isGroup: true,
    content: '!abarso help me',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);

  assertFalse(blockedAfterOff.handled, 'Message to deactivated group must be blocked');

  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});
