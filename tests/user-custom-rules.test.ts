import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { IntentClassifier } from '../src/advisor/intent-classifier.js';
import { PromptBuilder } from '../src/advisor/prompt-builder.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import { MediaProcessorService } from '../src/services/media-processor.service.js';
import fs from 'fs';

const suite = new TestSuite('Custom User Rules & Voice Intelligence Test Suite');
const testDb = './data/test_custom_rules.db';

suite.test('IntentClassifier recognizes questions about WhatsApp owner', () => {
  const queries = [
    'qofkii whatsapp lahaa aaway',
    'qofkii numberka lahaa mee?',
    'ninkii lambarka lahaa aaway',
    'owner-ka lambarka ma joogaa?',
    'number-kan yaa leh?',
    'where is the owner of this number?',
    'who is the owner of this whatsapp?',
  ];

  for (const q of queries) {
    const res = IntentClassifier.classify(q);
    assertEqual(res.intent, 'owner_inquiry', `Should classify "${q}" as owner_inquiry`);
  }
});

suite.test('Engine replies politely and naturally to WhatsApp owner inquiry', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  // Somali query
  const resSo = await engine.processMessage({
    rawSenderId: 'user_test_1',
    chatId: 'chat_1',
    isGroup: false,
    content: 'qofkii whatsapp lahaa aaway?',
  });

  assertEqual(resSo.intent, 'owner_inquiry', 'Intent must be owner_inquiry');
  assertTrue(resSo.replyText.includes('maamulaya oo haya lambarkan'), 'Should state managing the number');
  assertTrue(resSo.replyText.includes('ma joogo'), 'Should state owner is not around');

  // English query
  const resEn = await engine.processMessage({
    rawSenderId: 'user_test_2',
    chatId: 'chat_2',
    isGroup: false,
    content: 'where is the owner of this number?',
  });

  assertEqual(resEn.intent, 'owner_inquiry', 'Intent must be owner_inquiry');
  assertTrue(resEn.replyText.includes('managing and holding this number'), 'English reply should explain managing number');
  assertTrue(resEn.replyText.includes('around right now'), 'English reply should say owner is not around');

  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }
});

suite.test('PromptBuilder embeds strict topic discipline, proportional length, and human persona', () => {
  const prompt = PromptBuilder.buildSystemInstruction({
    detectedLanguage: 'so',
    isGroupChat: false,
    isVoiceReply: false,
  });

  assertTrue(prompt.includes('CORE PERSONA: HUMAN-LIKE WHATSAPP MANAGER'), 'Should define human-like WhatsApp manager persona');
  assertTrue(prompt.includes('AI LA MOODIN'), 'Must include AI la moodin directive');
  assertTrue(prompt.includes('STRICT TOPIC DISCIPLINE — ANSWER ONLY WHAT WAS ASKED'), 'Must strictly forbid off-topic');
  assertTrue(prompt.includes('PROPORTIONAL RESPONSE LENGTH'), 'Must enforce proportional length');
  assertTrue(prompt.includes('STRICT @CARDOSO TEXT-ONLY RULE'), 'Must enforce text-only on @cardoso');
});

suite.test('When @cardoso is written, router and engine NEVER return voice note', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);
  const router = new MessageRouter(engine, config);

  const mockTransport = new ConsoleSimulatorTransport();
  await mockTransport.start();

  let sentMediaTypes: string[] = [];
  mockTransport.sendMedia = async (_chatId, media) => {
    sentMediaTypes.push(media.type);
    return true;
  };

  // User wrote @cardoso asking for voice or greeting
  const res = await router.handleIncomingMessage({
    id: 'msg_cardoso_text_only',
    senderId: 'user_test_3',
    chatId: 'chat_3',
    isGroup: false,
    content: '@cardoso Asc walaal',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);

  assertTrue(res.handled, 'Message should be handled');
  assertFalse(sentMediaTypes.includes('audio'), 'Voice note must NEVER be sent when @cardoso was written');

  await mockTransport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }
});

suite.test('MediaProcessorService unwraps WhatsApp View-Once ("One-Click" 1️⃣) voice notes, images, and videos', () => {
  // 1. View-Once Voice Note (viewOnceMessageV2Extension)
  const viewOnceAudio = {
    messageContextInfo: { deviceListMetadataVersion: 2 },
    viewOnceMessageV2Extension: {
      message: {
        audioMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.enc',
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          viewOnce: true,
        },
      },
    },
  };
  const unwrappedAudio = MediaProcessorService.unwrapMessage(viewOnceAudio);
  assertTrue(unwrappedAudio.isViewOnce, 'Should detect View-Once voice note');
  assertEqual(unwrappedAudio.msgType, 'audioMessage', 'Should unwrap to audioMessage');
  assertEqual(unwrappedAudio.mediaKind, 'audio', 'Media kind should be audio');
  assertEqual(unwrappedAudio.baileysMediaType, 'audio', 'Baileys download type should be audio');

  // 2. View-Once Photo inside Ephemeral container (ephemeralMessage -> viewOnceMessageV2 -> imageMessage)
  const viewOnceImage = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7118-24/image.enc',
              mimetype: 'image/jpeg',
              caption: 'Arag sawirkayga',
              viewOnce: true,
            },
          },
        },
      },
    },
  };
  const unwrappedImage = MediaProcessorService.unwrapMessage(viewOnceImage);
  assertTrue(unwrappedImage.isViewOnce, 'Should detect View-Once image inside ephemeral container');
  assertEqual(unwrappedImage.msgType, 'imageMessage', 'Should unwrap to imageMessage');
  assertEqual(unwrappedImage.mediaKind, 'image', 'Media kind should be image');
  assertEqual(unwrappedImage.message.imageMessage.caption, 'Arag sawirkayga', 'Should preserve caption on View-Once image');

  // 3. View-Once Video (viewOnceMessageV2 -> videoMessage)
  const viewOnceVideo = {
    viewOnceMessageV2: {
      message: {
        videoMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7161-24/video.enc',
          mimetype: 'video/mp4',
          viewOnce: true,
        },
      },
    },
  };
  const unwrappedVideo = MediaProcessorService.unwrapMessage(viewOnceVideo);
  assertTrue(unwrappedVideo.isViewOnce, 'Should detect View-Once video');
  assertEqual(unwrappedVideo.msgType, 'videoMessage', 'Should unwrap to videoMessage');
  assertEqual(unwrappedVideo.mediaKind, 'video', 'Media kind should be video');
  assertEqual(MediaProcessorService.getMimeType(unwrappedVideo.msgType, 'video/mp4'), 'video/mp4', 'Should return video/mp4 MIME');
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});
