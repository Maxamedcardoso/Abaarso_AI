import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';
import { whatsappManagerService, WhatsAppManagerService } from '../src/services/whatsapp-manager.service.js';
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
  const testConfigPath = path.resolve(process.cwd(), 'data', 'test-call-reject-config.json');
  try { if (fs.existsSync(testConfigPath)) fs.unlinkSync(testConfigPath); } catch {}
  
  const mgr = new WhatsAppManagerService({
    statusStoragePath: testConfigPath,
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
  try { if (fs.existsSync(testConfigPath)) fs.unlinkSync(testConfigPath); } catch {}
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
  const manager = new WhatsAppManagerService();

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

  // Reset states
  manager.setLinkCampaignMode(false);
  manager.setAIEnabled(true);
});

suite.run().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
});
