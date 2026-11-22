import path from 'path';
import { config, validateConfig } from './config/env.js';
import { IMessagingTransport } from './transports/transport.interface.js';
import { ConsoleSimulatorTransport } from './transports/console-simulator.js';
import { MetaCloudWebhookTransport } from './transports/meta-cloud-webhook.js';
import { TenantRegistry } from './tenants/tenant-registry.js';
import { TenantManager } from './tenants/tenant-manager.js';
import { CloudStateSync, PostgresSnapshotStore } from './tenants/cloud-state-sync.js';
import { createStudioServer } from './web/studio-server.js';
import { errorLogService } from './services/error-log.service.js';

// Register process-level guards + console capture FIRST so even boot-time failures are recorded for `!info`.
errorLogService.installConsoleCapture();

async function bootstrap() {
  console.log(`\n======================================================`);
  console.log(`  CARDOSO AI — Multi-Tenant WhatsApp SaaS Platform     `);
  console.log(`  Tagline: Barasho, Ganacsi, Waxbarasho & Horumar     `);
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

  // 2. Initialize Cloud State Persistence (if CLOUD_DB_URL / NEON_DATABASE_URL is set)
  // Restores registry DB, tenant DBs, and WhatsApp sessions BEFORE SQLite/Baileys boot!
  const baseDataDir = path.dirname(config.database.path) || './data';
  const registryPath = path.join(baseDataDir, 'tenants_registry.db');
  const ownerAuthDir =
    process.env.BAILEYS_AUTH_DIR ||
    (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'owner_auth') : './baileys_auth_info');

  let cloudSync: CloudStateSync | undefined;
  const cloudDbUrl = (process.env.CLOUD_DB_URL || process.env.NEON_DATABASE_URL || '').trim();
  if (cloudDbUrl) {
    try {
      const store = new PostgresSnapshotStore(cloudDbUrl);
      cloudSync = new CloudStateSync({
        store,
        baseDataDir,
        registryDbPath: registryPath,
        ownerDbPath: config.database.path,
        ownerAuthDir,
      });
      await cloudSync.initialize();
      const forceRestore = process.env.CLOUD_FORCE_RESTORE === 'true';
      await cloudSync.restoreAllIfMissing(forceRestore);
      console.log(`☁️ [CloudStateSync] Persistent Neon/Postgres sync ACTIVE ($0 restart-safe mode).`);
    } catch (err: any) {
      console.warn(`⚠️ [CloudStateSync] Cloud DB unavailable on startup (${err?.message || err}); continuing with local disk.`);
      cloudSync = undefined;
    }
  } else {
    console.log(`ℹ️ [CloudStateSync] Local disk mode (set CLOUD_DB_URL to enable $0 Postgres persistence on Render).`);
  }

  // 3. Initialize SaaS Tenant Registry & Tenant Manager
  const registry = new TenantRegistry(registryPath);
  registry.initialize();

  const webPort = process.env.PORT || config.server.port || 3000;
  const tenantManager = new TenantManager(registry, config, {
    startSockets: config.messaging.mode === 'baileys',
    publicBaseUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${webPort}`,
    cloudSync,
  });
  await tenantManager.initialize();

  const ownerCtx = tenantManager.getOwnerContext();
  if (!ownerCtx) {
    throw new Error('Failed to initialize primary owner tenant context.');
  }

  console.log(`✅ [Database] Registry initialized at ${registryPath} & Owner DB at ${config.database.path}`);
  console.log(`✅ [AI Engine] Primary Model: ${config.gemini.model} (Daily free limit: ${config.gemini.dailyLimit})`);

  // 3. If non-Baileys transport mode (webhook / console), wire external transport onto Owner router
  let activeTransport: IMessagingTransport = ownerCtx.transport as IMessagingTransport;
  let externalTransport: IMessagingTransport | null = null;

  if (config.messaging.mode === 'webhook') {
    console.log(`🌐 [Transport] Starting Meta WhatsApp Cloud API Webhook Gateway...`);
    externalTransport = new MetaCloudWebhookTransport({
      port: config.server.port,
      verifyToken: config.security.webhookVerifyToken,
    });
  } else if (config.messaging.mode === 'console') {
    console.log(`💻 [Transport] Starting Interactive Console Simulator...`);
    externalTransport = new ConsoleSimulatorTransport();
  } else if (config.messaging.mode === 'app') {
    console.log(`📲 [Transport] Standalone Installable PWA App Mode Active (No WhatsApp socket required).`);
  } else {
    console.log(`📱 [Transport] Multi-Tenant WhatsApp Multi-Device Mode (Baileys) Active.`);
  }

  if (externalTransport) {
    activeTransport = externalTransport;
    externalTransport.onMessage(async (message) => {
      await ownerCtx.router.handleIncomingMessage(message, externalTransport!);
    });
    await externalTransport.start();
    ownerCtx.reminderService.setSendFunction(async (chatId: string, text: string) => {
      await externalTransport!.sendMessage(chatId, text);
    });
    if (externalTransport instanceof ConsoleSimulatorTransport) {
      externalTransport.startInteractiveCLI();
    }
  }

  // 4. Start Multi-Tenant Admin Studio & Client Portal Web Platform
  const server = createStudioServer({
    port: webPort,
    memory: ownerCtx.memory,
    engine: ownerCtx.engine,
    transport: activeTransport,
    config,
    tenantManager,
  });

  server.listen(webPort, () => {
    console.log(`🌐 [Studio Server] CARDOSO AI SaaS running on port ${webPort}`);
    console.log(`   📲 Installable App (PWA): http://localhost:${webPort}/app`);
    console.log(`   👑 Admin Studio:          http://localhost:${webPort}/`);
    console.log(`   📝 Self-Signup:           http://localhost:${webPort}/join`);
    console.log(`   🔑 Client Login:          http://localhost:${webPort}/portal`);
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
    }, 10 * 60 * 1000);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nGracefully shutting down CARDOSO AI...');
    server.close();
    if (externalTransport) {
      await externalTransport.stop().catch(() => {});
    }
    await tenantManager.shutdown();
    registry.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (err) => {
    errorLogService.record('Process Guard: uncaughtException', err, 'error');
    errorLogService.withoutCapture(() => console.error('🛡️ [Process Guard] Uncaught Exception caught safely:', err?.message || err));
  });
  process.on('unhandledRejection', (reason) => {
    errorLogService.record('Process Guard: unhandledRejection', reason instanceof Error ? reason : String((reason as any)?.message || reason), 'error', (reason as any)?.stack);
    errorLogService.withoutCapture(() => console.error('🛡️ [Process Guard] Unhandled Rejection caught safely:', (reason as any)?.message || reason));
  });
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
