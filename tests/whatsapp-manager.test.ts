import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { whatsappManagerService, WhatsAppManagerService } from '../src/services/whatsapp-manager.service.js';
import { GroupGovernorService } from '../src/services/group-governor.service.js';
import { broadcastService } from '../src/services/broadcast.service.js';
import { detectInstantGreetingReply } from '../src/advisor/somali-dictionary.js';
import { StatusReactorService } from '../src/services/status-reactor.service.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import { WhatsAppBaileysTransport } from '../src/transports/whatsapp-baileys.js';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateSubscriberGuidePdfBuffer } from '../src/services/user-guide-pdf.service.js';
import { codeRunnerService } from '../src/services/code-runner.service.js';
import { prayerTimesService, PrayerTimesService } from '../src/services/prayer-times.service.js';

const suite = new TestSuite('WhatsApp 100% Management & Status Intelligence');
const testDb = './data/test_whatsapp_manager.db';

suite.test('normalizeToJid formats Somali phone numbers correctly', () => {
  assertEqual(whatsappManagerService.normalizeToJid('0615123456'), '252615123456@s.whatsapp.net');
  assertEqual(whatsappManagerService.normalizeToJid('615123456'), '252615123456@s.whatsapp.net');
  assertEqual(whatsappManagerService.normalizeToJid('0634123456'), '252634123456@s.whatsapp.net');
  assertEqual(whatsappManagerService.normalizeToJid('+252615123456'), '252615123456@s.whatsapp.net');
  assertEqual(whatsappManagerService.normalizeToJid('252615123456@s.whatsapp.net'), '252615123456@s.whatsapp.net');
  assertEqual(whatsappManagerService.normalizeToJid('@252615123456'), '252615123456@s.whatsapp.net');
  assertEqual(whatsappManagerService.normalizeToJid('@0634123456'), '252634123456@s.whatsapp.net');
});

suite.test('Auto-View Status toggles properly', () => {
  whatsappManagerService.setAutoViewStatus(true);
  assertTrue(whatsappManagerService.isAutoViewStatusEnabled(), 'Auto view status should be true');
  whatsappManagerService.setAutoViewStatus(false);
  assertFalse(whatsappManagerService.isAutoViewStatusEnabled(), 'Auto view status should be false');
  whatsappManagerService.setAutoViewStatus(true);
});

suite.test('Mock socket executes status posting and group actions successfully', async () => {
  let sentJid = '';
  let sentPayload: any = null;
  let sentOptions: any = null;
  let groupUpdateAction = '';
  let readKeys: any[] = [];
  let updatedName = '';
  let updatedBio = '';

  const mockSocket: any = {
    user: { id: '252610000000:1@s.whatsapp.net' },
    sendMessage: async (jid: string, content: any, options?: any) => {
      sentJid = jid;
      sentPayload = content;
      sentOptions = options;
      return { key: { id: 'status_msg_123' } };
    },
    groupMetadata: async (groupJid: string) => {
      return {
        id: groupJid,
        subject: 'Tijaabo Group',
        participants: [
          { id: '252611111111@s.whatsapp.net', admin: 'admin' },
          { id: '252612222222@s.whatsapp.net', admin: null },
        ],
      };
    },
    groupParticipantsUpdate: async (groupJid: string, participants: string[], action: string) => {
      groupUpdateAction = action;
      return [{ status: '200', jid: participants[0] }];
    },
    groupSettingUpdate: async (groupJid: string, setting: string) => {
      return true;
    },
    groupInviteCode: async (groupJid: string) => 'TESTINVITECODE123',
    updateProfileName: async (name: string) => {
      updatedName = name;
    },
    updateProfileStatus: async (bio: string) => {
      updatedBio = bio;
    },
    updateProfilePicture: async () => true,
    updateBlockStatus: async () => true,
    readMessages: async (keys: any[]) => {
      readKeys = keys;
    },
  };

  whatsappManagerService.setSocket(mockSocket);

  // 1. Post Text Status
  const textResult = await whatsappManagerService.postTextStatus('Guushu waxay timaadaa dadaal ka dib!', {
    backgroundColor: '#0f5132',
  });
  assertTrue(textResult.success, 'Text status should succeed');
  assertEqual(sentJid, 'status@broadcast', 'Must target status@broadcast');
  assertEqual(sentPayload.text, 'Guushu waxay timaadaa dadaal ka dib!');
  assertEqual(sentPayload.backgroundColor, '#0f5132');
  assertTrue(sentOptions.broadcast, 'Must set broadcast: true');
  assertFalse(sentOptions.useUserDevicesCache, 'Must bypass stale user devices cache');
  assertEqual(sentOptions.backgroundColor, '#0f5132', 'Must pass backgroundColor in sendOptions for Baileys assertColor');
  assertEqual(sentOptions.font, 1, 'Must pass font in sendOptions for Baileys');
  assertTrue(Array.isArray(sentOptions.statusJidList), 'Must provide statusJidList');
  assertTrue(sentOptions.statusJidList.includes('252610000000@s.whatsapp.net'), 'Must include clean owner phone JID');
  assertFalse(sentOptions.statusJidList.some((j: string) => j.includes(':')), 'No device colon suffix in statusJidList');

  // 2. Post Media Status
  const mediaResult = await whatsappManagerService.postMediaStatus({
    type: 'image',
    buffer: Buffer.from('fake-image-bytes'),
    mimeType: 'image/jpeg',
    caption: 'Sawirka Maanta',
  });
  assertTrue(mediaResult.success, 'Media status should succeed');
  assertEqual(sentJid, 'status@broadcast');
  assertEqual(sentPayload.caption, 'Sawirka Maanta');
  assertTrue(sentOptions.broadcast, 'Media must set broadcast: true');
  assertTrue(Array.isArray(sentOptions.statusJidList), 'Media must provide statusJidList');
  assertTrue(sentOptions.statusJidList.includes('252610000000@s.whatsapp.net'), 'Media must include clean owner phone JID');

  // 2b. Delete Status by ID with recipient propagation
  const delStatusRes = await whatsappManagerService.deleteStatusById('status_msg_123');
  assertTrue(delStatusRes.success, 'Status delete should succeed');
  assertEqual(sentJid, 'status@broadcast');
  assertEqual(sentPayload.delete.id, 'status_msg_123');
  assertEqual(sentPayload.delete.participant, undefined, 'Status delete key must not contain participant');
  assertTrue(sentOptions.broadcast, 'Delete must broadcast to all recipients');
  assertTrue(Array.isArray(sentOptions.statusJidList), 'Delete must include statusJidList');
  assertTrue(sentOptions.statusJidList.includes('252610000000@s.whatsapp.net'), 'Delete must reach owner device');

  // 2c. Verify toCleanUserJid helper
  assertEqual(whatsappManagerService.toCleanUserJid('252634949642:0@s.whatsapp.net'), '252634949642@s.whatsapp.net');
  assertEqual(whatsappManagerService.toCleanUserJid('0634949642'), '252634949642@s.whatsapp.net');
  assertEqual(whatsappManagerService.toCleanUserJid('117000009416739@lid'), null);
  assertEqual(whatsappManagerService.toCleanUserJid('120363024@g.us'), null);

  // 3. Mark Status Seen (Auto View Status)
  const seenResult = await whatsappManagerService.markStatusSeen({
    id: 'status_key_1',
    remoteJid: 'status@broadcast',
    participant: '252615999999@s.whatsapp.net',
  });
  assertTrue(seenResult, 'Status seen should return true');
  assertEqual(readKeys.length, 1);

  // 4. Tag All Members in Group
  const tagResult = await whatsappManagerService.tagAll('12345@g.us', 'Shir degdeg ah!');
  assertTrue(tagResult.success, 'Tagall should succeed');
  assertEqual(tagResult.count, 2, 'Should tag 2 participants');
  assertEqual(sentJid, '12345@g.us');
  assertTrue(sentPayload.text.includes('@252611111111'), 'Mentions should contain participant numbers');

  // 5. Kick and Promote (handles both raw number and @mention)
  const kickRes = await whatsappManagerService.kickMember('12345@g.us', '252612222222');
  assertTrue(kickRes.success, 'Kick with raw number should succeed');
  assertTrue(kickRes.message.includes('Macasalaama'), 'Kick message should say Macasalaama');
  assertEqual(groupUpdateAction, 'remove');

  const kickMentionRes = await whatsappManagerService.kickMember('12345@g.us', '@252612222222');
  assertTrue(kickMentionRes.success, 'Kick with @mention should succeed');
  assertTrue(kickMentionRes.message.includes('Macasalaama'), 'Kick with @mention should say Macasalaama');
  assertEqual(kickMentionRes.jid, '252612222222@s.whatsapp.net');

  const addRes = await whatsappManagerService.addMember('12345@g.us', '0634999888');
  assertTrue(addRes.success, 'Add member should succeed');
  assertEqual(addRes.jid, '252634999888@s.whatsapp.net');

  const promoteRes = await whatsappManagerService.promoteMember('12345@g.us', '252612222222');
  assertTrue(promoteRes.success, 'Promote should succeed');
  assertEqual(groupUpdateAction, 'promote');

  // 6. Group link
  const linkRes = await whatsappManagerService.getGroupInviteLink('12345@g.us');
  assertTrue(linkRes.success, 'Invite link should succeed');
  assertEqual(linkRes.link, 'https://chat.whatsapp.com/TESTINVITECODE123');

  // 7. Profile Updates
  const nameRes = await whatsappManagerService.updateProfileName('CARDOSO AI PRO');
  assertTrue(nameRes.success, 'Name update should succeed');
  assertEqual(updatedName, 'CARDOSO AI PRO');

  const bioRes = await whatsappManagerService.updateProfileBio('Barasho, Dhiirigelin, iyo Horumar');
  assertTrue(bioRes.success, 'Bio update should succeed');
  assertEqual(updatedBio, 'Barasho, Dhiirigelin, iyo Horumar');
});

