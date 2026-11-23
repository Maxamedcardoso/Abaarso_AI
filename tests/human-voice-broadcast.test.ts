import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { masterHumanVoiceReplyToOggOpus } from '../src/services/podcast-studio.service.js';
import {
  VoiceReplyService,
  generateSpeechWaveform,
  getOggOpusDurationSeconds,
} from '../src/services/voice-reply.service.js';
import { PromptBuilder } from '../src/advisor/prompt-builder.js';
import { WhatsAppManagerService } from '../src/services/whatsapp-manager.service.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { IMessagingTransport, IncomingMessage, OutgoingMedia, OutgoingMessageOptions } from '../src/transports/transport.interface.js';
import { AppConfig } from '../src/config/env.js';

function createTestWavBuffer(leadingSilenceSec: number, toneSec: number, trailingSilenceSec: number): Buffer {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const leadSamples = Math.round(leadingSilenceSec * sampleRate);
  const toneSamples = Math.round(toneSec * sampleRate);
  const trailSamples = Math.round(trailingSilenceSec * sampleRate);
  const totalSamples = leadSamples + toneSamples + trailSamples;
  const dataSize = totalSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 4, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 4, 'ascii');
  buf.write('fmt ', 12, 4, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 4, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < toneSamples; i++) {
    const t = i / sampleRate;
    // Speech-like dual harmonic modulation (160Hz + 320Hz with envelope)
    const env = Math.sin((Math.PI * i) / toneSamples);
    const sample = Math.round(
      env * (0.45 * Math.sin(2 * Math.PI * 160 * t) + 0.25 * Math.sin(2 * Math.PI * 320 * t)) * 32767
    );
    buf.writeInt16LE(sample, 44 + (leadSamples + i) * 2);
  }
  return buf;
}

const dummyConfig: AppConfig = {
  ai: {
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-2.5-flash',
    fallbackModel: 'gemini-2.0-flash',
    maxTokens: 1000,
    temperature: 0.7,
    maxCallsPerMinute: 30,
    maxCallsPerDay: 500,
  },
  messaging: {
    transport: 'console',
    mode: 'test',
    prefix: '!ai',
    groupResponseMode: 'mention_only',
  },
  security: {
    adminPhoneNumbers: ['252634949642'],
    allowedGroups: [],
    rateLimitPerMinute: 60,
    rateLimitPerHour: 600,
    sessionTimeoutMinutes: 30,
  },
  database: {
    path: ':memory:',
  },
  server: {
    port: 3000,
  },
} as any;

