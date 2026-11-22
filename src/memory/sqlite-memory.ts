import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { IStudentMemory, LeadRecord, StoredMessage, StudentProfile, VerifiedReceiptRecord } from './memory.interface.js';

export class SQLiteStudentMemory implements IStudentMemory {
  private db: DatabaseSync | null = null;
  private dbPath: string;

  constructor(dbPath: string = './data/cardoso.db') {
    this.dbPath = dbPath;
  }

  /**
   * Hashes a raw phone number or sender ID using SHA-256 for student privacy.
   */
  public hashIdentifier(rawIdentifier: string): string {
    return crypto.createHash('sha256').update(rawIdentifier.trim()).digest('hex').slice(0, 16);
  }

  public async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);

    // Enable WAL mode for high performance and concurrency
    this.db.exec('PRAGMA journal_mode = WAL;');

    // Create core tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        student_id TEXT PRIMARY KEY,
        identifier_hash TEXT UNIQUE,
        preferred_language TEXT DEFAULT 'so',
        first_seen_at INTEGER,
        last_active_at INTEGER,
        total_messages INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        language TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conv_student ON conversations(student_id);
      CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_conv_chat ON conversations(chat_id);

      CREATE TABLE IF NOT EXISTS broadcast_contacts (
        jid TEXT PRIMARY KEY,
        name TEXT,
        first_name TEXT,
        phone TEXT,
        last_seen INTEGER
      );

      CREATE TABLE IF NOT EXISTS broadcast_sent_history (
        jid TEXT PRIMARY KEY,
        sent_at INTEGER NOT NULL,
        message_preview TEXT
      );

      CREATE TABLE IF NOT EXISTS user_vocab (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        normalized TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        example_context TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_normalized ON user_vocab(normalized);

      CREATE TABLE IF NOT EXISTS user_phrase_style (
        chat_id TEXT NOT NULL,
        phrase TEXT NOT NULL,
        used_count INTEGER DEFAULT 1,
        last_used INTEGER NOT NULL,
        PRIMARY KEY (chat_id, phrase)
      );

      CREATE TABLE IF NOT EXISTS bot_custom_config (
        id TEXT PRIMARY KEY,
        bot_name TEXT DEFAULT 'CARDOSO AI',
        business_name TEXT DEFAULT '',
        system_role TEXT DEFAULT '',
        knowledge_base TEXT DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broadcast_opt_outs (
        jid TEXT PRIMARY KEY,
        reason TEXT,
        opted_out_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auto_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT UNIQUE NOT NULL,
        reply_text TEXT NOT NULL,
        match_type TEXT DEFAULT 'contains',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        sender_name TEXT DEFAULT '',
        sender_phone TEXT DEFAULT '',
        category TEXT DEFAULT 'general',
        summary TEXT NOT NULL,
        status TEXT DEFAULT 'new',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

      CREATE TABLE IF NOT EXISTS verified_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT DEFAULT 'UNKNOWN',
        tix TEXT DEFAULT '',
        normalized_tix TEXT DEFAULT '',
        image_hash TEXT DEFAULT '',
        amount REAL DEFAULT NULL,
        currency TEXT DEFAULT 'UNKNOWN',
        receiver_name TEXT DEFAULT '',
        receiver_account TEXT DEFAULT '',
        chat_id TEXT NOT NULL,
        sender_phone TEXT DEFAULT '',
        status TEXT NOT NULL,
        rejection_reason TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_tix ON verified_receipts(normalized_tix, status);
      CREATE INDEX IF NOT EXISTS idx_receipts_hash ON verified_receipts(image_hash, status);
    `);

    // Safe schema migrations — add profile columns if they don't exist yet
    const profileColumns = ['first_name TEXT', 'interests TEXT', 'occupation TEXT'];
    for (const colDef of profileColumns) {
      const colName = colDef.split(' ')[0];
      try {
        this.db.exec(`ALTER TABLE students ADD COLUMN ${colName} TEXT DEFAULT NULL;`);
      } catch {
        // Column already exists — safe to ignore
      }
    }
  }

  public async getOrCreateStudent(rawIdentifier: string): Promise<StudentProfile> {
    if (!this.db) throw new Error('Database not initialized');

    const idHash = this.hashIdentifier(rawIdentifier);
    const now = Date.now();

    // Check if student exists
    const query = this.db.prepare('SELECT * FROM students WHERE identifier_hash = ?');
    const existing = query.get(idHash) as any;

    if (existing) {
      // Update last active
      this.db.prepare('UPDATE students SET last_active_at = ?, total_messages = total_messages + 1 WHERE student_id = ?')
        .run(now, existing.student_id);

      return {
        studentId: existing.student_id,
        rawIdentifier: idHash,
        preferredLanguage: existing.preferred_language || 'so',
        firstName: existing.first_name || undefined,
        interests: existing.interests || undefined,
        occupation: existing.occupation || undefined,
        firstSeenAt: existing.first_seen_at,
        lastActiveAt: now,
        totalMessagesCount: existing.total_messages + 1,
      };
    }

    // Create new student
    const studentId = `stu_${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO students (student_id, identifier_hash, preferred_language, first_seen_at, last_active_at, total_messages)
      VALUES (?, ?, 'so', ?, ?, 1)
    `).run(studentId, idHash, now, now);

    return {
      studentId,
      rawIdentifier: idHash,
      preferredLanguage: 'so',
      firstSeenAt: now,
      lastActiveAt: now,
      totalMessagesCount: 1,
    };
  }

  public async saveMessage(message: StoredMessage): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO conversations (student_id, chat_id, role, content, language, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.studentId,
      message.chatId,
      message.role,
      message.content,
      message.languageDetected || null,
      message.timestamp || Date.now()
    );
  }

  public async getConversationHistory(studentId: string, limit: number = 10): Promise<StoredMessage[]> {
    if (!this.db) throw new Error('Database not initialized');

    // Strict isolation: strictly filter by student_id
    const stmt = this.db.prepare(`
      SELECT student_id as studentId, chat_id as chatId, role, content, language as languageDetected, timestamp
      FROM conversations
      WHERE student_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);

    const rows = stmt.all(studentId, limit) as unknown as StoredMessage[];
    return rows.reverse(); // Return in chronological order
  }

  public async deleteStudentHistory(studentId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    // Delete conversations
    this.db.prepare('DELETE FROM conversations WHERE student_id = ?').run(studentId);
    // Delete profile
    this.db.prepare('DELETE FROM students WHERE student_id = ?').run(studentId);

    return true;
  }

  /**
   * Read-only lookup of conversation history by raw identifier (e.g. PWA session ID)
   * without creating a student profile row if the user has never chatted yet.
   */
  public async getHistoryByRawIdentifier(rawIdentifier: string, limit: number = 40): Promise<StoredMessage[]> {
    if (!this.db) throw new Error('Database not initialized');
    const idHash = this.hashIdentifier(rawIdentifier);
    const existing = this.db
      .prepare('SELECT student_id FROM students WHERE identifier_hash = ?')
      .get(idHash) as { student_id?: string } | undefined;
    if (!existing?.student_id) return [];
    return this.getConversationHistory(existing.student_id, limit);
  }

  /**
   * Deletes all conversation history and profile for a raw identifier if present.
   */
  public async deleteHistoryByRawIdentifier(rawIdentifier: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    const idHash = this.hashIdentifier(rawIdentifier);
    const existing = this.db
      .prepare('SELECT student_id FROM students WHERE identifier_hash = ?')
      .get(idHash) as { student_id?: string } | undefined;
    if (!existing?.student_id) return false;
    return this.deleteStudentHistory(existing.student_id);
  }

  public async purgeStaleData(retentionDays: number = 30): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare('DELETE FROM conversations WHERE timestamp < ?');
    const result: any = stmt.run(cutoffTimestamp);

    return result?.changes || 0;
  }

  public async getStats(): Promise<{
    totalStudents: number;
    totalMessages: number;
    oldestMessageDate: string | null;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    const studentsCount: any = this.db.prepare('SELECT COUNT(*) as count FROM students').get();
    const messagesCount: any = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    const oldestRow: any = this.db.prepare('SELECT MIN(timestamp) as oldest FROM conversations').get();

    return {
      totalStudents: studentsCount?.count || 0,
      totalMessages: messagesCount?.count || 0,
      oldestMessageDate: oldestRow?.oldest ? new Date(oldestRow.oldest).toISOString() : null,
    };
  }

  public async updateUserProfile(studentId: string, updates: { firstName?: string; interests?: string; occupation?: string; preferredLanguage?: string }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.firstName !== undefined) { setClauses.push('first_name = ?'); values.push(updates.firstName); }
    if (updates.interests !== undefined) { setClauses.push('interests = ?'); values.push(updates.interests); }
    if (updates.occupation !== undefined) { setClauses.push('occupation = ?'); values.push(updates.occupation); }
    if (updates.preferredLanguage !== undefined) { setClauses.push('preferred_language = ?'); values.push(updates.preferredLanguage); }

    if (setClauses.length === 0) return;

    values.push(studentId);
    this.db.prepare(`UPDATE students SET ${setClauses.join(', ')} WHERE student_id = ?`).run(...values);
  }

  public async saveBroadcastContact(contact: { jid: string; name?: string; firstName?: string; phone?: string }): Promise<void> {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO broadcast_contacts (jid, name, first_name, phone, last_seen)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          name = COALESCE(excluded.name, broadcast_contacts.name),
          first_name = COALESCE(excluded.first_name, broadcast_contacts.first_name),
          phone = COALESCE(excluded.phone, broadcast_contacts.phone),
          last_seen = excluded.last_seen;
      `).run(contact.jid, contact.name || null, contact.firstName || null, contact.phone || null, Date.now());
    } catch (err: any) {
      console.warn('[SQLiteStudentMemory] Failed saving broadcast contact:', err.message);
    }
  }

  public async getBroadcastContacts(): Promise<Array<{ jid: string; name?: string; firstName?: string; phone?: string }>> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare('SELECT jid, name, first_name as firstName, phone FROM broadcast_contacts ORDER BY last_seen DESC').all() as any[];
      return rows.map(r => ({
        jid: r.jid,
        name: r.name || undefined,
        firstName: r.firstName || undefined,
        phone: r.phone || undefined,
      }));
    } catch {
      return [];
    }
  }

  public async markBroadcastSent(jid: string, preview?: string): Promise<void> {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO broadcast_sent_history (jid, sent_at, message_preview)
        VALUES (?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          sent_at = excluded.sent_at,
          message_preview = excluded.message_preview;
      `).run(jid, Date.now(), (preview || '').slice(0, 100));
    } catch (err: any) {
      console.warn('[SQLiteStudentMemory] Failed marking broadcast sent:', err.message);
    }
  }

  public async getSentBroadcastJids(): Promise<Set<string>> {
    if (!this.db) return new Set();
    try {
      const rows = this.db.prepare('SELECT jid FROM broadcast_sent_history').all() as any[];
      return new Set(rows.map(r => r.jid));
    } catch {
      return new Set();
    }
  }

  public async resetBroadcastSentHistory(): Promise<number> {
    if (!this.db) return 0;
    try {
      const result = this.db.prepare('DELETE FROM broadcast_sent_history').run();
      return Number(result.changes);
    } catch {
      return 0;
    }
  }

  public getBroadcastSentCountSince(sinceMs: number): number {
    if (!this.db) return 0;
    try {
      const row: any = this.db.prepare('SELECT COUNT(*) as cnt FROM broadcast_sent_history WHERE sent_at >= ?').get(sinceMs);
      return Number(row?.cnt || 0);
    } catch {
      return 0;
    }
  }

  public addBroadcastOptOut(jid: string, reason?: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO broadcast_opt_outs (jid, reason, opted_out_at)
        VALUES (?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET reason = excluded.reason, opted_out_at = excluded.opted_out_at;
      `).run(jid, (reason || '').slice(0, 100), Date.now());
    } catch {}
  }

  public getBroadcastOptOutJids(): Set<string> {
    if (!this.db) return new Set();
    try {
      const rows = this.db.prepare('SELECT jid FROM broadcast_opt_outs').all() as any[];
      return new Set(rows.map(r => r.jid));
    } catch {
      return new Set();
    }
  }

  public async getDistinctIndividualChatsWithNames(): Promise<Array<{ chatId: string; firstName?: string }>> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(`
        SELECT c.chat_id as chatId, MAX(s.first_name) as firstName
        FROM conversations c
        LEFT JOIN students s ON c.student_id = s.student_id
        WHERE c.chat_id NOT LIKE '%@g.us'
          AND c.chat_id NOT LIKE '%status@broadcast%'
          AND c.chat_id NOT LIKE '%@newsletter%'
          AND c.chat_id != 'student_direct_chat'
        GROUP BY c.chat_id
      `).all() as any[];
      return rows
        .filter(r => r.chatId)
        .map(r => ({ chatId: r.chatId, firstName: r.firstName || undefined }));
    } catch {
      return [];
    }
  }

  public async getDistinctIndividualChats(): Promise<string[]> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(`
        SELECT DISTINCT chat_id
        FROM conversations
        WHERE chat_id NOT LIKE '%@g.us'
          AND chat_id NOT LIKE '%status@broadcast%'
          AND chat_id NOT LIKE '%@newsletter%'
          AND chat_id != 'student_direct_chat'
      `).all() as any[];
      return rows.map(r => r.chat_id).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Learns new Somali words from user messages and stores them with frequency.
   * Words must be ≥3 chars, Somali-alphabet only, not in a stopword list.
   */
  public learnVocabFromText(text: string): void {
    if (!this.db) return;
    const STOP = new Set([
      'waa','wuu','way','waan','ayaa','baa','oo','iyo','la','ku','ka','si','ma','ha',
      'in','ina','aan','aad','aya','ay','taa','tan','taas','kan','kaas','kuu','kaga',
      'haa','haye','maya','okay','ok','scw','wcs','sxb','lol','yes','no','hi','hey',
    ]);
    // Extract Somali words: letters only, 3-30 chars
    const tokens = text.toLowerCase().match(/[a-zxcqdhwjklmnprstuy']{3,30}/gi) || [];
    const now = Date.now();
    for (const raw of tokens) {
      const word = raw.replace(/'/g, '');
      if (word.length < 3 || STOP.has(word)) continue;
      try {
        this.db.prepare(`
          INSERT INTO user_vocab (word, normalized, frequency, first_seen, last_seen, example_context)
          VALUES (?, ?, 1, ?, ?, ?)
          ON CONFLICT(normalized) DO UPDATE SET
            frequency = frequency + 1,
            last_seen = excluded.last_seen
        `).run(raw, word, now, now, text.slice(0, 80));
      } catch {}
    }
  }

  /**
   * Returns total unique Somali words learned so far.
   */
  public getVocabCount(): number {
    if (!this.db) return 0;
    try {
      const row: any = this.db.prepare('SELECT COUNT(*) as cnt FROM user_vocab').get();
      return row?.cnt || 0;
    } catch { return 0; }
  }

  /**
   * Returns the top N most common words learned (for prompt injection).
   */
  public getTopVocab(limit = 60): Array<{ word: string; frequency: number }> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        'SELECT word, frequency FROM user_vocab ORDER BY frequency DESC LIMIT ?'
      ).all(limit) as any[];
      return rows.map(r => ({ word: r.word, frequency: r.frequency }));
    } catch { return []; }
  }

  /**
   * Records a phrase style used by the bot for a specific chat (anti-repetition).
   */
  public recordPhraseUsed(chatId: string, phrase: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO user_phrase_style (chat_id, phrase, used_count, last_used)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(chat_id, phrase) DO UPDATE SET
          used_count = used_count + 1,
          last_used = excluded.last_used
      `).run(chatId, phrase.slice(0, 100), Date.now());
    } catch {}
  }

  /**
   * Returns the most recently used phrases for a chat (to avoid repeating them).
   */
  public getRecentPhrases(chatId: string, limit = 15): string[] {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        'SELECT phrase FROM user_phrase_style WHERE chat_id = ? ORDER BY last_used DESC LIMIT ?'
      ).all(chatId, limit) as any[];
      return rows.map(r => r.phrase);
    } catch { return []; }
  }

  /**
   * Saves custom bot persona & business knowledge base
   */
  public async saveBotConfig(config: { botName?: string; businessName?: string; systemRole?: string; knowledgeBase?: string }): Promise<void> {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO bot_custom_config (id, bot_name, business_name, system_role, knowledge_base, updated_at)
        VALUES ('default', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          bot_name = COALESCE(excluded.bot_name, bot_custom_config.bot_name),
          business_name = COALESCE(excluded.business_name, bot_custom_config.business_name),
          system_role = COALESCE(excluded.system_role, bot_custom_config.system_role),
          knowledge_base = COALESCE(excluded.knowledge_base, bot_custom_config.knowledge_base),
          updated_at = excluded.updated_at;
      `).run(
        config.botName || 'CARDOSO AI',
        config.businessName || '',
        config.systemRole || '',
        config.knowledgeBase || '',
        Date.now()
      );
    } catch (err: any) {
      console.warn('[SQLiteStudentMemory] Failed saving bot config:', err.message);
    }
  }

  /**
   * Retrieves custom bot persona & business knowledge base
   */
  public async getBotConfig(): Promise<{ botName: string; businessName: string; systemRole: string; knowledgeBase: string }> {
    if (!this.db) return { botName: 'CARDOSO AI', businessName: '', systemRole: '', knowledgeBase: '' };
    try {
      const row: any = this.db.prepare(
        'SELECT bot_name as botName, business_name as businessName, system_role as systemRole, knowledge_base as knowledgeBase FROM bot_custom_config WHERE id = ?'
      ).get('default');
      return {
        botName: row?.botName || 'CARDOSO AI',
        businessName: row?.businessName || '',
        systemRole: row?.systemRole || '',
        knowledgeBase: row?.knowledgeBase || '',
      };
    } catch {
      return { botName: 'CARDOSO AI', businessName: '', systemRole: '', knowledgeBase: '' };
    }
  }

  /**
   * Saves custom instant auto-reply keyword & response
   */
  public async saveAutoReply(
    keyword: string,
    replyText: string,
    matchType: 'contains' | 'exact' = 'contains'
  ): Promise<void> {
    if (!this.db) return;
    const cleanKey = keyword.trim().toLowerCase();
    const cleanReply = replyText.trim();
    if (!cleanKey || !cleanReply) return;

    try {
      this.db.prepare(
        `INSERT INTO auto_replies (keyword, reply_text, match_type, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(keyword) DO UPDATE SET reply_text = excluded.reply_text, match_type = excluded.match_type, created_at = excluded.created_at`
      ).run(cleanKey, cleanReply, matchType, Date.now());
    } catch (err: any) {
      console.warn('[SQLiteStudentMemory] Failed saving auto-reply:', err.message);
    }
  }

  /**
   * Deletes custom auto-reply by keyword
   */
  public async deleteAutoReply(keyword: string): Promise<boolean> {
    if (!this.db) return false;
    try {
      const res = this.db.prepare('DELETE FROM auto_replies WHERE keyword = ?').run(keyword.trim().toLowerCase());
      return Boolean(res && (res as any).changes > 0);
    } catch {
      return false;
    }
  }

  /**
   * Retrieves all custom auto-replies
   */
  public async getAutoReplies(): Promise<Array<{ keyword: string; replyText: string; matchType: string }>> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare('SELECT keyword, reply_text as replyText, match_type as matchType FROM auto_replies ORDER BY created_at DESC').all() as any[];
      return rows || [];
    } catch {
      return [];
    }
  }

  /**
   * Checks if a message text matches any configured auto-reply
   */
  public async findMatchingAutoReply(text: string): Promise<string | null> {
    if (!this.db) return null;
    const clean = text.trim().toLowerCase();
    if (!clean) return null;

    try {
      const all = await this.getAutoReplies();
      for (const item of all) {
        if (item.matchType === 'exact') {
          if (clean === item.keyword) return item.replyText;
        } else {
          // 'contains' match
          if (clean.includes(item.keyword)) return item.replyText;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  public async recordLead(
    lead: Omit<LeadRecord, 'id' | 'createdAt' | 'status'> & { status?: LeadRecord['status'] }
  ): Promise<void> {
    if (!this.db) return;
    const summary = (lead.summary || '').trim();
    if (!summary) return;
    try {
      this.db.prepare(
        `INSERT INTO leads (chat_id, sender_name, sender_phone, category, summary, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        lead.chatId,
        (lead.senderName || '').trim(),
        (lead.senderPhone || '').trim(),
        (lead.category || 'general').trim(),
        summary.slice(0, 600),
        lead.status || 'new',
        Date.now()
      );
    } catch (err: any) {
      console.warn('[SQLiteStudentMemory] Failed saving lead:', err.message);
    }
  }

  public async getLeads(limit: number = 100): Promise<LeadRecord[]> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        `SELECT id, chat_id as chatId, sender_name as senderName, sender_phone as senderPhone,
                category, summary, status, created_at as createdAt
         FROM leads ORDER BY created_at DESC LIMIT ?`
      ).all(limit) as any[];
      return rows || [];
    } catch {
      return [];
    }
  }

  public async updateLeadStatus(id: number, status: LeadRecord['status']): Promise<boolean> {
    if (!this.db) return false;
    try {
      const res = this.db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id) as any;
      return Boolean(res?.changes > 0);
    } catch {
      return false;
    }
  }

  public async findReceiptByTix(normalizedTix: string): Promise<VerifiedReceiptRecord | null> {
    if (!this.db || !normalizedTix) return null;
    try {
      const row = this.db.prepare(
        `SELECT id, provider, tix, normalized_tix as normalizedTix, image_hash as imageHash,
                amount, currency, receiver_name as receiverName, receiver_account as receiverAccount,
                chat_id as chatId, sender_phone as senderPhone, status, rejection_reason as rejectionReason,
                created_at as createdAt
         FROM verified_receipts
         WHERE normalized_tix = ? AND status = 'verified'
         ORDER BY created_at DESC LIMIT 1`
      ).get(normalizedTix) as any;
      return row || null;
    } catch {
      return null;
    }
  }

  public async findReceiptByImageHash(imageHash: string): Promise<VerifiedReceiptRecord | null> {
    if (!this.db || !imageHash) return null;
    try {
      const row = this.db.prepare(
        `SELECT id, provider, tix, normalized_tix as normalizedTix, image_hash as imageHash,
                amount, currency, receiver_name as receiverName, receiver_account as receiverAccount,
                chat_id as chatId, sender_phone as senderPhone, status, rejection_reason as rejectionReason,
                created_at as createdAt
         FROM verified_receipts
         WHERE image_hash = ?
         ORDER BY created_at DESC LIMIT 1`
      ).get(imageHash) as any;
      return row || null;
    } catch {
      return null;
    }
  }

  public async recordReceiptVerification(
    receipt: Omit<VerifiedReceiptRecord, 'id' | 'createdAt'>
  ): Promise<void> {
    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO verified_receipts
           (provider, tix, normalized_tix, image_hash, amount, currency, receiver_name, receiver_account,
            chat_id, sender_phone, status, rejection_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        (receipt.provider || 'UNKNOWN').trim(),
        (receipt.tix || '').trim(),
        (receipt.normalizedTix || '').trim(),
        (receipt.imageHash || '').trim(),
        receipt.amount ?? null,
        (receipt.currency || 'UNKNOWN').trim(),
        (receipt.receiverName || '').trim(),
        (receipt.receiverAccount || '').trim(),
        receipt.chatId,
        (receipt.senderPhone || '').trim(),
        receipt.status,
        (receipt.rejectionReason || '').trim().slice(0, 500),
        Date.now()
      );
    } catch (err: any) {
      console.warn('[SQLiteStudentMemory] Failed recording receipt verification:', err.message);
    }
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

