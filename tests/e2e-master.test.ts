import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { config } from '../src/config/env.js';
import fs from 'fs';

const suite = new TestSuite('Phase 8: Comprehensive Master E2E Test Suite');

const masterDbPath = './data/test_master_e2e.db';

// Clean test db
try {
  if (fs.existsSync(masterDbPath)) fs.unlinkSync(masterDbPath);
} catch {}

suite.test('1. Somali conversation with natural, informal slang and spelling errors', async () => {
  const memory = new SQLiteStudentMemory(masterDbPath);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const res = await engine.processMessage({
    rawSenderId: '252615550001',
    chatId: 'somali_chat',
    isGroup: false,
    content: 'asc sxb i caawi sidee waqtiga loo maareeyaa?',
  });

  assertEqual(res.language, 'so', 'Must identify as Somali');
  assertEqual(res.intent, 'academic', 'Must identify as academic time management intent');
  await memory.close();
});

suite.test('2. English conversation with academic advice and study questions', async () => {
  const memory = new SQLiteStudentMemory(masterDbPath);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const res = await engine.processMessage({
    rawSenderId: '252615550002',
    chatId: 'eng_chat',
    isGroup: false,
    content: 'How should I organize my university study schedule for finals?',
  });

  assertEqual(res.language, 'en', 'Must identify as English');
  assertEqual(res.intent, 'academic', 'Must identify as academic intent');
  await memory.close();
});

suite.test('3. Mixed-language conversation (Somali + English programming code-switching)', async () => {
  const memory = new SQLiteStudentMemory(masterDbPath);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const res = await engine.processMessage({
    rawSenderId: '252615550003',
    chatId: 'mixed_chat',
    isGroup: false,
    content: 'Sideen Python ugu qoraa loop?',
  });

  assertEqual(res.language, 'mixed', 'Must identify as mixed code-switching');
  assertEqual(res.intent, 'programming', 'Must identify as programming intent');
  await memory.close();
});

suite.test('4. Homework assistance with Socratic problem breakdown', async () => {
  const memory = new SQLiteStudentMemory(masterDbPath);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const res = await engine.processMessage({
    rawSenderId: '252615550004',
    chatId: 'hw_chat',
    isGroup: false,
    content: 'Fadlan homework-gan ii xalli: xisaabi xagal saddex-xagal ah',
  });

  assertEqual(res.intent, 'homework', 'Must identify as homework intent');
  await memory.close();
});

suite.test('5. Multi-student simultaneous messaging with strict privacy isolation', async () => {
  const memory = new SQLiteStudentMemory(masterDbPath);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  // 3 students messaging in parallel
  const student1 = '252611111111';
  const student2 = '252622222222';
  const student3 = '252633333333';

  await Promise.all([
    engine.processMessage({
      rawSenderId: student1,
      chatId: 'group_shared',
      isGroup: true,
      content: 'Student 1 confidential code query',
    }),
    engine.processMessage({
      rawSenderId: student2,
      chatId: 'group_shared',
      isGroup: true,
      content: 'Student 2 confidential homework query',
    }),
    engine.processMessage({
      rawSenderId: student3,
      chatId: 'group_shared',
      isGroup: true,
      content: 'Student 3 confidential motivation query',
    }),
  ]);

  const p1 = await memory.getOrCreateStudent(student1);
  const p2 = await memory.getOrCreateStudent(student2);
  const p3 = await memory.getOrCreateStudent(student3);

  const h1 = await memory.getConversationHistory(p1.studentId);
  const h2 = await memory.getConversationHistory(p2.studentId);
  const h3 = await memory.getConversationHistory(p3.studentId);

  // Verify none of student 1's history has student 2's or 3's queries
  assertTrue(h1.some(m => m.content.includes('Student 1')), 'Student 1 sees their query');
  assertFalse(h1.some(m => m.content.includes('Student 2')), 'Student 1 NEVER sees Student 2');
  assertFalse(h1.some(m => m.content.includes('Student 3')), 'Student 1 NEVER sees Student 3');

  // Verify student 2's history isolation
  assertTrue(h2.some(m => m.content.includes('Student 2')), 'Student 2 sees their query');
  assertFalse(h2.some(m => m.content.includes('Student 1')), 'Student 2 NEVER sees Student 1');

  await memory.close();
});

suite.test('6. Free quota exhaustion blocks outbound calls and preserves zero-cost', async () => {
  const memory = new SQLiteStudentMemory(masterDbPath);
  await memory.initialize();

  const mockQuota = new QuotaTracker(3, 10, './data/test_quota_e2e');
  mockQuota.setDailyRequestsForTesting(3); // Quota exhausted!

  const testConfig = {
    ...config,
    gemini: { ...config.gemini, dailyLimit: 3 },
  };

  const ai = new AIOrchestrator(testConfig, mockQuota);
  const engine = new StudentAdvisorEngine(memory, ai);

  const res = await engine.processMessage({
    rawSenderId: '252610009999',
    chatId: 'direct',
    isGroup: false,
    content: 'Walaal ma i caawin kartaa?',
  });

  assertTrue(res.replyText.includes('Zero-Cost Safeguard'), 'Must return Zero-Cost Safeguard message');
  assertTrue(res.replyText.includes('Daily free quota reached'), 'Must mention quota reached');

  await memory.close();
  try {
    fs.rmSync('./data/test_quota_e2e', { recursive: true, force: true });
  } catch {}
});

suite.test('7. Restart and recovery behavior preserves conversation continuity', async () => {
  // Session 1: Run bot and save message
  const memory1 = new SQLiteStudentMemory(masterDbPath);
  await memory1.initialize();
  const student = await memory1.getOrCreateStudent('persistent_student');
  await memory1.saveMessage({
    studentId: student.studentId,
    chatId: 'chat_persist',
    role: 'user',
    content: 'Pre-restart message about JavaScript',
    timestamp: Date.now() - 5000,
  });
  await memory1.close(); // Bot shuts down

  // Session 2: Bot restarts fresh from disk
  const memory2 = new SQLiteStudentMemory(masterDbPath);
  await memory2.initialize(); // DB recovers from WAL file
  const historyRecovered = await memory2.getConversationHistory(student.studentId);

  assertEqual(historyRecovered.length, 1, 'Should recover 1 message from before restart');
  assertTrue(historyRecovered[0].content.includes('Pre-restart message'), 'Recovered content matches');

  await memory2.close();
});

suite.run().then(summary => {
  // Clean master db
  try {
    if (fs.existsSync(masterDbPath)) fs.unlinkSync(masterDbPath);
  } catch {}

  if (summary.failed > 0) {
    process.exit(1);
  }
});

