import fs from 'fs';
import path from 'path';
import { IMessagingTransport } from '../transports/transport.interface.js';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';

export function normalizePhoneNumber(raw: string): string {
  let clean = raw.replace(/[^0-9]/g, '');
  // If starts with 061, 062, 063, 065, 068, 090 (10 digits local e.g. 0615123456)
  if (/^0[69]\d{8}$/.test(clean)) {
    clean = '252' + clean.slice(1);
  }
  // If starts with 61, 62, 63, 65, 68, 90 (9 digits local e.g. 615123456)
  else if (/^[69]\d{8}$/.test(clean)) {
    clean = '252' + clean;
  }
  return clean;
}

export function parseContactsText(content: string): Array<{ name?: string; phone: string }> {
  const results: Array<{ name?: string; phone: string }> = [];

  // 1. Check if VCF format
  if (content.includes('BEGIN:VCARD') || content.includes('END:VCARD')) {
    const cards = content.split(/END:VCARD/i);
    for (const card of cards) {
      if (!card.includes('BEGIN:VCARD')) continue;

      // Extract Full Name (FN: or N:)
      const fnMatch = card.match(/(?:^|\n)FN(?:;[^:]*)?:([^\r\n]+)/i);
      const nMatch = card.match(/(?:^|\n)N(?:;[^:]*)?:([^\r\n]+)/i);
      const name = fnMatch ? fnMatch[1].trim() : (nMatch ? nMatch[1].replace(/;/g, ' ').trim() : undefined);

      // Extract Phone Number (TEL:)
      const telMatches = card.matchAll(/(?:^|\n)TEL(?:;[^:]*)?:([^\r\n]+)/gi);
      for (const tm of telMatches) {
        const rawPhone = normalizePhoneNumber(tm[1]);
        if (rawPhone.length >= 7) {
          results.push({ name, phone: rawPhone });
        }
      }
    }
    return results;
  }

  // 2. Otherwise line-by-line (CSV, Tab-delimited, or plain list of numbers)
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.includes(',') || trimmed.includes('\t') || trimmed.includes(';')) {
      const parts = trimmed.split(/[,;\t]+/).map(p => p.trim());
      const phoneIndex = parts.findIndex(p => p.replace(/[^0-9]/g, '').length >= 7);
      if (phoneIndex !== -1) {
        const rawPhone = normalizePhoneNumber(parts[phoneIndex]);
        const nameParts = parts.filter((_, idx) => idx !== phoneIndex).join(' ').trim();
        results.push({ name: nameParts || undefined, phone: rawPhone });
        continue;
      }
    }

    const rawPhone = normalizePhoneNumber(trimmed);
    if (rawPhone.length >= 7) {
      results.push({ phone: rawPhone });
    }
  }

  return results;
}

export interface BroadcastContact {
  jid: string;
  name?: string;
  firstName?: string;
  phone?: string;
  lastSeen: number;
}

export interface BroadcastDraft {
  adminChatId: string;
  messageText: string;
  recipients: BroadcastContact[];
  createdAt: number;
}

export interface BroadcastProgress {
  isActive: boolean;
  total: number;
  sentCount: number;
  failedCount: number;
  currentRecipient?: string;
  isAborted: boolean;
}

/**
 * BroadcastService — Safe, Human-Like WhatsApp Broadcasting for CARDOSO AI.
 * Protects the WhatsApp number from bans using:
 * 1. Randomized human delay (10-18 seconds per message).
 * 2. Personalized messages addressed to each recipient by name.
 * 3. Two-step confirmation (Admin must confirm with 'HAA' before sending).
 * 4. Graceful stop command (!jooji).
 */
export class BroadcastService {
  private contactsMap: Map<string, BroadcastContact> = new Map();
  private sentJids: Set<string> = new Set();
  private botJid: string = '';
  private pendingDrafts: Map<string, BroadcastDraft> = new Map();
  private activeBroadcast: BroadcastProgress = {
    isActive: false,
    total: 0,
    sentCount: 0,
    failedCount: 0,
    isAborted: false,
  };
  private memory?: SQLiteStudentMemory;

  constructor(memory?: SQLiteStudentMemory) {
    this.memory = memory;
  }

  public setMemory(memory: SQLiteStudentMemory): void {
    this.memory = memory;
  }

