import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { config, validateConfig } from '../src/config/env.js';
import { MessageDeduplicator } from '../src/pipeline/deduplicator.js';
import { RateLimiter } from '../src/pipeline/rate-limiter.js';

const suite = new TestSuite('Phase 2: Project Structure & Foundation');

suite.test('Environment config loads with default values', () => {
  assertTrue(config.server.port > 0, 'Port must be a positive integer');
  assertTrue(config.database.retentionDays >= 1, 'Retention days must be at least 1');
  assertTrue(['console', 'baileys', 'meta_webhook'].includes(config.messaging.mode), 'Messaging mode must be a valid transport mode');
  assertEqual(config.gemini.model, 'gemini-flash-lite-latest', 'Default model is gemini-flash-lite-latest');
});

suite.test('Configuration validation passes without errors when API key is configured', () => {
  const result = validateConfig();
  assertTrue(result.valid, 'Config should be valid (no blocking errors)');
  // Errors array must always be empty - warnings are acceptable
  assertEqual(result.errors.length, 0, 'Must have zero critical config errors');
});

suite.test('Message deduplicator ignores duplicates within TTL', () => {
  const dedup = new MessageDeduplicator(10, 1000);
  const msgId = 'test-msg-12345';

  // First time seeing message: not duplicate
  assertFalse(dedup.isDuplicate(msgId), 'First arrival should not be duplicate');

  // Second time seeing same message: duplicate
  assertTrue(dedup.isDuplicate(msgId), 'Second arrival must be detected as duplicate');

  // Different message: not duplicate
  assertFalse(dedup.isDuplicate('different-msg-67890'), 'Different message should not be duplicate');
});

suite.test('Rate limiter enforces max requests per window per student', () => {
  const limiter = new RateLimiter(3, 10000); // 3 requests per 10 seconds
  const studentA = 'student-252611111111';
  const studentB = 'student-252622222222';

  // Student A sends 3 requests: all allowed
  assertTrue(limiter.checkLimit(studentA).allowed, 'Student A req 1 allowed');
  assertTrue(limiter.checkLimit(studentA).allowed, 'Student A req 2 allowed');
  assertTrue(limiter.checkLimit(studentA).allowed, 'Student A req 3 allowed');

  // Student A 4th request: blocked
  const blockedA = limiter.checkLimit(studentA);
  assertFalse(blockedA.allowed, 'Student A req 4 must be rate-limited');
  assertTrue(blockedA.retryAfterSeconds > 0, 'Retry after seconds must be provided');

  // Student B is isolated and NOT affected by Student A
  assertTrue(limiter.checkLimit(studentB).allowed, 'Student B should be unaffected by Student A');
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});

