import {
  AbaarsoAdService,
  ABAARSO_VOICE_AD_SCRIPT,
  ABAARSO_REGISTRATION_TEXT,
  ABAARSO_DEGREE_PROGRAMS,
  ABAARSO_ADMISSION_INFO,
  ABAARSO_SCREENING_QUESTION,
} from '../src/services/abaarso-ad.service.js';
import { AcademicAdvisor } from '../src/advisor/academic-advisor.js';
import { IMessagingTransport, IncomingMessage, OutgoingMedia, OutgoingMessageOptions } from '../src/transports/transport.interface.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { PromptBuilder } from '../src/advisor/prompt-builder.js';

class MockTransport implements IMessagingTransport {
  public name = 'mock';
  public isConnected = true;
  public sentMessages: Array<{ chatId: string; text: string; options?: OutgoingMessageOptions }> = [];
  public sentMedia: Array<{ chatId: string; media: OutgoingMedia; options?: OutgoingMessageOptions }> = [];
  public failMedia: boolean = false;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async sendMessage(chatId: string, text: string, options?: OutgoingMessageOptions): Promise<boolean> {
    this.sentMessages.push({ chatId, text, options });
    return true;
  }

  async sendMedia(chatId: string, media: OutgoingMedia, options?: OutgoingMessageOptions): Promise<boolean> {
    if (this.failMedia) return false;
    this.sentMedia.push({ chatId, media, options });
    return true;
  }

  onMessage(handler: (message: IncomingMessage) => Promise<void>): void {}
}

