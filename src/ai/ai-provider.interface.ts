/**
 * Conversation message structure for AI providers
 */
export interface ConversationMessage {
  role: 'user' | 'model' | 'system';
  content: string;
}

/**
 * Options for AI generation
 */
export interface GenerateOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  studentId?: string;
}

/**
 * Result returned by an AI provider
 */
export interface GenerateResult {
  text: string;
  provider: 'gemini' | 'llama_fallback' | 'offline_mock';
  modelUsed: string;
  tokensUsed?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

/**
 * Pluggable AI Provider interface.
 * Allows switching between Gemini, local LLM (llama.cpp/ollama), or test mocks
 * without altering any messaging or student advising code.
 */
export interface IAIProvider {
  readonly name: string;
  readonly isAvailable: boolean;

  /**
   * Initializes the provider and checks connection/credentials
   */
  initialize(): Promise<boolean>;

  /**
   * Generates a response given conversation history and current user prompt
   */
  generateResponse(
    userPrompt: string,
    history?: ConversationMessage[],
    options?: GenerateOptions
  ): Promise<GenerateResult>;

  /**
   * Returns current health and quota status
   */
  getStatus(): {
    healthy: boolean;
    provider: string;
    model: string;
    totalRequestsToday: number;
    remainingQuota: number;
    isQuotaExhausted: boolean;
  };
}

