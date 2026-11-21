import fs from 'fs';
import path from 'path';

/**
 * ErrorLogService — central, persistent bot error registry.
 *
 * - Captures every console.error / console.warn (with the component tag and the source file:line
 *   that produced it), uncaught exceptions and unhandled rejections.
 * - Groups identical errors (count, first/last seen) so the owner can see WHAT failed and WHERE it came from
 *   by sending `!info` on WhatsApp, without needing access to the Render / terminal logs.
 * - Never throws, never logs through console itself (re-entrancy guarded), and redacts secrets.
 */

export type ErrorLevel = 'error' | 'warn';

export interface ErrorLogEntry {
  id: string;
  level: ErrorLevel;
  source: string;
  message: string;
  origin: string;
  stack: string[];
  hint?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const MAX_ENTRIES = 300;
const MAX_MESSAGE_LEN = 500;

export function redactSecrets(input: string): string {
  return String(input || '')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, 'AIza***')
    .replace(/([?&](?:key|token|access_token|api_key|apikey)=)[^&\s"']+/gi, '$1***')
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1***@')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{16,}/g, '$1***')
    .replace(/[A-Za-z0-9+/=]{200,}/g, '[…long-data…]');
}

function stripEmoji(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
}

/** Parses an Error stack into compact frames: project frames ("src/x.ts:12") first, else library frames ("pkg/lib/x.js:12"). */
export function parseStackFrames(stack: string | undefined, limit = 4): string[] {
  if (!stack) return [];
  const projectFrames: string[] = [];
  const libFrames: string[] = [];
  const otherFrames: string[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    if (line.includes('error-log.service') || line.includes('node:')) continue;
    const lib = line.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/](.+?):(\d+)(?::\d+)?\)?$/);
    if (lib) {
      libFrames.push(`${lib[1].replace(/\\/g, '/')}/${lib[2].replace(/\\/g, '/')}:${lib[3]}`);
      continue;
    }
    const m = line.match(/([^\s()]+?)[\\/](src[\\/][^\s():]+?):(\d+)(?::\d+)?\)?$/);
    if (m) {
      projectFrames.push(`${m[2].replace(/\\/g, '/')}:${m[3]}`);
      continue;
    }
    const other = line.match(/([^\\/\s()]+):(\d+)(?::\d+)?\)?$/);
    if (other) otherFrames.push(`${other[1]}:${other[2]}`);
  }
  // Project frames are the most actionable; when the failure happened purely inside a library
  // (e.g. a Baileys crypto error), show the library frames so the origin is never "unknown".
  const chosen = projectFrames.length > 0 ? projectFrames : libFrames.length > 0 ? libFrames : otherFrames;
  return chosen.slice(0, limit);
}

/** Known error patterns → plain-Somali explanation + whether they are benign (downgraded to a warning). */
const KNOWN_ERRORS: Array<{ re: RegExp; hint: string; benign: boolean }> = [
  {
    re: /Unsupported state or unable to authenticate data/i,
    hint: 'Baileys ayaa fariin/frame crypto ah u furi waayay (key-yada session-ka ma is-waafaqin, caadi ahaan waxay dhacdaa isla markii la xidhiidhinayo ama socket dib u bilaabmayo). Waa la qabtay, bot-kuna wuu shaqaynayaa. Haddii ay soo noqnoqoto cabaar kadib: unlink oo dib u scan-garee.',
    benign: true,
  },
  {
    re: /SSL modes .* aliases/i,
    hint: 'Digniin PostgreSQL (Neon) oo ku saabsan SSL mode — khatar ma aha.',
    benign: true,
  },
  {
    re: /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i,
    hint: 'Cilad shabakad (internet/API-ga dibadda). Hubi internet-ka ama API key-ga.',
    benign: false,
  },
  {
    re: /429|quota|RESOURCE_EXHAUSTED/i,
    hint: 'Xaddiga API (Gemini quota) ayaa dhammaaday ama waa la xaddiday.',
    benign: false,
  },
  {
    re: /Connection Closed|Stream Errored|Connection Failure|status: 408/i,
    hint: 'WhatsApp xidhiidhkii wuu go\'ay — bot-ku iskiis ayuu dib u xidhiidhinayaa.',
    benign: false,
  },
];

export function matchKnownError(message: string): { hint: string; benign: boolean } | undefined {
  const hit = KNOWN_ERRORS.find((k) => k.re.test(message));
  return hit ? { hint: hit.hint, benign: hit.benign } : undefined;
}