export async function runAbaarsoTests(): Promise<void> {
  console.log('🧪 Starting Abaarso AI Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(`  ✅ ${description}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${description}`);
      failed++;
    }
  }

  // 1. Degree Programs
  console.log('1. Official Degree Programs Knowledge Base');
  assert(ABAARSO_DEGREE_PROGRAMS.length === 15, 'Exactly 15 degree programs');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Software Engineering'), 'Includes Software Engineering');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Clinical Nursing'), 'Includes Clinical Nursing');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Midwifery'), 'Includes Midwifery');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Medical Laboratory Sciences'), 'Includes Medical Laboratory Sciences');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Nutrition and Food Sciences'), 'Includes Nutrition and Food Sciences');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Arts in Accounting and Finance (BAF)'), 'Includes BAF');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Business Administration'), 'Includes Business Administration');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Human Resource Management'), 'Includes HRM');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Islamic Banking and Finance'), 'Includes Islamic Banking');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Social Work (BSW)'), 'Includes BSW');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Laws (LLB)'), 'Includes LLB');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor in Informational and Communications Technologies'), 'Includes ICT');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Logistics and Procurement'), 'Includes Logistics');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Business Management and Economics'), 'Includes Economics');
  assert(ABAARSO_DEGREE_PROGRAMS.includes('Bachelor of Development Studies'), 'Includes Development Studies');

  // 2. Official Admission Details
  console.log('\n2. Official Admission Details');
  assert(ABAARSO_ADMISSION_INFO.campus.includes('Berbera'), 'Campus is Berbera');
  assert(ABAARSO_ADMISSION_INFO.academicYear === '2026/2027', 'Academic year is 2026/2027');
  assert(ABAARSO_ADMISSION_INFO.morningHours.includes('8:00 AM – 12:00 PM'), 'Morning hours 8am-12pm');
  assert(ABAARSO_ADMISSION_INFO.afternoonHours.includes('4:00 PM – 8:00 PM'), 'Afternoon hours 4pm-8pm');
  assert(ABAARSO_ADMISSION_INFO.physicalLocation.includes('Fooqa Kayd'), 'Location includes Fooqa Kayd');
  assert(ABAARSO_ADMISSION_INFO.physicalLocation.includes('Caynu-Raxma'), 'Location includes Caynu-Raxma');
  assert(ABAARSO_ADMISSION_INFO.onlineRegistrationLink.includes('docs.google.com/forms'), 'Online link is Google Forms link');

  // 3. Advertisement Voice Script and Follow-up Registration Link
  console.log('\n3. Official Advertisement Script and Registration Link Text');
  assert(ABAARSO_VOICE_AD_SCRIPT.includes('BISHAARO! BISHAARO! BISHAARO!'), 'Voice ad starts with powerful BISHAARO');
  assert(ABAARSO_VOICE_AD_SCRIPT.includes('Abaarso Tech University – Berbera Campus'), 'Voice ad names campus');
  assert(ABAARSO_VOICE_AD_SCRIPT.includes('Maxamed Daahir, aasaasaha Cardoso AI'), 'Voice ad mentions alumnus Mohamed Dahir');
  assert(ABAARSO_VOICE_AD_SCRIPT.includes('Diiwaangelinta sannad-dugsiyeedka cusub ee 2026/2027 way socotaa!'), 'Mentions 2026/2027');
  assert(ABAARSO_REGISTRATION_TEXT.includes('HADDA ONLINE ISKA DIIWAANGELI'), 'Text header matches');
  assert(ABAARSO_REGISTRATION_TEXT.includes(ABAARSO_ADMISSION_INFO.onlineRegistrationLink), 'Text has online link');

  // 4. Advertisement Delivery Sequence via Transport
  console.log('\n4. Advertisement Workflow Sequence (Voice FIRST, then Link AFTER delivery)');
  const transport = new MockTransport();
  // Mock pre-cached audio so we test delivery logic offline without needing network TTS
  (AbaarsoAdService as any).cachedAudioBuffer = Buffer.alloc(2048, 'OggS');
  (AbaarsoAdService as any).cachedMimeType = 'audio/ogg; codecs=opus';

  const delivered = await AbaarsoAdService.deliverAdvertisement('252631234567@s.whatsapp.net', transport);
  assert(delivered === true, 'deliverAdvertisement returns true on success');
  assert(transport.sentMedia.length === 1, 'Exactly one voice message sent');
  assert(transport.sentMedia[0].media.type === 'audio', 'Sent media is audio');
  assert(transport.sentMedia[0].media.ptt === true, 'Sent as voice note (PTT: true)');
  assert(transport.sentMessages.length === 1, 'Exactly one follow-up text sent');
  assert(transport.sentMessages[0].text.includes('docs.google.com/forms'), 'Follow-up text contains registration link');

  // 5. Delivery failure safety rule: do NOT send link if voice delivery fails
  console.log('\n5. Voice Delivery Failure Safety Guard');
  const failingTransport = new MockTransport();
  failingTransport.failMedia = true;
  const failResult = await AbaarsoAdService.deliverAdvertisement('252631234567@s.whatsapp.net', failingTransport);
  assert(failResult === false, 'Returns false when voice delivery fails');
  assert(failingTransport.sentMessages.length === 0, 'Does NOT send registration link if voice failed');

  // 6. Router Trigger Handling (!abaarso and @abaarso)
  console.log('\n6. MessageRouter Trigger Handling (!abaarso and @abaarso)');
  const mockEngine = {
    processMessage: async () => ({
      replyText: 'Test response',
      studentId: '123',
      intent: 'general',
      language: 'so',
      latencyMs: 10,
    }),
  } as any;
  const mockConfig = {
    security: { adminPhoneNumbers: [], allowedGroups: [] },
    messaging: { prefix: '!cardoso', mode: 'auto', groupResponseMode: 'all' },
  } as any;
  const router = new MessageRouter(mockEngine, mockConfig);

  const testRouterTransport = new MockTransport();
  const triggerA = await router.handleIncomingMessage({
    id: 'msg_1',
    senderId: '252630000001',
    chatId: '252630000001@s.whatsapp.net',
    isGroup: false,
    content: '!abaarso',
    rawTimestamp: Date.now(),
    isMentioned: false,
  }, testRouterTransport);
  assert(triggerA.handled === true, '!abaarso triggers advertisement workflow');
  assert(testRouterTransport.sentMedia.length === 1, 'Delivered voice media');
  assert(testRouterTransport.sentMessages.length === 1, 'Delivered registration link');

  testRouterTransport.sentMedia = [];
  testRouterTransport.sentMessages = [];
  const triggerB = await router.handleIncomingMessage({
    id: 'msg_2',
    senderId: '252630000002',
    chatId: '252630000002@s.whatsapp.net',
    isGroup: false,
    content: '@abaarso',
    rawTimestamp: Date.now(),
    isMentioned: false,
  }, testRouterTransport);
  assert(triggerB.handled === true, '@abaarso triggers advertisement workflow');
  assert(testRouterTransport.sentMedia.length === 1, 'Delivered voice media for @abaarso');

  // 7. Course Recommendation Assistant Protocol
  console.log('\n7. Intelligent Course Recommendation Protocol');
  assert(ABAARSO_SCREENING_QUESTION.includes('technology, caafimaadka, ganacsiga, sharciga'), 'Screening question covers core tracks');
  const matchedTech = AcademicAdvisor.matchDegreeProgram('waxaan rabaa programming iyo koodh');
  assert(matchedTech.program === 'Bachelor of Software Engineering', 'Matches programming to Software Engineering');
  const matchedNurse = AcademicAdvisor.matchDegreeProgram('waxaan jeclahay kalkaalisada iyo bukaanada');
  assert(matchedNurse.program === 'Bachelor in Clinical Nursing', 'Matches kalkaaliso to Clinical Nursing');
  const matchedBiz = AcademicAdvisor.matchDegreeProgram('waxaan xiiseeyaa ganacsiga iyo maamulka shirkadaha');
  assert(matchedBiz.program === 'Bachelor of Business Administration', 'Matches ganacsi to Business Administration');
  const matchedLaw = AcademicAdvisor.matchDegreeProgram('waxaan rabaa sharciga iyo maxkamadaha');
  assert(matchedLaw.program === 'Bachelor of Laws (LLB)', 'Matches sharci to LLB');

  // 8. Strict Silence Rule Verification
  console.log('\n8. Strict Silence Rule Verification');
  const silentEngine = {
    processMessage: async () => ({
      replyText: '[SILENCE]',
      studentId: '123',
      intent: 'general',
      language: 'so',
      latencyMs: 10,
    }),
  } as any;
  const silentRouter = new MessageRouter(silentEngine, mockConfig);
  const silentTransport = new MockTransport();
  const silenceResult = await silentRouter.handleIncomingMessage({
    id: 'msg_unrelated',
    senderId: '252630000003',
    chatId: '252630000003@s.whatsapp.net',
    isGroup: false,
    content: 'Sidee baasto loo kariyaa?',
    rawTimestamp: Date.now(),
    isMentioned: false,
  }, silentTransport);
  assert(silenceResult.handled === true, 'Silence handled cleanly');
  assert(silentTransport.sentMessages.length === 0, 'Remains completely silent (no message sent to WhatsApp)');

  // 9. System Instruction Persona Validation
  console.log('\n9. System Instruction Persona Validation');
  const sysPrompt = PromptBuilder.buildSystemInstruction({
    detectedLanguage: 'so',
    isGroupChat: false,
  });
  assert(sysPrompt.includes('ABARSO AI'), 'System prompt contains ABARSO AI');
  assert(sysPrompt.includes('Fooqa Kayd'), 'System prompt contains Fooqa Kayd');
  assert(sysPrompt.includes('Caynu-Raxma'), 'System prompt contains Caynu-Raxma');
  assert(sysPrompt.includes('docs.google.com/forms'), 'System prompt contains online registration link');
  assert(sysPrompt.includes('Bachelor in Clinical Nursing'), 'System prompt includes Clinical Nursing');
  assert(sysPrompt.includes('Bachelor of Software Engineering'), 'System prompt includes Software Engineering');
  assert(sysPrompt.includes('[SILENCE]'), 'System prompt contains strict silence instruction');

  console.log('\n========================================');
  console.log(`Summary: ${passed} Passed, ${failed} Failed`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAbaarsoTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
