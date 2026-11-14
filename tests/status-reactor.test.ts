import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { StatusReactorService, statusReactorService } from '../src/services/status-reactor.service.js';
import { whatsappManagerService } from '../src/services/whatsapp-manager.service.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import fs from 'fs';

const suite = new TestSuite('Status AI Reactor: Human-Like Interaction & Content Understanding');
const testDb = './data/test_status_reactor.db';

suite.test('Accurately classifies status categories and selects appropriate emojis and comments', () => {
  const service = new StatusReactorService('./data/test_sr_config.json');

  // 1. Graduation
  const grad = service.analyzeStatus('Alxamdullilah maanta waxaan si rasmi ah uga qalin-jabiyey jaamacadda!');
  assertEqual(grad.category, 'graduation', 'Should detect graduation');
  assertTrue(grad.suggestedEmojis.includes('🎓'), 'Graduation emojis should include graduation cap');
  assertTrue(grad.suggestedComments.some(c => c.includes('hambalyo')), 'Comments should include hambalyo');

  // 2. Wedding
  const wed = service.analyzeStatus('Barakallahu lakumaa wa baaraka calaykumaa, maanta arooskii walaalkay');
  assertEqual(wed.category, 'wedding', 'Should detect wedding');
  assertTrue(wed.suggestedEmojis.includes('💍'), 'Wedding emojis should include ring');

  // 3. Business
  const biz = service.analyzeStatus('Dhar cusub iyo kabo aad u qurux badan ayaa noo yimid, qiimo jaban ku dalbo hadda 063...');
  assertEqual(biz.category, 'business', 'Should detect business');
  assertTrue(biz.suggestedEmojis.includes('💼'), 'Business emojis should include briefcase');

  // 4. Funny / Meme
  const funny = service.analyzeStatus('Hahaha waar ninkan eega meeday kkkk yaabka');
  assertEqual(funny.category, 'funny', 'Should detect funny/humor');
  assertTrue(funny.suggestedEmojis.includes('😂'), 'Funny emojis should include laughing face');

  // 5. Islamic Friday
  const fri = service.analyzeStatus('Jimco wanaagsan dhammaan asxaabta qiimaha badan');
  assertEqual(fri.category, 'islamic_friday', 'Should detect Friday');
  assertTrue(fri.suggestedComments.some(c => c.includes('Jimco')), 'Comments should mention Jimco');

  // 6. Islamic Duco
  const duco = service.analyzeStatus('Ilaahayow noo dambi dhaaf, aamiin yaa rabbi');
  assertEqual(duco.category, 'islamic_duco', 'Should detect duco');

  // 7. Condolence (SAFETY CRITICAL)
  const cond = service.analyzeStatus('Innaa Lillaahi wa innaa Ilayhi Raajicuun waxaa geeriyooday adeerkay');
  assertEqual(cond.category, 'condolence', 'Should detect condolence');
  assertEqual(cond.suggestedEmojis.length, 1, 'Only prayer emoji allowed for death');
  assertEqual(cond.suggestedEmojis[0], '🤲', 'Must be prayer hands');
  assertFalse(cond.suggestedEmojis.includes('😂'), 'Must never include laughter emoji');
  assertFalse(cond.suggestedEmojis.includes('🎉'), 'Must never include party emoji');

  // 8. Illness
  const ill = service.analyzeStatus('Hooyo ayaa isbitaalka jiifta oo xanuunsan, fadlan u soo duceeya');
  assertEqual(ill.category, 'illness', 'Should detect illness');

  // 9. Travel
  const travel = service.analyzeStatus('Airport hargeysa safar toos ah oo ku wajahan Dubai');
  assertEqual(travel.category, 'travel', 'Should detect travel');
  assertTrue(travel.suggestedEmojis.includes('✈️'), 'Travel emojis should include airplane');

  // 10. Style / Outfit
  const style = service.analyzeStatus('Today style and outfit vibe');
  assertEqual(style.category, 'style_selfie', 'Should detect style/outfit');

  // 11. Media only
  const mediaOnly = service.analyzeStatus('', true);
  assertEqual(mediaOnly.category, 'media_only', 'Should detect media only');
});

