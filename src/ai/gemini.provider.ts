import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { IAIProvider, ConversationMessage, GenerateOptions, GenerateResult } from './ai-provider.interface.js';
import { QuotaTracker } from './quota-tracker.js';
import { executeWithRetry } from './retry-handler.js';

export class GeminiProvider implements IAIProvider {
  public readonly name = 'gemini';
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private modelName: string;
  private quotaTracker: QuotaTracker;
  private clients: GoogleGenerativeAI[] = [];

  constructor(apiKeyOrKeys: string | string[], modelName: string = 'gemini-flash-latest', quotaTracker?: QuotaTracker) {
    if (Array.isArray(apiKeyOrKeys)) {
      this.apiKeys = apiKeyOrKeys.filter(Boolean);
    } else if (apiKeyOrKeys) {
      this.apiKeys = [apiKeyOrKeys];
    }
    this.modelName = modelName;
    this.quotaTracker = quotaTracker || new QuotaTracker();
    this.initClients();
  }

  private initClients(): void {
    this.clients = this.apiKeys.map(k => new GoogleGenerativeAI(k));
  }

  public rotateKey(): boolean {
    if (this.clients.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.clients.length;
      console.log(`🔄 [GeminiProvider] Auto-rotated to API key #${this.currentKeyIndex + 1} of ${this.clients.length}`);
      return true;
    }
    return false;
  }

  public get isAvailable(): boolean {
    return this.clients.length > 0;
  }

  public get currentClient(): GoogleGenerativeAI | null {
    return this.clients[this.currentKeyIndex] || null;
  }

  public async initialize(): Promise<boolean> {
    if (this.apiKeys.length === 0) {
      console.warn('[GeminiProvider] Warning: GEMINI_API_KEY is not set. Gemini AI provider is disabled.');
      return false;
    }
    this.initClients();
    console.log(`🔑 [GeminiProvider] Initialized with ${this.clients.length} API key(s) in rotation pool.`);
    return true;
  }

  public async generateResponse(
    userPrompt: string,
    history: ConversationMessage[] = [],
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    const startTime = Date.now();

    // 1. Quota & Zero-Cost Protection Check
    const quotaCheck = this.quotaTracker.canMakeRequest();
    if (!quotaCheck.allowed) {
      return {
        text: `⚠️ [CARDOSO AI Safe Guard]: ${quotaCheck.reason}`,
        provider: 'gemini',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }

    if (!this.isAvailable || !this.currentClient) {
      return {
        text: '⚠️ [CARDOSO AI Configuration]: Google Gemini API key is missing or invalid. Please configure GEMINI_API_KEY in your .env file.',
        provider: 'gemini',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }

    // 2. Format history for Gemini API
    const formattedHistory: Content[] = history
      .filter(msg => msg.role === 'user' || msg.role === 'model')
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));

    const systemInstruction = options.systemInstruction || 'You are CARDOSO AI, a helpful, intelligent personal AI assistant.';

    // 3. Execute generation with retry & backoff
    try {
      const responseText = await executeWithRetry(
        async () => {
          const client = this.currentClient!;
          const modelInstance = client.getGenerativeModel({
            model: this.modelName,
            systemInstruction,
            generationConfig: {
              temperature: options.temperature ?? 0.7,
              maxOutputTokens: options.maxOutputTokens ?? 1000,
            },
          });

          // Prepare prompt payload (text and optional multimodal image/audio/document)
          const contentParts: Array<string | Part> = [];
          if (options.media?.dataBase64 && options.media?.mimeType) {
            contentParts.push({
              inlineData: {
                mimeType: options.media.mimeType,
                data: options.media.dataBase64,
              },
            });
          }
          contentParts.push(userPrompt);

          if (formattedHistory.length > 0) {
            const chat = modelInstance.startChat({
              history: formattedHistory,
            });
            const result = await chat.sendMessage(contentParts.length === 1 && typeof contentParts[0] === 'string' ? contentParts[0] : (contentParts as any));
            return result.response.text();
          } else {
            const result = await modelInstance.generateContent(contentParts.length === 1 && typeof contentParts[0] === 'string' ? contentParts[0] : (contentParts as any));
            return result.response.text();
          }
        },
        {
          onRetry: (attempt, delayMs, err) => {
            console.warn(`[GeminiProvider] Retry attempt ${attempt} in ${delayMs}ms due to: ${err.message}`);
            // If rate-limited or quota hit, rotate to next key in pool
            if (err.message.includes('429') || err.message.includes('quota') || err.message.includes('ResourceExhausted')) {
              this.rotateKey();
            }
          },
        }
      );

      // Record successful request for quota tracking
      const estimatedTokens = Math.ceil((userPrompt.length + responseText.length) / 4);
      this.quotaTracker.recordRequest(estimatedTokens);

      return {
        text: responseText,
        provider: 'gemini',
        modelUsed: this.modelName,
        tokensUsed: {
          promptTokens: Math.ceil(userPrompt.length / 4),
          completionTokens: Math.ceil(responseText.length / 4),
          totalTokens: estimatedTokens,
        },
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      console.error(`[GeminiProvider] Error generating response:`, err?.message || err);

      const isRateLimit = err?.status === 429 || (err?.message && err.message.includes('429'));
      if (isRateLimit) {
        return {
          text: '⏳ *[CARDOSO AI]*: Server-ku wuxuu gaadhay xadkii daqiiqada (Rate Limit). Fadlan 10 ilbiriqsi kadib mar kale isku day!',
          provider: 'gemini',
          modelUsed: this.modelName,
          latencyMs: Date.now() - startTime,
        };
      }

      const isHighDemand = err?.status === 503 || (err?.message && (err.message.includes('503') || err.message.includes('high demand') || err.message.includes('Service Unavailable')));
      if (isHighDemand) {
        return {
          text: '⏳ *[CARDOSO AI]*: Server-ka Gemini AI ayaa hadda aad u mashquulsan (High Demand). Fadlan 1 daqiiqo kadib dib u soo qor su\'aashaada!',
          provider: 'gemini',
          modelUsed: this.modelName,
          latencyMs: Date.now() - startTime,
        };
      }

      return {
        text: `⚠️ [CARDOSO AI Error]: Gemini API request failed (${err?.message || 'Unknown error'}). Check your network and API key.`,
        provider: 'gemini',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  public getStatus() {
    const quota = this.quotaTracker.getStats();
    return {
      healthy: this.isAvailable && !quota.isDailyQuotaExhausted,
      provider: this.name,
      model: this.modelName,
      totalRequestsToday: quota.dailyRequests,
      remainingQuota: quota.remainingDailyRequests,
      isQuotaExhausted: quota.isDailyQuotaExhausted,
    };
  }
}

