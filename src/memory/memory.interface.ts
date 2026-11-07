/**
 * Represents a stored conversation turn in memory
 */
export interface StoredMessage {
  id?: number;
  studentId: string;
  chatId: string;
  role: 'user' | 'model';
  content: string;
  languageDetected?: string;
  timestamp: number;
}

/**
 * Student profile and metadata
 */
export interface StudentProfile {
  studentId: string;             // Internal anonymized UUID
  rawIdentifier: string;         // WhatsApp phone number or console ID (stored securely)
  preferredLanguage?: 'so' | 'en' | 'mixed';
  firstSeenAt: number;
  lastActiveAt: number;
  totalMessagesCount: number;
  topicsDiscussed?: string[];
}

/**
 * Pluggable Database / Memory Repository Interface.
 * Implemented initially by SQLite, easily swapped for PostgreSQL later.
 */
export interface IStudentMemory {
  /**
   * Initializes tables, schema migrations, and indexes
   */
  initialize(): Promise<void>;

  /**
   * Retrieves or creates a student profile, returning the unique internal studentId
   */
  getOrCreateStudent(rawIdentifier: string): Promise<StudentProfile>;

  /**
   * Saves a message turn (user or model) into the student's conversation history
   */
  saveMessage(message: StoredMessage): Promise<void>;

  /**
   * Retrieves recent conversation history for a student (isolated from other students)
   */
  getConversationHistory(studentId: string, limit?: number): Promise<StoredMessage[]>;

  /**
   * Right to be Forgotten: Deletes all stored history and profile for a student
   */
  deleteStudentHistory(studentId: string): Promise<boolean>;

  /**
   * Configurable data retention: Purges messages older than retentionDays
   */
  purgeStaleData(retentionDays: number): Promise<number>;

  /**
   * Returns memory statistics (total students, total messages, DB size)
   */
  getStats(): Promise<{
    totalStudents: number;
    totalMessages: number;
    oldestMessageDate: string | null;
  }>;

  /**
   * Closes database connections cleanly
   */
  close(): Promise<void>;
}

