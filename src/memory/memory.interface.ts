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
  firstName?: string;            // User's name if they shared it
  interests?: string;            // Topics and interests the user has mentioned
  occupation?: string;           // Job, student, etc if shared
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
   * Updates a user's personal profile data (name, interests, occupation)
   */
  updateUserProfile(studentId: string, updates: { firstName?: string; interests?: string; occupation?: string; preferredLanguage?: string }): Promise<void>;

  /**
   * Saves or updates a contact for broadcasting
   */
  saveBroadcastContact(contact: { jid: string; name?: string; firstName?: string; phone?: string }): Promise<void>;

  /**
   * Retrieves all contacts saved for broadcasting
   */
  getBroadcastContacts(): Promise<Array<{ jid: string; name?: string; firstName?: string; phone?: string }>>;

  /**
   * Saves custom bot persona & business knowledge base
   */
  saveBotConfig?(config: { botName?: string; businessName?: string; systemRole?: string; knowledgeBase?: string }): Promise<void>;

  /**
   * Retrieves custom bot persona & business knowledge base
   */
  getBotConfig?(): Promise<{ botName: string; businessName: string; systemRole: string; knowledgeBase: string }>;

  /**
   * Saves custom instant auto-reply keyword & response
   */
  saveAutoReply?(keyword: string, replyText: string, matchType?: 'contains' | 'exact'): Promise<void>;

  /**
   * Deletes custom auto-reply by keyword
   */
  deleteAutoReply?(keyword: string): Promise<boolean>;

  /**
   * Retrieves all custom auto-replies
   */
  getAutoReplies?(): Promise<Array<{ keyword: string; replyText: string; matchType: string }>>;

  /**
   * Checks if a message text matches any configured auto-reply
   */
  findMatchingAutoReply?(text: string): Promise<string | null>;

  /**
   * Closes database connections cleanly
   */
  close(): Promise<void>;
}