function normalizeForFingerprint(msg: string): string {
  return msg
    .replace(/\b\d{6,}\b/g, '#')
    .replace(/\b[0-9a-f]{12,}\b/gi, '*')
    .replace(/\d+(?:\.\d+)?\s?ms\b/g, '#ms')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

export class ErrorLogService {
  private entries = new Map<string, ErrorLogEntry>();
  private filePath: string;
  private persistTimer: NodeJS.Timeout | null = null;
  private suppress = false;
  private installed = false;
  private startedAt = Date.now();
  private origConsoleError: typeof console.error | null = null;
  private origConsoleWarn: typeof console.warn | null = null;

  constructor(filePath?: string) {
    const dataDir = process.env.DATA_DIR || './data';
    this.filePath = filePath || path.join(dataDir, 'error-log.json');
    this.load();
  }

  /** Records an error / warning. Safe to call from anywhere; never throws. */
  public record(source: string, err: unknown, level: ErrorLevel = 'error', extraStack?: string): void {
    try {
      const e: any = err;
      const rawMsg = redactSecrets(
        typeof err === 'string' ? err : e?.message ? String(e.message) : (() => { try { return JSON.stringify(err); } catch { return String(err); } })()
      ).slice(0, MAX_MESSAGE_LEN);
      const stackSrc: string | undefined = (e && typeof e === 'object' && e.stack) ? String(e.stack) : extraStack;
      const stack = parseStackFrames(stackSrc);
      const origin = stack[0] || 'unknown';
      const cleanSource = (source || 'App').slice(0, 60);
      const known = matchKnownError(rawMsg);
      if (known?.benign) level = 'warn';
      const fp = `${level}|${cleanSource}|${normalizeForFingerprint(rawMsg)}`;
      const now = Date.now();
      const existing = this.entries.get(fp);
      if (existing) {
        existing.count++;
        existing.lastSeen = now;
        if (stack.length > 0 && existing.origin === 'unknown') {
          existing.origin = origin;
          existing.stack = stack;
        }
      } else {
        this.entries.set(fp, {
          id: fp,
          level,
          source: cleanSource,
          message: rawMsg,
          origin,
          stack,
          hint: known?.hint,
          count: 1,
          firstSeen: now,
          lastSeen: now,
        });
        if (this.entries.size > MAX_ENTRIES) {
          let oldestKey = '';
          let oldest = Infinity;
          for (const [k, v] of this.entries) {
            if (v.lastSeen < oldest) {
              oldest = v.lastSeen;
              oldestKey = k;
            }
          }
          if (oldestKey) this.entries.delete(oldestKey);
        }
      }
      this.schedulePersist();
    } catch {
      /* never throw from the error logger */
    }
  }

  /** Run a block whose console.error/warn output must NOT be captured (to avoid double-recording). */
  public withoutCapture<T>(fn: () => T): T {
    const prev = this.suppress;
    this.suppress = true;
    try {
      return fn();
    } finally {
      this.suppress = prev;
    }
  }

  /** Hooks console.error / console.warn once so every logged problem is registered with its origin. */
  public installConsoleCapture(): void {
    if (this.installed) return;
    this.installed = true;
    this.origConsoleError = console.error.bind(console);
    this.origConsoleWarn = console.warn.bind(console);

    const wrap = (orig: (...a: any[]) => void, level: ErrorLevel) => (...args: any[]) => {
      try {
        orig(...args);
      } finally {
        if (!this.suppress) {
          this.suppress = true;
          try {
            this.captureConsole(level, args);
          } catch {
            /* ignore */
          } finally {
            this.suppress = false;
          }
        }
      }
    };
    console.error = wrap(this.origConsoleError, 'error');
    console.warn = wrap(this.origConsoleWarn, 'warn');
  }

  private captureConsole(level: ErrorLevel, args: any[]): void {
    const errArg = args.find((a) => a instanceof Error);
    const text = args
      .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(' ')
      .trim();
    if (!text) return;
    // Ignore the cosmetic ban-risk notice and pure blank lines
    if (/BAN RISK NOTICE|SAFETY MEASURES INCLUDED/i.test(text)) return;

    const clean = stripEmoji(text);
    const tag = clean.match(/\[([A-Za-z][^\]]{1,50})\]/);
    const stackText = (errArg as Error | undefined)?.stack || new Error().stack;
    const frames = parseStackFrames(stackText);
    const fileBase = frames[0] ? path.basename(frames[0].split(':')[0], '.ts') : 'App';
    const source = tag ? tag[1] : fileBase;
    const messageBody = tag ? clean.replace(tag[0], '').replace(/^[\s:–-]+/, '') : clean;
    this.record(source, errArg ? `${messageBody || (errArg as Error).message}` : messageBody || clean, level, stackText);
  }

  public getEntries(opts: { level?: ErrorLevel; scopeText?: string; sinceMs?: number } = {}): ErrorLogEntry[] {
    let list = [...this.entries.values()];
    if (opts.level) list = list.filter((e) => e.level === opts.level);
    if (opts.scopeText) {
      const needle = opts.scopeText;
      list = list.filter((e) => e.source.includes(needle) || e.message.includes(needle));
    }
    if (opts.sinceMs) {
      const cutoff = Date.now() - opts.sinceMs;
      list = list.filter((e) => e.lastSeen >= cutoff);
    }
    return list.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  public getStartedAt(): number {
    return this.startedAt;
  }

  public clear(scopeText?: string): number {
    let removed = 0;
    for (const [k, v] of [...this.entries]) {
      if (!scopeText || v.source.includes(scopeText) || v.message.includes(scopeText)) {
        this.entries.delete(k);
        removed++;
      }
    }
    this.persistNow();
    return removed;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(parsed?.entries)) {
        for (const e of parsed.entries as ErrorLogEntry[]) {
          if (e?.id && e.message) this.entries.set(e.id, e);
        }
      }
    } catch {
      /* corrupt file — start fresh */
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 2000);
    if (typeof this.persistTimer.unref === 'function') this.persistTimer.unref();
  }

  private persistNow(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ entries: [...this.entries.values()] }), 'utf8');
    } catch {
      /* read-only FS etc. — keep in-memory only */
    }
  }
}

export const errorLogService = new ErrorLogService();

/** Formats a duration in ms as "2h 5m" / "35m" / "12s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Formats an epoch time as HH:MM (Mogadishu, UTC+3) — plus date when older than a day. */
export function formatClock(ts: number): string {
  const d = new Date(ts + 3 * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const older = Date.now() - ts > 24 * 3600 * 1000;
  return older ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${hh}:${mm}` : `${hh}:${mm}`;
}
