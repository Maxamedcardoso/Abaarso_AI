import fs from 'fs';
import path from 'path';
import { FREE_TIER_LIMITS } from '../config/limits.js';

export interface QuotaStats {
  date: string;
  dailyRequests: number;
  dailyEstimatedTokens: number;
  minuteRequests: number;
  lastRequestTimestamp: number;
  isDailyQuotaExhausted: boolean;
}

/**
 * QuotaTracker protects against any accidental billing.
 * Tracks daily requests, requests-per-minute, and estimates token usage.
 * Persists daily counts to disk so server restarts don't bypass the free quota.
 */
export class QuotaTracker {
  private dailyLimit: number;
  private rpmLimit: number;
  private stateFilePath: string;
  private stats: QuotaStats;
  private minuteWindowTimestamps: number[] = [];

  constructor(
    dailyLimit: number = FREE_TIER_LIMITS.MAX_DAILY_REQUESTS,
    rpmLimit: number = FREE_TIER_LIMITS.MAX_RPM,
    storageDir: string = './data'
  ) {
    this.dailyLimit = dailyLimit;
    this.rpmLimit = rpmLimit;
    this.stateFilePath = path.join(storageDir, 'quota_tracker.json');

    this.stats = this.loadState();
  }

  private getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
  }

  private loadState(): QuotaStats {
    const today = this.getTodayDateString();
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.date === today) {
          return {
            date: today,
            dailyRequests: parsed.dailyRequests || 0,
            dailyEstimatedTokens: parsed.dailyEstimatedTokens || 0,
            minuteRequests: 0,
            lastRequestTimestamp: parsed.lastRequestTimestamp || 0,
            isDailyQuotaExhausted: (parsed.dailyRequests || 0) >= this.dailyLimit,
          };
        }
      }
    } catch {
      // Ignore read errors and start fresh
    }

    return {
      date: today,
      dailyRequests: 0,
      dailyEstimatedTokens: 0,
      minuteRequests: 0,
      lastRequestTimestamp: 0,
      isDailyQuotaExhausted: false,
    };
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.stats, null, 2), 'utf8');
    } catch {
      // Non-fatal if state save fails
    }
  }

  /**
   * Resets counts if a new calendar day (UTC) has started.
   */
  private checkDayRollover(): void {
    const today = this.getTodayDateString();
    if (this.stats.date !== today) {
      this.stats = {
        date: today,
        dailyRequests: 0,
        dailyEstimatedTokens: 0,
        minuteRequests: 0,
        lastRequestTimestamp: 0,
        isDailyQuotaExhausted: false,
      };
      this.minuteWindowTimestamps = [];
      this.saveState();
    }
  }

  /**
   * Checks whether an AI request is permitted right now under free tier rules.
   */
  public canMakeRequest(): { allowed: boolean; reason?: string; retryAfterSeconds?: number } {
    this.checkDayRollover();

    // 1. Check daily hard limit
    if (this.stats.dailyRequests >= this.dailyLimit) {
      this.stats.isDailyQuotaExhausted = true;
      return {
        allowed: false,
        reason: `Daily free quota reached (${this.stats.dailyRequests}/${this.dailyLimit} requests). AI responses paused until 00:00 UTC to protect against any charges.`,
      };
    }

    // 2. Check Requests Per Minute (RPM) sliding window
    const now = Date.now();
    this.minuteWindowTimestamps = this.minuteWindowTimestamps.filter(t => now - t < 60000);

    if (this.minuteWindowTimestamps.length >= this.rpmLimit) {
      const oldestInWindow = this.minuteWindowTimestamps[0];
      const waitSeconds = Math.max(1, Math.ceil((60000 - (now - oldestInWindow)) / 1000));
      return {
        allowed: false,
        reason: `Per-minute rate limit reached (${this.rpmLimit} RPM). Cooling down.`,
        retryAfterSeconds: waitSeconds,
      };
    }

    return { allowed: true };
  }

  /**
   * Records a successfully initiated or completed AI request.
   */
  public recordRequest(estimatedTokens: number = 0): void {
    this.checkDayRollover();

    const now = Date.now();
    this.minuteWindowTimestamps.push(now);

    this.stats.dailyRequests++;
    this.stats.dailyEstimatedTokens += estimatedTokens;
    this.stats.lastRequestTimestamp = now;

    if (this.stats.dailyRequests >= this.dailyLimit) {
      this.stats.isDailyQuotaExhausted = true;
    }

    this.saveState();
  }

  public getStats(): QuotaStats & { dailyLimit: number; remainingDailyRequests: number } {
    this.checkDayRollover();
    const now = Date.now();
    const activeRpm = this.minuteWindowTimestamps.filter(t => now - t < 60000).length;

    return {
      ...this.stats,
      minuteRequests: activeRpm,
      dailyLimit: this.dailyLimit,
      remainingDailyRequests: Math.max(0, this.dailyLimit - this.stats.dailyRequests),
    };
  }

  /**
   * Explicitly sets daily request count (useful for testing or manual admin reset)
   */
  public setDailyRequestsForTesting(count: number): void {
    this.stats.dailyRequests = count;
    this.stats.isDailyQuotaExhausted = count >= this.dailyLimit;
    this.saveState();
  }

  public resetAll(): void {
    this.stats = {
      date: this.getTodayDateString(),
      dailyRequests: 0,
      dailyEstimatedTokens: 0,
      minuteRequests: 0,
      lastRequestTimestamp: 0,
      isDailyQuotaExhausted: false,
    };
    this.minuteWindowTimestamps = [];
    this.saveState();
  }
}

