import { TestSuite, assertEqual, assertTrue } from './runner.js';
import { LanguageDetector } from '../src/advisor/language-detector.js';
import { findTechnicalTermsInText, TECHNICAL_GLOSSARY } from '../src/advisor/somali-dictionary.js';
import { PromptBuilder } from '../src/advisor/prompt-builder.js';

const suite = new TestSuite('Phase 4: Somali & English Conversation Handling');

const detector = new LanguageDetector();

suite.test('Detects pure Somali natural sentences and questions', () => {
  const query1 = 'Walaal waxaan rabaa inaad i caawiso diyaarinta imtixaanka jaamacadda';
  const res1 = detector.detect(query1);
  assertEqual(res1.language, 'so', 'Query 1 should be detected as Somali');
  assertTrue(res1.confidence >= 0.7, 'Confidence should be high for Somali');

  const query2 = 'Sidee baan waqtigayga u maareeyaa markaan wax baranayo?';
  const res2 = detector.detect(query2);
  assertEqual(res2.language, 'so', 'Query 2 should be detected as Somali');
});

suite.test('Understands informal Somali slang, abbreviations and spelling errors', () => {
  const informal = 'asc sxb i caawi waxan raba inaan barto koodhka';
  const res = detector.detect(informal);

  assertEqual(res.language, 'so', 'Informal text should be detected as Somali');
  assertTrue(res.hasSomaliSlang, 'Should flag presence of Somali slang');
  assertTrue(res.detectedSlang.includes('asc'), 'Should identify "asc"');
  assertTrue(res.detectedSlang.includes('sxb'), 'Should identify "sxb"');

  // Verify normalization
  assertTrue(res.normalizedText.includes('Assalaamu Calaykum'), 'Normalized text should expand "asc"');
  assertTrue(res.normalizedText.includes('saaxiib'), 'Normalized text should expand "sxb"');
});

suite.test('Detects pure English questions accurately', () => {
  const engQuery = 'How can I prepare a study schedule for my computer science final exams?';
  const res = detector.detect(engQuery);
  assertEqual(res.language, 'en', 'Should be detected as English');
  assertTrue(res.confidence >= 0.7, 'Confidence should be high for English');

  const engCode = 'Explain the difference between let, const, and var in modern JavaScript';
  const resCode = detector.detect(engCode);
  assertEqual(resCode.language, 'en', 'Should be detected as English');
});

suite.test('Detects mixed Somali-English code-switching (bilingual student questions)', () => {
  const mixed1 = 'Sideen Python ugu qoraa loop?';
  const res1 = detector.detect(mixed1);
  assertEqual(res1.language, 'mixed', 'Should detect mixed code-switching for "Sideen Python ugu qoraa loop?"');

  const mixed2 = 'React useState-ka ma fahmin, fadlan ii faahfaahi';
  const res2 = detector.detect(mixed2);
  assertEqual(res2.language, 'mixed', 'Should detect mixed code-switching for React query');

  const mixed3 = 'Walaal binary search algorithm sidee u shaqeeyaa?';
  const res3 = detector.detect(mixed3);
  assertEqual(res3.language, 'mixed', 'Should detect mixed code-switching for algorithm query');
});

suite.test('Somali Technical Glossary explains complex English concepts simply', () => {
  assertTrue(Boolean(TECHNICAL_GLOSSARY.variable), 'Variable must be in glossary');
  assertTrue(TECHNICAL_GLOSSARY.variable.simpleExplanation.includes('sanduuq'), 'Variable explanation should use box/container analogy');

  assertTrue(Boolean(TECHNICAL_GLOSSARY.loop), 'Loop must be in glossary');
  assertTrue(
    TECHNICAL_GLOSSARY.loop.somaliName.includes('celcelin') ||
    TECHNICAL_GLOSSARY.loop.simpleExplanation.includes('celceli'),
    'Loop explanation should use repetition (ku-celcelin) in Somali'
  );

  assertTrue(Boolean(TECHNICAL_GLOSSARY.async), 'Async must be in glossary');

  const foundTerms = findTechnicalTermsInText('Walaal ma ii sharxi kartaa sida database iyo api u wada shaqeeyaan?');
  const termNames = foundTerms.map(t => t.term.toLowerCase());
  assertTrue(termNames.some(t => t.includes('database')), 'Should identify database term in query');
  assertTrue(termNames.some(t => t.includes('api')), 'Should identify API term in query');
});

suite.test('PromptBuilder generates appropriate system directives for each language mode', () => {
  const somaliPrompt = PromptBuilder.buildSystemInstruction({
    detectedLanguage: 'so',
    isGroupChat: false,
  });
  assertTrue(somaliPrompt.includes('LANGUAGE DIRECTIVE: SOMALI'), 'Must include Somali directive');
  assertTrue(somaliPrompt.includes('CARDOSO AI'), 'Must include CARDOSO AI identity');
  assertTrue(somaliPrompt.includes('STRICT SHORT GREETING MODE'), 'Must enforce strict short greeting mode');

  const englishPrompt = PromptBuilder.buildSystemInstruction({
    detectedLanguage: 'en',
    isGroupChat: true,
  });
  assertTrue(englishPrompt.includes('LANGUAGE DIRECTIVE: ENGLISH'), 'Must include English directive');
  assertTrue(englishPrompt.includes('Group mode'), 'Must include group mode note when in group chat');

  const mixedPrompt = PromptBuilder.buildSystemInstruction({
    detectedLanguage: 'mixed',
    isGroupChat: false,
  });
  assertTrue(mixedPrompt.includes('BILINGUAL MIXED'), 'Must include bilingual mixed directive');
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});
