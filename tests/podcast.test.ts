import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import {
  VoiceReplyService,
  generateSpeechWaveform,
  getOggOpusDurationSeconds,
  normalizePodcastSpeaker,
} from '../src/services/voice-reply.service.js';
import {
  createAmbientPadWav,
  createStudioChimeWav,
  decodeTrimmedMonoPcm48k,
  encodePcmWav,
  generatePodcastCoverPng,
  mixHumanPodcastTimeline,
  splitAudioIntoVoiceStatusClips,
} from '../src/services/podcast-studio.service.js';
import { WhatsAppManagerService } from '../src/services/whatsapp-manager.service.js';
import { renderPwaAppHTML } from '../src/web/views/app-page.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { QuotaTracker } from '../src/ai/quota-tracker.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { config } from '../src/config/env.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function createToneWav(freqHz: number, durationSec: number = 0.6, sampleRate: number = 24000): Buffer {
  const n = Math.round(sampleRate * durationSec);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = 0.25 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return encodePcmWav(samples, sampleRate);
}

async function runPodcastTests(): Promise<void> {
  console.log('\n🧪 Running Safa & Mohamed World-Class Podcast Studio V2 Test Suite...\n');

  // 1. Host renaming (Safa & Mohamed) + legacy alias compatibility + emotion tag extraction
  assert(!VoiceReplyService.isExplicitDialogueScript("faa'iidada waxbarashada"), 'Single topic must NOT be treated as script');
  assert(
    VoiceReplyService.isExplicitDialogueScript('Safa: [excited] Asc Mohamed!\nMohamed: [laugh] Wcs Safa!'),
    'Safa/Mohamed lines must be detected as explicit dialogue script'
  );
  const parsed = VoiceReplyService.parseDialogueScript(
    'Safa: [laugh] Haa-haa war Mohamed!\nMohamed: [debate] Maya Safa, bal i dhagayso!\nUbax: Sidee tahay?\nMuuse: Waan fiicanahay!'
  );
  assert(parsed.length === 4, 'Should parse 4 turns');
  assert(
    parsed[0].speaker === 'safa' &&
      parsed[0].emotion === 'laugh' &&
      !parsed[0].text.includes('[laugh]'),
    'Safa turn must extract [laugh] emotion and strip bracketed tag'
  );
  assert(
    parsed[1].speaker === 'mohamed' && parsed[1].emotion === 'debate',
    'Mohamed turn must extract [debate] emotion'
  );
  assert(
    normalizePodcastSpeaker(parsed[2].speaker) === 'safa' &&
      normalizePodcastSpeaker(parsed[3].speaker) === 'mohamed',
    'Legacy Ubax/Muuse aliases must normalize cleanly to safa/mohamed'
  );
  console.log('  ✅ PASS: Safa & Mohamed host mapping, legacy aliases & emotion extraction verified');

  // 2. Command parser: Title + Minutes + Styles + Video + URL
  const c1 = VoiceReplyService.parsePodcastCommandArgs('Jacaylka iyo Lacagta 3min');
  assert(c1.topic === 'Jacaylka iyo Lacagta' && c1.durationMinutes === 3 && c1.style === 'debate', `Unexpected c1: ${JSON.stringify(c1)}`);

  const c2 = VoiceReplyService.parsePodcastCommandArgs('study Barashada Python 4 daqiiqo');
  assert(c2.topic === 'Barashada Python' && c2.durationMinutes === 4 && c2.style === 'study', `Unexpected c2: ${JSON.stringify(c2)}`);

  const c3 = VoiceReplyService.parsePodcastCommandArgs('diini Sabirka iyo Dulqaadka 2');
  assert(c3.topic === 'Sabirka iyo Dulqaadka' && c3.durationMinutes === 2 && c3.style === 'diini' && c3.soundMode === 'clean', `Unexpected c3: ${JSON.stringify(c3)}`);

  const c4 = VoiceReplyService.parsePodcastCommandArgs('video Ganacsiga Online 1m');
  assert(c4.topic === 'Ganacsiga Online' && c4.durationMinutes === 1 && c4.outputKind === 'video', `Unexpected c4: ${JSON.stringify(c4)}`);

  const c5 = VoiceReplyService.parsePodcastCommandArgs('https://example.com/somalia-ai 2m');
  assert(c5.sourceUrl === 'https://example.com/somalia-ai' && c5.durationMinutes === 2, `Unexpected c5: ${JSON.stringify(c5)}`);

  const c6 = VoiceReplyService.parsePodcastCommandArgs('status Ganacsiga Online 1m');
  assert(c6.postToStatus === true && c6.topic === 'Ganacsiga Online' && c6.durationMinutes === 1, `Unexpected c6: ${JSON.stringify(c6)}`);

  const c7 = VoiceReplyService.parsePodcastCommandArgs('status video Jacaylka 45s');
  assert(c7.postToStatus === true && c7.outputKind === 'video' && c7.topic === 'Jacaylka', `Unexpected c7: ${JSON.stringify(c7)}`);
  console.log('  ✅ PASS: !podcast command parser handles minutes (1-5m), 5 styles, video, status & URLs');

  // 3. Sleek Broadcast Teaser (NO boring waiting boilerplate, Safa & Mohamed names!)
  const teaser = VoiceReplyService.buildPodcastTeaserMessage({
    topic: 'Ganacsiga Online-ka',
    style: 'debate',
    durationMinutes: 3,
    outputKind: 'ogg',
  });
  assert(teaser.includes('Safa & Mohamed'), 'Teaser must name Safa & Mohamed');
  assert(teaser.includes('Goor dhow la soco'), 'Teaser must include radio broadcast teaser "Goor dhow la soco"');
  assert(teaser.includes('3 daqiiqo'), 'Teaser must display requested duration');
  assert(!teaser.toLowerCase().includes('fadlan sug'), 'Teaser must NOT include boring "Fadlan sug" boilerplate');
  assert(!teaser.includes('Muuse') && !teaser.includes('Ubax'), 'Teaser must NOT use legacy Muuse/Ubax names');
  console.log('  ✅ PASS: Sleek radio broadcast teaser verified ("Goor dhow la soco", Safa & Mohamed)');

  // 4. AI topic generator (with minute scaling) + Gender/Comparison side-taking + collapsed-line recovery
  let capturedPrompt = '';
  let capturedSystem = '';
  const mockAi = {
    generateResponse: async (prompt: string, _h?: any[], opts?: any) => {
      capturedPrompt = prompt;
      capturedSystem = String(opts?.systemInstruction || '');
      // Intentionally simulate markdown bolding + single-line collapsed response to prove parser resilience!
      return {
        text:
          '**Safa:** [excited] Assalaamu calaykum Mohamed! Maanta dooddu waa Ragga iyo Dumarka ayaa khiyaano badan — raggaa ku horreeya! ' +
          '**Mohamed:** [laugh] Wa calaykumus salaam Safa! Haa-haa maya walaal, dumarkaa ka qarsoon! ' +
          'Safa: [debate] War Mohamed beenta jooji, bulshada Soomaalida eeg! ' +
          'Mohamed: [debate] Sug sug Safa ha caroonin, tusaale nool baan kuu hayaa! ' +
          'Safa: [backchannel] Haa-haa waa been! ' +
          'Mohamed: [calm] Dhageystayaasha ha kala saareen maanta!',
      };
    },
  };
  const aiTurns = await VoiceReplyService.generateTopicDialogueTurns('Ragga iyo Dumarka ayaa khiyaano badan', mockAi, {
    style: 'debate',
    durationMinutes: 3,
  });
  assert(capturedPrompt.includes('3 daqiiqo'), 'AI prompt must pass requested minutes');
  assert(
    capturedSystem.includes('U DOODDAA DUMARKA') && capturedSystem.includes('U DOODAA RAGGA'),
    'Gender debate must instruct Safa to defend Women and Mohamed to defend Men'
  );
  assert(
    aiTurns.length === 6 && aiTurns[0].speaker === 'safa' && aiTurns[1].speaker === 'mohamed',
    `Collapsed/bolded AI output must still parse cleanly into 6 Safa/Mohamed turns, got ${aiTurns.length}`
  );

  const genderCtx = VoiceReplyService.detectPodcastDebateContext('Ragga iyo Dumarka ayaa khiyaano badan');
  assert(genderCtx.isGenderDebate === true, 'Must detect Men vs Women debate');

  const cmpCtx = VoiceReplyService.detectPodcastDebateContext('Jacaylka iyo Lacagta midkee muhiimsan');
  assert(cmpCtx.isComparison === true && cmpCtx.safaSide === 'Jacaylka' && cmpCtx.mohamedSide === 'Lacagta', `Comparison sides mismatch: ${JSON.stringify(cmpCtx)}`);

  const genderFallback = await VoiceReplyService.generateTopicDialogueTurns('Ragga iyo Dumarka ayaa khiyaano badan', undefined, {
    style: 'debate',
    durationMinutes: 2,
  });
  assert(
    genderFallback.length >= 10 &&
      genderFallback.some((t) => t.speaker === 'safa' && /rag/i.test(t.text)) &&
      genderFallback.some((t) => t.speaker === 'mohamed' && /dumar|gabadh/i.test(t.text)),
    'Gender fallback must have Safa arguing against men and Mohamed arguing against women on the real topic'
  );

  const fallbackLong = await VoiceReplyService.generateTopicDialogueTurns('waxbarashada', undefined, {
    style: 'debate',
    durationMinutes: 3,
  });
  assert(fallbackLong.length >= 11, `3-min fallback should expand depth (>=11 turns), got ${fallbackLong.length}`);
  assert(fallbackLong.every((t) => t.speaker === 'safa' || t.speaker === 'mohamed'), 'Fallback must use Safa & Mohamed exclusively');
  console.log('  ✅ PASS: AI dialogue writer (newline-safe, gender/comparison side-taking & topic lock) verified');

  // 5. Pure-Node Studio Chime, Ambient Pad, Cover PNG + Silence Trimming + Real Human Voice Overlap + Room Tone + FFmpeg Mastering & Video!
  const introWav = createStudioChimeWav('intro');
  const ambientWav = createAmbientPadWav(4);
  const coverPng = generatePodcastCoverPng(540, 960);
  assert(introWav.slice(0, 4).toString('ascii') === 'RIFF', 'Intro chime must be valid WAV');
  assert(ambientWav.slice(0, 4).toString('ascii') === 'RIFF', 'Ambient pad must be valid WAV');
  assert(coverPng.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Studio cover must be valid PNG');

  // Verify leading/trailing dead TTS silence trimming (0.4s dead silence + 0.5s tone + 0.4s dead silence -> ~0.5s!)
  const sr = 24000;
  const paddedSamples = new Float32Array(Math.round(sr * 1.3));
  for (let i = Math.round(sr * 0.4); i < Math.round(sr * 0.9); i++) {
    paddedSamples[i] = 0.3 * Math.sin((2 * Math.PI * 300 * i) / sr);
  }
  const trimmedPcm = await decodeTrimmedMonoPcm48k(encodePcmWav(paddedSamples, sr));
  const trimmedSec = trimmedPcm.length / 48000;
  assert(trimmedSec >= 0.35 && trimmedSec <= 0.72, `Expected dead silence trimmed to ~0.5s, got ${trimmedSec.toFixed(2)}s`);

  // Verify real human voice overlap (-135..-210ms) + per-turn prosody jitter
  const p0 = VoiceReplyService.prosodyForEmotion('debate', 0);
  const p1 = VoiceReplyService.prosodyForEmotion('debate', 1);
  assert(p0.rate !== p1.rate || p0.pitch !== p1.pitch, 'Per-turn micro-prosody jitter should vary across turns');

  const segA = new Float32Array(48000); // 1.0s
  const segB = new Float32Array(48000); // 1.0s
  segA.fill(0.15);
  segB.fill(0.15);
  const mixedOverlap = mixHumanPodcastTimeline(
    [
      { speaker: 'safa', emotion: 'excited', samples: segA },
      { speaker: 'mohamed', emotion: 'debate', samples: segB },
      { speaker: 'safa', emotion: 'backchannel', samples: segA.subarray(0, 24000) },
    ],
    { isStereo: true, soundMode: 'clean' }
  );
  assert(mixedOverlap.overlapCount === 2, `Expected 2 real human voice overlaps (debate + backchannel), got ${mixedOverlap.overlapCount}`);
  assert(mixedOverlap.wavBuffer.length > 1000, 'Mixed timeline WAV must be valid');
  console.log(`  ✅ PASS: TTS silence trimming (${trimmedSec.toFixed(2)}s), real voice overlap (${mixedOverlap.overlapCount}x), room tone & prosody jitter verified`);

  // Temporarily stub Edge TTS single attempt with pure-Node synthetic WAV so FFmpeg Mastering + Video Audiogram run 100% offline!
  const origAttempt = (VoiceReplyService as any).synthesizeSingleAttempt;
  (VoiceReplyService as any).synthesizeSingleAttempt = async (_clean: string, voiceName: string) => ({
    buffer: createToneWav(voiceName.includes('Ubax') ? 340 : 210, 0.55),
    mimeType: 'audio/wav',
  });

  try {
    const mp3Mastered = await VoiceReplyService.synthesizeSomaliDialogue(aiTurns.slice(0, 4), {
      outputFormat: 'mp3',
      soundMode: 'ambient',
      masterAudio: true,
    });
    assert(mp3Mastered && mp3Mastered.buffer.length > 4000, 'Mastered stereo MP3 must be non-trivial');
    assert(mp3Mastered!.transcript.includes('Safa:') && mp3Mastered!.transcript.includes('Mohamed:'), 'Result must include formatted Safa & Mohamed transcript');

    const oggMastered = await VoiceReplyService.synthesizeSomaliDialogue(aiTurns.slice(0, 4), {
      outputFormat: 'ogg',
      soundMode: 'chime',
      masterAudio: true,
    });
    assert(oggMastered && oggMastered.buffer.slice(0, 4).toString('ascii') === 'OggS', 'Mastered WhatsApp PTT must be valid OggS Opus');
    assert(oggMastered!.waveform.length === 64, 'Mastered PTT must include 64-bar waveform');

    const mp4Video = await VoiceReplyService.renderPodcastVideoAudiogram(mp3Mastered!.buffer, {
      title: 'Ganacsiga Online-ka',
      styleLabel: 'SAFA & MOHAMED STUDIO',
    });
    assert(mp4Video.length > 8000 && mp4Video.subarray(4, 8).toString('ascii') === 'ftyp', 'Video Audiogram must be a valid MP4 (ftyp header)');
    console.log(
      `  ✅ PASS: Real FFmpeg Studio Mastering (MP3 ${(mp3Mastered!.buffer.length / 1024).toFixed(1)}KB, OGG ${(oggMastered!.buffer.length / 1024).toFixed(1)}KB) & 9:16 Video Audiogram MP4 (${(mp4Video.length / 1024).toFixed(1)}KB) verified`
    );
  } finally {
    (VoiceReplyService as any).synthesizeSingleAttempt = origAttempt;
  }

  // 6. /app PWA Podcast Studio UI syntax validation
  const appHtml = renderPwaAppHTML({ botName: 'CARDOSO AI' });
  const scripts = [...appHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert(scripts.length >= 1, '/app must contain client script');
  for (let i = 0; i < scripts.length; i++) {
    new vm.Script(scripts[i][1], { filename: `app-podcast-script-${i}.js` });
  }
  assert(appHtml.includes('Safa &amp; Mohamed Podcast Studio'), '/app must show Safa & Mohamed Podcast Studio');
  assert(appHtml.includes('podcastDurationSelect') && appHtml.includes('podcastStyleSelect'), '/app must expose duration & style selectors');
  console.log('  ✅ PASS: /app Safa & Mohamed Podcast Studio UI & inline JS syntax verified');

  // 7. Router `!podcast` delivers sleek Safa & Mohamed teaser + playable WhatsApp PTT Voice Note
  const promoOggCandidates = [
    path.join(process.cwd(), 'assets', 'audio', 'cardoso-ai-safa-mohamed-promo.ogg'),
    path.join(process.cwd(), 'assets', 'audio', 'cardoso-ai-muuse-ubax-promo.ogg'),
  ];
  const existingPromo = promoOggCandidates.find((p) => fs.existsSync(p));
  if (existingPromo) {
    const oggBuf = fs.readFileSync(existingPromo);
    assert(oggBuf.slice(0, 4).toString('ascii') === 'OggS', 'Prebuilt promo must start with OggS');
    const sec = getOggOpusDurationSeconds(oggBuf);
    const wf = generateSpeechWaveform(oggBuf);
    assert(sec >= 20 && wf.length === 64, 'Prebuilt promo duration & waveform valid');

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
      assert(sentTexts.length >= 1 && sentTexts[0].includes('Safa & Mohamed') && sentTexts[0].includes('Goor dhow la soco'), 'Router must send sleek Safa & Mohamed teaser');
      assert(sentAudios.length === 1, '!podcast must send 1 Voice Note');
      const vn = sentAudios[0];
      assert(vn.type === 'audio' && vn.ptt === true, 'Must be sent as WhatsApp PTT Voice Note');
      assert(vn.mimeType === 'audio/ogg; codecs=opus', 'Must use audio/ogg; codecs=opus');
      assert(vn.fileName === undefined, 'PTT Voice Note must NOT set fileName');
      assert(vn.dataBuffer.slice(0, 4).toString('ascii') === 'OggS', 'Voice Note buffer must be valid OggS Opus');
      assert(typeof vn.seconds === 'number' && vn.seconds >= 20, `Exact duration expected, got ${vn.seconds}`);
      assert(vn.waveform instanceof Uint8Array && vn.waveform.length === 64, '64-bar waveform expected');
      console.log(`  ✅ PASS: Router !podcast sends sleek teaser + authentic PTT Voice Note (${vn.seconds}s, OggS, waveform)`);

      // 8. Voice Status splitting (>55s) + authentic Ogg Opus Voice Status posting to status@broadcast
      const clips = await splitAudioIntoVoiceStatusClips(oggBuf, sec, 55);
      assert(clips.length >= 2, `Expected 109s promo to split into >=2 Voice Status clips, got ${clips.length}`);
      assert(clips.every((c) => c.slice(0, 4).toString('ascii') === 'OggS'), 'Every split Voice Status clip must be valid OggS');

      const statusMgr = new WhatsAppManagerService({
        authDir: path.join(tmpDir, 'status_auth'),
        statusStoragePath: path.join(tmpDir, 'statuses.json'),
        adminPhones: ['252634949642'],
      });
      const statusCalls: any[] = [];
      statusMgr.setSocket({
        user: { id: '252634949642:1@s.whatsapp.net' },
        sendMessage: async (jid: string, payload: any, opts: any) => {
          statusCalls.push({ jid, payload, opts });
          return { key: { id: `st_${statusCalls.length}` } };
        },
      } as any);

      const postedSeries = await statusMgr.postVoiceStatusSeries(clips[0], {
        caption: 'CARDOSO AI Safa & Mohamed',
      });
      assert(postedSeries.success === true && postedSeries.partsPosted === 1, 'Voice Status series should post cleanly');
      assert(statusCalls.length === 1 && statusCalls[0].jid === 'status@broadcast', 'Must dispatch to status@broadcast');
      const sp = statusCalls[0].payload;
      assert(sp.mimetype === 'audio/ogg; codecs=opus' && sp.ptt === true, 'Voice Status must use audio/ogg; codecs=opus & ptt: true');
      assert(typeof sp.seconds === 'number' && sp.seconds >= 10 && sp.waveform instanceof Uint8Array && sp.waveform.length === 64, 'Voice Status must include exact seconds & 64-bar waveform');
      assert(typeof sp.backgroundColor === 'string' && sp.backgroundColor.startsWith('#'), 'Voice Status must include backgroundColor');
      statusMgr.stopAutonomousGovernorLoop();
      console.log(`  ✅ PASS: Voice Status auto-splits long podcasts (${clips.length}x <=55s) & posts valid OggS PTT + waveform + color to status@broadcast`);
    } finally {
      await memory.close?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log('\n🎉 All Safa & Mohamed World-Class Podcast Studio V2 tests passed!\n');
}

runPodcastTests().catch((err) => {
  console.error('❌ Podcast Test Suite Failed:', err);
  process.exit(1);
});
