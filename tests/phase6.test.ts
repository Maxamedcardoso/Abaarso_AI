import { TestSuite, assertEqual, assertTrue } from './runner.js';
import { IntentClassifier } from '../src/advisor/intent-classifier.js';
import { MotivationCoach } from '../src/advisor/motivation-coach.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import fs from 'fs';

const suite = new TestSuite('Phase 6: AI Features & Safety Guardrails');

const testDb = './data/test_advisor.db';

suite.test('IntentClassifier accurately categorizes user intents', () => {
  // Privacy
  assertEqual(IntentClassifier.classify('!tirtir').intent, 'privacy_forget', 'Should classify !tirtir as privacy_forget');
  assertEqual(IntentClassifier.classify('!clear').intent, 'privacy_forget', 'Should classify !clear as privacy_forget');
  // Help
  assertEqual(IntentClassifier.classify('!help').intent, 'help', 'Should classify !help as help');
  // Greetings (pure greetings must be classified as greeting)
  assertEqual(IntentClassifier.classify('asc').intent, 'greeting', 'Should classify asc as greeting');
  assertEqual(IntentClassifier.classify('asc sxb').intent, 'greeting', 'Should classify asc sxb as greeting');
  assertEqual(IntentClassifier.classify('assalaamu calaykum').intent, 'greeting', 'Should classify assalaamu calaykum as greeting');
  assertEqual(IntentClassifier.classify('iwaran').intent, 'greeting', 'Should classify iwaran as greeting');
  assertEqual(IntentClassifier.classify('iska warran').intent, 'greeting', 'Should classify iska warran as greeting');
  assertEqual(IntentClassifier.classify('hi').intent, 'greeting', 'Should classify hi as greeting');
  assertEqual(IntentClassifier.classify('hello').intent, 'greeting', 'Should classify hello as greeting');
  // Domain queries
  assertEqual(IntentClassifier.classify('Sideen Python ugu qoraa loop?').intent, 'programming', 'Programming question should be programming');
  assertEqual(IntentClassifier.classify('Fadlan homework-gan ii xalli').intent, 'homework', 'Homework question should be homework');
  assertEqual(IntentClassifier.classify('jadwalka imtixaanka jaamacadda').intent, 'academic', 'Academic question should be academic');
  assertEqual(IntentClassifier.classify('Maxaa ku dhacay Soomaaliya 1991?').intent, 'general', 'History question should be general');
  // Motivation
  assertEqual(IntentClassifier.classify('Aad baan u daallanahay dhiirigelin ma haysto').intent, 'motivation', 'Should classify burnout as motivation');
  // Creator questions
  assertEqual(IntentClassifier.classify('Yaa ku sameeyey?').intent, 'creator', 'Should classify who made you as creator');
  assertEqual(IntentClassifier.classify('who created you?').intent, 'creator', 'Should classify who created you as creator');
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
  } catch { }

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
  } catch { }
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
  } catch { }
});

suite.test('Creator intent accurately introduces creator Maxamed Daahir', async () => {
  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const resSomali = await engine.processMessage({
    rawSenderId: 'student_creator_1',
    chatId: 'chat_creator',
    isGroup: false,
    content: 'Yaa ku sameeyey?',
  });

  assertEqual(resSomali.intent, 'creator', 'Should classify as creator intent');
  assertTrue(resSomali.replyText.includes('Maxamed Daahir'), 'Must mention Maxamed Daahir in Somali');
  assertTrue(resSomali.replyText.includes('Abaarso'), 'Must mention Abaarso University');

  const resEnglish = await engine.processMessage({
    rawSenderId: 'student_creator_2',
    chatId: 'chat_creator_en',
    isGroup: false,
    content: 'Who created you?',
  });

  assertEqual(resEnglish.intent, 'creator', 'Should classify as creator intent');
  assertTrue(resEnglish.replyText.includes('Mohamed Dahir'), 'Must mention Mohamed Dahir in English');
  assertTrue(resEnglish.replyText.includes('Abaarso'), 'Must mention Abaarso University');

  // Test Location inquiry
  const resLocation = await engine.processMessage({
    rawSenderId: 'student_creator_3',
    chatId: 'chat_creator_loc',
    isGroup: false,
    content: 'Halkee buu joogaa Maxamed Daahir?',
  });

  assertEqual(resLocation.intent, 'creator', 'Location inquiry should classify as creator intent');
  assertTrue(resLocation.replyText.includes('Berbera'), 'Must mention Berbera');
  assertTrue(resLocation.replyText.includes('Jamalaaye'), 'Must mention Jamalaaye neighborhood');

  const resLocationEn = await engine.processMessage({
    rawSenderId: 'student_creator_4',
    chatId: 'chat_creator_loc_en',
    isGroup: false,
    content: 'Where is he located?',
  });

  assertEqual(resLocationEn.intent, 'creator', 'English location inquiry should classify as creator intent');
  assertTrue(resLocationEn.replyText.includes('Berbera'), 'Must mention Berbera in English');
  assertTrue(resLocationEn.replyText.includes('Jamalaaye'), 'Must mention Jamalaaye in English');

  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});

