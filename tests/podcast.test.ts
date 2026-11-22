import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  VoiceReplyService,
  generateSpeechWaveform,
  getOggOpusDurationSeconds,
} from '../src/services/voice-reply.service.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { config } from '../src/config/env.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function runPodcastTests(): Promise<void> {
  console.log('\n🧪 Running Muuse & Ubax WhatsApp Voice Note (!podcast) Test Suite...\n');

  // 1. Script vs Topic detection
  assert(
    !VoiceReplyService.isExplicitDialogueScript("faa'iidada waxbarashada"),
    'Single topic line must be detected as a Topic, NOT an explicit script'
  );
  assert(
    VoiceReplyService.isExplicitDialogueScript('Ubax: Asc Muuse\nMuuse: Wcs Ubax'),
    'Labeled Ubax/Muuse lines must be detected as explicit dialogue script'
  );

  // 2. Parse dialogue script with alternating Somali voices
  const parsed = VoiceReplyService.parseDialogueScript('Ubax: Asc Muuse!\nMuuse: Wcs Ubax!\nGabadh: Sidee tahay?');
  assert(parsed.length === 3, 'Should parse 3 turns');
  assert(parsed[0].speaker === 'ubax' && parsed[1].speaker === 'muuse' && parsed[2].speaker === 'ubax', 'Speaker mapping must match');
  console.log('  ✅ PASS: Topic vs script detection & Muuse/Ubax speaker parsing verified');

  // 3. Topic dialogue generation via AI mock & zero-quota fallback
  const mockAi = {
    generateResponse: async () => ({
      text: [
        'Ubax: Assalaamu calaykum Muuse! Maanta maxaan ka baranaynaa ganacsiga online-ka?',
        'Muuse: Wa calaykumus salaam Ubax! Ganacsiga online-ku waa fursad weyn oo qof walba taleefankiisa ka bilaabi karo.',
        'Ubax: Alla waa runtaa! Oo maxaa ugu muhiimsan marka la bilaabayo?',
        'Muuse: Inaad doorato badeecad dadku u baahan yihiin oo aad si daacad ah ugu adeegto macaamiisha.',
      ].join('\n'),
    }),
  };
  const aiTurns = await VoiceReplyService.generateTopicDialogueTurns('ganacsiga online-ka', mockAi);
  assert(aiTurns.length === 4 && aiTurns[0].speaker === 'ubax' && aiTurns[1].speaker === 'muuse', 'AI topic dialogue should generate alternating Ubax/Muuse turns');

  const fallbackTurns = await VoiceReplyService.generateTopicDialogueTurns('waxbarashada', undefined);
  assert(fallbackTurns.length >= 6 && fallbackTurns.some((t) => t.text.includes('waxbarashada')), 'Fallback topic dialogue should discuss the topic cleanly');
  console.log('  ✅ PASS: AI topic dialogue generator & offline fallback verified');

  // 4. Real OggS duration parser & 64-byte waveform generator against generated promo file (if present)
  const promoOggPath = path.join(process.cwd(), 'assets', 'audio', 'cardoso-ai-muuse-ubax-promo.ogg');
  if (fs.existsSync(promoOggPath)) {
    const oggBuf = fs.readFileSync(promoOggPath);
    assert(oggBuf.slice(0, 4).toString('ascii') === 'OggS', 'Prebuilt promo must start with OggS magic header');
    const sec = getOggOpusDurationSeconds(oggBuf);
    assert(sec >= 30 && sec <= 240, `Prebuilt promo duration should be realistic (30..240s), got ${sec}s`);
    const wf = generateSpeechWaveform(oggBuf);
    assert(wf.length === 64 && wf.every((v) => v >= 10 && v <= 96), 'Waveform must be 64 valid bars');
    console.log(`  ✅ PASS: Prebuilt Ogg Opus Voice Note verified (${sec}s, OggS, 64-bar waveform)`);
  }

  // 5. Router `!podcast` (no args) -> sends playable PTT Voice Note (ptt: true, OggS, seconds, waveform, NO fileName!)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-pod-test-'));
  const memory = new SQLiteStudentMemory(path.join(tmpDir, 'pod.db'));
  await memory.initialize();
  try {
    const testConfig = { ...config, security: { ...config.security, adminPhoneNumbers: ['252634949642'] } };
    const ai = new AIOrchestrator(testConfig, new QuotaTracker(100, 14), 'fake');
    const engine = new StudentAdvisorEngine(memory, ai);
    const router = new MessageRouter(engine, testConfig, undefined, undefined, memory, { tenantId: 'owner' });

    const sentAudios: any[] = [];
    const sentTexts: string[] = [];
    const mockTransport: any = {
      name: 'mock',
      isConnected: true,
      sendMessage: async (_chatId: string, t: string) => {
        sentTexts.push(t);
        return true;
      },
      sendMedia: async (_chatId: string, media: any) => {
        sentAudios.push(media);
        return true;
      },
    };

    if (fs.existsSync(promoOggPath)) {
      const res = await router.handleIncomingMessage(
        {
          id: 'pod_cmd_1',
          senderId: '252634949642@s.whatsapp.net',
          senderPhone: '252634949642',
          chatId: '252634949642@s.whatsapp.net',
          isGroup: false,
          content: '!podcast',
          rawTimestamp: Date.now(),
          isMentioned: false,
          isFromMe: true,
        },
        mockTransport
      );
      assert(res.handled === true, '!podcast must be handled');
      assert(sentAudios.length === 1, '!podcast must send 1 Voice Note');
      const vn = sentAudios[0];
      assert(vn.type === 'audio' && vn.ptt === true, 'Must be sent as WhatsApp PTT Voice Note (ptt: true)');
      assert(vn.mimeType === 'audio/ogg; codecs=opus', 'Must use audio/ogg; codecs=opus');
      assert(vn.fileName === undefined, 'PTT Voice Note must NOT set fileName (prevents generic audio file rendering)');
      assert(vn.dataBuffer.slice(0, 4).toString('ascii') === 'OggS', 'Voice Note buffer must be valid OggS Opus');
      assert(typeof vn.seconds === 'number' && vn.seconds >= 30, `Voice Note must include exact duration, got ${vn.seconds}`);
      assert(vn.waveform instanceof Uint8Array && vn.waveform.length === 64, 'Voice Note must include 64-byte waveform');
      console.log(`  ✅ PASS: Router !podcast delivers authentic WhatsApp PTT Voice Note (${vn.seconds}s, OggS, waveform)`);
    }

    console.log('\n🎉 All Muuse & Ubax Podcast Voice Note tests passed!\n');
  } finally {
    await memory.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runPodcastTests().catch((err) => {
  console.error('❌ Podcast Test Suite Failed:', err);
  process.exit(1);
});
