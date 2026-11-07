import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import fs from 'fs';

const suite = new TestSuite('Phase 5: Student Memory & Privacy Isolation');

const testDbPath = './data/test_memory.db';

suite.test('Initializes SQLite database and creates student profiles with hashed identifiers', async () => {
  // Clean up any old test db
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}

  const memory = new SQLiteStudentMemory(testDbPath);
  await memory.initialize();

  const rawPhone = '+252 61 555 1234';
  const profile1 = await memory.getOrCreateStudent(rawPhone);

  assertTrue(profile1.studentId.startsWith('stu_'), 'Student ID should be prefixed with stu_');
  assertFalse(profile1.rawIdentifier.includes('252'), 'Identifier must be hashed, not plaintext phone');

  // Calling again returns the same studentId
  const profile2 = await memory.getOrCreateStudent(rawPhone);
  assertEqual(profile1.studentId, profile2.studentId, 'Same raw phone should map to same studentId');
  assertEqual(profile2.totalMessagesCount, 2, 'Message count should increment');

  await memory.close();
});

suite.test('Strictly isolates conversation history between different students', async () => {
  const memory = new SQLiteStudentMemory(testDbPath);
  await memory.initialize();

  const studentA = await memory.getOrCreateStudent('student_A_phone');
  const studentB = await memory.getOrCreateStudent('student_B_phone');

  // Student A sends a private query
  await memory.saveMessage({
    studentId: studentA.studentId,
    chatId: 'group_123@g.us',
    role: 'user',
    content: 'Student A secret homework question',
    timestamp: Date.now(),
  });

  // Student B sends a different query
  await memory.saveMessage({
    studentId: studentB.studentId,
    chatId: 'group_123@g.us',
    role: 'user',
    content: 'Student B private programming question',
    timestamp: Date.now(),
  });

  // Retrieve histories
  const historyA = await memory.getConversationHistory(studentA.studentId);
  const historyB = await memory.getConversationHistory(studentB.studentId);

  assertEqual(historyA.length, 1, 'Student A should have 1 message');
  assertEqual(historyB.length, 1, 'Student B should have 1 message');

  assertTrue(historyA[0].content.includes('Student A secret'), 'Student A sees own message');
  assertFalse(historyA[0].content.includes('Student B'), 'Student A must NEVER see Student B message');

  assertTrue(historyB[0].content.includes('Student B private'), 'Student B sees own message');
  assertFalse(historyB[0].content.includes('Student A'), 'Student B must NEVER see Student A message');

  await memory.close();
});

suite.test('Right-to-be-Forgotten: Purges all conversations and profile on request', async () => {
  const memory = new SQLiteStudentMemory(testDbPath);
  await memory.initialize();

  const student = await memory.getOrCreateStudent('student_to_delete');
  await memory.saveMessage({
    studentId: student.studentId,
    chatId: 'chat_delete',
    role: 'user',
    content: 'Please forget me',
    timestamp: Date.now(),
  });

  const historyBefore = await memory.getConversationHistory(student.studentId);
  assertEqual(historyBefore.length, 1, 'Should have 1 message before deletion');

  // Execute Right to be Forgotten
  const deleted = await memory.deleteStudentHistory(student.studentId);
  assertTrue(deleted, 'Deletion should succeed');

  const historyAfter = await memory.getConversationHistory(student.studentId);
  assertEqual(historyAfter.length, 0, 'History must be completely empty after purge');

  await memory.close();
});

suite.test('Data Retention: Purges messages older than configurable retention threshold', async () => {
  const memory = new SQLiteStudentMemory(testDbPath);
  await memory.initialize();

  const student = await memory.getOrCreateStudent('student_retention_test');
  const now = Date.now();
  const fortyDaysAgo = now - (40 * 24 * 60 * 60 * 1000);

  // Old message (40 days old)
  await memory.saveMessage({
    studentId: student.studentId,
    chatId: 'chat_retention',
    role: 'user',
    content: 'Ancient message from 40 days ago',
    timestamp: fortyDaysAgo,
  });

  // Recent message (today)
  await memory.saveMessage({
    studentId: student.studentId,
    chatId: 'chat_retention',
    role: 'user',
    content: 'Fresh message from today',
    timestamp: now,
  });

  // Purge data older than 30 days
  const purgedCount = await memory.purgeStaleData(30);
  assertEqual(purgedCount, 1, 'Should have purged exactly 1 old message');

  const remainingHistory = await memory.getConversationHistory(student.studentId);
  assertEqual(remainingHistory.length, 1, 'Only recent message should remain');
  assertTrue(remainingHistory[0].content.includes('Fresh message'), 'Remaining message must be the fresh one');

  await memory.close();

  // Cleanup test db
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});