  public setBotJid(jid: string): void {
    if (!jid) return;
    this.botJid = jid.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
  }

  public isValidIndividualJid(jid: string): boolean {
    if (!jid || typeof jid !== 'string') return false;
    if (jid.endsWith('@g.us')) return false; // groups
    if (jid.includes('status@broadcast')) return false; // status updates
    if (jid.includes('@newsletter')) return false; // channels
    if (jid === 'student_direct_chat') return false;
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
  }

  /**
   * Loads persisted contacts and sent broadcast history from SQLite database on startup
   */
  public async loadPersistedContacts(): Promise<void> {
    if (!this.memory) return;
    try {
      const persisted = await this.memory.getBroadcastContacts();
      for (const c of persisted) {
        if (c.jid && this.isValidIndividualJid(c.jid)) {
          this.contactsMap.set(c.jid, {
            jid: c.jid,
            name: c.name,
            firstName: c.firstName || this.extractCleanFirstName(c.name),
            phone: c.phone,
            lastSeen: Date.now(),
          });
        }
      }

      // Auto-seed from existing conversations if available
      try {
        const pastChats = await this.memory.getDistinctIndividualChats();
        for (const chatId of pastChats) {
          if (this.isValidIndividualJid(chatId) && !this.contactsMap.has(chatId)) {
            this.recordContact(chatId);
          }
        }
      } catch {}

      if (this.contactsMap.size > 0) {
        console.log(`📢 [BroadcastService] Loaded ${this.contactsMap.size} persisted contacts for broadcasting.`);
      }

      // Auto-import contacts files (e.g. data/contacts.vcf or contacts.txt)
      await this.checkAndAutoImportFiles();

      this.sentJids = await this.memory.getSentBroadcastJids();
      if (this.sentJids.size > 0) {
        console.log(`📢 [BroadcastService] Loaded ${this.sentJids.size} previously contacted recipients (won't re-send).`);
      }
    } catch (err: any) {
      console.warn('[BroadcastService] Warning loading persisted contacts:', err.message);
    }
  }

  /**
   * Imports contacts from any VCF (vCard), CSV, or plain text content.
   */
  public importFromText(content: string): { totalParsed: number; added: number } {
    const parsed = parseContactsText(content);
    let added = 0;
    for (const item of parsed) {
      const cleanPhone = normalizePhoneNumber(item.phone);
      if (cleanPhone.length >= 7) {
        const jid = `${cleanPhone}@s.whatsapp.net`;
        const exists = this.contactsMap.has(jid);
        this.recordContact(jid, item.name);
        if (!exists) {
          added++;
        }
      }
    }
    return { totalParsed: parsed.length, added };
  }

  /**
   * Checks for any contacts file in project or data directory and auto-imports it.
   */
  public async checkAndAutoImportFiles(): Promise<number> {
    const candidatePaths = [
      './data/contacts.vcf',
      './data/contacts.txt',
      './data/contacts.csv',
      './contacts.vcf',
      './contacts.txt',
      './contacts.csv',
    ];

    let totalImported = 0;
    for (const filePath of candidatePaths) {
      try {
        if (fs.existsSync(filePath)) {
          console.log(`📁 [BroadcastService] Found contacts file: ${filePath}. Auto-importing...`);
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const result = this.importFromText(fileContent);
          totalImported += result.added;
          console.log(`✅ [BroadcastService] Imported ${result.added} new contacts from ${filePath} (Total: ${this.contactsMap.size}).`);
        }
      } catch (err: any) {
        console.warn(`[BroadcastService] Failed reading ${filePath}:`, err.message);
      }
    }
    return totalImported;
  }

