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

async function bootstrap() {
  console.log(`\n======================================================`);
  console.log(`  ABARSO AI — Your Smart Student Advisor               `);
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

  // If console simulator, start interactive prompt loop
  if (transport instanceof ConsoleSimulatorTransport) {
    transport.startInteractiveCLI();
  }

  // Start HTTP health server for Render & Cloud hosting (prevents timeout and enables 24/7 keep-alive)
  const webPort = process.env.PORT || config.server.port || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'ABARSO AI Advisor',
        mode: config.messaging.mode,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    const isBaileys = transport instanceof WhatsAppBaileysTransport;
    const currentQR = isBaileys ? (transport as WhatsAppBaileysTransport).currentQR : null;
    const isConnected = isBaileys ? (transport as WhatsAppBaileysTransport).isConnected : true;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (currentQR && !isConnected) {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta http-equiv="refresh" content="12">
            <title>Scan WhatsApp QR — ABARSO AI</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
              .card { background: #1e293b; padding: 2rem; border-radius: 16px; max-width: 480px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
              h1 { color: #38bdf8; margin: 0 0 0.5rem; font-size: 1.6rem; }
              .badge { display: inline-block; padding: 0.35rem 0.85rem; background: #eab308; color: #000; border-radius: 9999px; font-weight: bold; font-size: 0.85rem; margin-bottom: 1rem; }
              .qr-box { background: #ffffff; padding: 12px; border-radius: 12px; display: inline-block; margin: 0.5rem auto 1rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
              p { color: #94a3b8; line-height: 1.5; margin: 0.4rem 0; font-size: 0.95rem; }
              .steps { background: #0f172a; padding: 0.75rem 1rem; border-radius: 8px; margin-top: 1rem; text-align: left; font-size: 0.85rem; color: #cbd5e1; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>📱 Ku Xidh WhatsApp-ka</h1>
              <div class="badge">⏳ WAITING FOR QR SCAN</div>
              <p>Ka scan-garee QR Code-kan taleefankaaga WhatsApp-ka:</p>
              <div class="qr-box">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentQR)}" alt="WhatsApp QR Code" width="250" height="250" />
              </div>
              <div class="steps">
                <strong>Tallaabooyinka WhatsApp:</strong><br>
                1. Fur WhatsApp taleefankaaga<br>
                2. Tag <strong>Settings (Dejinta)</strong> ➔ <strong>Linked Devices (Qalabka ku xidhan)</strong><br>
                3. Riix <strong>Link a Device</strong> oo ku qabo kamarada QR-kan sare.
              </div>
              <p style="font-size:0.75rem; color:#64748b; margin-top:0.75rem;">Boggani wuxuu si toos ah isu cusboonaysiinayaa 12-kii ilbiriqsiba si QR-ku uusan u dhicin.</p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ABARSO AI — Online 24/7</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
            .card { background: #1e293b; padding: 2.5rem; border-radius: 16px; max-width: 520px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
            h1 { color: #38bdf8; margin: 0 0 0.5rem; font-size: 1.8rem; }
            .badge { display: inline-block; padding: 0.35rem 0.85rem; background: #059669; color: #fff; border-radius: 9999px; font-weight: bold; font-size: 0.85rem; margin-bottom: 1.25rem; }
            p { color: #94a3b8; line-height: 1.6; margin: 0.5rem 0; }
            .info { background: #0f172a; padding: 1rem; border-radius: 8px; margin-top: 1.5rem; font-size: 0.9rem; color: #cbd5e1; text-align: left; }
            code { color: #38bdf8; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>🤖 ABARSO AI</h1>
            <div class="badge">● ONLINE 24/7</div>
            <p>Smart Student Advisor — Barasho, Dhiirigelin, iyo Horumar.</p>
            <div class="info">
              <div>📱 WhatsApp Status: <code>Active & Connected</code></div>
              <div>⚡ AI Engine: <code>${config.gemini.model}</code></div>
              <div>💬 Mention: <code>@abaarso</code> ama <code>!abaarso</code></div>
            </div>
          </div>
        </body>
      </html>
    `);
  });

  server.listen(webPort, () => {
    console.log(`🌐 [Web Server] HTTP Health Server running on port ${webPort} (Render ready!)`);
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
    console.log('\nGracefully shutting down ABARSO AI...');
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

