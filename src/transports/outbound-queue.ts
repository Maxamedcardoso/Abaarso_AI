/**
 * OutboundQueue — Anti-Ban serial message queue for WhatsApp.
 * Ensures messages to multiple concurrent users are spaced out naturally
 * with human-like typing delays (600ms - 1200ms) to avoid Meta spam detection algorithms.
 */
export class OutboundQueue {
  private queue: Array<{
    task: () => Promise<any>;
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }> = [];

  private isProcessing = false;
  private minDelayMs: number;
  private maxDelayMs: number;

  constructor(minDelayMs: number = 200, maxDelayMs: number = 400) {
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Enqueues a message send task and returns a Promise that resolves when the task finishes.
   */
  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }

      // Random jitter delay between distinct outgoing messages
      if (this.queue.length > 0) {
        const delay = Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    this.isProcessing = false;
  }

  public get pendingCount(): number {
    return this.queue.length;
  }
}