suite.test('Enforces cooldown per contact to prevent spamming multiple stories', () => {
  const service = new StatusReactorService('./data/test_sr_config.json');
  service.setConfig({ cooldownHours: 2 });
  const testJid = '252615999888@s.whatsapp.net';

  // Initially not in cooldown
  assertFalse(service.isCooldownActive(testJid), 'Should not be in cooldown initially');

  // Record an interaction
  service.recordInteraction({
    id: 'test_log_1',
    senderJid: testJid,
    senderName: 'Test Contact',
    type: 'reaction',
    content: '❤️',
    category: 'style_selfie',
    statusText: 'test text',
    timestamp: Date.now(),
  });

  // Now in cooldown
  assertTrue(service.isCooldownActive(testJid), 'Should be in cooldown immediately after interaction');

  // Reset cooldowns
  service.resetCooldowns();
  assertFalse(service.isCooldownActive(testJid), 'Should no longer be in cooldown after reset');
});

suite.test('Dispatches reaction and comment to mock WhatsApp socket', async () => {
  const service = new StatusReactorService('./data/test_sr_config.json');
  service.setConfig({
    enabled: true,
    autoReact: true,
    autoComment: true,
    mode: 'both',
    cooldownHours: 4,
    minDelaySeconds: 0,
    maxDelaySeconds: 0,
  });

  const testJid = '252617777777@s.whatsapp.net';
  const sentMessages: Array<{ jid: string; content: any; options?: any }> = [];

  const mockSocket: any = {
    sendMessage: async (jid: string, content: any, options?: any) => {
      sentMessages.push({ jid, content, options });
      return { key: { id: 'sent_res_1' } };
    },
    sendPresenceUpdate: async () => {},
  };

  const fakeStatusMsg: any = {
    key: {
      remoteJid: 'status@broadcast',
      id: 'STATUS_MSG_XYZ',
      participant: testJid,
    },
    pushName: 'Maxamed Asxaabi',
    message: {
      conversation: 'Masha Allah maanta waxaan ku guuleystay shahaadada Master-ka jaamacadda!',
    },
  };

  const analysis = service.analyzeStatus(fakeStatusMsg.message.conversation, false);

  await service.executeInteraction(
    fakeStatusMsg,
    mockSocket,
    testJid,
    fakeStatusMsg.pushName,
    analysis,
    fakeStatusMsg.message.conversation
  );

  // Both reaction and comment should be sent
  assertTrue(sentMessages.length >= 2, 'Should have sent both reaction and comment');

  const reactMsg = sentMessages.find(m => m.content?.react);
  assertTrue(Boolean(reactMsg), 'Reaction message must be found');
  assertEqual(reactMsg?.content?.react?.key?.id, 'STATUS_MSG_XYZ', 'Reaction must reference status message key');

  const commentMsg = sentMessages.find(m => m.content?.text && m.options?.quoted);
  assertTrue(Boolean(commentMsg), 'Comment message must be found and quote the status story');
  assertEqual(commentMsg?.jid, testJid, 'Comment must be sent directly to the contact JID');
  assertTrue(commentMsg?.content?.text?.length > 5, 'Comment text must be non-empty and meaningful');
});

