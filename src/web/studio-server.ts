import express, { Request, Response } from 'express';
import http from 'http';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { IMessagingTransport } from '../transports/transport.interface.js';
import { WhatsAppBaileysTransport } from '../transports/whatsapp-baileys.js';
import { broadcastService } from '../services/broadcast.service.js';
import { whatsappManagerService } from '../services/whatsapp-manager.service.js';
import { statusReactorService } from '../services/status-reactor.service.js';
import { AppConfig } from '../config/env.js';

export interface StudioServerOptions {
  port: number | string;
  memory: SQLiteStudentMemory;
  engine: StudentAdvisorEngine;
  transport: IMessagingTransport;
  config: AppConfig;
}

export function createStudioServer(options: StudioServerOptions): http.Server {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const { memory, engine, transport, config, port } = options;

  // 1. Health check for Render / Cloud keep-alive
  app.get(['/health', '/healthz'], (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'CARDOSO AI — No-Code Bot Studio',
      mode: config.messaging.mode,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // 1b. Password protection (HTTP Basic Auth) for everything except /health.
  // Set STUDIO_PASSWORD in .env / Render environment. Username can be anything.
  const studioPassword = process.env.STUDIO_PASSWORD || '';
  if (!studioPassword) {
    console.warn('⚠️ [Studio] STUDIO_PASSWORD lama dejin — dashboard-ku waa xidhan yahay ilaa la dejiyo.');
  }
  app.use((req: Request, res: Response, next) => {
    if (!studioPassword) {
      res.status(503).send('Studio is locked. Set STUDIO_PASSWORD environment variable to enable the dashboard.');
      return;
    }
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password === studioPassword) {
        next();
        return;
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="CARDOSO AI Studio"');
    res.status(401).send('Furaha sirta ah ayaa loo baahan yahay.');
  });

  // 2. Real-time Status API
  app.get('/api/status', (req: Request, res: Response) => {
    const isBaileys = transport instanceof WhatsAppBaileysTransport;
    const isConnected = isBaileys ? (transport as WhatsAppBaileysTransport).isConnected : true;
    const currentQR = isBaileys ? (transport as WhatsAppBaileysTransport).currentQR : null;
    const botNumber = isBaileys ? (transport as WhatsAppBaileysTransport).getBotNumber() : null;
    const stats = broadcastService.getStats();

    res.json({
      status: 'ok',
      mode: config.messaging.mode,
      isConnected,
      currentQR,
      botNumber,
      contacts: stats,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // 3. Get Bot Custom Configuration
  app.get('/api/config', async (req: Request, res: Response) => {
    try {
      const botConfig = await memory.getBotConfig();
      res.json({ status: 'ok', config: botConfig });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // 4. Save Bot Custom Configuration (Training)
  app.post('/api/config', async (req: Request, res: Response) => {
    try {
      const { botName, businessName, systemRole, knowledgeBase } = req.body;
      await memory.saveBotConfig({
        botName: (botName || '').trim(),
        businessName: (businessName || '').trim(),
        systemRole: (systemRole || '').trim(),
        knowledgeBase: (knowledgeBase || '').trim(),
      });
      res.json({
        status: 'ok',
        message: '✅ Tababarka bot-ka iyo xogta meheradda si guul leh ayaa loo kaydiyay!',
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // 5. Live Interactive Chat Test (Browser Simulation)
  app.post('/api/test-chat', async (req: Request, res: Response) => {
    try {
      const userMessage = (req.body.message || '').trim();
      if (!userMessage) {
        res.status(400).json({ status: 'error', message: 'Fariintu ma bannaana' });
        return;
      }

      const output = await engine.processMessage({
        rawSenderId: 'web_preview_user',
        chatId: 'web_preview_chat',
        isGroup: false,
        content: userMessage,
        senderName: 'Macmiil Web',
      });

      res.json({ status: 'ok', reply: output.replyText });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // 6. Direct Broadcast Trigger via Web
  app.post('/api/broadcast', async (req: Request, res: Response) => {
    try {
      const text = (req.body.text || '').trim();
      if (!text) {
        res.status(400).json({ status: 'error', message: 'Fadlan qor qoraalka fariinta' });
        return;
      }

      const result = await broadcastService.startDirectBroadcast('web_admin', text, transport, 50);
      res.json({ status: 'ok', message: result.message, success: result.success });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // 7. Abort Broadcast
  app.post('/api/broadcast/abort', (req: Request, res: Response) => {
    const aborted = broadcastService.abortBroadcast();
    res.json({ status: 'ok', aborted, message: aborted ? '🛑 Fariin-wadareedka waa la joojiyay' : 'Hadda ma jirto fariin socota' });
  });

  // 8. Unlink WhatsApp Session
  app.post('/api/unlink', async (req: Request, res: Response) => {
    if (transport instanceof WhatsAppBaileysTransport) {
      await (transport as WhatsAppBaileysTransport).unlinkSession();
      res.json({ status: 'ok', message: 'WhatsApp session waa la xidhay. QR cusub ayaa soo baxaya.' });
    } else {
      res.status(400).json({ status: 'error', message: 'Baileys transport is not active.' });
    }
  });

  // ─── 9. WhatsApp Status & Stories Endpoints ────────────────────────────────
  app.post('/api/status/post', async (req: Request, res: Response) => {
    try {
      const { text, color, font } = req.body;
      if (!text || !text.trim()) {
        res.status(400).json({ status: 'error', message: 'Fadlan qor qoraalka status-ka' });
        return;
      }
      const result = await whatsappManagerService.postTextStatus(text, {
        backgroundColor: color,
        font: font ? parseInt(font, 10) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/status/post-ai', async (req: Request, res: Response) => {
    try {
      const { topic } = req.body;
      const result = await whatsappManagerService.generateAndPostAIStatus(topic);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/status/autoview', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      enabled: whatsappManagerService.isAutoViewStatusEnabled(),
    });
  });

  app.post('/api/status/autoview', (req: Request, res: Response) => {
    const { enabled } = req.body;
    whatsappManagerService.setAutoViewStatus(Boolean(enabled));
    res.json({
      status: 'ok',
      enabled: whatsappManagerService.isAutoViewStatusEnabled(),
      message: `Auto-View Status is now ${whatsappManagerService.isAutoViewStatusEnabled() ? 'ENABLED' : 'DISABLED'}`,
    });
  });

  app.get('/api/status/reactor', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      config: statusReactorService.getConfig(),
      recent: statusReactorService.getRecentInteractions(),
    });
  });

  app.post('/api/status/reactor', (req: Request, res: Response) => {
    const { enabled, autoReact, autoComment, mode, cooldownHours } = req.body;
    const updated = statusReactorService.setConfig({
      ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(autoReact !== undefined ? { autoReact: Boolean(autoReact) } : {}),
      ...(autoComment !== undefined ? { autoComment: Boolean(autoComment) } : {}),
      ...(mode ? { mode } : {}),
      ...(cooldownHours !== undefined ? { cooldownHours: Number(cooldownHours) } : {}),
    });
    res.json({
      status: 'ok',
      config: updated,
      message: 'Status reactor settings updated successfully',
    });
  });

  // ─── 10. Direct Reply & Messaging Endpoint ─────────────────────────────────
  app.post('/api/direct-reply', async (req: Request, res: Response) => {
    try {
      const { phone, message: replyText } = req.body;
      if (!phone || !replyText) {
        res.status(400).json({ status: 'error', message: 'Fadlan geli lambarka iyo fariinta' });
        return;
      }
      const result = await whatsappManagerService.sendDirectReply(phone, replyText, transport);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // ─── 11. Custom Auto-Replies Endpoints ─────────────────────────────────────
  app.get('/api/auto-replies', async (req: Request, res: Response) => {
    try {
      const replies = memory.getAutoReplies ? await memory.getAutoReplies() : [];
      res.json({ status: 'ok', autoReplies: replies });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.post('/api/auto-replies', async (req: Request, res: Response) => {
    try {
      const { keyword, replyText } = req.body;
      if (!keyword || !replyText) {
        res.status(400).json({ status: 'error', message: 'Ereyga iyo jawaabta waa waajib' });
        return;
      }
      if (memory.saveAutoReply) {
        await memory.saveAutoReply(keyword, replyText);
      }
      res.json({ status: 'ok', message: 'Auto-reply si guul leh ayaa loo keydiyay' });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.delete('/api/auto-replies/:keyword', async (req: Request, res: Response) => {
    try {
      const keyword = (Array.isArray(req.params.keyword) ? req.params.keyword[0] : req.params.keyword) || '';
      if (memory.deleteAutoReply && keyword) {
        await memory.deleteAutoReply(keyword);
      }
      res.json({ status: 'ok', message: `Auto-reply '${keyword}' waa la tirtiray` });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // ─── 12. Main No-Code Studio Dashboard UI ──────────────────────────────────
  app.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderStudioHTML());
  });

  const server = http.createServer(app);
  return server;
}

function renderStudioHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CARDOSO AI — No-Code WhatsApp Bot Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --card-hover: #172238;
      --primary: #06b6d4;
      --primary-hover: #0891b2;
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.2);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --danger: #ef4444;
      --warning: #f59e0b;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }

    body {
      background: radial-gradient(circle at 50% 0%, #152238 0%, var(--bg) 60%);
      color: var(--text-main);
      min-height: 100vh;
      padding-bottom: 3rem;
    }

    header {
      padding: 1.25rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--card-border);
      background: rgba(9, 13, 22, 0.85);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .logo-box {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 42px;
      height: 42px;
      background: linear-gradient(135deg, #06b6d4, #3b82f6);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
    }

    .logo-title {
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #fff;
    }

    .logo-title span { color: var(--primary); }

    .logo-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 1rem;
      border-radius: 9999px;
      font-size: 0.825rem;
      font-weight: 700;
      transition: all 0.3s ease;
    }

    .status-connected {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .status-waiting {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
    }

    .container {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 0 1.5rem;
    }

    .hero-banner {
      text-align: center;
      margin-bottom: 2.5rem;
    }

    .hero-banner h1 {
      font-size: 2.4rem;
      font-weight: 800;
      margin-bottom: 0.75rem;
      letter-spacing: -1px;
      background: linear-gradient(135deg, #ffffff 40%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .hero-banner p {
      color: var(--text-muted);
      font-size: 1.05rem;
      max-width: 650px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .grid-layout {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 1.75rem;
    }

    @media (max-width: 900px) {
      .grid-layout { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 1.75rem;
      box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);
    }

    .card-title {
      font-size: 1.15rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.5rem;
      color: #fff;
    }

    .card-desc {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }

    .form-group {
      margin-bottom: 1.25rem;
    }

    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 0.4rem;
    }

    input, textarea, select {
      width: 100%;
      background: #0b1120;
      border: 1px solid #23314a;
      border-radius: 10px;
      padding: 0.75rem 1rem;
      color: #f8fafc;
      font-size: 0.9rem;
      transition: all 0.2s ease;
      outline: none;
    }

    input:focus, textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.2);
    }

    textarea {
      min-height: 130px;
      resize: vertical;
      line-height: 1.5;
    }

    .template-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin-top: 0.5rem;
    }

    .chip {
      background: #172238;
      border: 1px solid #283955;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      color: #94a3b8;
      cursor: pointer;
      transition: all 0.2s;
    }

    .chip:hover {
      background: rgba(6, 182, 212, 0.2);
      color: #38bdf8;
      border-color: var(--primary);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.85rem 1.25rem;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.925rem;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn-primary {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      color: #fff;
      box-shadow: 0 4px 15px rgba(6, 182, 212, 0.35);
    }

    .btn-primary:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
      margin-top: 0.75rem;
    }

    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }

    /* QR Box */
    .qr-container {
      text-align: center;
      padding: 1.5rem 1rem;
      background: #090e1a;
      border-radius: 14px;
      border: 1px dashed #23314a;
      margin-bottom: 1.25rem;
      min-height: 280px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .qr-image-wrapper {
      background: #ffffff;
      padding: 14px;
      border-radius: 14px;
      display: inline-block;
      box-shadow: 0 8px 25px rgba(0,0,0,0.4);
    }

    .qr-image-wrapper img {
      display: block;
      width: 210px;
      height: 210px;
    }

    .qr-instructions {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 1rem;
      line-height: 1.5;
    }

    .connected-box {
      text-align: center;
      padding: 2rem 1rem;
    }

    .connected-icon {
      width: 70px;
      height: 70px;
      background: rgba(16, 185, 129, 0.15);
      border: 2px solid var(--accent);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.2rem;
      color: var(--accent);
      margin: 0 auto 1rem;
      box-shadow: 0 0 25px var(--accent-glow);
    }

    /* Live Chat Tester */
    .chat-card {
      margin-top: 1.75rem;
    }

    .chat-box {
      background: #090e1a;
      border-radius: 12px;
      border: 1px solid #1f293d;
      height: 260px;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .chat-msg {
      max-width: 80%;
      padding: 0.65rem 0.95rem;
      border-radius: 12px;
      font-size: 0.85rem;
      line-height: 1.45;
      word-break: break-word;
    }

    .msg-user {
      align-self: flex-end;
      background: #0284c7;
      color: #fff;
      border-bottom-right-radius: 3px;
    }

    .msg-bot {
      align-self: flex-start;
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-bottom-left-radius: 3px;
    }

    .chat-input-row {
      display: flex;
      gap: 0.5rem;
    }

    .chat-input-row input {
      flex: 1;
    }

    .chat-input-row button {
      width: auto;
      padding: 0 1.25rem;
    }

    /* Stats bar */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .stat-pill {
      background: #090e1a;
      border: 1px solid #1f293d;
      padding: 0.75rem;
      border-radius: 10px;
      text-align: center;
    }

    .stat-num {
      font-size: 1.25rem;
      font-weight: 800;
      color: #fff;
    }

    .stat-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 700;
      margin-top: 0.2rem;
    }

    .toast {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      background: #10b981;
      color: #fff;
      padding: 0.75rem 1.25rem;
      border-radius: 10px;
      font-size: 0.875rem;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      display: none;
      z-index: 1000;
    }
  </style>
</head>
<body>

  <header>
    <div class="logo-box">
      <div class="logo-icon">🤖</div>
      <div>
        <div class="logo-title">CARDOSO <span>AI</span></div>
        <div class="logo-sub">No-Code WhatsApp Bot Studio</div>
      </div>
    </div>
    <div id="statusBadge" class="status-badge status-waiting">
      <div class="status-dot"></div>
      <span id="connStatusText">Checking WhatsApp...</span>
    </div>
  </header>

  <div class="container">
    <div class="hero-banner">
      <h1>Dhis WhatsApp Bot-kaaga 2 Daqiiqo Gudahood</h1>
      <p>Ku tababar meheraddaada, gali xogtaada, ka dibna toos uga scan-garee WhatsApp-ka adoon hal xabbo oo koodh ah taaban!</p>
    </div>

    <div class="grid-layout">
      <!-- LEFT: Bot Configuration & Training -->
      <div>
        <div class="card">
          <div class="card-title">🧠 1. Ku Tababar Bot-kaaga (Train & Customize)</div>
          <div class="card-desc">Gali magaca meheraddaada, doorka uu bot-ku qabanayo, iyo liiska alaabta ama adeegyada aad bixiso.</div>

          <form id="botConfigForm">
            <div class="form-group">
              <label>Magaca Bot-ka / Meheradda</label>
              <input type="text" id="businessName" placeholder="Tusaale: Dukaanka Hilaac, Hargeysa" />
            </div>

            <div class="form-group">
              <label>Doorka Bot-ka (Persona / Role)</label>
              <input type="text" id="systemRole" placeholder="Tusaale: Waxaad tahay iibiye dhar ah oo asluub badan, macaamiisha si asluub leh u soo dhawee..." />
              <div class="template-chips">
                <span class="chip" onclick="applyTemplate('shop')">🛍️ Dukaan & Iibiye</span>
                <span class="chip" onclick="applyTemplate('clinic')">🩺 Farmashiye / Clinic</span>
                <span class="chip" onclick="applyTemplate('edu')">🎓 Waxbarasho & Arday</span>
                <span class="chip" onclick="applyTemplate('support')">💼 Adeeg Macmiil (24/7)</span>
              </div>
            </div>

            <div class="form-group">
              <label>Xogta Meheradda (Knowledge Base & Catalog)</label>
              <textarea id="knowledgeBase" placeholder="Halkan ku qor dhammaan xogta meheraddaada:
- Qiimaha: Shaadhka ($12), Surwaalka ($18)
- Goobta: Suuqa Hoose, Hargeysa
- Bixinta: Zaad / Sahal / EVC Plus
- Gaarsiinta: Hargeysa dhexdeeda waa $1..."></textarea>
            </div>

            <button type="submit" class="btn btn-primary" id="saveBtn">
              <span>💾 Keydi & Ku Tababar Bot-ka</span>
            </button>
          </form>
        </div>

        <!-- Live Chat Simulator -->
        <div class="card chat-card">
          <div class="card-title">🧪 3. Tijaabi Bot-kaaga (Live Browser Test)</div>
          <div class="card-desc">Ula hadal bot-ka halkan tooska ah si aad u aragto siduu u bartay xogtaada ka hor inta aadan WhatsApp-ka ku xidhin.</div>

          <div class="chat-box" id="chatBox">
            <div class="chat-msg msg-bot">Salaan! Waxaan ahay bot-kaaga. I weydii wax ku saabsan meheraddaada si aan kuugu tijaabiyo! 😊</div>
          </div>

          <div class="chat-input-row">
            <input type="text" id="chatInput" placeholder="Qor su'aal (tusaale: Maxaad iibisaan?)..." onkeydown="if(event.key==='Enter') sendTestChat()" />
            <button class="btn btn-primary" onclick="sendTestChat()">Dir 🚀</button>
          </div>
        </div>
      </div>

      <!-- RIGHT: WhatsApp Live QR & Broadcast -->
      <div>
        <div class="card">
          <div class="card-title">📱 2. Ku Xidh WhatsApp-kaaga</div>
          <div class="card-desc">Scan garee QR-ka hoose taleefankaaga WhatsApp-kiisa si bot-ku toos ugu bilaabo shaqada.</div>

          <div id="qrArea" class="qr-container">
            <div id="qrLoading" style="color:#94a3b8; font-size:0.85rem; padding:1.5rem; text-align:center;">
              ⏳ Fadlan sug... QR Code-ka WhatsApp ayaa la diyaarinayaa...
            </div>
            <div class="qr-image-wrapper" id="qrWrapper" style="display:none;">
              <img id="qrImage" src="" alt="WhatsApp QR Code" />
            </div>
            <div class="qr-instructions">
              <strong>Tallaabooyinka:</strong><br>
              1. Fur WhatsApp ➔ <strong>Settings</strong> ➔ <strong>Linked Devices</strong><br>
              2. Riix <strong>Link a Device</strong> oo ku qabo kamarada QR-kan sare.
            </div>
          </div>

          <div id="connectedArea" class="connected-box" style="display:none;">
            <div class="connected-icon">✓</div>
            <h3 style="font-size:1.2rem; margin-bottom:0.4rem; color:#fff;">Bot-ku Wuu Xidhan Yahay!</h3>
            <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:1rem;">Wuxuu toos ugu xidhan yahay lambarka: <strong id="connectedPhone" style="color:#38bdf8;"></strong></p>
            <p style="color:#34d399; font-size:0.8rem; background:rgba(16,185,129,0.1); padding:0.6rem; border-radius:8px;">Hadda macaamiishaadu markay WhatsApp fariin kuugu soo diraan, bot-ku isagaa si toos ah ugu jawaabaya 24/7!</p>
            <button class="btn btn-danger" onclick="unlinkWhatsApp()">🛑 Ka Saar / Logout WhatsApp</button>
          </div>
        </div>

        <!-- Smart Broadcast Card -->
        <div class="card" style="margin-top: 1.75rem;">
          <div class="card-title">📢 Fariin-Wadareed (Smart Broadcast)</div>
          <div class="card-desc">Fariin u dir dhammaan dadka ku jira contacts-kaaga (50 qof mar kasta).</div>

          <div class="stats-row">
            <div class="stat-pill">
              <div class="stat-num" id="totalContacts">0</div>
              <div class="stat-label">Contacts</div>
            </div>
            <div class="stat-pill">
              <div class="stat-num" id="sentContacts" style="color:#34d399;">0</div>
              <div class="stat-label">Loo Diray</div>
            </div>
            <div class="stat-pill">
              <div class="stat-num" id="remContacts" style="color:#38bdf8;">0</div>
              <div class="stat-label">Hadhay</div>
            </div>
          </div>

          <div class="form-group">
            <label>Qoraalka Fariinta</label>
            <textarea id="broadcastText" style="min-height:90px;" placeholder="Qor fariinta aad rabto in loo diro macaamiishaada..."></textarea>
          </div>

          <button class="btn btn-primary" onclick="sendBroadcast()">🚀 Dir Fariinta (50 qof oo cusub)</button>
          <button class="btn btn-danger" onclick="abortBroadcast()" style="margin-top:0.5rem;">🛑 Jooji Fariinta</button>
        </div>

        <!-- WhatsApp Status (Stories) Card -->
        <div class="card" style="margin-top: 1.75rem;">
          <div class="card-title">📱 WhatsApp Status (Stories) Manager</div>
          <div class="card-desc">Toos WhatsApp Status ugu daabac fariimo qoraal ah ama adeegso AI dhiirigelin ah.</div>

          <div class="form-group">
            <label>Qoraalka Status-ka</label>
            <textarea id="statusText" style="min-height:75px;" placeholder="Qor fariinta aad rabto inaad status soo dhigto..."></textarea>
          </div>

          <div class="form-group">
            <label>Dooro Midabka Status-ka</label>
            <div style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.75rem;">
              <input type="color" id="statusColor" value="#1e3c72" style="width:40px; height:40px; border-radius:8px; border:none; cursor:pointer;" />
              <span style="font-size:0.8rem; color:var(--text-muted);">Riix midabka si aad mid custom ah u doorato</span>
            </div>
          </div>

          <button class="btn btn-primary" onclick="postStatusNow()">📢 Daabac Status WhatsApp</button>
          <button class="btn btn-primary" onclick="postAIStatusNow()" style="margin-top:0.5rem; background:linear-gradient(135deg, #10b981, #06b6d4);">✨ Ku Daabac AI Status (Automatic Quote)</button>

          <hr style="border-color:var(--card-border); margin:1.25rem 0;" />

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:700; font-size:0.9rem;">Auto-View Status (Auto Seen)</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">Bot-ku si toos ah ma u daawadaa status-yada dadka?</div>
            </div>
            <button id="autoViewBtn" class="btn btn-primary" style="width:auto; padding:0.4rem 0.9rem; font-size:0.8rem;" onclick="toggleAutoView()">ON (Furan)</button>
          </div>

          <hr style="border-color:var(--card-border); margin:1.25rem 0;" />

          <div style="font-weight:700; font-size:0.95rem; margin-bottom:0.4rem; color:#38bdf8; display:flex; align-items:center; gap:0.4rem;">
            <span>🤖</span> Fal-celinta & Faallada Status-ka (Status AI Reactor)
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:1rem; line-height:1.4;">
            Bot-ku wuxuu fahmayaa waxa ay dadku soo dhigaan (qoraal, xikmad, sawir, qalinjabin, aroos, ganacsi, jimce) isagoo si dabiici ah uga bixinaya Emoji Reaction ama Faallo (Comment) Soomaali ah.
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <div>
              <div style="font-weight:600; font-size:0.85rem;">❤️ Falcelinta Emoji-ga (Auto-React)</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">Status-ka toos emoji ugu dhufo (❤️, 😂, 👏, 🔥, 🤲)</div>
            </div>
            <button id="srReactBtn" class="btn btn-primary" style="width:auto; padding:0.35rem 0.8rem; font-size:0.75rem;" onclick="toggleStatusReactor('autoReact')">ON (Furan)</button>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <div>
              <div style="font-weight:600; font-size:0.85rem;">💬 Faallada Tooska ah (Auto-Comment)</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">Faallo kooban oo Soomaali ah kaga dhiibo status-ka (Quote DM)</div>
            </div>
            <button id="srCommentBtn" class="btn btn-primary" style="width:auto; padding:0.35rem 0.8rem; font-size:0.75rem;" onclick="toggleStatusReactor('autoComment')">ON (Furan)</button>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-top:0.75rem;">
            <div>
              <label style="font-size:0.75rem;">Nooca Falcelinta</label>
              <select id="srMode" style="padding:0.4rem 0.6rem; font-size:0.8rem;" onchange="updateStatusReactorSettings()">
                <option value="both">Labada (Reaction + Comment)</option>
                <option value="reaction">Emoji Keliya (Reaction Only)</option>
                <option value="comment">Faallo Keliya (Comment Only)</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;">Cooldown Qofkiiba</label>
              <select id="srCooldown" style="padding:0.4rem 0.6rem; font-size:0.8rem;" onchange="updateStatusReactorSettings()">
                <option value="2">2 Saacadood</option>
                <option value="4" selected>4 Saacadood</option>
                <option value="6">6 Saacadood</option>
                <option value="12">12 Saacadood</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Direct Reply Card -->
        <div class="card" style="margin-top: 1.75rem;">
          <div class="card-title">💬 Qof Fariin u Dir (Direct Reply)</div>
          <div class="card-desc">Lambar kasta oo WhatsApp ah si toos ah fariin ugu dir magaca bot-ka.</div>

          <div class="form-group">
            <label>Lambarka Telefoonka</label>
            <input type="text" id="directPhone" placeholder="Tusaale: 252615000000 ama 0634000000" />
          </div>

          <div class="form-group">
            <label>Fariinta</label>
            <textarea id="directMsg" style="min-height:75px;" placeholder="Qor fariinta aad rabto in loo diro qofkaas..."></textarea>
          </div>

          <button class="btn btn-primary" onclick="sendDirectMessage()">📤 U Dir Qofka Hadda</button>
        </div>

        <!-- Custom Auto-Replies Card -->
        <div class="card" style="margin-top: 1.75rem;">
          <div class="card-title">⚡ Jawaabaha Tooska ah (Auto-Replies)</div>
          <div class="card-desc">Sameyso ereyo gaar ah oo bot-ku isla markiiba ugu jawaabo macaamiisha adoon AI isticmaalin.</div>

          <div class="form-group">
            <label>Ereyga (Keyword / Trigger)</label>
            <input type="text" id="arKeyword" placeholder="Tusaale: qiimaha, fiidkii, location" />
          </div>

          <div class="form-group">
            <label>Jawaabta Tooska ah</label>
            <textarea id="arReply" style="min-height:65px;" placeholder="Qor jawaabta degdegga ah..."></textarea>
          </div>

          <button class="btn btn-primary" onclick="addAutoReply()">➕ Ku Dar Auto-Reply</button>

          <div id="arList" style="margin-top:1rem; display:flex; flex-direction:column; gap:0.5rem; max-height:180px; overflow-y:auto;">
            <!-- Loaded dynamically -->
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast">Keydiyay!</div>

  <script>
    const templates = {
      shop: {
        role: "Waxaad tahay shaqaale dhar iyo kabo iibiya oo aad u asluub badan. Macaamiisha si diirran u soo dhawee, qiimaha u sheeg, u faahfaahi midabada iyo cabbirada, dalabkana ka qaad.",
        knowledge: "- Shaadhka Nimanka: $12 (Cabbirada: M, L, XL)\\n- Surwaalka Jiiniska: $18 (Midabada: Madow, Buluug)\\n- Kabaha Isboortiga: $25 (Size 40 ilaa 44)\\n- Goobta: Suuqa Hoose, Dabaqa 2aad, Hargeysa\\n- Lacag bixinta: Zaad (0634000000) ama Sahal\\n- Gaarsiinta: Hargeysa dhexdeeda waa $1, magaalooyinka kale waa $3."
      },
      clinic: {
        role: "Waxaad tahay caawiye xarun caafimaad iyo farmashiye. Su'aalaha bukaanada si naxariis leh uga jawaab, u sheeg waqtiyada dhakhtarku joogo, u qabo ballamo, kana caawi dawooyinka.",
        knowledge: "- Waqtiga Shaqada: 8:00 Subaxnimo ilaa 9:00 Habeenimo\\n- Qiimaha Balanta Dhakhtarka: $5\\n- Goobta: Wadada Wadnaha, Hargeysa\\n- Adeegyada: Shaybaadh (Lab), Ultrasound, iyo Dawooyinka Guud\\n- Xaaladaha Degdegga ah: Fadlan toos u soo wac lambarka 0634111111."
      },
      edu: {
        role: "Waxaad tahay la-taliye arday iyo macallin caqli badan. Ardayda ka caawi casharada, xallinta su'aalaha, sharaxaadda cilmiga, iyo dhiirrigelinta waxbarashada.",
        knowledge: "- Koorsooyinka: Python, Web Development, English, iyo Xisaabta\\n- Waqtiga: Galabtii iyo Habeenkii\\n- Qiimaha Koorso kasta: $15 bishii\\n- Shahaado: Arday kasta oo dhammeeya wuxuu helayaa Shahaado la aqoonsan yahay."
      },
      support: {
        role: "Waxaad tahay wakiilka rasmiga ah ee adeegga macmiilka (Customer Support). Si edeb leh u xalli cabashooyinka, qor fariimaha loo reebayo maamulka, una sharax shirkadda.",
        knowledge: "- Saacadaha Shaqada: 24 Saac / 7 Maalmood\\n- Telefoonka Xafiiska: 0634000000\\n- Email: support@meherad.com\\n- Jawaab-celinta Cabashooyinka: 2 saacadood gudahood."
      }
    };

    function applyTemplate(type) {
      const t = templates[type];
      if (t) {
        document.getElementById('systemRole').value = t.role;
        document.getElementById('knowledgeBase').value = t.knowledge;
        showToast('Template la doortay! Riix "Keydi" si aad u tababarto.');
      }
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }

    // Load initial bot configuration
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.status === 'ok' && data.config) {
          document.getElementById('businessName').value = data.config.businessName || '';
          document.getElementById('systemRole').value = data.config.systemRole || '';
          document.getElementById('knowledgeBase').value = data.config.knowledgeBase || '';
        }
      } catch (err) {
        console.warn('Config load error:', err);
      }
    }

    // Save Bot Configuration
    document.getElementById('botConfigForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('saveBtn');
      saveBtn.disabled = true;
      saveBtn.innerText = '⏳ Waa la tababarayaa...';

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName: document.getElementById('businessName').value,
            systemRole: document.getElementById('systemRole').value,
            knowledgeBase: document.getElementById('knowledgeBase').value,
          })
        });
        const data = await res.json();
        showToast(data.message || '✅ Bot-ka si buuxda ayaa loo tababaray!');
      } catch (err) {
        showToast('❌ Khalad ayaa dhacay: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerText = '💾 Keydi & Ku Tababar Bot-ka';
      }
    });

    // Poll Status & QR
    async function pollStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const badge = document.getElementById('statusBadge');
        const statusText = document.getElementById('connStatusText');
        const qrArea = document.getElementById('qrArea');
        const connectedArea = document.getElementById('connectedArea');
        const qrWrapper = document.getElementById('qrWrapper');
        const qrLoading = document.getElementById('qrLoading');

        if (data.isConnected) {
          badge.className = 'status-badge status-connected';
          if (statusText) statusText.innerText = 'Connected: +' + (data.botNumber || 'Active');
          qrArea.style.display = 'none';
          connectedArea.style.display = 'block';
          document.getElementById('connectedPhone').innerText = '+' + (data.botNumber || 'WhatsApp');
        } else {
          badge.className = 'status-badge status-waiting';
          if (statusText) statusText.innerText = 'Sugaya Scan-ka...';
          qrArea.style.display = 'flex';
          connectedArea.style.display = 'none';

          if (data.currentQR) {
            document.getElementById('qrImage').src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(data.currentQR);
            if (qrWrapper) qrWrapper.style.display = 'inline-block';
            if (qrLoading) qrLoading.style.display = 'none';
          } else {
            if (qrWrapper) qrWrapper.style.display = 'none';
            if (qrLoading) qrLoading.style.display = 'block';
          }
        }

        if (data.contacts) {
          document.getElementById('totalContacts').innerText = data.contacts.total || 0;
          document.getElementById('sentContacts').innerText = data.contacts.sent || 0;
          document.getElementById('remContacts').innerText = data.contacts.remaining || 0;
        }
      } catch (err) {
        console.warn('Status poll error:', err);
      }
    }

    // Send Test Chat in Browser
    async function sendTestChat() {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text) return;

      const chatBox = document.getElementById('chatBox');
      chatBox.innerHTML += '<div class="chat-msg msg-user">' + escapeHtml(text) + '</div>';
      input.value = '';
      chatBox.scrollTop = chatBox.scrollHeight;

      // Loading bubble
      const loadingId = 'loading_' + Date.now();
      chatBox.innerHTML += '<div class="chat-msg msg-bot" id="' + loadingId + '">⏳ Wuu fekerayaa...</div>';
      chatBox.scrollTop = chatBox.scrollHeight;

      try {
        const res = await fetch('/api/test-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        const bubble = document.getElementById(loadingId);
        if (bubble) {
          bubble.innerHTML = escapeHtml(data.reply || 'Jawaab ma helin.');
        }
      } catch (err) {
        const bubble = document.getElementById(loadingId);
        if (bubble) bubble.innerText = '❌ Cilad: ' + err.message;
      }
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Send Broadcast from Web
    async function sendBroadcast() {
      const text = document.getElementById('broadcastText').value.trim();
      if (!text) {
        alert('Fadlan qor qoraalka fariinta!');
        return;
      }
      if (!confirm('Ma hubtaa inaad 50-ka qof ee soo socda u dirto fariintan?')) return;

      try {
        const res = await fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        alert(data.message || 'Fariinta waa la bilaabay!');
        document.getElementById('broadcastText').value = '';
        pollStatus();
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Abort Broadcast
    async function abortBroadcast() {
      try {
        const res = await fetch('/api/broadcast/abort', { method: 'POST' });
        const data = await res.json();
        showToast(data.message);
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Unlink / Logout
    async function unlinkWhatsApp() {
      if (!confirm('Ma hubtaa inaad ka saarto WhatsApp-ka hadda ku xidhan? Waxaad u baahan doontaa inaad QR cusub scan-garayso.')) return;
      try {
        await fetch('/api/unlink', { method: 'POST' });
        showToast('WhatsApp waa la xidhay. Fadlan sug QR cusub...');
        setTimeout(pollStatus, 2000);
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Post Status
    async function postStatusNow() {
      const text = document.getElementById('statusText').value.trim();
      const color = document.getElementById('statusColor').value;
      if (!text) {
        alert('Fadlan qor qoraalka status-ka!');
        return;
      }
      try {
        const res = await fetch('/api/status/post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, color })
        });
        const data = await res.json();
        alert(data.message || 'Status-ka waa la daabacay!');
        if (data.success) document.getElementById('statusText').value = '';
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Post AI Status
    async function postAIStatusNow() {
      try {
        showToast('⏳ AI ayaa curinaya status-ka dhiirigelinta ah...');
        const res = await fetch('/api/status/post-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        alert(data.message || 'AI Status waa la daabacay!');
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Toggle Auto-View Status
    let autoViewCurrent = true;
    async function toggleAutoView() {
      try {
        const nextState = !autoViewCurrent;
        const res = await fetch('/api/status/autoview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextState })
        });
        const data = await res.json();
        autoViewCurrent = Boolean(data.enabled);
        updateAutoViewUI();
        showToast(autoViewCurrent ? '👁️ Auto-View Status waa FURAN TAHAY' : '🛑 Auto-View Status waa LA DAMIYAY');
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    function updateAutoViewUI() {
      const btn = document.getElementById('autoViewBtn');
      if (btn) {
        btn.innerText = autoViewCurrent ? 'ON (Furan)' : 'OFF (Xidhan)';
        btn.style.background = autoViewCurrent ? '#10b981' : '#64748b';
      }
    }

    // Status Reactor UI
    let srConfig = { enabled: true, autoReact: true, autoComment: true, mode: 'both', cooldownHours: 4 };

    async function loadStatusReactor() {
      try {
        const res = await fetch('/api/status/reactor');
        const data = await res.json();
        if (data.status === 'ok' && data.config) {
          srConfig = data.config;
          updateStatusReactorUI();
        }
      } catch (err) {}
    }

    function updateStatusReactorUI() {
      const reactBtn = document.getElementById('srReactBtn');
      const commentBtn = document.getElementById('srCommentBtn');
      const modeSelect = document.getElementById('srMode');
      const cdSelect = document.getElementById('srCooldown');

      if (reactBtn) {
        reactBtn.innerText = srConfig.autoReact ? 'ON (Furan)' : 'OFF (Xidhan)';
        reactBtn.style.background = srConfig.autoReact ? '#10b981' : '#64748b';
      }
      if (commentBtn) {
        commentBtn.innerText = srConfig.autoComment ? 'ON (Furan)' : 'OFF (Xidhan)';
        commentBtn.style.background = srConfig.autoComment ? '#10b981' : '#64748b';
      }
      if (modeSelect) modeSelect.value = srConfig.mode || 'both';
      if (cdSelect) cdSelect.value = String(srConfig.cooldownHours || 4);
    }

    async function toggleStatusReactor(field) {
      try {
        const next = !srConfig[field];
        const res = await fetch('/api/status/reactor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: next })
        });
        const data = await res.json();
        if (data.status === 'ok') {
          srConfig = data.config;
          updateStatusReactorUI();
          showToast(field === 'autoReact' ? (srConfig.autoReact ? '❤️ Auto-React waa la daaray' : '🛑 Auto-React waa la damiyay') : (srConfig.autoComment ? '💬 Auto-Comment waa la daaray' : '🛑 Auto-Comment waa la damiyay'));
        }
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    async function updateStatusReactorSettings() {
      const mode = document.getElementById('srMode').value;
      const cooldownHours = parseInt(document.getElementById('srCooldown').value, 10);
      try {
        const res = await fetch('/api/status/reactor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, cooldownHours })
        });
        const data = await res.json();
        if (data.status === 'ok') {
          srConfig = data.config;
          showToast('✅ Habaynta Status Reactor waa la keydiyay!');
        }
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Direct Reply
    async function sendDirectMessage() {
      const phone = document.getElementById('directPhone').value.trim();
      const message = document.getElementById('directMsg').value.trim();
      if (!phone || !message) {
        alert('Fadlan gali lambarka iyo fariinta!');
        return;
      }
      try {
        const res = await fetch('/api/direct-reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message })
        });
        const data = await res.json();
        alert(data.message || 'Fariinta waa la diray!');
        if (data.success) document.getElementById('directMsg').value = '';
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    // Auto-Replies Management
    async function loadAutoReplies() {
      try {
        const res = await fetch('/api/auto-replies');
        const data = await res.json();
        const list = document.getElementById('arList');
        if (!list) return;
        list.innerHTML = '';
        if (data.autoReplies && data.autoReplies.length > 0) {
          for (const ar of data.autoReplies) {
            const item = document.createElement('div');
            item.style.cssText = 'background:#090e1a; padding:0.5rem 0.75rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid #1f293d; font-size:0.8rem;';
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = '<strong>"' + escapeHtml(ar.keyword) + '"</strong> ➔ <span style="color:#94a3b8;">' + escapeHtml(ar.replyText) + '</span>';
            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; margin-left:0.5rem; font-size:1rem;';
            delBtn.innerText = '✕';
            delBtn.onclick = function() {
              deleteAutoReply(encodeURIComponent(ar.keyword));
            };
            item.appendChild(contentDiv);
            item.appendChild(delBtn);
            list.appendChild(item);
          }
        } else {
          list.innerHTML = '<div style="color:#64748b; font-size:0.75rem;">Wali ma jiraan auto-replies.</div>';
        }
      } catch (err) {}
    }

    async function addAutoReply() {
      const keyword = document.getElementById('arKeyword').value.trim();
      const replyText = document.getElementById('arReply').value.trim();
      if (!keyword || !replyText) {
        alert('Fadlan gali ereyga iyo jawaabta!');
        return;
      }
      try {
        const res = await fetch('/api/auto-replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, replyText })
        });
        const data = await res.json();
        showToast(data.message || 'Auto-reply waa la keydiyay!');
        document.getElementById('arKeyword').value = '';
        document.getElementById('arReply').value = '';
        loadAutoReplies();
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    async function deleteAutoReply(encodedKeyword) {
      const keyword = decodeURIComponent(encodedKeyword);
      if (!confirm('Ma hubtaa inaad tirtirto auto-reply-ga "' + keyword + '"?')) return;
      try {
        await fetch('/api/auto-replies/' + encodeURIComponent(keyword), { method: 'DELETE' });
        showToast('Auto-reply waa la tirtiray');
        loadAutoReplies();
      } catch (err) {
        alert('Cilad: ' + err.message);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.innerText = text;
      return div.innerHTML.replace(/\\n/g, '<br>');
    }

    // Init
    loadConfig();
    loadAutoReplies();
    loadStatusReactor();
    pollStatus();
    setInterval(pollStatus, 3500); // Poll status every 3.5s
  </script>
</body>
</html>`;
}

