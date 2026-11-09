import { EmotionDetector } from '../src/advisor/emotion-detector.js';
import { UserProfiler } from '../src/services/user-profiler.service.js';
import { PromptBuilder } from '../src/advisor/prompt-builder.js';

export async function runHumanPersonaTests(): Promise<{ passed: boolean; message: string }> {
  console.log('\n========================================');
  console.log('RUNNING TEST SUITE: Human-Like WhatsApp Persona & Empathy Tests');
  console.log('========================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name}`);
      failed++;
    }
  }

  // 1. Emoji & Sickness detection
  const sickResult1 = EmotionDetector.detect('Waan xanuunsanahay madaxaa i xanuunaya');
  assert(sickResult1.tone === 'sick', 'Detects Somali sickness words as "sick" emotion');

  const sickResult2 = EmotionDetector.detect('Xaaladaydu ma fiicna 🤒🤕');
  assert(sickResult2.tone === 'sick', 'Detects sick emojis (🤒🤕) as "sick" emotion');

  // 2. Somali insults & rude words detection
  const angryResult1 = EmotionDetector.detect('Nacas baad tahay doqon yahow');
  assert(angryResult1.tone === 'angry', 'Detects Somali insults (nacas, doqon) as "angry" tone');

  const angryResult2 = EmotionDetector.detect('Adigaa waalan naga aamus 😡');
  assert(angryResult2.tone === 'angry', 'Detects rude banter and angry emoji as "angry" tone');

  // 3. Gender detection
  const genderMale1 = UserProfiler.detectGender('Mohamed Dahir');
  assert(genderMale1 === 'male', 'Detects male gender from name "Mohamed"');

  const genderFemale1 = UserProfiler.detectGender('Fadumo Ahmed');
  assert(genderFemale1 === 'female', 'Detects female gender from name "Fadumo"');

  const genderFemaleCue = UserProfiler.detectGender(undefined, 'Abaayo sidee wax yihiin?');
  assert(genderFemaleCue === 'female', 'Detects female gender from linguistic cue "abaayo"');

  const genderMaleCue = UserProfiler.detectGender(undefined, 'Ninyahow ii waran saaka');
  assert(genderMaleCue === 'male', 'Detects male gender from linguistic cue "ninyahow"');

  // 4. PromptBuilder Verification
  const systemInstruction = PromptBuilder.buildSystemInstruction({
    detectedLanguage: 'so',
    userName: 'Khadra Cali',
    userGender: 'female',
    emotionResult: sickResult1,
  });

  assert(systemInstruction.includes('Khadra Cali'), 'System instruction includes WhatsApp contact name');
  assert(systemInstruction.includes('FEMALE (Naag / Gabadh)'), 'System instruction sets female address rules');
  assert(systemInstruction.includes('kiniin laq ama dawo cun haku dhihin'), 'System instruction strictly forbids prescribing pills');
  assert(systemInstruction.includes('SOMALI BANTER & WITTY COMEBACKS'), 'System instruction includes Somali banter/comebacks rule');
  assert(systemInstruction.includes('WHATSAPP OWNER PROXY'), 'System instruction includes owner proxy representation');

  console.log('----------------------------------------');
  console.log(`Suite Summary: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------\n');

  return { passed: failed === 0, message: `${passed} passed, ${failed} failed` };
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('human-persona.test.ts')) {
  runHumanPersonaTests().then(res => {
    if (!res.passed) process.exit(1);
  });
}

