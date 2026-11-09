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

  constructor(apiKeyOrKeys: string | string[], modelName: string = 'gemini-3.8-flash', quotaTracker?: QuotaTracker) {
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

    // 2. Format history for Gemini API with strict validation and alternation enforcement
    const formattedHistory: Content[] = [];
    let expectedRole: 'user' | 'model' = 'user';

    for (const msg of history) {
      if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) continue;
      if (msg.role === expectedRole) {
        formattedHistory.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content.trim() }],
        });
        expectedRole = expectedRole === 'user' ? 'model' : 'user';
      }
    }

    // Gemini startChat requires the history to end on 'model', because sendMessage will append the next 'user' turn!
    while (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === 'user') {
      formattedHistory.pop();
    }

    const systemInstruction = options.systemInstruction || 'You are CARDOSO AI, a helpful, intelligent personal AI assistant.';

    // 3. Candidate models fallback list — Updated to current active Gemini models (Nov 2026)
    const candidateModels = Array.from(new Set([
      this.modelName,          // Primary model from config (default: gemini-3.8-flash)
      'gemini-3.8-flash',      // Latest recommended model (Google's official recommendation)
      'gemini-2.0-flash-001',  // Stable 2.0 flash
      'gemini-2.0-flash-lite', // Lightweight fallback
    ])).filter(m => Boolean(m));

    let lastError: any = null;

    for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx++) {
      const currentModelName = candidateModels[modelIdx];

      try {
        const responseText = await executeWithRetry(
          async () => {
            const client = this.currentClient!;
            const modelInstance = client.getGenerativeModel({
              model: currentModelName,
              systemInstruction,
              generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxOutputTokens ?? 1000,
              },
            });

            // Prepare prompt payload (text and optional multimodal image/audio/document)
            const contentParts: Array<string | Part> = [];
            if (options.media?.dataBase64 && options.media?.mimeType) {
              const cleanMime = options.media.mimeType.split(';')[0].trim();
              contentParts.push({
                inlineData: {
                  mimeType: cleanMime,
                  data: options.media.dataBase64,
                },
              });
            }
            contentParts.push(userPrompt);

            const callPromise = (async () => {
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
            })();

            // Enforce strict 8.5s timeout per model attempt to prevent hanging requests
            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error(`Timeout: ${currentModelName} took longer than 8500ms`)), 8500);
            });

            return await Promise.race([callPromise, timeoutPromise]);
          },
          {
            maxRetries: 1, // Fast retry on current model before switching
            initialDelayMs: 500,
            onRetry: (attempt, delayMs, err) => {
              console.warn(`[GeminiProvider] Retry ${attempt} on ${currentModelName} in ${delayMs}ms due to: ${err.message}`);
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
          modelUsed: currentModelName,
          tokensUsed: {
            promptTokens: Math.ceil(userPrompt.length / 4),
            completionTokens: Math.ceil(responseText.length / 4),
            totalTokens: estimatedTokens,
          },
          latencyMs: Date.now() - startTime,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiProvider] Model ${currentModelName} threw error (${err?.message || err}). Failing over to next free candidate...`);
        this.rotateKey();
      }
    }

    // 4. If all candidate models on all keys failed:
    console.error(`[GeminiProvider] All candidate models exhausted:`, lastError?.message || lastError);

    const isRateLimit = lastError?.status === 429 || (lastError?.message && lastError.message.includes('429'));
    if (isRateLimit) {
      return {
        text: 'Waan ka xumahay walaal, server-ka AI-da ayaa hadda su\'aalo badan helay hal mar. Fadlan 5-10 ilbiriqsi kadib mar kale codka ii soo duub! 🙏',
        provider: 'gemini',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }

    const isHighDemand = lastError?.status === 503 || (lastError?.message && (lastError.message.includes('503') || lastError.message.includes('high demand') || lastError.message.includes('Service Unavailable')));
    if (isHighDemand) {
      return {
        text: 'Waan ka xumahay walaal, server-ka Gemini AI ayaa hadda aad u mashquulsan. Fadlan wax yar kadib dib ii weydii! 😊',
        provider: 'gemini',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }

    const gracefulFallback = "Walaal, hadda xiriirka wuu yara mashquulsan yahay, fadlan daqiiqad yar kadib codka mar kale ii soo duub ama fariin ii soo qor! 😊";

    return {
      text: gracefulFallback,
      provider: 'gemini',
      modelUsed: this.modelName,
      latencyMs: Date.now() - startTime,
    };
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

