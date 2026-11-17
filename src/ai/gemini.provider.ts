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

  constructor(apiKeyOrKeys: string | string[], modelName: string = 'gemini-flash-lite-latest', quotaTracker?: QuotaTracker) {
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

  public setApiKeys(apiKeyOrKeys: string | string[]): void {
    this.apiKeys = Array.isArray(apiKeyOrKeys)
      ? apiKeyOrKeys.filter(Boolean)
      : apiKeyOrKeys
        ? [apiKeyOrKeys]
        : [];
    this.currentKeyIndex = 0;
    this.initClients();
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

    // 3. Candidate models fallback list — Active Google Gemini Models with intelligent failover
    const unsupportedModels = new Set([
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-2.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-1.5-pro',
      'gemini-2.5-flash-lite',
    ]);

    const candidateModels = Array.from(new Set([
      this.modelName,             // Model from env (default: gemini-flash-lite-latest)
      'gemini-flash-lite-latest', // Dynamic pointer to active flash-lite (high quota)
      'gemini-3.5-flash-lite',    // Proven active model with high quota & low latency
      'gemini-3.1-flash-lite',    // High-performance lite fallback
      'gemini-3.5-flash',         // Standard flash
      'gemini-3.6-flash',         // Standard flash
      'gemini-3.8-flash',         // Advanced flash
    ])).filter(m => Boolean(m) && !unsupportedModels.has(m));

    let lastError: any = null;

    for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx++) {
      const currentModelName = candidateModels[modelIdx];

      // Try across available rotated API keys for this model before falling over
      const keyAttempts = Math.max(1, this.clients.length);
      for (let kAttempt = 0; kAttempt < keyAttempts; kAttempt++) {
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
                  ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
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

              // Fast 12s timeout per model to prevent hanging
              const timeoutPromise = new Promise<string>((_, reject) => {
                setTimeout(() => reject(new Error(`Timeout: ${currentModelName} took longer than 12000ms`)), 12000);
              });

              return await Promise.race([callPromise, timeoutPromise]);
            },
            {
              maxRetries: 1, // Fast retry on current model before switching
              initialDelayMs: 400,
              onRetry: (attempt, delayMs, err) => {
                console.warn(`[GeminiProvider] Retry ${attempt} on ${currentModelName} in ${delayMs}ms due to: ${err.message}`);
                if (err.message.includes('429') || err.message.includes('quota') || err.message.includes('ResourceExhausted')) {
                  this.rotateKey();
                }
              },
            }
          );

          // Record successful request for quota tracking
          const cleanResponseText = responseText.replace(/\bqaali(?:ga|da|yey|yahow)?\b/gi, '').replace(/\s+/g, ' ').trim();
          const estimatedTokens = Math.ceil((userPrompt.length + cleanResponseText.length) / 4);
          this.quotaTracker.recordRequest(estimatedTokens);

          return {
            text: cleanResponseText,
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
          const errMsg = err?.message || '';
          const is404 = errMsg.includes('404') || errMsg.includes('not found') || err?.status === 404;
          if (is404) {
            unsupportedModels.add(currentModelName);
            console.warn(`[GeminiProvider] Model ${currentModelName} is not available (404). Skipping immediately.`);
            break; // Skip all keys for this 404 model
          }

          const isQuota = errMsg.includes('429') || errMsg.includes('quota') || err?.status === 429;
          if (isQuota && this.clients.length > 1 && kAttempt < keyAttempts - 1) {
            console.warn(`[GeminiProvider] Key #${this.currentKeyIndex + 1} reached quota on ${currentModelName}. Rotating to next key...`);
            this.rotateKey();
            continue; // Try next key on this model!
          }

          console.warn(`[GeminiProvider] Model ${currentModelName} threw error (${errMsg}). Failing over...`);
          this.rotateKey();
          break; // Proceed to next candidate model
        }
      }
    }

    // 4. If all candidate models on all keys failed:
    console.error(`[GeminiProvider] All candidate models exhausted:`, lastError?.message || lastError);

    const isRateLimit = lastError?.status === 429 || (lastError?.message && lastError.message.includes('429'));
    if (isRateLimit) {
      return {
        text: 'Walaal, xilligan server-ka AI ayaa mashquul ah maadaama fariimo badan soo gaadheen. Fadlan ilbiriqsiyo yar kadib dib iigu soo qor waan kula socdaaye! 😊',
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

