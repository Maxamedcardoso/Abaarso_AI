import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { IStudentMemory, StoredMessage, StudentProfile } from './memory.interface.js';

export class SQLiteStudentMemory implements IStudentMemory {
  private db: DatabaseSync | null = null;
  private dbPath: string;

  constructor(dbPath: string = './data/abarso.db') {
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

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

