import http from 'http';
import { config, validateConfig } from './config/env.js';
import { SQLiteStudentMemory } from './memory/sqlite-memory.js';
import { AIOrchestrator } from './ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from './advisor/advisor-engine.js';
import { MessageRouter } from './pipeline/message-router.js';
import { IMessagingTransport } from './transports/transport.interface.js';
import { ConsoleSimulatorTransport } from './transports/console-simulator.js';
import { WhatsAppBaileysTransport } from './transports/whatsapp-baileys.js';
import { MetaCloudWebhookTransport } from './transports/meta-cloud-webhook.js';
import { reminderService } from './services/reminder.service.js';
import { broadcastService } from './services/broadcast.service.js';
import { createStudioServer } from './web/studio-server.js';

async function bootstrap() {
  console.log(`\n======================================================`);
  console.log(`  CARDOSO AI — Your Smart Personal AI Assistant        `);
  console.log(`  Tagline: Barasho, Dhiirigelin, iyo Horumar          `);
  console.log(`======================================================\n`);

  // 1. Validate environment configuration
  const validation = validateConfig();
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(w => console.warn(`⚠️ [Config Warning]: ${w}`));
  }
  if (!validation.valid) {
    validation.errors.forEach(e => console.error(`❌ [Config Error]: ${e}`));
    process.exit(1);
  }

  // 2. Initialize Memory Database
  const memory = new SQLiteStudentMemory(config.database.path);
  await memory.initialize();
  console.log(`✅ [Database] SQLite Student Memory initialized at ${config.database.path}`);

  // 2b. Initialize Broadcast Service with persistent database
  broadcastService.setMemory(memory);
  await broadcastService.loadPersistedContacts();

  // 3. Initialize AI Orchestrator
  const ai = new AIOrchestrator(config);
  await ai.initialize();
  console.log(`✅ [AI Engine] Primary Model: ${config.gemini.model} (Daily free limit: ${config.gemini.dailyLimit})`);

  // 4. Initialize Advisor Engine & Message Router
  const engine = new StudentAdvisorEngine(memory, ai);
  const router = new MessageRouter(engine, config);

  // 5. Select and initialize active transport
  let transport: IMessagingTransport;

  switch (config.messaging.mode) {
    case 'baileys':
      console.log(`📱 [Transport] Starting WhatsApp Multi-Device Transport (Baileys)...`);
      transport = new WhatsAppBaileysTransport();
      break;

    case 'webhook':
      console.log(`🌐 [Transport] Starting Meta WhatsApp Cloud API Webhook Gateway...`);
      transport = new MetaCloudWebhookTransport({
        port: config.server.port,
        verifyToken: config.security.webhookVerifyToken,
      });
      break;

    case 'console':
    default:
      console.log(`💻 [Transport] Starting Interactive Console Simulator...`);
      transport = new ConsoleSimulatorTransport();
      break;
  }

  // Register router message handler
  transport.onMessage(async (message) => {
    await router.handleIncomingMessage(message, transport);
  });

  // Start transport
  await transport.start();

  // Wire reminder service so it can send WhatsApp messages
  reminderService.setSendFunction(async (chatId: string, text: string) => {
    await transport.sendMessage(chatId, text);
  });
  reminderService.start();
  console.log('⏰ [Reminders] Reminder scheduler is active.');

  // If console simulator, start interactive prompt loop
  if (transport instanceof ConsoleSimulatorTransport) {
    transport.startInteractiveCLI();
  }

  // Start No-Code Bot Studio Web Platform (Render & Cloud Hosting Ready)
  const webPort = process.env.PORT || config.server.port || 3000;
  const server = createStudioServer({
    port: webPort,
    memory,
    engine,
    transport,
    config,
  });

  server.listen(webPort, () => {
    console.log(`🌐 [Studio Server] CARDOSO AI No-Code Studio running on port ${webPort} (Render ready!)`);
  });

  // Render Anti-Sleep Keep-Alive (pings itself every 10 minutes if RENDER_EXTERNAL_URL is set)
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderExternalUrl) {
    console.log(`🔄 [Keep-Alive] Render Anti-Sleep active for: ${renderExternalUrl}`);
    setInterval(async () => {
      try {
        await fetch(`${renderExternalUrl}/health`);
        console.log(`⏰ [Keep-Alive] Pinged ${renderExternalUrl}/health`);
      } catch (err: any) {
        console.warn(`⚠️ [Keep-Alive] Ping error: ${err.message}`);
      }
    }, 10 * 60 * 1000); // Every 10 mins
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nGracefully shutting down CARDOSO AI...');
    reminderService.stop();
    server.close();
    await transport.stop();
    await memory.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});

