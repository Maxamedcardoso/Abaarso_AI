/**
 * In-memory LRU Deduplicator to prevent duplicate message processing.
 * Crucial for WhatsApp webhooks and multi-device connection reconnects,
 * where the same message ID can be delivered more than once.
 */
export class MessageDeduplicator {
  private seenIds: Map<string, number> = new Map();
  private maxCapacity: number;
  private ttlMs: number;

  /**
   * @param maxCapacity Maximum message IDs to remember (default 1000)
   * @param ttlMs Time-to-live in milliseconds (default 5 minutes)
   */
  constructor(maxCapacity: number = 1000, ttlMs: number = 5 * 60 * 1000) {
    this.maxCapacity = maxCapacity;
    this.ttlMs = ttlMs;
  }

  /**
   * Checks if a message ID has already been seen.
   * If not seen, records it and returns false.
   * If already seen, returns true.
   */
  public isDuplicate(messageId: string): boolean {
    if (!messageId) return false;

    const now = Date.now();
    const existingTime = this.seenIds.get(messageId);

    if (existingTime) {
      if (now - existingTime < this.ttlMs) {
        return true; // Already processed recently
      }
    }

    // Record new ID
    this.seenIds.set(messageId, now);

    // Evict oldest entries if capacity exceeded
    if (this.seenIds.size > this.maxCapacity) {
      const oldestKey = this.seenIds.keys().next().value;
      if (oldestKey) {
        this.seenIds.delete(oldestKey);
      }
    }

    return false;
  }

  /**
   * Cleans up expired IDs
   */
  public cleanupExpired(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.seenIds.entries()) {
      if (now - timestamp > this.ttlMs) {
        this.seenIds.delete(id);
      }
    }
  }

  public size(): number {
    return this.seenIds.size;
  }

  public clear(): void {
    this.seenIds.clear();
  }
}