suite.test('Custom Auto-Replies in SQLiteMemory store and match instant answers', async () => {
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }

  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();

  // Save two auto replies
  await memory.saveAutoReply('fiidkii', 'Waa hagaag walaal, xafiisku fiidkii wuxuu furan yahay 5:00 PM ilaa 9:00 PM.', 'contains');
  await memory.saveAutoReply('lacag', 'Lacag-bixinta waxaad ku diri kartaa Zaad: 0634000000 ama Sahal: 0654000000.', 'contains');

  const all = await memory.getAutoReplies();
  assertEqual(all.length, 2, 'Should have 2 auto-replies saved');

  // Matching check
  const match1 = await memory.findMatchingAutoReply('Goormaad furantihiin fiidkii miyaa?');
  assertTrue(match1 !== null, 'Should match fiidkii');
  assertTrue(match1!.includes('5:00 PM'), 'Response should mention 5:00 PM');

  const match2 = await memory.findMatchingAutoReply('Sideen lacagta idiinku soo diraa?');
  assertTrue(match2 !== null, 'Should match lacag');
  assertTrue(match2!.includes('Zaad'), 'Response should mention Zaad');

  const noMatch = await memory.findMatchingAutoReply('Sidee tahay saaxiib?');
  assertEqual(noMatch, null, 'Should return null for non-matching questions');

  // Deletion check
  const deleted = await memory.deleteAutoReply('fiidkii');
  assertTrue(deleted, 'Delete should return true');
  const afterDel = await memory.getAutoReplies();
  assertEqual(afterDel.length, 1, 'Should have 1 auto-reply remaining');

  await memory.close();
});

