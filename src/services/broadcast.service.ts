import { IMessagingTransport } from '../transports/transport.interface.js';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';

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

  /**
   * Loads persisted contacts from SQLite database on startup
   */
  public async loadPersistedContacts(): Promise<void> {
    if (!this.memory) return;
    try {
      const persisted = await this.memory.getBroadcastContacts();
      for (const c of persisted) {
        this.contactsMap.set(c.jid, {
          jid: c.jid,
          name: c.name,
          firstName: c.firstName || this.extractCleanFirstName(c.name),
          phone: c.phone,
          lastSeen: Date.now(),
        });
      }
      if (persisted.length > 0) {
        console.log(`📢 [BroadcastService] Loaded ${persisted.length} persisted contacts for broadcasting.`);
      }
    } catch (err: any) {
      console.warn('[BroadcastService] Warning loading persisted contacts:', err.message);
    }
  }

  /**
   * Records or updates a contact whenever a message is seen.
   * Excludes status broadcasts, groups, and bot identity.
   */
  public recordContact(jid: string, name?: string, isGroup?: boolean): void {
    if (!jid || isGroup || jid.endsWith('@g.us') || jid.includes('status@broadcast')) {
      return;
    }

    const cleanName = (name && name.trim().length > 0) ? name.trim() : undefined;
    const firstName = this.extractCleanFirstName(cleanName);
    const phone = jid.split('@')[0].replace(/[^0-9]/g, '');

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
        console.log(`✅ [Broadcast] Sent to ${recipient.firstName || recipient.jid} (${i + 1}/${recipients.length})`);
      } catch (err: any) {
        this.activeBroadcast.failedCount++;
        console.warn(`⚠️ [Broadcast] Failed sending to ${recipient.jid}: ${err.message}`);
      }

      // Progress update to admin every 15 sent messages
      if ((i + 1) % 15 === 0 && (i + 1) < recipients.length) {
        await transport.sendMessage(
          adminChatId,
          `⏳ *[Smart Broadcast Progress]*: Waxaa la diray *${i + 1}/${recipients.length} qof*... shaqadu way socotaa.`
        );
      }

      // Do NOT delay after the very last message
      if (i < recipients.length - 1) {
        // Random human delay between 10 to 18 seconds (10,000ms - 18,000ms)
        const delayMs = Math.floor(10000 + Math.random() * 8000);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.activeBroadcast.isActive = false;

    // Send final celebratory completion report to Admin
    const summary = `🎉 *[CARDOSO AI SMART BROADCAST — GUUL]*

Dhammaan fariimihii waxaa loo wada diray si nabad ah!
• Guuleystay: *${this.activeBroadcast.sentCount} qof*
• Cillad ku dhacday: *${this.activeBroadcast.failedCount} qof*
• Total: *${recipients.length} qof*

Dhammaan fariimaha waxaa loo diray si dabiici ah oo badbaado buuxda u ah lambarkaaga. ✅`;

    await transport.sendMessage(adminChatId, summary);
    console.log(`🎉 [BroadcastService] Completed broadcast. Sent: ${this.activeBroadcast.sentCount}, Failed: ${this.activeBroadcast.failedCount}`);
  }
}

// Singleton export
export const broadcastService = new BroadcastService();