  /**
   * Records or updates a contact whenever a message or sync event is seen.
   * Strictly filters out status broadcasts, groups, and bot identity.
   */
  public recordContact(jid: string, name?: string, isGroup?: boolean): void {
    if (!jid || isGroup || !this.isValidIndividualJid(jid)) {
      return;
    }

    const phone = jid.split('@')[0].replace(/[^0-9]/g, '');
    if (this.botJid && (phone === this.botJid || jid.includes(this.botJid))) {
      return;
    }

    const cleanName = (name && name.trim().length > 0) ? name.trim() : undefined;
    const firstName = this.extractCleanFirstName(cleanName);

    const existing = this.contactsMap.get(jid);
    const resolvedName = cleanName || existing?.name;
    const resolvedFirstName = firstName || existing?.firstName;

    const contact: BroadcastContact = {
      jid,
      name: resolvedName,
      firstName: resolvedFirstName,
      phone: phone || existing?.phone,
      lastSeen: Date.now(),
    };

    this.contactsMap.set(jid, contact);

    // Asynchronously save to SQLite
    if (this.memory) {
      this.memory.saveBroadcastContact({
        jid,
        name: resolvedName,
        firstName: resolvedFirstName,
        phone: contact.phone,
      }).catch(() => {});
    }
  }

  /**
   * Allows manual bulk import of phone numbers by admin.
   */
  public addManualNumbers(rawInput: string): number {
    const tokens = rawInput.split(/[\s,;\n]+/);
    let added = 0;
    for (const token of tokens) {
      const clean = token.replace(/[^0-9]/g, '');
      if (clean.length >= 7) {
        const jid = `${clean}@s.whatsapp.net`;
        if (!this.contactsMap.has(jid)) {
          this.recordContact(jid);
          added++;
        }
      }
    }
    return added;
  }