async function runTests() {
  let passed = 0;
  const ok = (name: string) => {
    passed++;
    console.log(`  ✅ ${passed}. ${name}`);
  };

  console.log('\n🎙️ [Human Voice & WhatsApp Broadcast List Tests] Starting...\n');

  // 1. Human Voice Mastering Pipeline (FFmpeg silence trim + phone-mic warmth + OggS Opus)
  const rawWav = createTestWavBuffer(0.65, 1.0, 0.65); // 2.3s total with 1.3s dead silence
  const masteredOgg = await masterHumanVoiceReplyToOggOpus(rawWav);
  assert.strictEqual(
    masteredOgg.slice(0, 4).toString('ascii'),
    'OggS',
    'masterHumanVoiceReplyToOggOpus must emit valid OggS Opus container'
  );
  const durSec = getOggOpusDurationSeconds(masteredOgg);
  assert.ok(durSec >= 1 && durSec <= 2, `Dead silence should be trimmed cleanly (expected 1-2s, got ${durSec}s)`);
  const wf = generateSpeechWaveform(masteredOgg);
  assert.strictEqual(wf.length, 64, 'Speech waveform must have 64 bars');
  ok(`masterHumanVoiceReplyToOggOpus produced valid OggS (${masteredOgg.length} bytes, ${durSec}s, dead silence trimmed)`);

  // 2. Emotion-Matched Mohamed Prosody (Clapback vs Empathy vs Happy + Somali text fallback)
  const angryProsody = VoiceReplyService.prosodyForChatEmotion('angry', 'Afkaaga qabso!');
  const sickProsody = VoiceReplyService.prosodyForChatEmotion('sick', 'Alle ha ku caafiyo');
  const happyProsody = VoiceReplyService.prosodyForChatEmotion('happy', 'Haa-haa waa guul!');
  const autoRoastProsody = VoiceReplyService.prosodyForChatEmotion(
    'neutral',
    'War adiga maxaa kaa qaldan ninyahow?! Afkaaga qabso!'
  );
  const autoEmpathyProsody = VoiceReplyService.prosodyForChatEmotion(
    'neutral',
    'Alle ha ku caafiyo walaal, caafimaad degdeg ah baan kuu rajaynayaa.'
  );

  assert.ok(parseInt(angryProsody.rate, 10) >= 3, `Angry/clapback rate must be punchy positive, got ${angryProsody.rate}`);
  assert.ok(parseInt(sickProsody.rate, 10) <= -5, `Sick/empathy rate must be gentle negative, got ${sickProsody.rate}`);
  assert.ok(parseInt(happyProsody.pitch, 10) >= 2, `Happy pitch must be lifted, got ${happyProsody.pitch}`);
  assert.ok(parseInt(autoRoastProsody.rate, 10) >= 3, `Auto-detected Somali clapback must trigger punchy prosody, got ${autoRoastProsody.rate}`);
  assert.ok(parseInt(autoEmpathyProsody.rate, 10) <= -5, `Auto-detected Somali empathy must trigger gentle prosody, got ${autoEmpathyProsody.rate}`);
  ok('prosodyForChatEmotion adapts Mohamed voice cleanly across clapback, empathy, joy, and Somali spoken cues');

  // 3. Spoken Voice Mode System Prompt includes human Mohamed voice + bold Somali clapbacks
  const voicePrompt = PromptBuilder.buildSystemInstruction({
    isVoiceReply: true,
    language: 'so',
    isGroup: false,
    studentName: 'Ahmed',
  } as any);
  assert.ok(
    voicePrompt.includes('SPOKEN VOICE NOTE MODE (ACTIVE) — 100% HUMAN MOHAMED VOICE'),
    'Voice mode prompt must activate Mohamed human voice block'
  );
  assert.ok(
    voicePrompt.includes('SHARP SOMALI COMEBACKS IN VOICE WHEN INSULTED OR MOCKED'),
    'Voice mode prompt must enable confident Somali comebacks when insulted'
  );
  ok('PromptBuilder activates Spoken Mohamed Human Voice Mode with Somali comeback rules');

  // 4. WhatsAppManagerService Broadcast List Registry, Persistence & w:b IQ Parsing
  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-bclist-test-'));
  try {
    const mgr = new WhatsAppManagerService({
      authDir: tmpAuthDir,
      adminPhones: ['252634949642'],
    });
    mgr.stopAutonomousGovernorLoop();

    assert.strictEqual(mgr.isBroadcastListJid('1763812345@broadcast'), true);
    assert.strictEqual(mgr.isBroadcastListJid('status@broadcast'), false);
    assert.strictEqual(mgr.isBroadcastListJid('120363000000@g.us'), false);
    assert.strictEqual(mgr.isBroadcastListJid('252634111111@s.whatsapp.net'), false);

    // Mock socket with w:b IQ query returning a broadcast list + participants
    const mockSocket: any = {
      user: { id: '252634949642:12@s.whatsapp.net' },
      query: async (iq: any) => {
        if (iq?.attrs?.xmlns === 'w:b' && iq?.attrs?.to === '1763812345@broadcast') {
          return {
            tag: 'iq',
            attrs: { type: 'result' },
            content: [
              {
                tag: 'broadcast',
                attrs: { name: 'Asxaabta VIP' },
                content: [
                  { tag: 'participant', attrs: { jid: '252634111111@s.whatsapp.net' } },
                  { tag: 'participant', attrs: { jid: '252634222222@s.whatsapp.net' } },
                  // Bot's own number must be filtered out automatically
                  { tag: 'participant', attrs: { jid: '252634949642@s.whatsapp.net' } },
                ],
              },
            ],
          };
        }
        return { tag: 'iq', attrs: { type: 'result' }, content: [] };
      },
    };
    mgr.setSocket(mockSocket);
    mgr.stopAutonomousGovernorLoop();

    const resolved = await mgr.resolveBroadcastListRecipients('1763812345@broadcast', true);
    assert.strictEqual(resolved.name, 'Asxaabta VIP');
    assert.deepStrictEqual(resolved.recipients, [
      '252634111111@s.whatsapp.net',
      '252634222222@s.whatsapp.net',
    ]);
    ok('WhatsAppManagerService parses w:b IQ Broadcast List participants & excludes bot self-number');

    // Receipt capture + reload from disk cache
    const addedReceipt = mgr.recordBroadcastListRecipient(
      '1763812345@broadcast',
      '252634333333:5@s.whatsapp.net',
      true
    );
    assert.strictEqual(addedReceipt, true);

    const mgrReloaded = new WhatsAppManagerService({
      authDir: tmpAuthDir,
      adminPhones: ['252634949642'],
    });
    mgrReloaded.stopAutonomousGovernorLoop();
    const cachedList = mgrReloaded.getBroadcastList('1763812345@broadcast');
    assert.ok(cachedList, 'Broadcast list must persist across restarts in broadcast-lists-cache.json');
    assert.strictEqual(cachedList!.name, 'Asxaabta VIP');
    assert.strictEqual(cachedList!.recipients.length, 3);
    ok('Broadcast list recipients capture receipts & persist across restarts in broadcast-lists-cache.json');

    // 5. Router E2E for !podcast, !cod, !bclist inside WhatsApp Broadcast Lists
    const sentTexts: Array<{ chatId: string; text: string }> = [];
    const sentMedia: Array<{ chatId: string; media: OutgoingMedia }> = [];
    let aiCalledCount = 0;

    const fakeEngine: any = {
      getAIOrchestrator: () => null,
      processMessage: async () => {
        aiCalledCount++;
        return { replyText: 'AI should not be called for broadcast list !cod/!podcast' };
      },
    };

    const mockTransport: IMessagingTransport = {
      name: 'mock-wa',
      isConnected: true,
      start: async () => { },
      stop: async () => { },
      onMessage: () => { },
      getSocket: () => mockSocket,
      getStatus: () => ({ name: 'mock-wa', connected: true, activeChats: 1, lastActivity: Date.now() }),
      sendMessage: async (chatId: string, text: string, _opts?: OutgoingMessageOptions) => {
        sentTexts.push({ chatId, text });
        return true;
      },
      sendMedia: async (chatId: string, media: OutgoingMedia) => {
        sentMedia.push({ chatId, media });
        return true;
      },
    };

    // Stub TTS & Promo generator offline using our real FFmpeg-mastered OggS buffer
    const origSynth = VoiceReplyService.synthesizeVoice;
    const origPromo = VoiceReplyService.getCardosoPromoVoiceNote;
    const synthesizedCalls: Array<{ text: string; options?: any }> = [];

    (VoiceReplyService as any).synthesizeVoice = async (text: string, _lang?: string, options?: any) => {
      synthesizedCalls.push({ text, options });
      return {
        buffer: masteredOgg,
        mimeType: 'audio/ogg; codecs=opus',
        seconds: durSec,
        waveform: wf,
      };
    };
    (VoiceReplyService as any).getCardosoPromoVoiceNote = async () => ({
      buffer: masteredOgg,
      mimeType: 'audio/ogg; codecs=opus',
      seconds: durSec,
      waveform: wf,
      turnCount: 8,
    });

    try {
      const router = new MessageRouter(fakeEngine, dummyConfig, undefined, undefined, undefined, {
        whatsappManager: mgr,
      });

      // 5a. `!podcast` sent inside Broadcast List `1763812345@broadcast` (3 recipients)
      const podMsg: IncomingMessage = {
        id: 'bc_pod_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '1763812345@broadcast',
        isGroup: false,
        content: '!podcast',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const podRes = await router.handleIncomingMessage(podMsg, mockTransport);
      assert.strictEqual(podRes.handled, true);
      assert.strictEqual(sentMedia.length, 3, 'All 3 Broadcast List recipients must receive the Podcast PTT');
      assert.deepStrictEqual(
        sentMedia.map(m => m.chatId),
        [
          '252634111111@s.whatsapp.net',
          '252634222222@s.whatsapp.net',
          '252634333333@s.whatsapp.net',
        ]
      );
      for (const m of sentMedia) {
        assert.strictEqual(m.media.type, 'audio');
        assert.strictEqual(m.media.ptt, true);
        assert.strictEqual(m.media.mimeType, 'audio/ogg; codecs=opus');
        assert.strictEqual(m.media.dataBuffer.slice(0, 4).toString('ascii'), 'OggS');
        assert.ok((m.media.seconds || 0) >= 1);
        assert.strictEqual(m.media.waveform?.length, 64);
      }
      // Teasers & delivery summary MUST go ONLY to owner's Self-Chat, NEVER to recipients!
      assert.ok(sentTexts.length >= 2, 'Owner Self-Chat must receive teaser & delivery confirmation');
      assert.ok(
        sentTexts.every(t => t.chatId === '252634949642@s.whatsapp.net'),
        'Zero text clutter may be sent to Broadcast List recipients!'
      );
      assert.ok(
        sentTexts.some(t => t.text.includes('3/3 qof')),
        'Delivery report must confirm 3/3 recipients'
      );
      ok('!podcast inside WhatsApp Broadcast List delivers OggS PTT to all 3 recipients & reports ONLY to Self-Chat');

      // 5b. `!cod <qoraal>` sent inside Broadcast List `1763812345@broadcast`
      sentTexts.length = 0;
      sentMedia.length = 0;
      const codMsg: IncomingMessage = {
        id: 'bc_cod_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '1763812345@broadcast',
        isGroup: false,
        content: '!cod Salaan dhammaan asxaabta, caawa barnaamij cusub baa soo baxaya!',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const codRes = await router.handleIncomingMessage(codMsg, mockTransport);
      assert.strictEqual(codRes.handled, true);
      assert.strictEqual(aiCalledCount, 0, '!cod in Broadcast List must NEVER call Gemini AI Q&A');
      const lastSynthesizedCall = synthesizedCalls[synthesizedCalls.length - 1];
      assert.ok(lastSynthesizedCall, 'VoiceReplyService.synthesizeVoice must be called');
      assert.strictEqual(
        lastSynthesizedCall.text,
        'Salaan dhammaan asxaabta, caawa barnaamij cusub baa soo baxaya!'
      );
      assert.strictEqual(lastSynthesizedCall.options?.speaker, 'mohamed');
      assert.strictEqual(lastSynthesizedCall.options?.humanMaster, true);
      assert.strictEqual(sentMedia.length, 3, 'All 3 recipients must receive Mohamed Voice Note PTT');
      assert.ok(sentTexts.every(t => t.chatId === '252634949642@s.whatsapp.net'));
      assert.ok(sentTexts.some(t => t.text.includes('3/3 qof')));
      ok('!cod <qoraal> inside Broadcast List speaks exact text in Mohamed Human Voice & delivers to all 3 recipients');

      // 5c. Empty Broadcast List fallback (preview + sync guide to Self-Chat, zero crash)
      sentTexts.length = 0;
      sentMedia.length = 0;
      const emptyCodMsg: IncomingMessage = {
        id: 'bc_cod_empty',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '9999999999@broadcast',
        isGroup: false,
        content: '!cod Tijaabo liis cusub',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const emptyRes = await router.handleIncomingMessage(emptyCodMsg, mockTransport);
      assert.strictEqual(emptyRes.handled, true);
      assert.strictEqual(sentMedia.length, 1, 'Preview audio should be delivered to Owner Self-Chat');
      assert.strictEqual(sentMedia[0].chatId, '252634949642@s.whatsapp.net');
      assert.ok(sentTexts.some(t => t.chatId === '252634949642@s.whatsapp.net' && t.text.includes('!bclist add 9999999999@broadcast')));
      ok('Empty Broadcast List delivers preview voice + clear !bclist add sync guide to Owner Self-Chat');

      // 5d. `!bclist add` inside empty Broadcast List registers Somali local + international numbers
      sentTexts.length = 0;
      const addMsg: IncomingMessage = {
        id: 'bc_add_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '9999999999@broadcast',
        isGroup: false,
        content: '!bclist add 0634555555, 252634666666',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const addRes = await router.handleIncomingMessage(addMsg, mockTransport);
      assert.strictEqual(addRes.handled, true);
      const updatedEmpty = mgr.getBroadcastList('9999999999@broadcast');
      assert.strictEqual(updatedEmpty?.recipients.length, 2);
      assert.ok(updatedEmpty?.recipients.includes('252634555555@s.whatsapp.net'));
      assert.ok(updatedEmpty?.recipients.includes('252634666666@s.whatsapp.net'));
      ok('!bclist add registers recipients directly on the active Broadcast List');

      // 5e. `!bc cod` and `!bc podcast` from Owner Self-Chat target Broadcast List cleanly without leaking raw text!
      sentTexts.length = 0;
      sentMedia.length = 0;
      const selfBcCodMsg: IncomingMessage = {
        id: 'self_bc_cod_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '252634949642@s.whatsapp.net',
        isGroup: false,
        content: '!bc cod #1 Salaan VIP ah oo laga soo diray Self-Chat!',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const selfBcRes = await router.handleIncomingMessage(selfBcCodMsg, mockTransport);
      assert.strictEqual(selfBcRes.handled, true);
      assert.ok(sentMedia.length >= 2, '!bc cod from Self-Chat must fan out Mohamed PTT to target Broadcast List');
      assert.ok(sentTexts.every(t => t.chatId === '252634949642@s.whatsapp.net'));
      ok('!bc cod #1 from Owner Self-Chat delivers Mohamed Voice Note to Broadcast List with zero raw command leak');

      // 5f. `!bclist name #1 Ardayda` renames list + persists, and `!bc cod Ardayda ...` targets it by custom name!
      sentTexts.length = 0;
      sentMedia.length = 0;
      const renameMsg: IncomingMessage = {
        id: 'self_bc_rename_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '252634949642@s.whatsapp.net',
        isGroup: false,
        content: '!bclist name #1 Ardayda',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const renameRes = await router.handleIncomingMessage(renameMsg, mockTransport);
      assert.strictEqual(renameRes.handled, true);
      assert.strictEqual(mgr.listBroadcastLists()[0].name, 'Ardayda');

      const namedBcCodMsg: IncomingMessage = {
        id: 'self_bc_named_cod_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '252634949642@s.whatsapp.net',
        isGroup: false,
        content: '!bc cod Ardayda Imtixaanku beri weeye!',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const namedRes = await router.handleIncomingMessage(namedBcCodMsg, mockTransport);
      assert.strictEqual(namedRes.handled, true);
      assert.strictEqual(sentMedia.length, 2, '!bc cod Ardayda must deliver to the 2 members of Ardayda');
      assert.strictEqual(
        synthesizedCalls[synthesizedCalls.length - 1].text,
        'Imtixaanku beri weeye!'
      );
      ok('!bclist name #1 Ardayda renames list & !bc cod Ardayda targets it directly by custom name');

      // 5f-2. Existing multi-word WhatsApp list name ("Asxaabta VIP") works automatically without renaming!
      sentTexts.length = 0;
      sentMedia.length = 0;
      const multiWordMsg: IncomingMessage = {
        id: 'self_bc_multiword_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '252634949642@s.whatsapp.net',
        isGroup: false,
        content: '!bc cod Asxaabta VIP Shirku waa 8-da fiidnimo!',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const multiRes = await router.handleIncomingMessage(multiWordMsg, mockTransport);
      assert.strictEqual(multiRes.handled, true);
      assert.strictEqual(sentMedia.length, 3, '!bc cod Asxaabta VIP must deliver to all 3 members of Asxaabta VIP');
      assert.strictEqual(
        synthesizedCalls[synthesizedCalls.length - 1].text,
        'Shirku waa 8-da fiidnimo!'
      );
      ok('Existing multi-word WhatsApp Broadcast List name ("Asxaabta VIP") works automatically in !bc cod / !bc podcast');

      // 5g. `!bc cod all` fans out across ALL Broadcast Lists with strict deduplication (overlapping member gets it ONCE!)
      // Add overlapping member `252634222222@s.whatsapp.net` to 9999999999@broadcast too (already in 1763812345@broadcast)
      mgr.recordBroadcastListRecipient('9999999999@broadcast', '252634222222@s.whatsapp.net', true);
      sentTexts.length = 0;
      sentMedia.length = 0;
      const allBcMsg: IncomingMessage = {
        id: 'self_bc_all_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '252634949642@s.whatsapp.net',
        isGroup: false,
        content: '!bc cod all Warbixin guud dhammaan 5-ta liis!',
        rawTimestamp: Date.now(),
        isMentioned: true,
        isFromMe: true,
      };
      const allRes = await router.handleIncomingMessage(allBcMsg, mockTransport);
      assert.strictEqual(allRes.handled, true);
      // 1763812345@broadcast has {111, 222, 333}; 9999999999@broadcast has {555, 666, 222} -> 5 unique recipients!
      assert.strictEqual(sentMedia.length, 5, 'All 5 unique recipients across both lists must receive it ONCE');
      assert.strictEqual(new Set(sentMedia.map(m => m.chatId)).size, 5, 'Zero duplicate sends across overlapping lists');
      assert.ok(sentTexts.some(t => t.chatId === '252634949642@s.whatsapp.net' && t.text.includes('5/5 qof')));
      ok('!bc cod all delivers to ALL Broadcast Lists at once with 100% deduplication (5/5 unique recipients)');

      // 5h. Non-command message in Broadcast List must NEVER trigger Gemini AI
      const plainBcMsg: IncomingMessage = {
        id: 'bc_plain_1',
        senderId: '252634949642@s.whatsapp.net',
        chatId: '1763812345@broadcast',
        isGroup: false,
        content: 'Salaan asxaabta',
        rawTimestamp: Date.now(),
        isMentioned: false,
        isFromMe: true,
      };
      const plainRes = await router.handleIncomingMessage(plainBcMsg, mockTransport);
      assert.strictEqual(plainRes.handled, false);
      assert.strictEqual(aiCalledCount, 0);
      ok('Plain non-command messages inside Broadcast Lists never accidentally trigger Gemini AI');
    } finally {
      (VoiceReplyService as any).synthesizeVoice = origSynth;
      (VoiceReplyService as any).getCardosoPromoVoiceNote = origPromo;
      mgr.setSocket(null);
      mgr.stopAutonomousGovernorLoop();
    }
  } finally {
    fs.rmSync(tmpAuthDir, { recursive: true, force: true });
  }

  console.log(`\n🎉 ALL HUMAN VOICE & BROADCAST LIST TESTS PASSED (${passed}/${passed})!\n`);
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ HUMAN VOICE & BROADCAST LIST TEST FAILED:', err);
    process.exit(1);
  });
