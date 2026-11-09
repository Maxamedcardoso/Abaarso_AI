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

  const broadcastService = new BroadcastService();

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
  const directService = new BroadcastService();
  directService.recordContact('252611111111@s.whatsapp.net', 'Cali');
  directService.recordContact('252622222222@s.whatsapp.net', 'Faadumo');
  const directResult = await directService.startDirectBroadcast('admin_123', 'Asc dhamaan, ogeysiis toos ah', mockTransport, 50);
  assert(directResult.success === true, 'Direct broadcast starts immediately without confirmation');
  assert(directResult.message.includes('FARIIN-WADAREED BILAABATAY'), 'Direct broadcast returns immediate acknowledgment');

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

