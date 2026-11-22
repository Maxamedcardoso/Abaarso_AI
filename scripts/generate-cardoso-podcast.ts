import fs from 'fs';
import path from 'path';
import { DEFAULT_CARDOSO_PROMO_DIALOGUE, VoiceReplyService } from '../src/services/voice-reply.service.js';

async function main() {
  const outDir = path.join(process.cwd(), 'assets', 'audio');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('🎧 Generating CARDOSO AI Promo Podcast (Muuse + Ubax Somali Neural Voices)...');

  const mp3 = await VoiceReplyService.synthesizeSomaliDialogue(DEFAULT_CARDOSO_PROMO_DIALOGUE, {
    outputFormat: 'mp3',
    defaultPauseMs: 300,
  });
  if (!mp3) {
    throw new Error('Failed to generate MP3 podcast');
  }
  const mp3Path = path.join(outDir, 'cardoso-ai-muuse-ubax-promo.mp3');
  fs.writeFileSync(mp3Path, mp3.buffer);
  console.log(`✅ MP3 saved: ${mp3Path} (${(mp3.buffer.length / 1024).toFixed(1)} KB, ${mp3.turnCount} turns)`);

  // Convert the already-stitched MP3 directly to WhatsApp-native OGG Opus (2x faster!)
  const oggBuf = await VoiceReplyService.convertMediaToOggOpusStrict(mp3.buffer);
  const oggPath = path.join(outDir, 'cardoso-ai-muuse-ubax-promo.ogg');
  fs.writeFileSync(oggPath, oggBuf);
  console.log(`✅ WhatsApp OGG Voice Note saved: ${oggPath} (${(oggBuf.length / 1024).toFixed(1)} KB, OggS verified)`);
}

main().catch((err) => {
  console.error('❌ Podcast generation failed:', err);
  process.exit(1);
});
