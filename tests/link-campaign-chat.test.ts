import os from 'os';
import path from 'path';
import fs from 'fs';
import { TestSuite, assertEqual, assertTrue, assertFalse } from './runner.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardoso-link-chat-'));
process.env.DATA_DIR = tmpDir;

const { MessageRouter } = await import('../src/pipeline/message-router.js');
const { WhatsAppManagerService } = await import('../src/services/whatsapp-manager.service.js');
const { StatusReactorService } = await import('../src/services/status-reactor.service.js');
const { BroadcastService } = await import('../src/services/broadcast.service.js');
const { config } = await import('../src/config/env.js');

const suite = new TestSuite('Chat Photo + Link Auto Status Posting & Owner Promo Exchange (!link on ONLY)');

function buildChatHarness() {
  const authDir = path.join(tmpDir, `auth_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(authDir, { recursive: true });

  const broadcast = new BroadcastService();
  const manager = new WhatsAppManagerService({
    authDir,
    statusStoragePath: path.join(authDir, 'posted.json'),
    broadcast,
  });
  manager.setBotJid('252634949642:0@s.whatsapp.net');

  const statusPosts: Array<{ jid: string; payload: any; options: any }> = [];
  const mockSocket: any = {
    user: { id: '252634949642:0@s.whatsapp.net', lid: '999888777666:0@lid' },
    sendMessage: async (jid: string, payload: any, options: any) => {
      statusPosts.push({ jid, payload, options });
      return { key: { id: `st_${statusPosts.length}` } };
    },
  };
  manager.setSocket(mockSocket);

  const ownerPromoImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);
  const ownerPromoLink = 'https://api.whatsapp.com/send?phone=252634949642&text=maxamed';
  manager.setOwnerPromo({
    link: ownerPromoLink,
    imageBuffer: ownerPromoImage,
    mimeType: 'image/jpeg',
  });

  const statusReactor = new StatusReactorService(
    path.join(authDir, 'reactor.json'),
    broadcast,
    ['252634949642'],
    manager
  );

  const mockEngine: any = {
    getAIOrchestrator: () => undefined,
    processMessage: async () => ({ replyText: 'Normal AI reply' }),
  };

  const router = new MessageRouter(mockEngine, config, undefined, undefined, undefined, {
    tenantId: 'test',
    broadcast,
    whatsappManager: manager,
    statusReactor,
  });

  const sentTexts: Array<{ chatId: string; text: string }> = [];
  const sentMedias: Array<{ chatId: string; media: any }> = [];
  const mockTransport: any = {
    name: 'mock',
    isConnected: true,
    sendMessage: async (chatId: string, text: string) => {
      sentTexts.push({ chatId, text });
      return true;
    },
    sendMedia: async (chatId: string, media: any) => {
      sentMedias.push({ chatId, media });
      return true;
    },
  };

  return { manager, router, mockTransport, statusPosts, sentTexts, sentMedias, ownerPromoImage, ownerPromoLink };
}

suite.test('!link on: single chat message with photo + link posts BOTH to status AND sends owner promo photo + link back', async () => {
  const { manager, router, mockTransport, statusPosts, sentMedias, ownerPromoImage, ownerPromoLink } = buildChatHarness();
  manager.setLinkCampaignMode(true);

  const userPhoto = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const res = await router.handleIncomingMessage(
    {
      id: 'chat_pl_1',
      senderId: '252631112233@s.whatsapp.net',
      senderPhone: '252631112233',
      senderName: 'Cabdi',
      chatId: '252631112233@s.whatsapp.net',
      isGroup: false,
      content: 'https://api.whatsapp.com/send/?phone=%2B252631112233&text=asc',
      media: {
        type: 'image',
        mimeType: 'image/png',
        dataBase64: userPhoto.toString('base64'),
      },
      rawTimestamp: Date.now(),
      isMentioned: false,
      isFromMe: false,
    },
    mockTransport
  );

  assertTrue(res.handled, 'Photo+link chat message must be handled');
  assertEqual(statusPosts.length, 1, 'Must post user photo+link directly to status@broadcast');
  assertEqual(statusPosts[0].jid, 'status@broadcast');
  assertEqual(Buffer.compare(statusPosts[0].payload.image, userPhoto), 0, 'Posted status image must match user photo');
  assertTrue(
    String(statusPosts[0].payload.caption || '').includes('252631112233'),
    'Posted status caption must contain user link'
  );

  assertEqual(sentMedias.length, 1, 'Must automatically send owner promo photo+link back to sender');
  assertEqual(sentMedias[0].chatId, '252631112233@s.whatsapp.net');
  assertEqual(Buffer.compare(sentMedias[0].media.dataBuffer, ownerPromoImage), 0, 'Reply photo must match owner saved promo photo');
  assertTrue(
    String(sentMedias[0].media.caption || '').includes(ownerPromoLink),
    'Reply caption must include owner promo link'
  );
  assertFalse(/\bqaali\b/i.test(String(sentMedias[0].media.caption || '')), 'Reply must never contain "qaali"');
});

suite.test('!link on: two-message flow (photo first, link second) combines BOTH and posts photo+link to status + sends owner promo', async () => {
  const { manager, router, mockTransport, statusPosts, sentTexts, sentMedias, ownerPromoImage, ownerPromoLink } = buildChatHarness();
  manager.setLinkCampaignMode(true);

  const userPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xaa, 0xbb]);

  // Message 1: Photo only (with transport placeholder content)
  const r1 = await router.handleIncomingMessage(
    {
      id: 'chat_split_1',
      senderId: '144556677889900@lid',
      senderPhone: '252617778899',
      senderName: 'Xamda',
      chatId: '144556677889900@lid',
      isGroup: false,
      content: '🖼️ [Sawir – Fadlan sawirkan eeg oo ka hadal waxa ku jira]',
      media: {
        type: 'image',
        mimeType: 'image/jpeg',
        dataBase64: userPhoto.toString('base64'),
      },
      rawTimestamp: Date.now(),
      isMentioned: false,
      isFromMe: false,
    },
    mockTransport
  );
  assertTrue(r1.handled, 'Photo-only message should be handled and cached');
  assertEqual(statusPosts.length, 0, 'Should NOT post status before link arrives');
  assertEqual(sentTexts.length, 1, 'Should ask user to send their link');

  // Message 2: User sends their link 5 seconds later
  const r2 = await router.handleIncomingMessage(
    {
      id: 'chat_split_2',
      senderId: '144556677889900@lid',
      senderPhone: '252617778899',
      senderName: 'Xamda',
      chatId: '144556677889900@lid',
      isGroup: false,
      content: 'https://wa.me/252617778899',
      rawTimestamp: Date.now(),
      isMentioned: false,
      isFromMe: false,
    },
    mockTransport
  );

  assertTrue(r2.handled, 'Follow-up link should trigger combined photo+link post');
  assertEqual(statusPosts.length, 1, 'Combined photo+link must be posted to status');
  assertEqual(Buffer.compare(statusPosts[0].payload.image, userPhoto), 0, 'Combined status must use the cached user photo');
  assertEqual(statusPosts[0].payload.caption, 'https://wa.me/252617778899');
  assertEqual(sentMedias.length, 1, 'Owner promo photo+link must be sent back to user');
  assertEqual(Buffer.compare(sentMedias[0].media.dataBuffer, ownerPromoImage), 0);
  assertTrue(String(sentMedias[0].media.caption || '').includes(ownerPromoLink));
});

suite.test('!link on: reverse two-message flow (link first, photo second) upgrades and posts photo+link together to status', async () => {
  const { manager, router, mockTransport, statusPosts, sentMedias } = buildChatHarness();
  manager.setLinkCampaignMode(true);

  const userPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x11, 0x22]);

  // Message 1: Link first
  await router.handleIncomingMessage(
    {
      id: 'chat_rev_1',
      senderId: '252635556677@s.whatsapp.net',
      senderPhone: '252635556677',
      chatId: '252635556677@s.whatsapp.net',
      isGroup: false,
      content: 'https://wa.me/252635556677',
      rawTimestamp: Date.now(),
      isMentioned: false,
      isFromMe: false,
    },
    mockTransport
  );
  assertEqual(statusPosts.length, 1, 'Initial text link posted');
  assertEqual(sentMedias.length, 1, 'Owner promo photo+link sent immediately');

  // Message 2: User immediately follows with their photo
  await router.handleIncomingMessage(
    {
      id: 'chat_rev_2',
      senderId: '252635556677@s.whatsapp.net',
      senderPhone: '252635556677',
      chatId: '252635556677@s.whatsapp.net',
      isGroup: false,
      content: '🖼️ [Sawir – Fadlan sawirkan eeg oo ka hadal waxa ku jira]',
      media: {
        type: 'image',
        mimeType: 'image/jpeg',
        dataBase64: userPhoto.toString('base64'),
      },
      rawTimestamp: Date.now(),
      isMentioned: false,
      isFromMe: false,
    },
    mockTransport
  );
  assertEqual(statusPosts.length, 2, 'Follow-up photo must be paired with recent link and posted as image status');
  assertEqual(Buffer.compare(statusPosts[1].payload.image, userPhoto), 0);
  assertEqual(statusPosts[1].payload.caption, 'https://wa.me/252635556677');
});

suite.test('!link off: chat photo + link MUST NOT post to status and MUST NOT send owner promo photo+link', async () => {
  const { manager, router, mockTransport, statusPosts, sentMedias, sentTexts } = buildChatHarness();
  manager.setLinkCampaignMode(false);
  manager.setAIEnabled(true);

  const userPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x99, 0x88]);
  await router.handleIncomingMessage(
    {
      id: 'chat_off_1',
      senderId: '252639998877@s.whatsapp.net',
      senderPhone: '252639998877',
      chatId: '252639998877@s.whatsapp.net',
      isGroup: false,
      content: 'https://wa.me/252639998877',
      media: {
        type: 'image',
        mimeType: 'image/jpeg',
        dataBase64: userPhoto.toString('base64'),
      },
      rawTimestamp: Date.now(),
      isMentioned: false,
      isFromMe: false,
    },
    mockTransport
  );

  assertEqual(statusPosts.length, 0, 'When !link off, chat photo+link MUST NOT post to status');
  assertEqual(sentMedias.length, 0, 'When !link off, chat photo+link MUST NOT send owner promo photo');
  assertTrue(sentTexts.some((m) => m.text === 'Normal AI reply'), 'When !link off, message should flow normally to AI');
});

const result = await suite.run();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch { }
if (result.failed > 0) process.exit(1);
process.exit(0);
