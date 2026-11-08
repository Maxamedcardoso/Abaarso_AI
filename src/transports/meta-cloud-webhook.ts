import express, { Request, Response } from 'express';
import http from 'http';
import { IMessagingTransport, IncomingMessage, OutgoingMessageOptions } from './transport.interface.js';

export interface MetaCloudConfig {
  port: number;
  verifyToken: string;
  accessToken?: string;
  phoneNumberId?: string;
}

export class MetaCloudWebhookTransport implements IMessagingTransport {
  public readonly name = 'meta_cloud_webhook';
  private app: express.Application;
  private server: http.Server | null = null;
  private config: MetaCloudConfig;
  private connected: boolean = false;
  private messageHandler: ((message: IncomingMessage) => Promise<void>) | null = null;
  private lastActivityTimestamp: number | null = null;

  constructor(config: MetaCloudConfig) {
    this.config = config;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Pure verification logic for unit testing and route execution
   */
  public verifyWebhookToken(mode?: string, token?: string, challenge?: string): { verified: boolean; challenge?: string } {
    if (mode === 'subscribe' && token === this.config.verifyToken) {
      return { verified: true, challenge };
    }
    return { verified: false };
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'CARDOSO AI Webhook Gateway',
        timestamp: new Date().toISOString(),
      });
    });

    // 1. Meta Webhook Verification Handshake
    this.app.get('/webhook', (req: Request, res: Response) => {
      const mode = req.query['hub.mode'] as string | undefined;
      const token = req.query['hub.verify_token'] as string | undefined;
      const challenge = req.query['hub.challenge'] as string | undefined;

      const result = this.verifyWebhookToken(mode, token, challenge);
      if (result.verified) {
        console.log('[MetaCloudWebhook] Webhook successfully verified with Meta!');
        res.status(200).send(result.challenge);
      } else {
        console.warn('[MetaCloudWebhook] Verification token mismatch.');
        res.sendStatus(403);
      }
    });

    // 2. Incoming Meta Message Processing
    this.app.post('/webhook', async (req: Request, res: Response) => {
      // Immediate 200 OK acknowledgment to satisfy Meta's webhook timeout
      res.status(200).send('EVENT_RECEIVED');

      const body = req.body;
      if (body.object !== 'whatsapp_business_account') return;

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;

          const value = change.value;
          const messages = value?.messages || [];

          for (const msg of messages) {
            if (msg.type !== 'text') continue;

            const fromPhone = msg.from;
            const text = msg.text?.body || '';

            const incoming: IncomingMessage = {
              id: msg.id || `wamid_${Date.now()}`,
              senderId: fromPhone,
              chatId: fromPhone,
              isGroup: false, // Official Cloud API does not support standard consumer groups
              content: text,
              rawTimestamp: parseInt(msg.timestamp, 10) * 1000 || Date.now(),
              isMentioned: true, // In 1-to-1 official chat, user is always directing to the bot
            };

            this.lastActivityTimestamp = Date.now();

            if (this.messageHandler) {
              try {
                await this.messageHandler(incoming);
              } catch (err) {
                console.error('[MetaCloudWebhook] Error processing incoming webhook:', err);
              }
            }
          }
        }
      }
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, '127.0.0.1', () => {
        this.connected = true;
        this.lastActivityTimestamp = Date.now();
        console.log(`[MetaCloudWebhook] Webhook server listening on 127.0.0.1:${this.config.port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.connected = false;
          resolve();
        });
      } else {
        this.connected = false;
        resolve();
      }
    });
  }

  public async sendMessage(chatId: string, text: string, options?: OutgoingMessageOptions): Promise<boolean> {
    this.lastActivityTimestamp = Date.now();

    // If access token & phone number id are provided, send via Meta Graph API
    if (this.config.accessToken && this.config.phoneNumberId) {
      try {
        const url = `https://graph.facebook.com/v21.0/${this.config.phoneNumberId}/messages`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: chatId,
            type: 'text',
            text: { body: text },
          }),
        });

        return res.ok;
      } catch (err) {
        console.error('[MetaCloudWebhook] Error sending via Graph API:', err);
        return false;
      }
    }

    console.log(`[MetaCloudWebhook] (Simulated Send to ${chatId}):\n${text}`);
    return true;
  }

  public onMessage(handler: (message: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  public getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      activeChats: 1,
      lastActivity: this.lastActivityTimestamp,
    };
  }

  public getApp(): express.Application {
    return this.app;
  }
}