suite.test('MessageRouter administrative commands control Status Reactor settings', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const testConfig = {
    ...config,
    security: {
      ...config.security,
      adminPhoneNumbers: ['252610000099'],
    },
  };

  const router = new MessageRouter(engine, testConfig as any);
  const transport = new ConsoleSimulatorTransport();
  await transport.start();

  let lastSentReply = '';
  transport.onMessage(async (msg) => {
    lastSentReply = msg.content;
  });

  // 1. Admin toggles !statusreact on and off
  const resReactOn = await router.handleIncomingMessage(
    {
      id: 'msg_adm_sr_1',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!statusreact on',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resReactOn.handled, '!statusreact on should be handled');
  assertTrue(statusReactorService.getConfig().autoReact, 'Auto react should be true');

  const resReactOff = await router.handleIncomingMessage(
    {
      id: 'msg_adm_sr_2',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!statusreact off',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resReactOff.handled, '!statusreact off should be handled');
  assertFalse(statusReactorService.getConfig().autoReact, 'Auto react should be false');

  // Turn it back on
  statusReactorService.setConfig({ autoReact: true, autoComment: true });

  // 2. Admin toggles !statuscomment on and off
  const resCommentOff = await router.handleIncomingMessage(
    {
      id: 'msg_adm_sr_3',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!statuscomment off',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resCommentOff.handled, '!statuscomment off should be handled');
  assertFalse(statusReactorService.getConfig().autoComment, 'Auto comment should be false');

  // 3. Admin updates mode with !statusmode
  const resMode = await router.handleIncomingMessage(
    {
      id: 'msg_adm_sr_4',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!statusmode reaction',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resMode.handled, '!statusmode reaction should be handled');
  assertEqual(statusReactorService.getConfig().mode, 'reaction', 'Mode should be reaction');

  // Reset to both
  statusReactorService.setConfig({ autoReact: true, autoComment: true, mode: 'both' });

  // 4. Admin updates cooldown with !statuscooldown
  const resCd = await router.handleIncomingMessage(
    {
      id: 'msg_adm_sr_5',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!statuscooldown 6',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resCd.handled, '!statuscooldown 6 should be handled');
  assertEqual(statusReactorService.getConfig().cooldownHours, 6, 'Cooldown should be 6 hours');

  // 5. Admin asks for !statusinfo
  const resInfo = await router.handleIncomingMessage(
    {
      id: 'msg_adm_sr_6',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!statusinfo',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resInfo.handled, '!statusinfo should be handled');

  // 6. Security block: Non-admin user cannot execute !statusreact
  const resBlocked = await router.handleIncomingMessage(
    {
      id: 'msg_unauth_sr_1',
      senderId: '252619999000',
      chatId: 'direct_unauth',
      isGroup: false,
      content: '!statusreact off',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resBlocked.handled, 'Unauthorized command should be intercepted by security guard');
  assertEqual(resBlocked.reason, 'Unauthorized admin command blocked', 'Must be blocked by security');

  // Reset cooldown to 0 after test to avoid blocking real operations
  statusReactorService.setConfig({ cooldownHours: 0 });

  await transport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (fs.existsSync('./data/test_sr_config.json')) fs.unlinkSync('./data/test_sr_config.json');
  } catch {}
});

suite.test('All-in-One Master Command (view on/off) simultaneously controls Seen, React, and Comment', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const testConfig = {
    ...config,
    security: {
      ...config.security,
      adminPhoneNumbers: ['252610000099'],
    },
  };

  const router = new MessageRouter(engine, testConfig as any);
  const transport = new ConsoleSimulatorTransport();
  await transport.start();

  let lastOutboundMessage = '';
  transport.sendMessage = async (chatId: string, text: string) => {
    lastOutboundMessage = text;
    return true;
  };

  // 1. Admin turns everything OFF using "view off" (no exclamation)
  const resOff = await router.handleIncomingMessage(
    {
      id: 'msg_adm_view_off',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: 'view off',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resOff.handled, 'view off should be handled');
  assertFalse(whatsappManagerService.isAutoViewStatusEnabled(), 'Auto view must be false');
  assertFalse(statusReactorService.getConfig().autoReact, 'Auto react must be false');
  assertFalse(statusReactorService.getConfig().autoComment, 'Auto comment must be false');
  assertTrue(lastOutboundMessage.includes('DAMIDAY'), 'Confirmation should state all are disabled');

  // 2. Admin turns everything ON using "!view on" (with exclamation)
  const resOn = await router.handleIncomingMessage(
    {
      id: 'msg_adm_view_on',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: '!view on',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resOn.handled, '!view on should be handled');
  assertTrue(whatsappManagerService.isAutoViewStatusEnabled(), 'Auto view must be true');
  assertTrue(statusReactorService.getConfig().autoReact, 'Auto react must be true');
  assertTrue(statusReactorService.getConfig().autoComment, 'Auto comment must be true');
  assertEqual(statusReactorService.getConfig().mode, 'both', 'Mode must be set to both');
  assertTrue(lastOutboundMessage.includes('SHIDAY'), 'Confirmation should state all are enabled');

  // 3. Admin asks for "view" status summary
  const resSummary = await router.handleIncomingMessage(
    {
      id: 'msg_adm_view_status',
      senderId: '252610000099',
      chatId: 'direct_admin',
      isGroup: false,
      content: 'view',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resSummary.handled, 'view status summary should be handled');
  assertTrue(lastOutboundMessage.includes('ALL-IN-ONE VIEW STATUS'), 'Should show view summary');

  // 4. Non-admin attempting "view on" is blocked by security guard
  const resBlocked = await router.handleIncomingMessage(
    {
      id: 'msg_unauth_view_on',
      senderId: '252619999000',
      chatId: 'direct_unauth',
      isGroup: false,
      content: 'view on',
      rawTimestamp: Date.now(),
      isMentioned: true,
    },
    transport
  );
  assertTrue(resBlocked.handled, 'Unauthorized view command must be handled');
  assertEqual(resBlocked.reason, 'Unauthorized admin command blocked', 'Must be blocked by security');

  // Reset cooldown to 0 after test to avoid blocking real operations
  statusReactorService.setConfig({ cooldownHours: 0 });

  await transport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}
});

suite.test('Ignores status posts from bot owner/admin and processes contacts with zero cooldown', async () => {
  const service = new StatusReactorService('./data/test_sr_config.json');
  service.setConfig({
    enabled: true,
    autoReact: true,
    autoComment: true,
    mode: 'both',
    cooldownHours: 0, // Zero cooldown per user request
    minDelaySeconds: 0,
    maxDelaySeconds: 0,
  });

  const mockSocket: any = {
    user: { id: '252634949642:0@s.whatsapp.net' },
    sendMessage: async () => ({ key: { id: 'mock_sent_id' } }),
    sendPresenceUpdate: async () => {},
  };

  // 1. Admin/Owner posts status -> MUST be ignored!
  const adminStatusMsg: any = {
    key: {
      remoteJid: 'status@broadcast',
      id: 'STATUS_ADMIN_1',
      participant: '252634949642@s.whatsapp.net',
      fromMe: false,
    },
    pushName: 'Bot Owner Mohamed',
    message: { conversation: 'Status aan anigu soo dhigay...' },
  };
  const adminHandled = await service.handleIncomingStatus(adminStatusMsg, mockSocket);
  assertFalse(adminHandled, 'Must NEVER react or comment on admin/owner status');

  // 2. Regular contact posts status -> MUST be handled
  const contactStatusMsg1: any = {
    key: {
      remoteJid: 'status@broadcast',
      id: 'STATUS_CONTACT_1',
      participant: '252618888999@s.whatsapp.net',
      fromMe: false,
    },
    pushName: 'Farxaan Saaxiib',
    message: { conversation: 'Alxamdulilah maanta shaqo cusub ayaan bilaabay!' },
  };
  const contactHandled1 = await service.handleIncomingStatus(contactStatusMsg1, mockSocket);
  assertTrue(contactHandled1, 'Contact status must be handled');

  // 3. Same contact posts a 2nd status immediately -> MUST NOT be blocked (zero cooldown active)
  const contactStatusMsg2: any = {
    key: {
      remoteJid: 'status@broadcast',
      id: 'STATUS_CONTACT_2',
      participant: '252618888999@s.whatsapp.net',
      fromMe: false,
    },
    pushName: 'Farxaan Saaxiib',
    message: { conversation: 'Muuqaal qurux badan...' },
  };
  const contactHandled2 = await service.handleIncomingStatus(contactStatusMsg2, mockSocket);
  assertTrue(contactHandled2, 'Contact consecutive status must NOT be blocked when cooldown is 0');
});

suite.test('Differentiates male vs female status comments with authentic Somali male persona', async () => {
  const service = new StatusReactorService('./data/test_sr_config.json');

  // Male contact (Farxaan)
  const maleAnalysis = service.analyzeStatus('Maanta waan qalinjabiyey!', false, undefined, 'male');
  assertEqual(maleAnalysis.category, 'graduation');
  assertTrue(
    maleAnalysis.suggestedComments.some(c => c.includes('sxb') || c.includes('bro') || c.includes('geesi')),
    'Male comments must include masculine terms'
  );
  assertFalse(
    maleAnalysis.suggestedComments.some(c => c.includes('abaayo')),
    'Male comments must NEVER address a man as abaayo'
  );

  // Female contact (Fadumo / Ayaan)
  const femaleAnalysis = service.analyzeStatus('Maanta waan qalinjabiyey!', false, undefined, 'female');
  assertEqual(femaleAnalysis.category, 'graduation');
  assertTrue(
    femaleAnalysis.suggestedComments.some(c => c.includes('abaayo') || c.includes('walaashay')),
    'Female comments must include courteous feminine terms'
  );
  assertFalse(
    femaleAnalysis.suggestedComments.some(c => c.includes('ninyahow')),
    'Female comments must NEVER address a woman as ninyahow'
  );

  // Video media status
  const videoAnalysis = service.analyzeStatus('', true, 'video', 'male');
  assertEqual(videoAnalysis.category, 'video', 'Should detect video status category');
  assertTrue(
    videoAnalysis.suggestedComments.some(c => c.includes('muuqaal')),
    'Video comments should compliment the visual video/clip'
  );
});

suite.test('Responds to status reply gratitude and story replies warmly without "Maxaan kaa caawiyaa?"', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);

  const testConfig = {
    ...config,
    security: {
      ...config.security,
      adminPhoneNumbers: ['252634949642'],
    },
  };

  const router = new MessageRouter(engine, testConfig as any);
  const transport = new ConsoleSimulatorTransport();
  await transport.start();

  let sentReply = '';
  transport.sendMessage = async (chatId: string, text: string) => {
    sentReply = text;
    return true;
  };

  const contactJid = '252619111222@s.whatsapp.net';

  // 1. Bot previously commented on Farxaan's status
  statusReactorService.recordSentStatusComment({
    senderJid: contactJid,
    senderName: 'Farxaan Cali',
    gender: 'male',
    commentText: "Masha'Allah hambalyo sxb qaali! Guul iyo mustaqbal ifaya ayaan kuu rajaynayaa 🎓👏",
    category: 'graduation',
    statusText: 'Qalinjabin jaamacad',
    timestamp: Date.now(),
  });

  // 2. Farxaan replies to the bot's comment in DM: "Mahadsanid sxb"
  const resGratitude = await router.handleIncomingMessage(
    {
      id: 'msg_gratitude_1',
      senderId: contactJid,
      senderName: 'Farxaan Cali',
      chatId: contactJid,
      isGroup: false,
      content: 'Mahadsanid sxb',
      rawTimestamp: Date.now(),
      isMentioned: false,
    },
    transport
  );

  assertTrue(resGratitude.handled, 'Status gratitude must be intercepted and handled');
  assertTrue(
    sentReply.includes('Adigaa mudan') || sentReply.includes('Waa waxba') || sentReply.includes('Aamiin'),
    'Should respond with warm Somali brotherly gratitude'
  );
  assertFalse(
    sentReply.includes('Maxaan kaa caawiyaa') || sentReply.includes('Sideen kuu caawin karaa'),
    'Must NEVER say "Maxaan kaa caawiyaa?" in response to status gratitude'
  );
  assertFalse(
    sentReply.includes('abaayo'),
    'Must NEVER say "abaayo" to a male contact'
  );

  // 3. Female contact (Ayaan) replies with "Aamiin yaa rabbi"
  const femaleJid = '252615333444@s.whatsapp.net';
  statusReactorService.recordSentStatusComment({
    senderJid: femaleJid,
    senderName: 'Ayaan Maxamed',
    gender: 'female',
    commentText: 'Jimco barakaysan abaayo macaan! Rabi ducada ha aqbalo 🤲🌸',
    category: 'islamic_friday',
    statusText: 'Jimco wanaagsan',
    timestamp: Date.now(),
  });

  const resFemale = await router.handleIncomingMessage(
    {
      id: 'msg_gratitude_female',
      senderId: femaleJid,
      senderName: 'Ayaan Maxamed',
      chatId: femaleJid,
      isGroup: false,
      content: 'Aamiin yaa rabbi',
      rawTimestamp: Date.now(),
      isMentioned: false,
    },
    transport
  );
  assertTrue(resFemale.handled, 'Female gratitude reply must be handled');
  assertTrue(
    sentReply.includes('abaayo') || sentReply.includes('Adigaa mudan') || sentReply.includes('Aamiin'),
    'Female response should use courteous feminine terms'
  );
  assertFalse(
    sentReply.includes('Maxaan kaa caawiyaa'),
    'Must NEVER say "Maxaan kaa caawiyaa?"'
  );

  // 4. Contact replies to a story/status posted by the bot
  const storyReplyMsg = await router.handleIncomingMessage(
    {
      id: 'msg_story_reply_1',
      senderId: contactJid,
      senderName: 'Farxaan Cali',
      chatId: contactJid,
      isGroup: false,
      content: 'Masha Allah meel qurux badan',
      rawTimestamp: Date.now(),
      isMentioned: false,
      isStoryReply: true,
      quotedText: 'Berbera beach sunset vibe',
    },
    transport
  );
  assertTrue(storyReplyMsg.handled, 'Story reply must be handled');
  assertFalse(
    sentReply.includes('Maxaan kaa caawiyaa') || sentReply.includes('Sideen kuu caawin karaa'),
    'Story replies must NEVER say "Maxaan kaa caawiyaa?"'
  );

  // 5. Normal Chat Isolation: Contact who received a status comment earlier sends a normal chat message
  // Must NOT be intercepted as a status comeback!
  const resNormalChat = await router.handleIncomingMessage(
    {
      id: 'msg_normal_chat_1',
      senderId: contactJid,
      senderName: 'Farxaan Cali',
      chatId: contactJid,
      isGroup: false,
      content: 'Asc walaal su\'aal baan qabaa',
      rawTimestamp: Date.now(),
      isMentioned: false,
    },
    transport
  );
  assertTrue(resNormalChat.handled, 'Normal chat message must be processed by AdvisorEngine');
  assertFalse(
    sentReply.includes('mar kasta waan kula socdaa'),
    'Must NOT reply with status comeback when user asks a normal chat question'
  );

  // Reset cooldown to 0 after test to avoid blocking real operations
  statusReactorService.setConfig({ cooldownHours: 0 });

  await transport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});
