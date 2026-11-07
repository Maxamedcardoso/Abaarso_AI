import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { executeWithRetry, isRetryableError } from '../src/ai/retry-handler.js';
import { GeminiProvider } from '../src/ai/gemini.provider.js';
import { LlamaProvider } from '../src/ai/llama.provider.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import fs from 'fs';

const suite = new TestSuite('Phase 3: Gemini AI Integration & Zero-Cost Protection');

suite.test('QuotaTracker enforces daily free limit and blocks requests when exhausted', () => {
  const tracker = new QuotaTracker(5, 10, './data/test_quota');
  tracker.resetAll();

  // Make 5 requests
  for (let i = 0; i < 5; i++) {
    const check = tracker.canMakeRequest();
    assertTrue(check.allowed, `Request ${i + 1} must be allowed under limit 5`);
    tracker.recordRequest(100);
  }

  // 6th request must be blocked
  const check6 = tracker.canMakeRequest();
  assertFalse(check6.allowed, '6th request must be blocked by daily limit');
  assertTrue(check6.reason!.includes('Daily free quota reached'), 'Reason must mention daily quota reached');

  // Verify stats
  const stats = tracker.getStats();
  assertEqual(stats.dailyRequests, 5, 'Daily requests count should be 5');
  assertEqual(stats.remainingDailyRequests, 0, 'Remaining requests should be 0');
  assertTrue(stats.isDailyQuotaExhausted, 'isDailyQuotaExhausted flag must be true');

  // Cleanup test file
  try {
    fs.rmSync('./data/test_quota', { recursive: true, force: true });
  } catch {}
});

suite.test('QuotaTracker enforces per-minute rate limits (RPM safeguard)', () => {
  const tracker = new QuotaTracker(100, 3, './data/test_quota_rpm'); // 3 RPM
  tracker.resetAll();

  assertTrue(tracker.canMakeRequest().allowed, 'RPM 1 allowed');
  tracker.recordRequest(50);
  assertTrue(tracker.canMakeRequest().allowed, 'RPM 2 allowed');
  tracker.recordRequest(50);
  assertTrue(tracker.canMakeRequest().allowed, 'RPM 3 allowed');
  tracker.recordRequest(50);

  // 4th within same minute should be blocked
  const check = tracker.canMakeRequest();
  assertFalse(check.allowed, '4th request within 1 minute must be blocked');
  assertTrue(check.retryAfterSeconds! > 0, 'Retry after seconds must be provided');

  try {
    fs.rmSync('./data/test_quota_rpm', { recursive: true, force: true });
  } catch {}
});

suite.test('RetryHandler identifies retryable vs non-retryable errors correctly', () => {
  // Retryable: 429, 503, network disconnect
  assertTrue(isRetryableError({ status: 429 }), 'HTTP 429 is retryable');
  assertTrue(isRetryableError({ message: 'Resource exhausted (429)' }), '429 message is retryable');
  assertTrue(isRetryableError({ status: 503 }), 'HTTP 503 is retryable');
  assertTrue(isRetryableError({ message: 'fetch failed' }), 'Network failure is retryable');

  // Non-retryable: 400 Bad Request, 401 Unauthorized, 403 Forbidden
  assertFalse(isRetryableError({ status: 400, message: 'Invalid prompt syntax' }), '400 is not retryable');
  assertFalse(isRetryableError({ status: 401, message: 'API key not valid' }), '401 is not retryable');
  assertFalse(isRetryableError({ status: 403, message: 'Permission denied' }), '403 is not retryable');
});

suite.test('RetryHandler executes exponential backoff on transient failure and recovers', async () => {
  let callCount = 0;
  const mockTask = async () => {
    callCount++;
    if (callCount < 3) {
      const err: any = new Error('Temporary 429 Resource Exhausted');
      err.status = 429;
      throw err;
    }
    return 'Success after retries';
  };

  let retryAttemptsLogged = 0;
  const result = await executeWithRetry(mockTask, {
    maxRetries: 3,
    initialDelayMs: 10,
    backoffFactor: 2,
    maxDelayMs: 100,
    onRetry: () => {
      retryAttemptsLogged++;
    },
  });

  assertEqual(result, 'Success after retries', 'Task should succeed after retry');
  assertEqual(callCount, 3, 'Should have made exactly 3 attempts');
  assertEqual(retryAttemptsLogged, 2, 'Should have logged 2 retries');
});

suite.test('GeminiProvider safely handles missing API key without crashing', async () => {
  const provider = new GeminiProvider('', 'gemini-2.0-flash');
  assertFalse(provider.isAvailable, 'Provider without key should report unavailable');

  const result = await provider.generateResponse('Hello advisor');
  assertTrue(result.text.includes('Google Gemini API key is missing'), 'Should return helpful key missing message');
  assertEqual(result.provider, 'gemini', 'Provider name matches');
});

suite.test('LlamaProvider never fakes fallback when server is offline', async () => {
  const llama = new LlamaProvider(true, 'http://127.0.0.1:9999/v1', 'llama-3.2-3b');
  const initResult = await llama.initialize();

  assertFalse(initResult, 'Should report false when local server is offline');
  assertFalse(llama.isAvailable, 'isAvailable must be false when offline');

  const response = await llama.generateResponse('Test prompt');
  assertTrue(response.text.includes('Local llama.cpp fallback server is unavailable'), 'Must honestly report offline status');
});

suite.test('AIOrchestrator pauses AI and delivers zero-cost safeguard message when quota is reached', async () => {
  const testTracker = new QuotaTracker(2, 10, './data/test_orchestrator_quota');
  testTracker.resetAll();

  const testConfig = {
    ...config,
    gemini: {
      ...config.gemini,
      apiKey: '',
      dailyLimit: 2,
    },
    llamaFallback: {
      enabled: false,
      url: 'http://127.0.0.1:8080/v1',
      model: 'llama-3.2-3b',
    },
  };

  const orchestrator = new AIOrchestrator(testConfig, testTracker);
  testTracker.setDailyRequestsForTesting(2); // Manually set to limit

  const res = await orchestrator.generateResponse('Walaal ma i caawin kartaa?');
  assertTrue(res.text.includes('Zero-Cost Safeguard'), 'Response must explain Zero-Cost Safeguard');
  assertTrue(res.text.includes('Daily free quota reached'), 'Response must explain daily free quota');

  try {
    fs.rmSync('./data/test_orchestrator_quota', { recursive: true, force: true });
  } catch {}
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});

