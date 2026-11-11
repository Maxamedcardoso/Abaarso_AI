import { BroadcastService, BroadcastContact } from '../src/services/broadcast.service.js';
import { IMessagingTransport } from '../src/transports/transport.interface.js';

export async function runBroadcastTests(): Promise<{ passed: boolean; message: string }> {
  console.log('\n========================================');
  console.log('RUNNING TEST SUITE: Safe Smart Broadcast Tests');
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

  const fastTestTiming = { minDelayMs: 15, maxDelayMs: 25, cooldownEvery: 50, cooldownMinMs: 20, cooldownMaxMs: 30 };
  const broadcastService = new BroadcastService(undefined, fastTestTiming);

  // 1. Name extraction test
  const name1 = broadcastService.extractCleanFirstName('Mohamed Dahir');
  assert(name1 === 'Mohamed', 'Extracts first name from "Mohamed Dahir"');

  const name2 = broadcastService.extractCleanFirstName('Faadumo Cali 🌸');
  assert(name2 === 'Faadumo', 'Extracts first name from "Faadumo Cali 🌸" (stripping emojis)');

  const name3 = broadcastService.extractCleanFirstName(undefined);
  assert(name3 === undefined, 'Returns undefined when name is missing');

  // 2. Personalization logic test
  const msg1 = broadcastService.formatPersonalizedMessage('Asc dhamaantiin, berrito kulan baa jira', 'Axmed');
  assert(msg1.startsWith('Asc Axmed, '), 'Personalizes greeting starting with "Asc"');

  const msg2 = broadcastService.formatPersonalizedMessage('Fariintan waa ogeysiis muhiim ah', 'Sahra');
  assert(msg2 === 'Asc Sahra, Fariintan waa ogeysiis muhiim ah', 'Adds personalized prefix when message has no greeting');

  const msg3 = broadcastService.formatPersonalizedMessage('Kusoo dhawaada kulanka {magac}', 'Jaamac');
  assert(msg3 === 'Kusoo dhawaada kulanka Jaamac', 'Replaces explicit {magac} placeholder');

  const msg4 = broadcastService.formatPersonalizedMessage('Ogeysiis cusub', undefined);
  assert(msg4 === 'Asc walaal, Ogeysiis cusub', 'Uses "walaal" fallback when recipient has no name');

  // 3. Contact recording test
  broadcastService.recordContact('252610000001@s.whatsapp.net', 'Cali Maxamed', false);
  broadcastService.recordContact('252610000002@s.whatsapp.net', 'Deeqa Axmed', false);
  broadcastService.recordContact('120363000000@g.us', 'Group Name', true); // Should be ignored (group)

  assert(broadcastService.getContactsCount() === 2, 'Records 2 individual contacts and ignores group JID');

  // 4. Draft creation test
  const draftResult = broadcastService.createDraft('admin_123', 'Asc dhamaan, tababar baa jira.');
  assert(draftResult.success === true, 'Successfully creates draft');
  assert(draftResult.message.includes('2 qof'), 'Draft accurately counts recipients (2)');
  assert(broadcastService.hasPendingDraft('admin_123') === true, 'Identifies pending draft for admin');

  // 5. Cancellation test
  const cancelled = broadcastService.cancelDraft('admin_123');
  assert(cancelled === true, 'Successfully cancels draft');
  assert(broadcastService.hasPendingDraft('admin_123') === false, 'Draft removed after cancellation');

  // 6. Mock transmission test
  const sentMessages: Array<{ to: string; text: string }> = [];
  const mockTransport: IMessagingTransport = {
    name: 'mock',
    isConnected: true,
    start: async () => {},
    sendMessage: async (chatId, text) => {
      sentMessages.push({ to: chatId, text });
      return true;
    },
    onMessage: () => {},
    stop: async () => {},
    getStatus: () => ({
      name: 'mock',
      connected: true,
      activeChats: 0,
      lastActivity: Date.now(),
    }),
  };

  // Re-create draft and confirm
  broadcastService.createDraft('admin_123', 'Asc, berri waxaan haynaa fursad cusub.');
  await broadcastService.confirmDraft('admin_123', mockTransport);

  assert(sentMessages.length >= 1, 'Sends immediate start confirmation to admin');
  assert(sentMessages[0].text.includes('Smart Broadcast Bilaabatay'), 'Admin notified of start');

  // 7. Direct Broadcast Test (no confirmation step needed, up to 50 recipients)
  const directService = new BroadcastService(undefined, fastTestTiming);
  directService.recordContact('252611111111@s.whatsapp.net', 'Cali');
  directService.recordContact('252622222222@s.whatsapp.net', 'Faadumo');
  const directResult = await directService.startDirectBroadcast('admin_123', 'Asc dhamaan, ogeysiis toos ah', mockTransport, 50);
  assert(directResult.success === true, 'Direct broadcast starts immediately without confirmation');
  assert(directResult.message.includes('FARIIN-WADAREED BADBAADO LEH'), 'Direct broadcast returns immediate acknowledgment');

  // 8. Exclusion & Anti-Repeat Test (recipients already sent are NEVER contacted again)
  const batchService = new BroadcastService();
  batchService.recordContact('252610000001@s.whatsapp.net', 'User1');
  batchService.recordContact('252610000002@s.whatsapp.net', 'User2');
  batchService.recordContact('252610000003@s.whatsapp.net', 'User3');

  // Mark User1 as already sent
  await batchService.markAsSent('252610000001@s.whatsapp.net');
  const available = batchService.getAvailableRecipients();
  assert(available.length === 2, 'Excludes already-contacted recipient (User1)');
  assert(!available.some(c => c.jid === '252610000001@s.whatsapp.net'), 'User1 is strictly excluded from available pool');

  // Test reset history
  await batchService.resetSentHistory();
  const resetAvailable = batchService.getAvailableRecipients();
  assert(resetAvailable.length === 3, 'Reset restores full pool of recipients');

  // 9. Modern WhatsApp Multi-Device LID and manual import support
  batchService.recordContact('277923424645192@lid', 'LID User');
  assert(batchService.getContacts().some(c => c.jid === '277923424645192@lid'), 'Supports WhatsApp Multi-Device @lid contacts');

  const manualAdded = batchService.addManualNumbers('252615999888, 252615777666');
  assert(manualAdded === 2, 'Manually imports bulk numbers via !dar/!add');
  assert(batchService.getContacts().some(c => c.jid === '252615999888@s.whatsapp.net'), 'Manual contact exists in recipient list');

  // 10. Varied personalization & name-first ordering
  assert(broadcastService.extractCleanFirstName('Eng. Maxamed Daahir') === 'Maxamed', 'Skips title prefix "Eng." to extract real first name');
  assert(broadcastService.extractCleanFirstName('+252 63 4949642') === undefined, 'Rejects raw phone numbers as first names');

  const var0 = broadcastService.formatPersonalizedMessage('Asc wll berrito shir baa jira', 'Axmed', 0);
  const var1 = broadcastService.formatPersonalizedMessage('Asc wll berrito shir baa jira', 'Sahra', 1);
  const var2 = broadcastService.formatPersonalizedMessage('Asc wll berrito shir baa jira', 'Cali', 2);
  assert(var0.startsWith('Axmed, Asc! '), 'Variant 0 places person name BEFORE Asc ("Axmed, Asc!")');
  assert(var0 !== var1 && var1 !== var2, 'Produces varied greetings across recipients');

  const unVar0 = broadcastService.formatPersonalizedMessage('Ogeysiis muhiim ah', undefined, 0);
  const unVar1 = broadcastService.formatPersonalizedMessage('Ogeysiis muhiim ah', undefined, 1);
  const unVar2 = broadcastService.formatPersonalizedMessage('Ogeysiis muhiim ah', undefined, 2);
  assert(unVar0 !== unVar1 && unVar1 !== unVar2, 'Unnamed recipients do not receive identical "Asc walaal" prefix repeatedly');

  // 11. Anti-Ban Protections: Spintax, Opt-Out, Daily Cap, Warm-First Ordering, and Auto-Stop
  const spin0 = broadcastService.formatPersonalizedMessage('{Waxaan haynaa|Waxaa soo baxday} fursad {maanta|usbuucan}', 'Axmed', 0);
  const spin1 = broadcastService.formatPersonalizedMessage('{Waxaan haynaa|Waxaa soo baxday} fursad {maanta|usbuucan}', 'Sahra', 1);
  assert(spin0.includes('Waxaan haynaa') && spin1.includes('Waxaa soo baxday'), 'Spintax rotates alternative body wording across recipients');

  const safeService = new BroadcastService(undefined, { ...fastTestTiming, dailyLimit: 2, maxConsecutiveFailures: 2 });
  safeService.recordContact('252610000010@s.whatsapp.net', undefined); // unnamed cold contact
  safeService.recordContact('252610000011@s.whatsapp.net', 'Xasan');  // named warm contact
  safeService.recordContact('252610000012@s.whatsapp.net', 'Hodan');
  safeService.optOut('252610000012@s.whatsapp.net', 'jooji');

  const orderedPool = safeService.getAvailableRecipients();
  assert(orderedPool.length === 2, 'Excludes opted-out contact (Hodan) from available pool');
  assert(orderedPool[0].firstName === 'Xasan', 'Prioritizes named contacts before cold unnamed numbers');

  await safeService.resetSentHistory();
  assert(safeService.isOptedOut('252610000012@s.whatsapp.net') === true, 'Opt-out survives broadcast history reset');

  await safeService.markAsSent('252610000011@s.whatsapp.net');
  await safeService.markAsSent('252610000010@s.whatsapp.net');
  safeService.recordContact('252610000013@s.whatsapp.net', 'Farxaan');
  const capBlocked = await safeService.startDirectBroadcast('admin_123', 'Tijaabo xadka maalinlaha', mockTransport, 50);
  assert(capBlocked.success === false && capBlocked.message.includes('XADKA MAALINLAHA'), 'Enforces daily anti-ban send limit');

  // Auto-stop after consecutive failures
  const failService = new BroadcastService(undefined, { ...fastTestTiming, maxConsecutiveFailures: 2 });
  failService.recordContact('252610000021@s.whatsapp.net', 'UserA');
  failService.recordContact('252610000022@s.whatsapp.net', 'UserB');
  failService.recordContact('252610000023@s.whatsapp.net', 'UserC');
  const failingMessages: string[] = [];
  const failingTransport: IMessagingTransport = {
    ...mockTransport,
    sendMessage: async (chatId, text) => {
      if (chatId === 'admin_123') {
        failingMessages.push(text);
        return true;
      }
      return false;
    },
  };
  await failService.startDirectBroadcast('admin_123', 'Tijaabo auto-stop', failingTransport, 10);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert(failingMessages.some(m => m.includes('ANTI-BAN EMERGENCY STOP')), 'Triggers emergency auto-stop after consecutive failures');

  console.log('----------------------------------------');
  console.log(`Suite Summary: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------\n');

  return { passed: failed === 0, message: `${passed} passed, ${failed} failed` };
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('broadcast.test.ts')) {
  runBroadcastTests().then(res => {
    if (!res.passed) process.exit(1);
  });
}

