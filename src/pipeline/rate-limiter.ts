/**
 * In-memory sliding window rate limiter per student ID.
 * Protects the bot from abusive spam, infinite loops, and token exhaustion.
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequestsPerWindow: number;
  private windowMs: number;

  /**
   * @param maxRequests Maximum requests allowed within the window (e.g. 5)
   * @param windowMs Time window in milliseconds (e.g. 60,000ms = 1 minute)
   */
  constructor(maxRequests: number = 15, windowMs: number = 60 * 1000) {
    this.maxRequestsPerWindow = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Checks if an action by `studentId` is allowed.
   * If allowed, records the timestamp and returns { allowed: true }.
   * If rate-limited, returns { allowed: false, retryAfterSeconds }.
   */
  public checkLimit(studentId: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const timestamps = this.requests.get(studentId) || [];

    // Filter out timestamps outside the window
    const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequestsPerWindow) {
      const oldestValid = validTimestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((this.windowMs - (now - oldestValid)) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    // Add current timestamp
    validTimestamps.push(now);
    this.requests.set(studentId, validTimestamps);

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Resets rate limit for a specific student (e.g., admin override)
   */
  public reset(studentId: string): void {
    this.requests.delete(studentId);
  }

  /**
   * Periodic garbage collection of stale rate limit entries
   */
  public cleanup(): void {
    const now = Date.now();
    for (const [studentId, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.requests.delete(studentId);
      } else {
        this.requests.set(studentId, valid);
      }
    }
  }
}

