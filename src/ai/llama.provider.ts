import { IAIProvider, ConversationMessage, GenerateOptions, GenerateResult } from './ai-provider.interface.js';

export class LlamaProvider implements IAIProvider {
  public readonly name = 'llama_fallback';
  private endpointUrl: string;
  private modelName: string;
  private available: boolean = false;
  private enabled: boolean = false;

  constructor(enabled: boolean = false, endpointUrl: string = 'http://127.0.0.1:8080/v1', modelName: string = 'llama-3.2-3b') {
    this.enabled = enabled;
    this.endpointUrl = endpointUrl.replace(/\/+$/, '');
    this.modelName = modelName;
  }

  public get isAvailable(): boolean {
    return this.enabled && this.available;
  }

  /**
   * Real health probe: checks if local llama.cpp or Ollama is running.
   * Never fakes availability.
   */
  public async initialize(): Promise<boolean> {
    if (!this.enabled) {
      this.available = false;
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second probe timeout

      const response = await fetch(`${this.endpointUrl}/models`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        this.available = true;
        console.log(`[LlamaProvider] Local llama.cpp/Ollama server detected online at ${this.endpointUrl}`);
        return true;
      }
    } catch {
      // Local server is not running
    }

    this.available = false;
    console.log(`[LlamaProvider] Local llama fallback is configured but OFFLINE at ${this.endpointUrl}.`);
    return false;
  }

  public async generateResponse(
    userPrompt: string,
    history: ConversationMessage[] = [],
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    const startTime = Date.now();

    if (!this.isAvailable) {
      // Honestly report offline status — never fake a response!
      return {
        text: `⚠️ [ABARSO AI Fallback]: Local llama.cpp fallback server is unavailable at ${this.endpointUrl}. Ensure llama.cpp/Ollama is running.`,
        provider: 'llama_fallback',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }

    const messages = [
      { role: 'system', content: options.systemInstruction || 'You are ABARSO AI, a student advisor.' },
      ...history.map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.content,
      })),
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await fetch(`${this.endpointUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxOutputTokens ?? 1000,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';

      return {
        text,
        provider: 'llama_fallback',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      this.available = false; // Mark unavailable if it crashed
      return {
        text: `⚠️ [ABARSO AI Fallback Error]: Local llama request failed: ${err.message}`,
        provider: 'llama_fallback',
        modelUsed: this.modelName,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  public getStatus() {
    return {
      healthy: this.isAvailable,
      provider: this.name,
      model: this.modelName,
      totalRequestsToday: 0,
      remainingQuota: Infinity,
      isQuotaExhausted: false,
    };
  }
}

