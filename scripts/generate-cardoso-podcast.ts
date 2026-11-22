import fs from 'fs';
import path from 'path';
import { DEFAULT_CARDOSO_PROMO_DIALOGUE, VoiceReplyService } from '../src/services/voice-reply.service.js';

async function main() {
  const outDir = path.join(process.cwd(), 'assets', 'audio');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('🎧 Generating World-Class CARDOSO AI Promo Podcast (Safa + Mohamed Studio Mastered)...');

  const mp3 = await VoiceReplyService.synthesizeSomaliDialogue(DEFAULT_CARDOSO_PROMO_DIALOGUE, {
    outputFormat: 'mp3',
    defaultPauseMs: 200,
    soundMode: 'chime',
    masterAudio: true,
  });
  if (!mp3) {
    throw new Error('Failed to generate MP3 podcast');
  }
  const mp3Path = path.join(outDir, 'cardoso-ai-safa-mohamed-promo.mp3');
  fs.writeFileSync(mp3Path, mp3.buffer);
  console.log(`✅ Stereo Studio MP3 saved: ${mp3Path} (${(mp3.buffer.length / 1024).toFixed(1)} KB, ${mp3.turnCount} turns, ~${mp3.seconds}s)`);

  // Convert to authentic WhatsApp OGG Opus PTT Voice Note
  const oggBuf = await VoiceReplyService.convertMediaToOggOpusStrict(mp3.buffer);
  const oggPath = path.join(outDir, 'cardoso-ai-safa-mohamed-promo.ogg');
  fs.writeFileSync(oggPath, oggBuf);
  console.log(`✅ WhatsApp OGG Voice Note saved: ${oggPath} (${(oggBuf.length / 1024).toFixed(1)} KB, OggS verified)`);
}

main().catch((err) => {
  console.error('❌ Podcast generation failed:', err);
  process.exit(1);
});
