import { FREE_TIER_LIMITS } from '../config/limits.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: any) => void;
}

/**
 * Checks if an error from Gemini or network is transient and retryable.
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  const msg = (error.message || '').toLowerCase();
  const status = error.status || error.statusCode || 0;

  // HTTP 429: Too Many Requests / Resource Exhausted
  if (status === 429 || msg.includes('429') || msg.includes('resource_exhausted')) {
    return true;
  }

  // HTTP 503: Service Unavailable / Overloaded
  if (status === 503 || msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
    return true;
  }

  // Transient network connection drops
  if (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network error')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async task with exponential backoff and jitter.
 */
export async function executeWithRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? FREE_TIER_LIMITS.RETRY.MAX_RETRIES;
  const initialDelay = options.initialDelayMs ?? FREE_TIER_LIMITS.RETRY.INITIAL_DELAY_MS;
  const factor = options.backoffFactor ?? FREE_TIER_LIMITS.RETRY.BACKOFF_FACTOR;
  const maxDelay = options.maxDelayMs ?? FREE_TIER_LIMITS.RETRY.MAX_DELAY_MS;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await task();
    } catch (err: any) {
      attempt++;

      if (attempt > maxRetries || !isRetryableError(err)) {
        // Fatal or max retries exceeded
        throw err;
      }

      // Add jitter (±20%) to prevent thundering herd
      const jitter = delay * (0.8 + Math.random() * 0.4);
      const actualWaitMs = Math.min(Math.round(jitter), maxDelay);

      if (options.onRetry) {
        options.onRetry(attempt, actualWaitMs, err);
      }

      await new Promise(resolve => setTimeout(resolve, actualWaitMs));

      delay = Math.min(delay * factor, maxDelay);
    }
  }
}

