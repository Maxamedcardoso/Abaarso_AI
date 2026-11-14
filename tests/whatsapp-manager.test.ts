import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { whatsappManagerService } from '../src/services/whatsapp-manager.service.js';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { MessageRouter } from '../src/pipeline/message-router.js';
import { StudentAdvisorEngine } from '../src/advisor/advisor-engine.js';
import { AIOrchestrator } from '../src/ai/ai-orchestrator.js';
import { config } from '../src/config/env.js';
import { ConsoleSimulatorTransport } from '../src/transports/console-simulator.js';
import fs from 'fs';

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
  } catch {}

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

  await mockTransport.stop();
  await memory.close();
  try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  } catch {}
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

  await mockTransport.stop();
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