  /**
   * Extracts a clean first name from contact's full name.
   * Handles Somali names gracefully.
   */
  public extractCleanFirstName(fullName?: string): string | undefined {
    if (!fullName) return undefined;
    // Strip emojis and leading non-letters
    const cleaned = fullName.replace(/[\p{Emoji}\p{Extended_Pictographic}]/gu, '').trim();
    if (!cleaned) return undefined;
    const firstWord = cleaned.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 2 && !/^[0-9]+$/.test(firstWord)) {
      return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    }
    return undefined;
  }

  /**
   * Returns list of all known valid individual contacts.
   */
  public getContacts(): BroadcastContact[] {
    return Array.from(this.contactsMap.values());
  }

  public getContactsCount(): number {
    return this.contactsMap.size;
  }

  /**
   * Returns eligible contacts that have NEVER been sent a broadcast yet,
   * strictly excluding admin, bot, and previously contacted JIDs.
   */
  public getAvailableRecipients(adminChatId?: string): BroadcastContact[] {
    const cleanAdmin = adminChatId?.split(':')[0]?.split('@')[0]?.replace(/[^0-9]/g, '');
    return Array.from(this.contactsMap.values()).filter(c => {
      // Must not be in already-sent set
      if (this.sentJids.has(c.jid)) return false;
      // Must not be admin chat
      if (adminChatId && c.jid === adminChatId) return false;
      if (cleanAdmin && c.jid.replace(/[^0-9]/g, '') === cleanAdmin) return false;
      // Must not be bot's own number
      if (this.botJid && c.jid.replace(/[^0-9]/g, '') === this.botJid) return false;
      // Must be individual phone contact or LID
      if (!this.isValidIndividualJid(c.jid)) return false;
      return true;
    });
  }

  /**
   * Marks a contact as having received a broadcast so they are never contacted again.
   */
  public async markAsSent(jid: string, preview?: string): Promise<void> {
    this.sentJids.add(jid);
    if (this.memory) {
      await this.memory.markBroadcastSent(jid, preview);
    }
  }

  /**
   * Resets broadcast history if admin wants to run a brand new campaign.
   */
  public async resetSentHistory(): Promise<number> {
    this.sentJids.clear();
    if (this.memory) {
      return await this.memory.resetBroadcastSentHistory();
    }
    return 0;
  }

  /**
   * Gets broadcast delivery statistics.
   */
  public getStats(): { total: number; sent: number; remaining: number } {
    const total = this.contactsMap.size;
    const sent = this.sentJids.size;
    return {
      total,
      sent,
      remaining: Math.max(0, total - sent),
    };
  }

  /**
   * Creates a draft broadcast message and requests admin confirmation.
   */
  public createDraft(adminChatId: string, rawText: string): { success: boolean; message: string; draft?: BroadcastDraft } {
    if (this.activeBroadcast.isActive) {
      return {
        success: false,
        message: '⚠️ Waxaa hadda socota fariin-wadareed kale! Fadlan sug inta ay ka dhamaaneyso ama qor `!jooji` si aad u baajiso.',
      };
    }

    const messageText = rawText.trim();
    if (messageText.length < 3) {
      return {
        success: false,
        message: '⚠️ Fadlan qor fariinta aad doonayso inaad dirto. Tusaale:\n`!broadcast Asc dhamaan, berbera waxaan ku qabanaynaa kulan muhiim ah.`',
      };
    }

    // Recipients list — all known individual contacts (excluding the admin chatId)
    const recipients = this.getContacts().filter(c => c.jid !== adminChatId);

    if (recipients.length === 0) {
      return {
        success: false,
        message: '⚠️ Wali ma jiraan contacts ku kaydsan bot-ka oo fariin loo diri karo!\nMarka dadku WhatsApp-ka kula hadlaan, bot-ku si toos ah ayuu u kaydsanayaa.',
      };
    }

    const draft: BroadcastDraft = {
      adminChatId,
      messageText,
      recipients,
      createdAt: Date.now(),
    };

    this.pendingDrafts.set(adminChatId, draft);

    const sampleName = recipients[0]?.firstName || 'Axmed';
    const samplePreview = this.formatPersonalizedMessage(messageText, sampleName);

    const confirmationPrompt = `📢 *[CARDOSO AI SMART BROADCAST — XAQIIJIN]*

Waxaad doonaysaa inaad fariin u dirto *${recipients.length} qof* oo WhatsApp-kaaga ku jira.

📝 *Nuxurka Fariinta:*
"${messageText}"

🔍 *Tusaale sida qof kasta u gaadhayso (Sample Preview):*
"${samplePreview}"

⚡ *Habka Dirista Badbaadada Leh (Safe Anti-Ban):*
• Qof kasta magaciisa gaarka ah ayaa lagu bilaabayaa.
• Fariin kasta waxay u dhaxaysaa 10 ilaa 18 ilbiriqsi (si aan WhatsApp ku xannibin).

*Ma bilaawnaa dirista?*
👉 Ku jawaab *HAA* si loo bilaabo.
👉 Ku jawaab *MAYA* si loo tirtiro.`;

    return {
      success: true,
      message: confirmationPrompt,
      draft,
    };
  }

  /**
   * Starts a direct broadcast immediately without confirmation step.
   * Sends to the next batch of uncontacted contacts (up to maxLimit, default 50).
   * Once sent to, contacts are recorded in persistent SQLite history so they
   * are NEVER contacted again.
   */
  public async startDirectBroadcast(
    adminChatId: string,
    rawText: string,
    transport: IMessagingTransport,
    maxLimit: number = 50
  ): Promise<{ success: boolean; message: string }> {
    if (this.activeBroadcast.isActive) {
      return {
        success: false,
        message: '⚠️ Waxaa hadda socota fariin-wadareed kale! Fadlan sug inta ay ka dhamaaneyso ama qor `!jooji` si aad u baajiso.',
      };
    }

    const messageText = rawText.trim();
    if (messageText.length < 2) {
      return {
        success: false,
        message: '⚠️ Fadlan qor fariinta aad doonayso inaad dirto. Tusaale:\n`!fariin Asc dhamaan, berbera waxaan ku qabanaynaa kulan muhiim ah.`',
      };
    }

    // Get uncontacted individual contacts excluding adminChatId and bot
    const availableRecipients = this.getAvailableRecipients(adminChatId);

    if (availableRecipients.length === 0) {
      const stats = this.getStats();
      if (stats.total === 0) {
        return {
          success: false,
          message: '⚠️ Wali ma jiraan contacts ku kaydsan bot-ka oo fariin loo diri karo!\nBot-ku wuxuu si toos ah u soo qaadanayaa dadka WhatsApp-ka kula hadla ama ku jira liiskaaga.',
        };
      }
      return {
        success: false,
        message: `ℹ️ *[CARDOSO AI — DHAMMAAN WAA LA GAARSIISAY]*\n\nDhammaan contacts-ka bot-ka ku jira (*${stats.sent}/${stats.total} qof*) fariinta horey ayaa loo gaarsiiyay!\nQofna mar labaad looma celinayo.\n\nHaddii aad doonayso inaad olole cusub bilowdo oo liiska dib u bilowdo, qor:\n\`!fariin reset\``,
      };
    }

    const recipients = availableRecipients.slice(0, maxLimit);
    const remainingAfter = availableRecipients.length - recipients.length;

    // Set active progress
    this.activeBroadcast = {
      isActive: true,
      total: recipients.length,
      sentCount: 0,
      failedCount: 0,
      isAborted: false,
    };

    const draft: BroadcastDraft = {
      adminChatId,
      messageText,
      recipients,
      createdAt: Date.now(),
    };

    const estimatedMinutes = Math.max(1, Math.ceil((recipients.length * 5) / 60));
    const sampleName = recipients[0]?.firstName || 'Axmed';
    const samplePreview = this.formatPersonalizedMessage(messageText, sampleName);

    // Run background transmission loop asynchronously (non-blocking)
    this.runBroadcastLoop(draft, transport).catch(err => {
      console.error('❌ [BroadcastService] Critical loop error:', err);
    });

    return {
      success: true,
      message: `🚀 *[CARDOSO AI — FARIIN-WADAREED BILAABATAY]*

Fariinta waxaa toos loogu bilaabay dufcad ka kooban *${recipients.length} qof* (Dufcaddan: ilaa 50 qof).
📊 Xaaladda: *${recipients.length}* hadda loo dirayaa | *${remainingAfter}* ayaa dhiman.

📝 *Tusaale sida ay ugu dhacayso:*
"${samplePreview}"

🛡️ *Xeerka Badbaadada:* Qofna fariin laguma celcelin doono. Qof kasta fariin gaar ah ayuu ku helayaa (~${estimatedMinutes} daqiiqo).
🛑 Haddii aad rabto inaad joojiso qor: \`!jooji\``,
    };
  }

  /**
   * Confirms and starts the background broadcast.
   */
  public async confirmDraft(adminChatId: string, transport: IMessagingTransport): Promise<boolean> {
    const draft = this.pendingDrafts.get(adminChatId);
    if (!draft) return false;

    this.pendingDrafts.delete(adminChatId);

    // Set active progress
    this.activeBroadcast = {
      isActive: true,
      total: draft.recipients.length,
      sentCount: 0,
      failedCount: 0,
      isAborted: false,
    };

    // Acknowledge start to admin immediately
    const estimatedMinutes = Math.ceil((draft.recipients.length * 14) / 60);
    await transport.sendMessage(
      adminChatId,
      `🚀 *[Smart Broadcast Bilaabatay]*:\nFariinta waxaa loo bilaabay *${draft.recipients.length} qof*. Waqtiga qiyaasta: ~${estimatedMinutes} daqiiqo.\nWaxaan kuugu soo warbixin doonaa marka ay dhamaato. Haddii aad rabto inaad baajiso qor *!jooji*.`
    );

    // Run background loop asynchronously (non-blocking)
    this.runBroadcastLoop(draft, transport).catch(err => {
      console.error('❌ [BroadcastService] Critical loop error:', err);
    });

    return true;
  }

  /**
   * Cancels a pending broadcast draft.
   */
  public cancelDraft(adminChatId: string): boolean {
    if (this.pendingDrafts.has(adminChatId)) {
      this.pendingDrafts.delete(adminChatId);
      return true;
    }
    return false;
  }

  public hasPendingDraft(adminChatId: string): boolean {
    return this.pendingDrafts.has(adminChatId);
  }

  /**
   * Aborts an ongoing active broadcast.
   */
  public abortBroadcast(): boolean {
    if (this.activeBroadcast.isActive) {
      this.activeBroadcast.isAborted = true;
      this.activeBroadcast.isActive = false;
      return true;
    }
    return false;
  }

  public isBroadcastActive(): boolean {
    return this.activeBroadcast.isActive;
  }

  /**
   * Formats the personalized message for a specific recipient.
   */
  public formatPersonalizedMessage(template: string, name?: string): string {
    const recipientName = name || 'walaal';

    // 1. If explicit placeholder {magac} exists, replace it
    if (template.includes('{magac}')) {
      return template.replace(/\{magac\}/g, recipientName);
    }
    if (template.includes('{name}')) {
      return template.replace(/\{name\}/g, recipientName);
    }

    // 2. If already starts with a greeting like "Asc" or "Asalaamu calaykum"
    const trimmed = template.trim();
    if (/^asc\b/i.test(trimmed)) {
      return trimmed.replace(/^asc\b[,\s]*/i, `Asc ${recipientName}, `);
    }
    if (/^asalaam[u\s]/i.test(trimmed)) {
      return trimmed.replace(/^asalaam[u\s]*calaykum[,\s]*/i, `Asalaamu calaykum ${recipientName}, `);
    }
    if (/^hi\b/i.test(trimmed)) {
      return trimmed.replace(/^hi\b[,\s]*/i, `Hi ${recipientName}, `);
    }
    if (/^hello\b/i.test(trimmed)) {
      return trimmed.replace(/^hello\b[,\s]*/i, `Hello ${recipientName}, `);
    }

    // 3. Otherwise prefix naturally with personalized greeting
    return `Asc ${recipientName}, ${trimmed}`;
  }

  /**
   * Main background transmission loop with human delays.
   */
  private async runBroadcastLoop(draft: BroadcastDraft, transport: IMessagingTransport): Promise<void> {
    const { adminChatId, messageText, recipients } = draft;

    console.log(`📢 [BroadcastService] Starting safe broadcast to ${recipients.length} recipients...`);

    for (let i = 0; i < recipients.length; i++) {
      if (this.activeBroadcast.isAborted) {
        console.log(`🛑 [BroadcastService] Broadcast was aborted by admin at ${i}/${recipients.length}`);
        await transport.sendMessage(
          adminChatId,
          `🛑 *[Smart Broadcast La Baajiyay]*:\nFariin-wadareedka waa la joojiyay amarkaaga darted. Waxaa la gaarsiiyay *${this.activeBroadcast.sentCount}/${recipients.length} qof*.`
        );
        this.activeBroadcast.isActive = false;
        return;
      }

      const recipient = recipients[i];
      const personalized = this.formatPersonalizedMessage(messageText, recipient.firstName);

      try {
        await transport.sendMessage(recipient.jid, personalized);
        this.activeBroadcast.sentCount++;
        await this.markAsSent(recipient.jid, messageText);
        console.log(`✅ [Broadcast] Sent to ${recipient.firstName || recipient.jid} (${i + 1}/${recipients.length})`);
      } catch (err: any) {
        this.activeBroadcast.failedCount++;
        await this.markAsSent(recipient.jid, messageText);
        console.warn(`⚠️ [Broadcast] Failed sending to ${recipient.jid}: ${err.message}`);
      }

      // Progress update to admin every 10 sent messages
      if ((i + 1) % 10 === 0 && (i + 1) < recipients.length) {
        await transport.sendMessage(
          adminChatId,
          `⏳ *[Smart Broadcast Progress]*: Waxaa la diray *${i + 1}/${recipients.length} qof*... shaqadu way socotaa.`
        );
      }

      // Do NOT delay after the very last message
      if (i < recipients.length - 1) {
        // Safe natural human delay between 3.5 to 6 seconds (3,500ms - 6,000ms)
        const delayMs = Math.floor(3500 + Math.random() * 2500);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.activeBroadcast.isActive = false;

    const remainingNow = this.getAvailableRecipients(adminChatId).length;

    // Send final celebratory completion report to Admin
    const summary = `🎉 *[CARDOSO AI SMART BROADCAST — GUUL]*

Dufcaddii *${recipients.length} qof* si nabad ah ayaa loo wada gaarsiiyay!
• Guuleystay: *${this.activeBroadcast.sentCount} qof*
• Cillad ku dhacday: *${this.activeBroadcast.failedCount} qof*
• Total la diray: *${recipients.length} qof*
• Qofna dib looguma celinayo dadkan (History saved).
• Hadhay (Aan wali helin): *${remainingNow} qof*

${remainingNow > 0 ? `Si aad 50-ka xiga ugu dirto, mar kale qor:\n\`!fariin ${messageText}\`` : 'Dhammaan contacts-kaagii fariinta waa wada heleen! 💯'}`;

    await transport.sendMessage(adminChatId, summary);
    console.log(`🎉 [BroadcastService] Completed broadcast. Sent: ${this.activeBroadcast.sentCount}, Remaining: ${remainingNow}`);
  }
}

// Singleton export
export const broadcastService = new BroadcastService();