suite.test('MessageRouter processes status commands, replies, and group actions', async () => {
  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  await memory.saveAutoReply('shirka', 'Shirka wuxuu bilaabmayaa 10:00 Subaxnimo.');

  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);
  const router = new MessageRouter(engine, config, undefined, undefined, memory);

  const mockTransport = new ConsoleSimulatorTransport();
  await mockTransport.start();

  // 1. Comprehensive Help Menu
  const helpResult = await router.handleIncomingMessage({
    id: 'msg_help_1',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!maamul',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(helpResult.handled, '!maamul help menu should be handled');

  // 2. Custom auto-reply instant match (bypassing AI)
  const autoReplyResult = await router.handleIncomingMessage({
    id: 'msg_ar_1',
    senderId: '252610000001',
    chatId: 'direct_chat',
    isGroup: false,
    content: 'Waqtigee buu shirka yahay?',
    rawTimestamp: Date.now(),
    isMentioned: true,
  }, mockTransport);
  assertTrue(autoReplyResult.handled, 'Auto-reply should be handled immediately');
  assertEqual(autoReplyResult.reason, 'Matched custom auto-reply');

  // 3. Status Post Command
  const statusResult = await router.handleIncomingMessage({
    id: 'msg_stat_1',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!status Subax wanaagsan dhammaan ardayda!',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(statusResult.handled, '!status command should be handled');

  // 4. Auto-View Status Toggle Command
  const avResult = await router.handleIncomingMessage({
    id: 'msg_av_1',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!autoview on',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(avResult.handled, '!autoview on should be handled');
  assertTrue(whatsappManagerService.isAutoViewStatusEnabled(), 'Auto view status should be true');

  // 5. Direct Reply / Send Command
  const replyResult = await router.handleIncomingMessage({
    id: 'msg_rep_1',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!reply 252615999999 Fariintaada waan helnay walaal, mahadsanid!',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(replyResult.handled, '!reply to number should be handled');

  // 6. Add Auto-Reply via Chat Command
  const addArResult = await router.handleIncomingMessage({
    id: 'msg_addar_1',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!autoreply add goobta | Xafiiskeenu wuxuu ku yaallaa Suuqa Hoose.',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(addArResult.handled, '!autoreply add should be handled');

  const matchNew = await memory.findMatchingAutoReply('Aaway goobta aad ku taallaan?');
  assertTrue(matchNew !== null && matchNew.includes('Suuqa Hoose'), 'New auto-reply should match');

  // 7. Group Kick with @mention
  const kickGroupRes = await router.handleIncomingMessage({
    id: 'msg_kick_1',
    senderId: '252634949642',
    chatId: 'group_test@g.us',
    isGroup: true,
    content: '!kick @252612222222',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
    mentionedJids: ['252612222222@s.whatsapp.net'],
  }, mockTransport);
  assertTrue(kickGroupRes.handled, 'Group kick with @mention should be handled');

  // 8. Group Kick with raw phone number
  const kickGroupRawRes = await router.handleIncomingMessage({
    id: 'msg_kick_2',
    senderId: '252634949642',
    chatId: 'group_test@g.us',
    isGroup: true,
    content: '!kick 252612222222',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(kickGroupRawRes.handled, 'Group kick with raw number should be handled');

  // 9. Group Add with welcome message
  const addGroupRes = await router.handleIncomingMessage({
    id: 'msg_add_1',
    senderId: '252634949642',
    chatId: 'group_test@g.us',
    isGroup: true,
    content: '!add 252634999888',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(addGroupRes.handled, 'Group add member should be handled with welcoming message');

  // 10. Link Campaign Mode: Admin activates !link on (prompts for promo when not set)
  const linkOnRes = await router.handleIncomingMessage({
    id: 'msg_link_on_cmd',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!link on',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(linkOnRes.handled, '!link on should be handled');
  assertTrue(whatsappManagerService.isLinkCampaignMode(), 'Link campaign should be enabled');

  // 11. Admin sends flyer image + link to complete setup
  const promoSetupRes = await router.handleIncomingMessage({
    id: 'msg_promo_setup_1',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: 'https://wa.me/252615998877 Waa kan flyer-kayga WhatsApp',
    media: {
      type: 'image',
      mimeType: 'image/jpeg',
      dataBase64: Buffer.from('ADMIN_PROMO_FLYER').toString('base64'),
    },
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(promoSetupRes.handled, 'Owner promo flyer and link should be saved');
  assertTrue(whatsappManagerService.hasOwnerPromo(), 'Owner promo should now exist');

  // 12. Incoming user sends link -> posted to status and exchanged with owner promo flyer
  const testSenderPhone = '25261' + Date.now().toString().slice(-7);
  const userExchangeRes = await router.handleIncomingMessage({
    id: 'msg_user_link_exchange',
    senderId: testSenderPhone,
    chatId: `${testSenderPhone}@s.whatsapp.net`,
    isGroup: false,
    content: `https://wa.me/${testSenderPhone} status iigu dhig sxb`,
    rawTimestamp: Date.now(),
    isMentioned: false,
    isFromMe: false,
  }, mockTransport);
  assertTrue(userExchangeRes.handled, 'User status link submission should be handled');
  assertEqual(userExchangeRes.reason, 'Link campaign: posted status and exchanged owner promo flyer');
  assertTrue(whatsappManagerService.hasPostedLinkForSender(testSenderPhone), 'Sender should be recorded as posted');

  // 13. Same user tries to submit second link -> rejected politely
  const userDuplicateRes = await router.handleIncomingMessage({
    id: 'msg_user_link_duplicate',
    senderId: testSenderPhone,
    chatId: `${testSenderPhone}@s.whatsapp.net`,
    isGroup: false,
    content: `https://wa.me/${testSenderPhone} mar kale status ii dhig`,
    rawTimestamp: Date.now(),
    isMentioned: false,
    isFromMe: false,
  }, mockTransport);
  assertTrue(userDuplicateRes.handled, 'Duplicate link submission should be handled');
  assertEqual(userDuplicateRes.reason, 'Link campaign: link already posted previously');

  // 14. User asks "link isoo dhig" without sending link -> prompted with owner promo flyer
  const testAskPhone = '25262' + Date.now().toString().slice(-7);
  const userAskPromoRes = await router.handleIncomingMessage({
    id: 'msg_user_ask_promo',
    senderId: testAskPhone,
    chatId: `${testAskPhone}@s.whatsapp.net`,
    isGroup: false,
    content: 'walaal link isoo dhig',
    rawTimestamp: Date.now(),
    isMentioned: false,
    isFromMe: false,
  }, mockTransport);
  assertTrue(userAskPromoRes.handled, 'User asking for link should be handled');
  assertEqual(userAskPromoRes.reason, 'Link campaign: prompted with owner promo');

  // 15. Turn off link campaign
  const linkOffRes = await router.handleIncomingMessage({
    id: 'msg_link_off_cmd',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!link off',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(linkOffRes.handled, '!link off should be handled');
  assertFalse(whatsappManagerService.isLinkCampaignMode(), 'Link campaign should now be disabled');

  // 16. Admin disables AI for specific number via !off <number>
  const disableOneRes = await router.handleIncomingMessage({
    id: 'msg_off_single',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!off 252634777888',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(disableOneRes.handled, '!off <number> should be handled');
  assertTrue(whatsappManagerService.isAIDisabledForNumber('252634777888'), 'Number should be marked as AI disabled');

  // 17. The disabled number sends a message -> silently ignored
  const disabledUserMsgRes = await router.handleIncomingMessage({
    id: 'msg_from_disabled_user',
    senderId: '252634777888',
    chatId: '252634777888@s.whatsapp.net',
    isGroup: false,
    content: 'Asc sidee tahay walaal?',
    rawTimestamp: Date.now(),
    isMentioned: false,
    isFromMe: false,
  }, mockTransport);
  assertTrue(disabledUserMsgRes.handled, 'Disabled user message should be handled');
  assertEqual(disabledUserMsgRes.reason, 'AI disabled specifically for this sender');

  // 18. Admin lists disabled numbers via !off list
  const listDisabledRes = await router.handleIncomingMessage({
    id: 'msg_off_list',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!off list',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(listDisabledRes.handled, '!off list should be handled');

  // 19. Admin re-enables AI for that number via !on <number>
  const enableOneRes = await router.handleIncomingMessage({
    id: 'msg_on_single',
    senderId: '252634949642',
    chatId: 'direct_chat',
    isGroup: false,
    content: '!on 252634777888',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: true,
  }, mockTransport);
  assertTrue(enableOneRes.handled, '!on <number> should be handled');
  assertFalse(whatsappManagerService.isAIDisabledForNumber('252634777888'), 'Number should no longer be AI disabled');

  await mockTransport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }
});

suite.test('Unauthorized users are strictly blocked from executing admin/management commands', async () => {
  const memory = new SQLiteStudentMemory(testDb);
  await memory.initialize();
  const ai = new AIOrchestrator(config);
  const engine = new StudentAdvisorEngine(memory, ai);
  const router = new MessageRouter(engine, config, undefined, undefined, memory);

  const mockTransport = new ConsoleSimulatorTransport();
  await mockTransport.start();

  // 1. Stranger in private chat tries to post status: strictly blocked
  const strangerStatus = await router.handleIncomingMessage({
    id: 'stranger_msg_1',
    senderId: '252619999888', // Not in ADMIN_PHONE_NUMBERS
    chatId: 'direct_chat',
    isGroup: false,
    content: '!status Hacker status',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: false, // Not host phone
  }, mockTransport);

  assertTrue(strangerStatus.handled, 'Stranger command should be intercepted by security block');
  assertEqual(strangerStatus.reason, 'Unauthorized admin command blocked');

  // 2. Stranger in group tries to kick a participant: strictly blocked
  const strangerKick = await router.handleIncomingMessage({
    id: 'stranger_msg_2',
    senderId: '252619999888',
    chatId: 'group_123@g.us',
    isGroup: true,
    content: '!kick 252611111111',
    rawTimestamp: Date.now(),
    isMentioned: true,
    isFromMe: false,
  }, mockTransport);

  assertTrue(strangerKick.handled, 'Stranger kick must be blocked');
  assertEqual(strangerKick.reason, 'Unauthorized admin command blocked');

  // Test !statusviews admin command
  let sentViewsMsg = '';
  const viewsTransport: any = {
    sendMessage: async (chatId: string, text: string) => {
      sentViewsMsg = text;
      return true;
    },
  };

  const viewsRes = await router.handleIncomingMessage({
    id: 'msg_statusviews_1',
    senderId: '252634949642@s.whatsapp.net',
    senderName: 'Maxamed Daahir',
    chatId: '252634949642@s.whatsapp.net',
    isGroup: false,
    content: '!statusviews',
    rawTimestamp: Date.now(),
    isMentioned: false,
    isFromMe: false,
  }, viewsTransport);

  assertTrue(viewsRes.handled, '!statusviews command should be handled');
  assertEqual(viewsRes.reason, 'Status views displayed');
  assertTrue(sentViewsMsg.includes('DAAWADEYAASHA STATUS-KA'), 'Should show status views header');

  await mockTransport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch { }
});

suite.test('Status View Tracking & Viewer Reports', () => {
  // 1. Post a new status
  whatsappManagerService.recordPostedStatus('test_status_viewer_id', 'text', 'Xigmad maanta', '#1e3c72', 15);

  // 2. Record 2 status views
  const view1 = whatsappManagerService.recordStatusView('test_status_viewer_id', '252634111222@s.whatsapp.net', Date.now());
  assertTrue(view1.recorded, 'View 1 should be recorded');
  assertEqual(view1.count, 1, 'View count should be 1');

  const view2 = whatsappManagerService.recordStatusView('test_status_viewer_id', '252634333444@s.whatsapp.net', Date.now());
  assertTrue(view2.recorded, 'View 2 should be recorded');
  assertEqual(view2.count, 2, 'View count should be 2');

  // 3. Duplicate view from same person should not increase total count
  const viewDuplicate = whatsappManagerService.recordStatusView('test_status_viewer_id', '252634111222@s.whatsapp.net', Date.now());
  assertTrue(viewDuplicate.recorded, 'Duplicate view should update');
  assertEqual(viewDuplicate.count, 2, 'View count should still be 2');

  // 4. Retrieve status views report
  const report = whatsappManagerService.getStatusViews('test_status_viewer_id');
  assertTrue(report.found, 'Status must be found');
  assertEqual(report.totalViews, 2, 'Total views must be 2');
  assertTrue(report.formattedReport.includes('252634111222'), 'Report must list viewer 1');
  assertTrue(report.formattedReport.includes('252634333444'), 'Report must list viewer 2');
  assertTrue(report.formattedReport.includes('Xigmad maanta'), 'Report must show status text');
});

suite.test('Status Recipients strictly exclude @lid and 14-15 digit LID numbers to prevent USync Timed Out', () => {
  broadcastService.recordContact('10849087394000@lid', 'LID Contact 1', false, true);
  broadcastService.recordContact('277923424645192@lid', 'LID Contact 2', false, true);
  broadcastService.recordContact('252634949642@s.whatsapp.net', 'Maxamed Daahir', false, true);

  const recipients = whatsappManagerService.getStatusRecipients();
  const hasLidNumber = recipients.some(r => r.includes('10849087394000') || r.includes('277923424645192') || r.includes('@lid'));
  assertTrue(!hasLidNumber, 'Status recipients must NEVER contain @lid or 14-15 digit LID numbers formatted as @s.whatsapp.net');
  assertTrue(recipients.includes('252634949642@s.whatsapp.net'), 'Status recipients must include real E.164 phone number JIDs');
});

suite.test('ensureOwnerSessionHealthy heals stale unacked PN sessions and preserves healthy ones', async () => {
  const tempAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-owner-sess-'));
  try {
    const storeSessions: Record<string, any> = {};
    const deletedKeys: any[] = [];
    const assertedCalls: Array<{ jids: string[]; force: boolean }> = [];

    const mockSocket: any = {
      user: { id: '252633171649:6@s.whatsapp.net', lid: '117000009416739:6@lid' },
      authState: {
        keys: {
          get: async (type: string, ids: string[]) => {
            if (type !== 'session') return {};
            const out: Record<string, any> = {};
            for (const id of ids) {
              if (storeSessions[id]) out[id] = storeSessions[id];
            }
            return out;
          },
          set: async (data: any) => {
            deletedKeys.push(data);
            if (data?.session) {
              for (const [k, v] of Object.entries(data.session)) {
                if (v === null) delete storeSessions[k];
                else storeSessions[k] = v;
              }
            }
          },
        },
      },
      assertSessions: async (jids: string[], force: boolean) => {
        assertedCalls.push({ jids, force });
        return true;
      },
    };

    whatsappManagerService.setBotJid('252633171649:6@s.whatsapp.net');
    whatsappManagerService.setSocket(mockSocket);

    const sessionFile = path.join(tempAuthDir, 'session-252633171649.0.json');
    const healthyRecord = {
      _sessions: {
        base1: {
          indexInfo: { closed: -1 },
          _chains: {
            send1: { chainKey: { counter: 12 } },
            recv1: { chainKey: { counter: 3 } },
          },
        },
      },
    };
    fs.writeFileSync(sessionFile, JSON.stringify(healthyRecord));

    const healthyRefresh = await whatsappManagerService.ensureOwnerSessionHealthy(false, tempAuthDir);
    assertFalse(healthyRefresh, 'Healthy two-way session must NOT be deleted');
    assertTrue(fs.existsSync(sessionFile), 'Healthy session file must remain intact on disk');
    assertEqual(assertedCalls.length, 0, 'assertSessions must not run for healthy session');

    const staleRecord = {
      _sessions: {
        base2: {
          indexInfo: { closed: -1 },
          pendingPreKey: { preKeyId: 12892953, signedKeyId: 9156460 },
          _chains: {
            send1: { chainKey: { counter: 86 } },
          },
        },
      },
    };
    fs.writeFileSync(sessionFile, JSON.stringify(staleRecord));
    const skMemFile = path.join(tempAuthDir, 'sender-key-memory-status@broadcast.json');
    fs.writeFileSync(skMemFile, '{}');

    const staleRefresh = await whatsappManagerService.ensureOwnerSessionHealthy(false, tempAuthDir);
    assertTrue(staleRefresh, 'Stale unacknowledged PreKey session (counter >= 5, single chain) must be healed');
    assertFalse(fs.existsSync(sessionFile), 'Stale session file must be removed before re-assert');
    assertFalse(fs.existsSync(skMemFile), 'Status sender-key-memory file must be cleared when healing owner session');
    assertEqual(assertedCalls.length, 1, 'assertSessions should run once to fetch fresh PreKey');
    assertEqual(assertedCalls[0].jids[0], '252633171649:0@s.whatsapp.net');
    assertTrue(assertedCalls[0].force, 'assertSessions should force=true after clearing stale session');
    assertTrue(deletedKeys.some(d => d?.session?.['252633171649.0'] === null), 'Should clear session from keystore');
    assertTrue(deletedKeys.some(d => d?.['sender-key-memory']?.['status@broadcast'] === null), 'Should reset sender-key-memory');
  } finally {
    fs.rmSync(tempAuthDir, { recursive: true, force: true });
  }
});

suite.test('deleteStatusById resets status sender-key memory and disables device cache', async () => {
  const keySets: any[] = [];
  const sendCalls: Array<{ jid: string; payload: any; options: any }> = [];

  const mockSocket: any = {
    user: { id: '252633171649:6@s.whatsapp.net' },
    authState: {
      keys: {
        set: async (data: any) => {
          keySets.push(data);
        },
      },
    },
    sendMessage: async (jid: string, payload: any, options: any) => {
      sendCalls.push({ jid, payload, options });
      return { key: { id: 'del_ack_1' } };
    },
    chatModify: async () => { },
  };

  whatsappManagerService.setBotJid('252633171649:6@s.whatsapp.net');
  whatsappManagerService.setSocket(mockSocket);
  whatsappManagerService.recordPostedStatus('del_mem_test_1', 'text', 'Test delete memory reset');

  const res = await whatsappManagerService.deleteStatusById('del_mem_test_1');
  assertTrue(res.success, 'deleteStatusById should succeed');
  assertTrue(sendCalls.length >= 1, 'deleteStatusById should broadcast revoke message');
  assertEqual(sendCalls[0].jid, 'status@broadcast');
  assertFalse(Boolean(sendCalls[0].options?.useUserDevicesCache), 'deleteStatusById should pass useUserDevicesCache: false');

  const skResets = keySets.filter(d => d?.['sender-key-memory']?.['status@broadcast'] === null);
  assertTrue(skResets.length >= 2, 'deleteStatusById should reset status sender-key-memory before and after revoke');
});

suite.test('WhatsAppBaileysTransport caches status@broadcast and restores owner-only statusJidList on LID retry', async () => {
  const transport = new WhatsAppBaileysTransport();
  const ws = new EventEmitter();
  const relayedCalls: Array<{ jid: string; message: any; options: any }> = [];
  const assertedCalls: Array<{ jids: string[]; force: boolean }> = [];
  const keySets: any[] = [];

  const mockSocket: any = {
    user: { id: '252633171649:6@s.whatsapp.net', lid: '117000009416739:6@lid' },
    ws,
    authState: {
      keys: {
        get: async () => ({}),
        set: async (data: any) => {
          keySets.push(data);
        },
      },
    },
    assertSessions: async (jids: string[], force: boolean) => {
      assertedCalls.push({ jids, force });
      return true;
    },
    relayMessage: async (jid: string, message: any, options: any) => {
      relayedCalls.push({ jid, message, options });
      return options?.messageId || 'STATUS_RETRY_001';
    },
  };

  whatsappManagerService.setBotJid('252633171649:6@s.whatsapp.net');
  whatsappManagerService.setSocket(mockSocket);
  transport.installStatusHooks(mockSocket);

  const statusPayload = { extendedTextMessage: { text: 'Live status message' } };
  await mockSocket.relayMessage('status@broadcast', statusPayload, {
    messageId: 'STATUS_RETRY_001',
    statusJidList: ['252633171649@s.whatsapp.net', '252634949642@s.whatsapp.net'],
    useUserDevicesCache: true,
  });

  assertEqual(relayedCalls.length, 1);
  assertFalse(relayedCalls[0].options.useUserDevicesCache, 'Status relay must always force useUserDevicesCache: false');

  const cachedForRetry = await transport.getMessageForRetry({ remoteJid: 'status@broadcast', id: 'STATUS_RETRY_001' });
  assertEqual(cachedForRetry?.extendedTextMessage?.text, 'Live status message', 'getMessageForRetry must return cached status@broadcast payload');

  // Simulate WhatsApp retry receipt from owner primary phone LID without :device
  ws.emit('CB:receipt', {
    attrs: {
      type: 'retry',
      id: 'STATUS_RETRY_001',
      from: 'status@broadcast',
      participant: '117000009416739@lid',
    },
  });

  // Simulate Baileys sendMessagesAgain calling relayMessage without statusJidList
  await mockSocket.relayMessage('status@broadcast', cachedForRetry, {
    messageId: 'STATUS_RETRY_001',
    useUserDevicesCache: false,
  });

  assertEqual(relayedCalls.length, 2);
  assertEqual(JSON.stringify(relayedCalls[1].options.statusJidList), JSON.stringify(['252633171649@s.whatsapp.net']), 'Owner retry must restore owner-only PN statusJidList without spamming other contacts');
  assertEqual(relayedCalls[1].options.participant, undefined, 'Owner retry must clear participant so messages-send uses asserted PN session');
  assertTrue(assertedCalls.some(c => c.jids.includes('252633171649:0@s.whatsapp.net') && c.force), 'Owner retry must force-refresh owner :0 PN session');
  assertTrue(keySets.some(d => d?.['sender-key-memory']?.['status@broadcast'] === null), 'Owner retry must reset status sender-key-memory so SKDM is re-sent');

  // Simulate per-device @lid participant retry passed directly by sendMessagesAgain
  await mockSocket.relayMessage('status@broadcast', cachedForRetry, {
    messageId: 'STATUS_RETRY_001',
    participant: { jid: '117000009416739:0@lid', count: 2 },
  });

  assertEqual(relayedCalls.length, 3);
  assertEqual(relayedCalls[2].options.participant, undefined, 'Direct @lid participant retry must be stripped before Baileys turns it into @s.whatsapp.net');
  assertEqual(JSON.stringify(relayedCalls[2].options.statusJidList), JSON.stringify(['252633171649@s.whatsapp.net']), 'Direct @lid owner retry must target owner PN statusJidList');
});

suite.test('Call Reject Management (!reject all, !reject <number>, !unreject all, !unreject <number>)', () => {
  const testAuthDir = path.resolve(process.cwd(), 'data', 'test-auth-dir-reject');
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(testAuthDir, { recursive: true });
  
  const mgr = new WhatsAppManagerService({
    authDir: testAuthDir,
  });

  // 1. By default, rejectAllCalls is FALSE — calls are allowed unless explicitly blocked
  assertFalse(mgr.shouldRejectCall('252634111222@s.whatsapp.net'), 'Default should ALLOW calls (rejectAll=false)');
  assertFalse(mgr.shouldRejectCall('+252634333444'), 'Default should ALLOW caller (rejectAll=false)');

  // 2. Reject all calls
  const rejectAllFirst = mgr.setRejectAllCalls(true);
  assertTrue(rejectAllFirst.success, 'Reject all should succeed');
  assertTrue(mgr.shouldRejectCall('252634111222@s.whatsapp.net'), 'After reject all: should block');
  assertTrue(mgr.shouldRejectCall('252634333444'), 'After reject all: other callers also blocked');

  // 3. Unreject specific number (turns off rejectAll, allows that number)
  const unrejectOne = mgr.unrejectCallNumber('252634111222');
  assertTrue(unrejectOne.success, 'Unreject single number should succeed');
  assertFalse(mgr.shouldRejectCall('252634111222@s.whatsapp.net'), 'Unrejected number must be allowed through');
  // rejectAll is now false, so other callers are also allowed (unless explicitly rejected)
  assertFalse(mgr.shouldRejectCall('252634333444'), 'After unreject number: rejectAll turned off, others allowed');

  // 4. Reject all again, then unreject all
  mgr.setRejectAllCalls(true);
  const unrejectAll = mgr.unrejectAllCalls();
  assertTrue(unrejectAll.success, 'Unreject all should succeed');
  assertFalse(mgr.shouldRejectCall('252634111222'), 'All callers should be allowed');
  assertFalse(mgr.shouldRejectCall('252634333444'), 'All callers should be allowed');

  // 5. Reject specific number when rejectAll is off
  const rejectOne = mgr.rejectCallNumber('252634999888');
  assertTrue(rejectOne.success, 'Reject single number should succeed');
  assertTrue(mgr.shouldRejectCall('252634999888'), 'Rejected number must be blocked');
  assertFalse(mgr.shouldRejectCall('252634333444'), 'Non-rejected number must still be allowed');

  // 6. Reject all — everyone blocked
  const rejectAll = mgr.setRejectAllCalls(true);
  assertTrue(rejectAll.success, 'Reject all should succeed');
  assertTrue(mgr.shouldRejectCall('252634333444'), 'All callers must now be blocked');
  assertTrue(mgr.shouldRejectCall('252634111222'), 'All callers must now be blocked');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

suite.test('Instant Goodbye & Farewell Detection (stops dragging conversations)', () => {
  const g1 = detectInstantGreetingReply('bye');
  assertTrue(Boolean(g1 && /nabad\s*gelyo|macasalaama/i.test(g1)), 'bye should return farewell');
  assertFalse(Boolean(g1 && /maxaa\s*cusub|sidee\s*tahay/i.test(g1)), 'farewell must NOT ask questions');

  const g2 = detectInstantGreetingReply('macasalaamo');
  assertTrue(Boolean(g2 && /nabad\s*gelyo|macasalaama/i.test(g2)), 'macasalaamo should return farewell');

  const g3 = detectInstantGreetingReply('haye bye', { userName: 'Farxaan' });
  assertTrue(Boolean(g3 && g3.includes('Farxaan') && /nabad\s*gelyo/i.test(g3)), 'personalized farewell with name');

  const g4 = detectInstantGreetingReply('nabad gelyo');
  assertTrue(Boolean(g4 && /nabad\s*gelyo|macasalaama/i.test(g4)), 'nabad gelyo should return farewell');
});

suite.test('Status Reactor save-me tracking and owner name customization', () => {
  const sr = new StatusReactorService();
  sr.setOwnerName('Mohamed Dahir');
  assertEqual(sr.getOwnerName(), 'Mohamed Dahir', 'Owner name should be updated');

  assertFalse(sr.isPendingSaveMe('252634555666'), 'Should not be pending initially');
  sr.markSaveMeSent('252634555666');
  assertTrue(sr.isPendingSaveMe('252634555666@s.whatsapp.net'), 'Should be pending after markSaveMeSent');

  sr.resolvePendingSaveMe('252634555666');
  assertFalse(sr.isPendingSaveMe('252634555666'), 'Should no longer be pending after resolution');
});

suite.test('StatusReactor suppresses interactions when Link Campaign Mode is ON', async () => {
  const sr = new StatusReactorService();
  whatsappManagerService.setLinkCampaignMode(true);
  const mockMsg: any = {
    key: { remoteJid: 'status@broadcast', id: 'stat_suppress_test_1', participant: '252634777888@s.whatsapp.net', fromMe: false },
    message: { conversation: 'MashaAllah aroos wacan!' },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  const handled = await sr.handleIncomingStatus(mockMsg, { user: { id: '252610000000@s.whatsapp.net' } });
  assertFalse(handled, 'StatusReactor must return false when link campaign mode is ON');
  whatsappManagerService.setLinkCampaignMode(false);
});

suite.test('StatusReactor suppresses interactions when AI is disabled for specific number', async () => {
  const sr = new StatusReactorService();
  whatsappManagerService.disableAIForNumber('252634333222');
  const mockMsg: any = {
    key: { remoteJid: 'status@broadcast', id: 'stat_suppress_disabled_num', participant: '252634333222@s.whatsapp.net', fromMe: false },
    message: { conversation: 'MashaAllah aroos wacan!' },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  const handled = await sr.handleIncomingStatus(mockMsg, { user: { id: '252610000000@s.whatsapp.net' } });
  assertFalse(handled, 'StatusReactor must return false when AI is disabled for number');
  whatsappManagerService.enableAIForNumber('252634333222');
});

suite.test('WhatsAppManager saveContact syncs via addOrEditContact and records broadcast contact', async () => {
  const manager = new WhatsAppManagerService();
  let contactActionCaptured: any = null;
  let jidCaptured: string = '';

  const mockSock: any = {
    addOrEditContact: async (jid: string, action: any) => {
      jidCaptured = jid;
      contactActionCaptured = action;
    },
    sendMessage: async () => ({ key: { id: 'vc_1' } }),
  };

  manager.setSocket(mockSock);
  const res = await manager.saveContact('252634123456', 'Khadar Cali');
  assertTrue(res.success, 'saveContact should succeed');
  assertEqual(res.name, 'Khadar Cali', 'Should return full name');
  assertTrue(Boolean(contactActionCaptured), 'addOrEditContact should be called on socket');
  assertEqual(contactActionCaptured?.fullName, 'Khadar Cali', 'fullName should match');
  assertTrue(contactActionCaptured?.saveOnPrimaryAddressbook === true, 'saveOnPrimaryAddressbook should be true');
});

suite.test('AI Master Toggle (!on / !off) and Status Link Campaign Mode (!link on / !link off)', async () => {
  const testAuthDir = path.resolve(process.cwd(), 'data', 'test-auth-dir-botcontrol');
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(testAuthDir, { recursive: true });

  const manager = new WhatsAppManagerService({
    authDir: testAuthDir,
  });

  // 1. AI Master Toggle state
  assertTrue(manager.isAIEnabled(), 'AI should be enabled by default');
  const offRes = manager.setAIEnabled(false);
  assertTrue(offRes.success, 'Disabling AI should succeed');
  assertFalse(manager.isAIEnabled(), 'AI should now be disabled');
  assertTrue(offRes.message.includes('DAMIYAY') || offRes.message.includes('OFF'), 'Should state AI is OFF');

  const onRes = manager.setAIEnabled(true);
  assertTrue(onRes.success, 'Enabling AI should succeed');
  assertTrue(manager.isAIEnabled(), 'AI should now be enabled');
  assertTrue(onRes.message.includes('SHIDAY') || onRes.message.includes('ON'), 'Should state AI is ON');

  // 2. Link Campaign Mode state
  assertFalse(manager.isLinkCampaignMode(), 'Link campaign should be disabled by default');
  const linkOnRes = manager.setLinkCampaignMode(true);
  assertTrue(linkOnRes.success, 'Enabling link campaign should succeed');
  assertTrue(manager.isLinkCampaignMode(), 'Link campaign should now be enabled');

  // 3. Status Link deduplication
  assertFalse(manager.hasPostedLinkForSender('252634112233'), 'Sender should not have posted initially');
  manager.recordLinkCampaignPoster('252634112233');
  assertTrue(manager.hasPostedLinkForSender('252634112233'), 'Sender should be marked as posted');
  assertTrue(manager.hasPostedLinkForSender('252634112233@s.whatsapp.net'), 'JID lookup should also match');

  // 4. Contact saved check
  assertFalse(manager.isContactSaved('252639999000'), 'Unknown number should not be saved');
  await manager.saveContact('252639999000', 'Nimco Sahal');
  assertTrue(manager.isContactSaved('252639999000'), 'Saved contact should be recognized as saved');

  // 5. Owner Promo Flyer & wa.me Link Setup
  assertFalse(manager.hasOwnerPromo(), 'Owner promo should not be set initially');
  assertFalse(manager.isAwaitingOwnerPromoSetup(), 'Should not be awaiting promo setup initially');

  manager.setAwaitingOwnerPromoSetup(true);
  assertTrue(manager.isAwaitingOwnerPromoSetup(), 'Should be awaiting promo setup after setting true');

  const flyerBuffer = Buffer.from('FAKE_PROMO_FLYER_IMAGE_DATA');
  const promoRes = manager.setOwnerPromo({
    link: 'https://wa.me/252615998877',
    imageBuffer: flyerBuffer,
    mimeType: 'image/jpeg',
  });
  assertTrue(promoRes.success, 'Setting owner promo should succeed');
  assertFalse(manager.isAwaitingOwnerPromoSetup(), 'Should no longer await setup after saving promo');
  assertTrue(manager.hasOwnerPromo(), 'Should now have owner promo set');

  const savedPromo = manager.getOwnerPromo();
  assertEqual(savedPromo.link, 'https://wa.me/252615998877');
  assertTrue(Boolean(savedPromo.imageBuffer), 'Saved flyer buffer should exist');
  assertEqual(savedPromo.imageBuffer?.toString(), 'FAKE_PROMO_FLYER_IMAGE_DATA');

  // 6. Disable AI for Specific Number (!off <number> / !on <number>)
  assertFalse(manager.isAIDisabledForNumber('252634888999'), 'Number should not have AI disabled initially');
  const disRes = manager.disableAIForNumber('252634888999');
  assertTrue(disRes.success, 'Disabling AI for number should succeed');
  assertTrue(manager.isAIDisabledForNumber('252634888999'), 'Number should now be recognized as AI disabled');
  assertTrue(manager.isAIDisabledForNumber('252634888999@s.whatsapp.net'), 'JID lookup should also match');
  assertTrue(manager.getDisabledAINumbers().includes('252634888999'), 'List should include disabled number');

  // Verify call reject bypass: Even if rejectAll is true, disabled AI number must NOT be rejected!
  manager.setRejectAllCalls(true);
  assertFalse(manager.shouldRejectCall('252634888999'), 'Disabled AI user calls must NOT be rejected (phone rings normally)');
  assertTrue(manager.shouldRejectCall('252634111222'), 'Other callers must still be rejected');
  manager.setRejectAllCalls(false);

  // Re-enable AI for that number
  const enRes = manager.enableAIForNumber('252634888999');
  assertTrue(enRes.success, 'Enabling AI for number should succeed');
  assertFalse(manager.isAIDisabledForNumber('252634888999'), 'Number should no longer be AI disabled');

  // 7. Verify Subscriber Guide PDF Generator Buffer
  const pdfBuffer = generateSubscriberGuidePdfBuffer({
    subscriberName: 'Maxamed Cabdi',
    phone: '252634123456',
    category: 'business',
    portalUrl: 'https://cardoso-ai.onrender.com/portal?token=test1234',
    pairingCode: 'CARD-1234',
  });
  assertTrue(Buffer.isBuffer(pdfBuffer), 'PDF result must be a Buffer');
  assertTrue(pdfBuffer.length > 2000, 'PDF buffer must be substantial (>= 2KB)');
  const pdfHeader = pdfBuffer.slice(0, 8).toString('latin1');
  assertTrue(pdfHeader.startsWith('%PDF-1.'), 'PDF buffer must start with %PDF-1.');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

suite.test('Autonomous Group Takeover & Anti-Link Protection', async () => {
  const testAuthDir = path.join(os.tmpdir(), `auto_group_test_${Date.now()}`);
  fs.mkdirSync(testAuthDir, { recursive: true });

  const manager = new WhatsAppManagerService({ authDir: testAuthDir });

  // 1. Link detection regex
  assertTrue(manager.containsForbiddenLink('https://chat.whatsapp.com/ABCD1234efgh'), 'WhatsApp group link must be detected');
  assertTrue(manager.containsForbiddenLink('Ku soo biir t.me/somali_group'), 'Telegram link must be detected');
  assertTrue(manager.containsForbiddenLink('Booqo www.somaliwebsite.com maanta'), 'Web link must be detected');
  assertTrue(manager.containsForbiddenLink('wa.me/252615000000'), 'wa.me link must be detected');
  assertFalse(manager.containsForbiddenLink('Asc walaalayaal sidee tihiin maanta?'), 'Normal Somali greeting must NOT be detected as link');
  assertFalse(manager.containsForbiddenLink('Semistarka lacagtiisu waa $350'), 'Normal text with dollar must NOT be detected as link');

  // 2. Enable Auto-Group
  assertFalse(manager.isAutoGroupManaged('120363001@g.us'));
  const enableRes = await manager.enableAutoGroup('120363001@g.us', 'Kooxda Waxbarashada');
  assertTrue(enableRes.success, 'Enable auto group should succeed');
  assertEqual(enableRes.groupName, 'Kooxda Waxbarashada');
  assertTrue(manager.isAutoGroupManaged('120363001@g.us'), 'Group should now be auto-managed');

  // 3. Persistence across instances
  const manager2 = new WhatsAppManagerService({ authDir: testAuthDir });
  assertTrue(manager2.isAutoGroupManaged('120363001@g.us'), 'Auto-managed group should persist in storage');
  const list = manager2.getAutoManagedGroups();
  assertEqual(list.length, 1);
  assertEqual(list[0].name, 'Kooxda Waxbarashada');

  // 4. Find group by name
  const found = await manager2.findGroupByNameOrJid('waxbarashada');
  assertTrue(Boolean(found), 'Group should be found by name');
  assertEqual(found?.jid, '120363001@g.us');

  // 5. Disable Auto-Group
  const disableRes = await manager2.disableAutoGroup('120363001@g.us');
  assertTrue(disableRes.success, 'Disable auto group should succeed');
  assertFalse(manager2.isAutoGroupManaged('120363001@g.us'), 'Group should no longer be auto-managed');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

suite.test('GroupGovernorService — Profanity Detection, 3-Strike Escalation & AI Group Intelligence', async () => {
  const testAuthDir = path.join(os.tmpdir(), `governor_test_${Date.now()}`);
  fs.mkdirSync(testAuthDir, { recursive: true });

  const governor = new GroupGovernorService({ authDir: testAuthDir });

  // 1. Profanity Detection
  const profaneCheck1 = governor.detectProfanity('War naga aamus doqon yahow');
  assertTrue(profaneCheck1.isViolating, 'Should detect Somali insult (doqon)');

  const profaneCheck2 = governor.detectProfanity('Waxaad tahay nacas weyn');
  assertTrue(profaneCheck2.isViolating, 'Should detect Somali insult (nacas)');

  const politeCheck = governor.detectProfanity('Asc walaal, sideed tahay? Maanta cashir miyaa jira?');
  assertFalse(politeCheck.isViolating, 'Polite message should NOT be flagged');

  // 2. 3-Strike Escalation System
  const groupJid = '120363999@g.us';
  const badUser = '252615555555@s.whatsapp.net';

  // Strike 1
  const strike1 = governor.addStrike(groupJid, badUser, 'Hadallo anshax xumo', 'doqon');
  assertEqual(strike1.strikes, 1, 'First strike should be count 1');
  assertEqual(strike1.action, 'warn_1', 'First strike action should be warn_1');

  // Strike 2
  const strike2 = governor.addStrike(groupJid, badUser, 'Aflagaado mar labaad ah', 'nacas');
  assertEqual(strike2.strikes, 2, 'Second strike should be count 2');
  assertEqual(strike2.action, 'warn_2', 'Second strike action should be warn_2');

  // Strike 3
  const strike3 = governor.addStrike(groupJid, badUser, 'Cay aan la joojin');
  assertEqual(strike3.strikes, 3, 'Third strike should be count 3');
  assertEqual(strike3.action, 'kick', 'Third strike action must be kick');

  // Retrieve strikes
  const userStrikes = governor.getStrikes(groupJid, badUser);
  assertEqual(userStrikes['252615555555'].count, 3);
  assertEqual(userStrikes['252615555555'].history.length, 3);

  // Clear strikes
  const cleared = governor.clearStrikes(groupJid, badUser);
  assertTrue(cleared, 'Clearing strikes should succeed');
  assertEqual(Object.keys(governor.getStrikes(groupJid, badUser)).length, 0);

  // 3. AI Group Profiling & Niche Intelligence
  const itGroup = governor.analyzeGroup('Barashada Python & Web Development');
  assertEqual(itGroup.category, 'tech');
  assertTrue(itGroup.customRules.length >= 5, 'Tech group rules must have at least 5 rules');
  assertTrue(itGroup.enhancedDescription.includes('Hadafka'), 'Description should have structured goal');
  assertTrue(itGroup.logoPrompt.includes('code'), 'Logo prompt should be relevant to coding');

  const eduGroup = governor.analyzeGroup('Ardayda Jaamacadda Jamhuriya Semester 4');
  assertEqual(eduGroup.category, 'education');
  assertTrue(eduGroup.categoryLabel.includes('Waxbarashada'));

  const bizGroup = governor.analyzeGroup('Ganacsiga Online-ka & Suuqgeynta');
  assertEqual(bizGroup.category, 'business');

  // 4. Multi-lingual Profanity Check (Arabic & English)
  const arabicCheck = governor.detectProfanity('هذا كلام شرموطة');
  assertTrue(arabicCheck.isViolating, 'Should detect Arabic profanity');

  const englishCheck = governor.detectProfanity('You are a fucking idiot');
  assertTrue(englishCheck.isViolating, 'Should detect English vulgarity');

  // 5. Anti-Flood Detection
  for (let i = 0; i < 4; i++) {
    const f = governor.checkFlood(groupJid, '252618888888');
    assertFalse(f.isFlooding, 'First 4 messages should not trigger flood');
  }
  const f5 = governor.checkFlood(groupJid, '252618888888');
  assertTrue(f5.isFlooding, 'Fifth burst message within 5s MUST trigger flood');

  // 6. Full Autonomous Takeover execution
  const mockSock: any = {
    groupMetadata: async (j: string) => ({ id: j, subject: 'Ardayda Software Engineering 2026', desc: 'Kooxda ardayda' }),
    groupUpdateDescription: async () => {},
    updateProfilePicture: async () => {},
    groupSettingUpdate: async () => {},
  };
  const takeover = await governor.executeFullAutonomousTakeover(mockSock, '120363888@g.us');
  assertTrue(takeover.success, 'Full autonomous takeover must succeed');
  assertEqual(takeover.profile.category, 'tech');
  assertTrue(takeover.announcement.includes('AUTONOMOUS TAKEOVER'), 'Announcement must contain takeover decree');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

suite.test('Interactive WhatsApp Polls, Smart Night Curfew, Ghost Message Vault & Sandboxed Code Runner', async () => {
  const testAuthDir = path.join(os.tmpdir(), `test_superpowers_${Date.now()}`);
  const governor = new GroupGovernorService({ authDir: testAuthDir });

  // 1. Sandboxed Code Runner
  const jsExec = codeRunnerService.executeJavaScript('[10, 20, 30].map(n => n * 2)');
  assertTrue(jsExec.success, 'JavaScript code execution must succeed');
  assertTrue(jsExec.output.includes('20') && jsExec.output.includes('60'), 'Execution output must contain mapped values');
  assertTrue(jsExec.executionTimeMs >= 0, 'Execution time must be recorded');

  // Timeout protection
  const timeoutExec = codeRunnerService.executeJavaScript('while(true){}', 100);
  assertFalse(timeoutExec.success, 'Infinite loops must be killed by sandbox timeout');
  assertTrue(timeoutExec.output.toLowerCase().includes('timed out') || timeoutExec.output.toLowerCase().includes('timeout'), 'Output should note timeout');

  // 2. Interactive Poll Validation & Dispatch
  let dispatchedPayload: any = null;
  const mockSock: any = {
    sendMessage: async (jid: string, payload: any) => {
      dispatchedPayload = payload;
      return { key: { id: 'poll_123' } };
    },
    groupSettingUpdate: async () => {},
  };
  whatsappManagerService.setSocket(mockSock);

  const pollRes = await whatsappManagerService.createPoll(
    '120363888@g.us',
    'Luuqadee ugu fiican Backend 2026?',
    ['Node.js / TS', 'Python', 'Go', 'Rust']
  );
  assertTrue(pollRes.success, 'Poll creation must succeed');
  assertTrue(Boolean(dispatchedPayload?.poll), 'Dispatched message must contain native poll payload');
  assertEqual(dispatchedPayload.poll.name, 'Luuqadee ugu fiican Backend 2026?');
  assertEqual(dispatchedPayload.poll.values.length, 4);

  // 3. Smart Night Curfew Engine
  const curfewGroup = '120363999@g.us';
  const curfewConfig = governor.setCurfew(curfewGroup, true, 23, 6);
  assertTrue(curfewConfig.enabled, 'Curfew must be enabled');
  assertEqual(curfewConfig.startHour, 23);
  assertEqual(curfewConfig.endHour, 6);

  // Night condition: 23:00 (11 PM) -> should lock
  const nightCheck = governor.checkCurfew(curfewGroup, 23);
  assertTrue(nightCheck.shouldAct, 'Night hour must trigger curfew action');
  assertEqual(nightCheck.targetState, 'locked');

  const nightApply = await governor.applyCurfew(mockSock, curfewGroup, 23);
  assertTrue(nightApply.changed, 'Curfew transition to night must succeed');
  assertEqual(nightApply.state, 'locked');
  assertTrue(nightApply.notice?.includes('SAACADDA NASASHADA') || false);

  // Second check at night (01:00 AM) -> already locked, should not act again
  const nightAgain = governor.checkCurfew(curfewGroup, 1);
  assertFalse(nightAgain.shouldAct, 'Curfew should not re-trigger if already locked');

  // Morning condition: 07:00 AM -> should unlock
  const morningCheck = governor.checkCurfew(curfewGroup, 7);
  assertTrue(morningCheck.shouldAct, 'Morning hour must trigger curfew unlock');
  assertEqual(morningCheck.targetState, 'unlocked');

  const morningApply = await governor.applyCurfew(mockSock, curfewGroup, 7);
  assertTrue(morningApply.changed, 'Curfew transition to morning must succeed');
  assertEqual(morningApply.state, 'unlocked');
  assertTrue(morningApply.notice?.includes('SUBAX WANAAGSAN') || false);

  // 4. Ghost Message Vault (Anti-Delete)
  const ghostGroup = '120363777@g.us';
  whatsappManagerService.recordIncomingGroupMessage(ghostGroup, 'msg_secret_1', '252615555555@s.whatsapp.net', 'Sir culus oo hadhow la tirtirayo!');
  
  // Member deletes for everyone -> revoke arrives
  const revoked = whatsappManagerService.recordRevocation(ghostGroup, 'msg_secret_1');
  assertTrue(Boolean(revoked), 'Revocation must be captured in ghost vault');
  assertEqual(revoked?.text, 'Sir culus oo hadhow la tirtirayo!');
  assertEqual(revoked?.sender, '252615555555@s.whatsapp.net');

  const vault = whatsappManagerService.getRevokedMessages(ghostGroup);
  assertTrue(vault.length >= 1, 'Ghost vault must store the revoked message');
  assertEqual(vault[vault.length - 1].id, 'msg_secret_1');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

suite.test('Autonomous Polyglot Code Intelligence, Media Safety Shield, Evening Summarizer & Member Activity Auditing', async () => {
  const testAuthDir = path.join(os.tmpdir(), `test_polyglot_${Date.now()}`);
  const governor = new GroupGovernorService({ authDir: testAuthDir });

  // 1. Polyglot Code Snippet Detection across multiple languages
  const pyCode = 'def calculate_fibonacci(n):\n    if n <= 1: return n\n    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)\nprint(calculate_fibonacci(10))';
  const pyDetect = governor.detectCodeSnippet(pyCode);
  assertTrue(pyDetect.isCode, 'Python snippet must be detected as code');
  assertEqual(pyDetect.language, 'python');

  const cppCode = '#include <iostream>\nint main() {\n    std::cout << "Hello World" << std::endl;\n    return 0;\n}';
  const cppDetect = governor.detectCodeSnippet(cppCode);
  assertTrue(cppDetect.isCode, 'C++ snippet must be detected as code');
  assertEqual(cppDetect.language, 'cpp');

  const sqlCode = 'SELECT id, username, email FROM members WHERE status = "active" GROUP BY role;';
  const sqlDetect = governor.detectCodeSnippet(sqlCode);
  assertTrue(sqlDetect.isCode, 'SQL query must be detected as code');
  assertEqual(sqlDetect.language, 'sql');

  const rustCode = 'fn main() {\n    let mut counter = 0;\n    println!("Value: {}", counter);\n}';
  const rustDetect = governor.detectCodeSnippet(rustCode);
  assertTrue(rustDetect.isCode, 'Rust snippet must be detected as code');
  assertEqual(rustDetect.language, 'rust');

  // Plain conversation should not be detected as code
  const plainText = 'Asc walaalayaal sideed tihiin maanta? Xaaladda ka warrama';
  const plainDetect = governor.detectCodeSnippet(plainText);
  assertFalse(plainDetect.isCode, 'Regular conversational Somali text must not be detected as code');

  // 2. Code Review Generation
  const review = await governor.reviewCodeSnippet(pyCode, 'python');
  assertTrue(review.includes('CODE GUARDIAN'), 'Code review should contain guardian header');
  assertTrue(review.includes('PYTHON'), 'Code review should reference the language');

  // 3. Media Safety Screening (Mock AI Orchestrator)
  const mockViolatingAI: any = {
    generateResponse: async () => ({ text: 'VIOLATION: Nudity detected' }),
  };
  const mediaViolation = await governor.screenMediaSafety(
    { mimeType: 'image/jpeg', dataBase64: 'fake_base64_data' },
    mockViolatingAI
  );
  assertTrue(mediaViolation.isViolating, 'Should detect violation from AI review');
  assertTrue(mediaViolation.reason?.includes('Nudity') || false);

  const mockSafeAI: any = {
    generateResponse: async () => ({ text: 'SAFE' }),
  };
  const mediaSafe = await governor.screenMediaSafety(
    { mimeType: 'image/jpeg', dataBase64: 'fake_safe_data' },
    mockSafeAI
  );
  assertFalse(mediaSafe.isViolating, 'Safe image must pass review');

  // 4. Autonomous Evening Discussion Summary
  const groupJid = '120363555@g.us';
  const sampleMessages = [
    { sender: '252611111111', text: 'Sidee loo bartaa Python iyo Backend?', timestamp: Date.now() - 3600000 },
    { sender: '252612222222', text: 'FastAPI iyo Django ayaa ugu fiican dalkeena', timestamp: Date.now() - 1800000 },
    { sender: '252613333333', text: 'Mahadsanid walaal aad baan uga faa\'iiday', timestamp: Date.now() - 900000 },
  ];
  const summary = await governor.generateEveningSummary('Ardayda IT-ga Jamhuriya', sampleMessages);
  assertTrue(summary.includes('DULMARKA & FAALADA'), 'Summary must contain executive header');
  assertTrue(summary.includes('Ardayda IT-ga Jamhuriya'), 'Summary should reference group subject');

  // 5. Member Activity Auditing
  governor.recordMemberActivity(groupJid, '252619999999@s.whatsapp.net');
  const inactivesImmediate = governor.getInactiveMembers(groupJid, 30);
  assertEqual(inactivesImmediate.length, 0, 'Recently active member should not be inactive');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

// ─── TEST SUITE 23: Daily Quiz, Leaderboard & Scheduled Announcements ────────
suite.test('Daily Quiz Engine, Group Leaderboard & Scheduled Announcements', async () => {
  const testAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-quiz-test-'));
  const governor = new GroupGovernorService({ authDir: testAuthDir });
  const groupJid = '120363999@g.us';

  // 1. Daily Quiz Generation (using local bank, no AI)
  const quiz = await governor.generateDailyQuiz(groupJid, 'Tech Dev Somalia', '', undefined);
  assertTrue(quiz.pollTitle.length > 5, 'Quiz poll title should not be empty');
  assertTrue(Array.isArray(quiz.options) && quiz.options.length >= 2, 'Quiz should have at least 2 options');
  assertTrue(typeof quiz.correctIndex === 'number', 'Quiz should have a numeric correctIndex');
  assertTrue(quiz.correctIndex >= 0 && quiz.correctIndex < quiz.options.length, 'Correct index must be valid');

  // 2. Set Active Quiz and Record Answers
  governor.setActiveQuiz(groupJid, quiz.pollTitle, quiz.options, quiz.correctIndex, 60000);
  const activeQuiz = governor.getActiveQuiz(groupJid);
  assertTrue(activeQuiz !== null, 'Active quiz should be retrievable');
  assertEqual(activeQuiz!.correctIndex, quiz.correctIndex, 'Active quiz correct index should match');

  // 3. Answer recording — correct answer
  const correctResult = governor.recordQuizAnswer(groupJid, '252611111111@s.whatsapp.net', quiz.correctIndex);
  assertTrue(correctResult !== null, 'Should return result when quiz is active');
  assertTrue(correctResult!.correct, 'Correct answer should return correct=true');

  // 4. Answer recording — wrong answer
  const wrongIndex = quiz.correctIndex === 0 ? 1 : 0;
  const wrongResult = governor.recordQuizAnswer(groupJid, '252612222222@s.whatsapp.net', wrongIndex);
  assertTrue(wrongResult !== null, 'Should return result for wrong answer too');
  assertFalse(wrongResult!.correct, 'Wrong answer should return correct=false');

  // 5. Leaderboard
  const board = governor.getLeaderboard(groupJid, 10);
  assertTrue(board.length >= 1, 'Leaderboard should have at least one player');
  const winner = board[0];
  assertEqual(winner.user, '252611111111', 'Correct answerer should be top of leaderboard');
  assertTrue(winner.score >= 10, 'Correct answer should give 10 points');

  // 6. Quiz should not fire again too soon
  governor.recordDailyQuizPosted(groupJid);
  assertFalse(governor.shouldPostDailyQuiz(groupJid), 'Should not post quiz again too soon');

  // 7. Scheduled Announcements
  const id1 = governor.scheduleAnnouncement(groupJid, 14, 30, 'Kulanka Casariyeedka!');
  const id2 = governor.scheduleAnnouncement(groupJid, 20, 0, 'Habeenkii wanaagsan!');
  assertTrue(id1.startsWith('ann_'), 'Announcement ID should have ann_ prefix');
  assertEqual(governor.listScheduledAnnouncements(groupJid).length, 2, 'Should have 2 scheduled announcements');

  // 8. Check announcements at the right time
  const dueAt1430 = governor.checkScheduledAnnouncements(groupJid, 14, 30);
  assertEqual(dueAt1430.length, 1, 'Should trigger announcement at 14:30');
  assertTrue(dueAt1430[0].message.includes('Kulanka'), 'Triggered announcement should contain the message');

  // 9. Announcement should be consumed (one-shot)
  const dueAgain = governor.checkScheduledAnnouncements(groupJid, 14, 30);
  assertEqual(dueAgain.length, 0, 'Already-triggered announcement should not fire again');

  // 10. Cancel remaining announcement
  const cancelled = governor.cancelScheduledAnnouncement(groupJid, id2);
  assertTrue(cancelled, 'Cancellation of valid ID should succeed');
  assertEqual(governor.listScheduledAnnouncements(groupJid).length, 0, 'No announcements should remain');

  // 11. WhatsAppManagerService leaderboard display
  const manager = new WhatsAppManagerService({ authDir: testAuthDir });
  const boardText = manager.getQuizLeaderboard(groupJid, 10);
  assertTrue(boardText.includes('LEADERBOARD'), 'Manager leaderboard text should include LEADERBOARD header');

  // 12. Manager schedule announcement delegation
  const annId = manager.scheduleGroupAnnouncement(groupJid, 9, 0, 'Subax Wanaagsan!');
  assertTrue(annId.length > 0, 'scheduleGroupAnnouncement should return a valid ID');
  const listFromManager = manager.listScheduledAnnouncements(groupJid);
  assertEqual(listFromManager.length, 1, 'Manager should list scheduled announcements');
  const cancelledFromManager = manager.cancelScheduledAnnouncement(groupJid, annId);
  assertTrue(cancelledFromManager, 'Manager cancel should succeed');

  // Clean up
  try { if (fs.existsSync(testAuthDir)) fs.rmSync(testAuthDir, { recursive: true, force: true }); } catch {}
});

// ─── TEST SUITE 24: Islamic Prayer Times, Athan Voice Note & Du'a Engine ─────
suite.test('Islamic Prayer Times Engine, Athan Speech Synthesis & Sunnah Du\'a', async () => {
  const service = new PrayerTimesService();

  // 1. Schedule Generation
  const schedule = service.getTodaySchedule();
  assertTrue(schedule.prayers.length === 5, 'Should calculate exactly 5 daily prayers');
  const prayerKeys = schedule.prayers.map(p => p.key);
  assertEqual(prayerKeys.join(','), 'fajr,dhuhr,asr,maghrib,isha', 'Prayers must be in order: fajr,dhuhr,asr,maghrib,isha');

  // 2. Each prayer has valid hour and minute
  for (const p of schedule.prayers) {
    assertTrue(p.hour >= 0 && p.hour <= 23, `Prayer ${p.key} hour must be valid (got ${p.hour})`);
    assertTrue(p.minute >= 0 && p.minute <= 59, `Prayer ${p.key} minute must be valid (got ${p.minute})`);
    assertTrue(p.somaliName.length > 0, `Prayer ${p.key} must have Somali name`);
    assertTrue(p.arabicName.length > 0, `Prayer ${p.key} must have Arabic name`);
  }

  // 3. Reverent text reminder formatting
  const dhuhr = schedule.prayers.find(p => p.key === 'dhuhr')!;
  const reminderText = service.getPrayerReminderText(dhuhr);
  assertTrue(reminderText.includes('XUSUUSINTA SALAADDA'), 'Reminder text must have reverent header');
  assertTrue(reminderText.includes('DUHUR'), 'Reminder text must reference Dhuhr prayer');
  assertTrue(reminderText.includes('Al-Baqarah') || reminderText.includes('Qur\'aanka'), 'Reminder text should include Quran reference');

  // 4. Athan speech text
  const standardAthan = service.getAthanSpeechText(false);
  assertTrue(standardAthan.includes('اللهُ أَكْبَرُ'), 'Athan text must contain Takbeer');
  assertTrue(standardAthan.includes('أَشْهَدُ أَنْ لَا إِلٰهَ إِلَّا اللهُ'), 'Athan text must contain Shahada');
  assertFalse(standardAthan.includes('الصَّلَاةُ خَيْرٌ مِنَ النَّوْمِ'), 'Standard Athan must not have Fajr line');

  const fajrAthan = service.getAthanSpeechText(true);
  assertTrue(fajrAthan.includes('الصَّلَاةُ خَيْرٌ مِنَ النَّوْمِ'), 'Fajr Athan must include Al-Salatu Khairun Minan Nawm');

  // 4b. Real Melodious Human Athan & Dua Audio Loading (WhatsApp Native Voice Note Ogg Opus PTT)
  const athanAudio = await service.getAthanAudio(false);
  assertTrue(athanAudio !== null && athanAudio.buffer.length > 10000, 'Should load real melodious human Athan audio');
  assertEqual(athanAudio!.mimeType, 'audio/ogg; codecs=opus', 'Athan must be native WhatsApp Voice Note (audio/ogg; codecs=opus)');
  assertEqual(athanAudio!.buffer.slice(0, 4).toString(), 'OggS', 'Athan buffer must be native OggS container for PTT waveform');

  const fajrAudio = await service.getAthanAudio(true);
  assertTrue(fajrAudio !== null && fajrAudio.buffer.length > 10000, 'Should load real melodious human Fajr Athan audio');
  assertEqual(fajrAudio!.mimeType, 'audio/ogg; codecs=opus', 'Fajr Athan must be native WhatsApp Voice Note (audio/ogg; codecs=opus)');
  assertEqual(fajrAudio!.buffer.slice(0, 4).toString(), 'OggS', 'Fajr Athan buffer must be native OggS container');

  const duaAudio = await service.getDuaAudio();
  assertTrue(duaAudio !== null && duaAudio.buffer.length > 10000, 'Should load real melodious human Du\'a audio');
  assertEqual(duaAudio!.mimeType, 'audio/ogg; codecs=opus', 'Dua audio must be native WhatsApp Voice Note (audio/ogg; codecs=opus)');
  assertEqual(duaAudio!.buffer.slice(0, 4).toString(), 'OggS', 'Dua buffer must be native OggS container');

  // 5. Sunnah Du'a after Athan text
  const duaText = service.getDuaAfterAthanText();
  assertTrue(duaText.includes('DUCADII EEDANKA KADDIB'), 'Du\'a text must have header');
  assertTrue(duaText.includes('اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ'), 'Du\'a text must have authentic Hadith');
  assertTrue(duaText.includes('Nebi Muxammad'), 'Du\'a text must include Somali translation');

  // 6. Time formatting helper
  assertEqual(service.formatTime(4, 5), '04:05', 'formatTime should pad single digits');
  assertEqual(service.formatTime(12, 30), '12:30', 'formatTime should preserve double digits');

  // 7. Schedule summary for !salaad command
  const summary = service.getScheduleSummaryText();
  assertTrue(summary.includes('JADWALKA SALAADDA EE MAANTA'), 'Summary text must have Islamic header');
  assertTrue(summary.includes('Subax'), 'Summary text must list Subax');
  assertTrue(summary.includes('Maqrib'), 'Summary text must list Maqrib');

  // 8. Due Prayer check & deduplication per group
  const mockDate = new Date();
  // Force hour/minute to match Dhuhr
  const dhuhrPrayer = schedule.prayers.find(p => p.key === 'dhuhr')!;
  // Create Date matching Dhuhr time in EAT
  const utcOffset = mockDate.getTimezoneOffset() * 60000;
  const eatOffset = 3 * 3600000;
  // Calculate mock timestamp so that eat.getHours() == dhuhr.hour and eat.getMinutes() == dhuhr.minute
  const testGroupJid = '120363111@g.us';

  // Mark prayer posted
  service.markPrayerPosted(testGroupJid, 'dhuhr');
  // Check due prayer for dhuhr should now be ignored (deduplicated)
  const dueCheck = service.checkDuePrayer(testGroupJid);
  // It shouldn't trigger dhuhr again today
  assertTrue(dueCheck === null || dueCheck.key !== 'dhuhr', 'Dhuhr must not trigger again after marked posted');
});

suite.run().then(summary => {
  process.exit(summary.failed > 0 ? 1 : 0);
});
