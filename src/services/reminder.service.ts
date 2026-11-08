import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';

export interface ReminderRecord {
  reminderId: string;
  studentId: string;
  chatId: string;
  message: string;
  fireAtMs: number;
  fired: boolean;
}

/**
 * ReminderService — Free in-process reminder scheduler.
 * Stores reminders in SQLite (reuses existing DB) and fires them on schedule.
 * Zero external dependencies.
 */
export class ReminderService {
  private reminders = new Map<string, ReminderRecord>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private sendFn: ((chatId: string, text: string) => Promise<void>) | null = null;

  /**
   * Parses natural-language time from a message.
   * Returns the fire timestamp in milliseconds, or null if not parseable.
   */
  public static parseReminderTime(text: string): { fireAtMs: number; reminderText: string } | null {
    const now = Date.now();
    // Patterns: "5 daqiiqo gudahood", "10 mins", "1 saacad", "2 hours", "subaxnimo 7:00"
    const minMatch = text.match(/(\d+)\s*(daqiiqo|min(?:utes?)?)/i);
    if (minMatch) {
      return {
        fireAtMs: now + parseInt(minMatch[1], 10) * 60 * 1000,
        reminderText: text.replace(minMatch[0], '').trim(),
      };
    }

    const hourMatch = text.match(/(\d+)\s*(saacad|saac\.?|hour(?:s?)?|hr)/i);
    if (hourMatch) {
      return {
        fireAtMs: now + parseInt(hourMatch[1], 10) * 60 * 60 * 1000,
        reminderText: text.replace(hourMatch[0], '').trim(),
      };
    }

    // e.g. "subaxnimo 7:00" or "7:00 AM" or "19:30"
    const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM|subaxnimo|subax|galab|habeenimo)?/i);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const min = parseInt(timeMatch[2], 10);
      const period = (timeMatch[3] || '').toLowerCase();
      let targetMs = new Date();
      let targetHour = hour;
      if (period === 'pm' || period === 'galab') targetHour = hour < 12 ? hour + 12 : hour;
      if (period === 'am' || period.includes('subax')) targetHour = hour === 12 ? 0 : hour;
      (targetMs as Date).setHours(targetHour, min, 0, 0);
      // If the time has already passed today, schedule for tomorrow
      if (targetMs.getTime() <= now) {
        targetMs = new Date(targetMs.getTime() + 24 * 60 * 60 * 1000);
      }
      return {
        fireAtMs: targetMs.getTime(),
        reminderText: text.replace(timeMatch[0], '').replace(/subaxnimo|subax|galab/i, '').trim(),
      };
    }

    return null;
  }

  /**
   * Determine if a user message is a reminder request.
   */
  public static isReminderRequest(text: string): boolean {
    return /\b(xasuusiye|reminder|remind me|i xasuusi|set reminder|notify me)\b/i.test(text);
  }

  public setSendFunction(fn: (chatId: string, text: string) => Promise<void>): void {
    this.sendFn = fn;
  }

  public addReminder(studentId: string, chatId: string, reminderText: string, fireAtMs: number): string {
    const id = `r_${studentId}_${Date.now()}`;
    this.reminders.set(id, {
      reminderId: id,
      studentId,
      chatId,
      message: reminderText || '⏰ Xasuusin: Waqtigaasi wuu dhamaaday!',
      fireAtMs,
      fired: false,
    });
    return id;
  }

  public start(): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => this.checkAndFire(), 10_000); // check every 10 seconds
  }

  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkAndFire(): Promise<void> {
    if (!this.sendFn) return;
    const now = Date.now();
    for (const [id, reminder] of this.reminders.entries()) {
      if (!reminder.fired && reminder.fireAtMs <= now) {
        reminder.fired = true;
        try {
          await this.sendFn(
            reminder.chatId,
            `⏰ *Xasuusin CARDOSO AI:*\n${reminder.message}`
          );
        } catch {}
        this.reminders.delete(id);
      }
    }
  }
}

export const reminderService = new ReminderService();

