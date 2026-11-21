import os from 'os';
import path from 'path';
import fs from 'fs';
import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';

// Isolate the singleton's persistence file BEFORE the modules are imported
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-errlog-'));
process.env.DATA_DIR = tmpDir;

const { ErrorLogService, errorLogService, redactSecrets, parseStackFrames } = await import('../src/services/error-log.service.js');
const { MessageRouter } = await import('../src/pipeline/message-router.js');
const { StudentAdvisorEngine } = await import('../src/advisor/advisor-engine.js');
const { AIOrchestrator } = await import('../src/ai/ai-orchestrator.js');
const { SQLiteStudentMemory } = await import('../src/memory/sqlite-memory.js');
const { ConsoleSimulatorTransport } = await import('../src/transports/console-simulator.js');
const { config } = await import('../src/config/env.js');

const suite = new TestSuite('Error Log & !info Diagnostics');

suite.test('Groups identical errors, counts them and records origin file:line', () => {
  const svc = new ErrorLogService(path.join(tmpDir, 'unit-1.json'));
  const err = new Error('socket exploded for 252634949642');
  svc.record('WhatsAppBaileys:owner', err);
  svc.record('WhatsAppBaileys:owner', new Error('socket exploded for 252611111111'));
  const list = svc.getEntries();
  assertEqual(list.length, 1, 'Same error with different phone numbers must be grouped');
  assertEqual(list[0].count, 2, 'Count must be 2');
  assertTrue(list[0].origin.includes('error-log.test.ts') || list[0].origin.includes(':'), 'Origin must contain file:line');
});

suite.test('Redacts API keys, tokens and DB passwords from recorded messages', () => {
  const red = redactSecrets('GET https://x/y?key=AIzaSyA1234567890123456789012345 postgres://user:superSecret@host/db Bearer abcdefghijklmnopqrstuvwxyz123456');
  assertFalse(red.includes('AIzaSyA1234567890'), 'Google key must be redacted');
  assertFalse(red.includes('superSecret'), 'DB password must be redacted');
  assertFalse(red.includes('abcdefghijklmnopqrstuvwxyz123456'), 'Bearer token must be redacted');
});

suite.test('Parses project stack frames into src/…:line form', () => {
  const frames = parseStackFrames(
    'Error: x\n    at Foo.bar (file:///C:/Users/mohamed/Desktop/BOT/src/ai/gemini.provider.ts:112:9)\n    at node:internal/process/task_queues:95:5'
  );
  assertEqual(frames[0], 'src/ai/gemini.provider.ts:112', 'First frame must be the project file and line');
});

suite.test('Console capture registers console.error/warn with [Tag] source and does not recurse', () => {
  const svc = new ErrorLogService(path.join(tmpDir, 'unit-2.json'));
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    svc.installConsoleCapture();
    console.error('❌ [GeminiProvider] All candidate models exhausted');
    console.warn('⚠️ [Keep-Alive] Ping error: fetch failed');
  } finally {
    // restore the capture wrappers' targets so later tests are unaffected
    (console as any).error = origErr;
    (console as any).warn = origWarn;
  }
  const list = svc.getEntries();
  assertTrue(list.some((e) => e.source === 'GeminiProvider' && e.level === 'error'), 'GeminiProvider error captured');
  assertTrue(list.some((e) => e.source === 'Keep-Alive' && e.level === 'warn'), 'Keep-Alive warning captured');
});

suite.test('Scope filter + clear only touch the requested tenant', () => {
  const svc = new ErrorLogService(path.join(tmpDir, 'unit-3.json'));
  svc.record('WhatsAppBaileys:t_aaa', 'boom A');
  svc.record('WhatsAppBaileys:owner', 'boom owner');
  assertEqual(svc.getEntries({ scopeText: 't_aaa' }).length, 1, 'Scoped view shows only tenant entries');
  assertEqual(svc.clear('t_aaa'), 1, 'Scoped clear removes one');
  assertEqual(svc.getEntries().length, 1, 'Owner entry remains');
});

suite.test('!info shows health + errors with origin for admin; blocked for non-admin', async () => {
  const dbPath = path.join(tmpDir, 'info-test.db');
  const memory = new SQLiteStudentMemory(dbPath);
  await memory.initialize();
  const engine = new StudentAdvisorEngine(memory, new AIOrchestrator(config));
  const router = new MessageRouter(
    engine,
    { ...config, security: { ...config.security, adminPhoneNumbers: ['252610000099'] } } as any
  );
  const transport = new ConsoleSimulatorTransport();
  await transport.start();
  const sent: string[] = [];
  (transport as any).sendMessage = async (_chat: string, text: string) => {
    sent.push(text);
    return true;
  };

  errorLogService.clear();
  errorLogService.record('GeminiProvider', new Error('fetch failed'));

  const base = { chatId: 'direct_admin', isGroup: false, rawTimestamp: Date.now(), isMentioned: true };
  const r1 = await router.handleIncomingMessage({ ...base, id: 'info_1', senderId: '252610000099', content: '!info' }, transport);
  assertTrue(r1.handled, '!info must be handled');
  assertTrue(sent[0].includes('BOT HEALTH') && sent[0].includes('Auto-View'), 'Report includes health block');
  assertTrue(sent[0].includes('GeminiProvider'), 'Report lists the registered error source');

  const r2 = await router.handleIncomingMessage({ ...base, id: 'info_2', senderId: '252610000099', content: '!info errors' }, transport);
  assertTrue(r2.handled && sent[1].includes('Halka uu ka yimid'), '!info errors lists origin');

  const r3 = await router.handleIncomingMessage({ ...base, id: 'info_3', senderId: '252610000099', content: '!info clear' }, transport);
  assertTrue(r3.handled && errorLogService.getEntries().length === 0, '!info clear empties the registry');

  const r4 = await router.handleIncomingMessage(
    { ...base, chatId: 'direct_stranger', id: 'info_4', senderId: '252619999000', content: '!info' },
    transport
  );
  assertTrue(r4.handled && r4.reason === 'Unauthorized admin command blocked', 'Non-admin !info is blocked');
});

suite.test('Library-only stacks (e.g. Baileys crypto) show the library file:line and known errors get a hint + warn level', () => {
  const svc = new ErrorLogService(path.join(tmpDir, 'unit-4.json'));
  const err: any = new Error('Unsupported state or unable to authenticate data');
  err.stack =
    'Error: Unsupported state or unable to authenticate data\n' +
    '    at Decipheriv.final (node:internal/crypto/cipher:193:29)\n' +
    '    at aesDecryptGCM (file:///C:/Users/mohamed/Desktop/BOT/node_modules/@whiskeysockets/baileys/lib/Utils/crypto.js:53:30)\n' +
    '    at EventEmitter.emit (node:events:514:28)';
  svc.record('Process Guard: unhandledRejection', err);
  const e = svc.getEntries()[0];
  assertEqual(e.origin, '@whiskeysockets/baileys/lib/Utils/crypto.js:53', 'Origin must point at the Baileys file, not node:events');
  assertEqual(e.level, 'warn', 'Known benign Baileys crypto error is downgraded to a warning');
  assertTrue(Boolean(e.hint && e.hint.includes('Baileys')), 'Known error carries an explanatory hint');

  const ssl = new ErrorLogService(path.join(tmpDir, 'unit-5.json'));
  ssl.record('node', "Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'");
  assertEqual(ssl.getEntries()[0].level, 'warn', 'pg SSL alias notice is only a warning');
});

const result = await suite.run();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}
if (result.failed > 0) process.exit(1);
process.exit(0);
