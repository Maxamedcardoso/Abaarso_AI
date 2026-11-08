import { IAIProvider, ConversationMessage, GenerateOptions, GenerateResult } from './ai-provider.interface.js';
import { GeminiProvider } from './gemini.provider.js';
import { LlamaProvider } from './llama.provider.js';
import { QuotaTracker } from './quota-tracker.js';
import { AppConfig } from '../config/env.js';

export class AIOrchestrator {
  private geminiProvider: GeminiProvider;
  private llamaProvider: LlamaProvider;
  private quotaTracker: QuotaTracker;

  constructor(config: AppConfig, quotaTracker?: QuotaTracker) {
    this.quotaTracker = quotaTracker || new QuotaTracker(config.gemini.dailyLimit, config.gemini.rpmLimit);
    this.geminiProvider = new GeminiProvider(config.gemini.apiKey, config.gemini.model, this.quotaTracker);
    this.llamaProvider = new LlamaProvider(
      config.llamaFallback.enabled,
      config.llamaFallback.url,
      config.llamaFallback.model
    );
  }

  public async initialize(): Promise<void> {
    await this.geminiProvider.initialize();
    if (this.llamaProvider.isAvailable) {
      await this.llamaProvider.initialize();
    }
  }

  public getQuotaTracker(): QuotaTracker {
    return this.quotaTracker;
  }

  public getPrimaryProvider(): GeminiProvider {
    return this.geminiProvider;
  }

  public getFallbackProvider(): LlamaProvider {
    return this.llamaProvider;
  }

  public async generateResponse(
    userPrompt: string,
    history: ConversationMessage[] = [],
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    const quota = this.quotaTracker.canMakeRequest();

    // If Gemini free quota is exhausted:
    if (!quota.allowed) {
      // Check if local llama fallback is available
      if (this.llamaProvider.isAvailable) {
        console.log('[AIOrchestrator] Gemini free quota reached. Switching to verified local llama fallback.');
        return await this.llamaProvider.generateResponse(userPrompt, history, options);
      }

      // No fallback available — return clear zero-cost safeguard message
      return {
        text: `⚠️ [CARDOSO AI Zero-Cost Safeguard]: ${quota.reason}`,
        provider: 'gemini',
        modelUsed: this.geminiProvider.getStatus().model,
        latencyMs: 1,
      };
    }

    // Try primary Gemini provider
    if (this.geminiProvider.isAvailable) {
      const result = await this.geminiProvider.generateResponse(userPrompt, history, options);
      return result;
    }

    // If Gemini key is missing, check if fallback is active
    if (this.llamaProvider.isAvailable) {
      return await this.llamaProvider.generateResponse(userPrompt, history, options);
    }

    return {
      text: '⚠️ [CARDOSO AI]: No AI provider is active. Please add your free GEMINI_API_KEY in .env or configure local llama.cpp fallback.',
      provider: 'gemini',
      modelUsed: this.geminiProvider.getStatus().model,
      latencyMs: 1,
    };
  }

  public getStatus() {
    return {
      gemini: this.geminiProvider.getStatus(),
      llamaFallback: this.llamaProvider.getStatus(),
      quota: this.quotaTracker.getStats(),
    };
  }
}

