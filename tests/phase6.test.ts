import { TestSuite, assertEqual, assertTrue } from './runner.js';
import { IntentClassifier } from '../src/advisor/intent-classifier.js';
import { MotivationCoach } from '../src/advisor/motivation-coach.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import fs from 'fs';

const suite = new TestSuite('Phase 6: Academic Advisor Features & Safety Guardrails');

const testDb = './data/test_advisor.db';

suite.test('IntentClassifier accurately categorizes student intents', () => {
  assertEqual(IntentClassifier.classify('Sideen Python ugu qoraa loop?').intent, 'programming', 'Should classify python loop as programming');
  assertEqual(IntentClassifier.classify('React component state ma shaqeynayo').intent, 'programming', 'Should classify react state as programming');
  assertEqual(IntentClassifier.classify('Fadlan homework-gan ii xalli suaasha 3aad').intent, 'homework', 'Should classify homework as homework');
  assertEqual(IntentClassifier.classify('Sideen u diyaariyaa jadwalka imtixaanka jaamacadda?').intent, 'academic', 'Should classify study schedule as academic');
  assertEqual(IntentClassifier.classify('Aad baan u daallanahay, waxbarashada dhiirigelin ma haysto').intent, 'motivation', 'Should classify study burnout as motivation');
  assertEqual(IntentClassifier.classify('!tirtir').intent, 'privacy_forget', 'Should classify !tirtir as privacy_forget');
  assertEqual(IntentClassifier.classify('!clear').intent, 'privacy_forget', 'Should classify !clear as privacy_forget');
  assertEqual(IntentClassifier.classify('!help').intent, 'help', 'Should classify !help as help');
  assertEqual(IntentClassifier.classify('asc').intent, 'greeting', 'Should classify asc as greeting');
  assertEqual(IntentClassifier.classify('asc sxb').intent, 'greeting', 'Should classify asc sxb as greeting');
  assertEqual(IntentClassifier.classify('assalaamu calaykum').intent, 'greeting', 'Should classify assalaamu calaykum as greeting');
});

suite.test('MotivationCoach catches distress keywords and offers compassionate support without clinical diagnosis', () => {
  const distressMsg = 'Aad baan u quus gooyay, noloshu micno ma leh';
  assertTrue(MotivationCoach.hasDistressSignals(distressMsg), 'Must detect distress signals');

  const crisisNotice = MotivationCoach.getCrisisSupportMessage('so');
  assertTrue(crisisNotice.includes('Anigu waxaan ahay caawiye waxbarasho'), 'Must state boundary that it is not a doctor');
  assertTrue(crisisNotice.includes('dhaqtar'), 'Must recommend human counselors / doctors');
});

suite.test('Right-to-be-Forgotten command (!tirtir) executes immediately and clears history', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();

  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  // Student sends normal message
  await engine.processMessage({
    rawSenderId: 'student_priv_123',
    chatId: 'chat_priv',
    isGroup: false,
    content: 'Walaal Python sidee loo bartaa?',
  });

  const student = await memory.getOrCreateStudent('student_priv_123');
  const historyBefore = await memory.getConversationHistory(student.studentId);
  assertTrue(historyBefore.length >= 1, 'Should have history before deletion');

  // Student sends !tirtir command
  const deleteResult = await engine.processMessage({
    rawSenderId: 'student_priv_123',
    chatId: 'chat_priv',
    isGroup: false,
    content: '!tirtir',
  });

  assertEqual(deleteResult.intent, 'privacy_forget', 'Intent should be privacy_forget');
  assertTrue(deleteResult.replyText.includes('tirtiray'), 'Response should confirm deletion in Somali');

  const historyAfter = await memory.getConversationHistory(student.studentId);
  assertEqual(historyAfter.length, 0, 'History should now be 0');

  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}
});

suite.test('Greeting intent responds with "Wcs" and never returns "Asc"', async () => {
  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const res = await engine.processMessage({
    rawSenderId: 'student_greet_1',
    chatId: 'chat_greet',
    isGroup: false,
    content: 'asc sxb',
  });

  assertEqual(res.intent, 'greeting', 'Should classify as greeting');
  assertTrue(res.replyText.startsWith('Wcs'), 'Greeting reply must start with Wcs');

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

