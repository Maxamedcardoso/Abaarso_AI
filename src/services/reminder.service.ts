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
 * Stores reminders in memory & fires them reliably on schedule.
 * Full natural-language support for Somali and English time expressions,
 * with automatic East Africa Time (EAT / UTC+3) alignment for Somalia & Somaliland.
 */
export class ReminderService {
  private reminders = new Map<string, ReminderRecord>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private sendFn: ((chatId: string, text: string) => Promise<void>) | null = null;

  /**
   * Determine if a user message is a reminder request.
   * Catches: "igu xasuusi", "i xasuusi", "i xusuusi", "igu xusuusi", "remind me", "xasuusin", etc.
   */
  public static isReminderRequest(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      /(?:xasuusi|xusuusi|xasuusin|xusuusin|remind|reminder|notify|ha\s+i\s+hilmaamin|qorshe)/i.test(lower) ||
      (/\b\d{1,2}(?::\d{2})?\b/.test(lower) && /(?:ayaan\s+(?:samayn|qaban|tegi|tago)|waxaan\s+(?:samayn|qaban)|berri|bari|caawa|saacadu)/i.test(lower))
    );
  }

  /**
   * Parses natural-language time from a message.
   * Handles:
   * 1. Relative minutes: "5 daqiiqo kadib", "10 min", "in 15 minutes"
   * 2. Relative hours: "1 saacad kadib", "2 hours", "saacad ka dib"
   * 3. Specific clock times: "8:00 subaxnimo", "8 subaxnimo", "8-da subaxnimo", "7:30 PM", "9:00 fiidnimo", "20:00"
   * Returns { fireAtMs, reminderText } or null.
   */
  public static parseReminderTime(text: string): { fireAtMs: number; reminderText: string } | null {
    const now = Date.now();

    // 1. Relative minutes: e.g. "5 daqiiqo kadib", "10 min", "15 daqiiqo gudahood"
    const minMatch = text.match(/(\d+)\s*(?:daqiiqo|daqiiqadood|daaqiiqo|min(?:ute)?s?)/i);
    if (minMatch) {
      const mins = parseInt(minMatch[1], 10);
      return {
        fireAtMs: now + mins * 60 * 1000,
        reminderText: this.cleanReminderText(text),
      };
    }

    // 2. Relative hours: e.g. "1 saacad kadib", "2 saacadood", "3 hours", "1 hr"
    const hourMatch = text.match(/(\d+)\s*(?:saacad|saacadood|saac|hour(?:s)?|hr(?:s)?)/i);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1], 10);
      return {
        fireAtMs: now + hours * 60 * 60 * 1000,
        reminderText: this.cleanReminderText(text),
      };
    }

    // 3. Wall clock time (e.g. "8:00 subaxnimo", "8 subaxnimo", "8-da subaxnimo", "8:30pm", "9 fiidnimo", "14:00")
    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(?:[-]?da|[-]?ka|[-]?ta)?\s*(AM|PM|subaxnimo|subax|duhurnimo|duhur|galabnimo|galab|fiidnimo|fiid|habeenimo|habeen)?/i);
    if (timeMatch) {
      const rawHour = parseInt(timeMatch[1], 10);
      const rawMin = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const period = (timeMatch[3] || '').toLowerCase();

      if (rawHour >= 1 && rawHour <= 24 && rawMin >= 0 && rawMin <= 59) {
        let hour24 = rawHour;
        const isPm = period === 'pm' || period.includes('galab') || period.includes('fiid') || period.includes('habeen') || period.includes('duhur');
        const isAm = period === 'am' || period.includes('subax');

        if (isPm && hour24 < 12) hour24 += 12;
        if (isAm && hour24 === 12) hour24 = 0;

        // East Africa Time (EAT = UTC+3) alignment:
        // Render server operates in UTC. Somalia/Somaliland is UTC+3.
        const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
        const nowEat = new Date(now + EAT_OFFSET_MS);

        let targetEat = new Date(nowEat);
        targetEat.setUTCHours(hour24, rawMin, 0, 0);

        // If time has already passed today in EAT, schedule for tomorrow
        if (targetEat.getTime() <= nowEat.getTime()) {
          targetEat = new Date(targetEat.getTime() + 24 * 60 * 60 * 1000);
        }

        // Convert back to UTC epoch
        const fireAtMs = targetEat.getTime() - EAT_OFFSET_MS;

        return {
          fireAtMs,
          reminderText: this.cleanReminderText(text),
        };
      }
    }

    return null;
  }

  /**
   * Cleans the reminder request command to leave only the core task/message.
   */
  private static cleanReminderText(raw: string): string {
    let clean = raw
      .replace(/(\d+)\s*(?:daqiiqo|daqiiqadood|daaqiiqo|min(?:ute)?s?)/gi, '')
      .replace(/(\d+)\s*(?:saacad|saacadood|saac|hour(?:s)?|hr(?:s)?)/gi, '')
      .replace(/(\d{1,2})(?::(\d{2}))?\s*(?:[-]?da|[-]?ka|[-]?ta)?\s*(?:AM|PM|subaxnimo|subax|duhurnimo|duhur|galabnimo|galab|fiidnimo|fiid|habeenimo|habeen)?/gi, '')
      .replace(/\b(?:igu\s+xasuusi|i\s+xasuusi|i\s+xusuusi|igu\s+xusuusi|xasuusi|xusuusi|xasuusin|xusuusin|remind\s+me(?:\s+to)?|reminder|notify\s+me|kadib|ka\s+dib|gudahood|markay\s+tahay|markay\s+tahayba|fadlan|waxaan\s+samaynayaa|ayaan\s+samaynayaa|berri|bari|caawa|saacadu)\b/gi, '')
      .replace(/[⏰\.,:;!\?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean || clean.length < 3) {
      return 'Waqtigii aad ii sheegtay wuu gaadhay! ⏰';
    }

    return clean.charAt(0).toUpperCase() + clean.slice(1);
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
    console.log(`⏰ [ReminderService] Scheduled reminder for ${chatId} at ${new Date(fireAtMs).toISOString()} ("${reminderText}")`);
    return id;
  }

  public start(): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => this.checkAndFire(), 5_000); // Check every 5 seconds for high precision
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
        console.log(`🔔 [ReminderService] Firing reminder "${reminder.message}" to ${reminder.chatId}`);
        try {
          await this.sendFn(
            reminder.chatId,
            `⏰ *XASUUSIN CARDOSO AI:* 🔔\n\nWalaal, waa waqtigii xasuusinta aad iga codsatay:\n👉 *${reminder.message}*\n\n_Horumar iyo guul wanaagsan!_ ✨`
          );
        } catch (err) {
          console.error('[ReminderService] Error firing reminder:', err);
        }
        this.reminders.delete(id);
      }
    }
  }
}

export const reminderService = new ReminderService();
