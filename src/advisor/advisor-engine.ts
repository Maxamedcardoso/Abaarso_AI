import { IStudentMemory } from '../memory/memory.interface.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { LanguageDetector } from './language-detector.js';
import { IntentClassifier } from './intent-classifier.js';
import { PromptBuilder } from './prompt-builder.js';
import { MotivationCoach } from './motivation-coach.js';
import { ConversationMessage } from '../ai/ai-provider.interface.js';
import { WebSearchService } from '../services/web-search.service.js';
import { ReminderService, reminderService } from '../services/reminder.service.js';
import { MessageMedia } from '../transports/transport.interface.js';
import { UserProfiler } from '../services/user-profiler.service.js';

export interface ProcessMessageInput {
  rawSenderId: string;
  chatId: string;
  isGroup: boolean;
  content: string;
  timestamp?: number;
  media?: MessageMedia;
}

export interface ProcessMessageOutput {
  replyText: string;
  studentId: string;
  intent: string;
  language: string;
  latencyMs: number;
}

export class StudentAdvisorEngine {
  private memory: IStudentMemory;
  private ai: AIOrchestrator;
  private detector: LanguageDetector;

  constructor(memory: IStudentMemory, ai: AIOrchestrator) {
    this.memory = memory;
    this.ai = ai;
    this.detector = new LanguageDetector();
  }

  public async processMessage(input: ProcessMessageInput): Promise<ProcessMessageOutput> {
    const startTime = Date.now();
    const { rawSenderId, chatId, isGroup, content, timestamp = Date.now(), media } = input;

    // 1. Get or create secure, isolated user profile
    const student = await this.memory.getOrCreateStudent(rawSenderId);

    // 2. Classify intent
    const intentResult = IntentClassifier.classify(content);

    // 3. Detect language (Somali, English, Mixed)
    const langResult = this.detector.detect(content);
    const lang = langResult.language;

    // 4. Handle Privacy / Right-to-be-Forgotten command
    if (intentResult.intent === 'privacy_forget') {
      await this.memory.deleteStudentHistory(student.studentId);
      const reply = lang === 'en'
        ? '🗑️ *[Privacy Confirmation]*: All your conversation history has been permanently deleted from CARDOSO AI memory.'
        : '🗑️ *[Xaqiijinta Xog-tirtiridda]*: Dhammaan taariikhdii wada-hadalkaaga waxaa si rasmi ah looga tirtiray kaydka CARDOSO AI.';

      return {
        replyText: reply,
        studentId: student.studentId,
        intent: 'privacy_forget',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 5. Handle Distress / Mental Health Safety Check
    if (MotivationCoach.hasDistressSignals(content)) {
      const crisisReply = MotivationCoach.getCrisisSupportMessage(lang);
      return {
        replyText: crisisReply,
        studentId: student.studentId,
        intent: 'motivation',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 5.5. Handle Reminder request
    if (ReminderService.isReminderRequest(content)) {
      const parsed = ReminderService.parseReminderTime(content);
      if (parsed) {
        const minutesFromNow = Math.round((parsed.fireAtMs - Date.now()) / 60000);
        reminderService.addReminder(student.studentId, chatId, parsed.reminderText, parsed.fireAtMs);
        const confirmText = lang === 'en'
          ? `⏰ *Reminder Set!*\n"${parsed.reminderText || 'Your reminder'}" — I'll notify you in *${minutesFromNow} minute${minutesFromNow === 1 ? '' : 's'}*. ✅`
          : `⏰ *Xasuusiyaha waa la dejiyay!*\n"${parsed.reminderText || 'Xasuusintaada'}" — Waxaan kugu soo ogaysiinayaa *${minutesFromNow} daqiiqo* gudahood. ✅`;
        return {
          replyText: confirmText,
          studentId: student.studentId,
          intent: 'reminder',
          language: lang,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // 6. Retrieve isolated conversation history (max 14 turns for context)
    const storedHistory = await this.memory.getConversationHistory(student.studentId, 14);
    const aiHistory: ConversationMessage[] = storedHistory.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // 7. Handle pure greeting intent — always short reply, regardless of history
    if (intentResult.intent === 'greeting') {
      const clean = content.toLowerCase().trim();
      let greetingReply: string;

      if (/^(hello|hi|hey|how\s+are\s+you|good\s+(morning|afternoon|evening)|wassup|whats\s*up|howdy)/i.test(clean)) {
        greetingReply = 'Hi! How are you? 😊';
      } else if (/^(asc|assalamu|assalaamu|salaam|salaan)/i.test(clean)) {
        greetingReply = 'Wcs! Waan fiicanahay. Adiguna? 😊';
      } else if (/^(iska\s*warr?an|iskawarr?an)/i.test(clean)) {
        greetingReply = 'Waa nabad, adiguna sidee tahay? 😊';
      } else {
        // iwaran, see tahay, maxaa cusub, nabad, etc.
        greetingReply = 'Waan fiicanahay, mahadsanid. Adiguna? 😊';
      }

      return {
        replyText: greetingReply,
        studentId: student.studentId,
        intent: 'greeting',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 7.5. Handle Creator / Author inquiry ("Yaa ku sameeyey?", "Who created you?", "Halkee buu joogaa?")
    if (intentResult.intent === 'creator') {
      const clean = content.toLowerCase().trim();
      const isEnglish = lang === 'en' || /^(who|whom|where)/i.test(clean) || /(created|made|built|developer|creator|live|located)\s+you/i.test(clean);
      const isLocationQuery = /(halkee|meelkee|halkuu|xaggee|xagguu|where\s+(does|is))/i.test(clean);

      let creatorReply: string;
      if (isLocationQuery) {
        creatorReply = isEnglish
          ? `📍 *Creator's Location*\n\n*Mohamed Dahir* is based and lives in the historic coastal city of *Berbera*, specifically in the *Jamalaaye neighborhood*! 🌊🏢`
          : `📍 *Goobta Uu Joogo Qofka I Sameeyay*\n\n*Maxamed Daahir* wuxuu joogaa oo uu ku nool yahay magaalada qadiimiga ah ee *Berbera*, gaar ahaan *Xaafadda Jamalaaye*! 🌊📍`;
      } else {
        creatorReply = isEnglish
          ? `🌟 *MEET THE CREATOR OF CARDOSO AI*\n\nCARDOSO AI was envisioned, designed, and developed by *Mohamed Dahir*, a Software Engineer holding a *Bachelor's Degree in Computer Science* from Abaarso Tech University, where he studied in the *Faculty of Software Engineering and graduated with Honors*. 🎓🏆\n\nHe is an ambitious technology innovator driven by creativity, dedication, and a passion for building intelligent solutions that make technology and knowledge more accessible to everyone. He resides in *Berbera (Jamalaaye neighborhood)*.\n\n*Mohamed Dahir — combining knowledge, innovation, and vision to create technology that makes a difference.* 🚀`
          : `🌟 *QOFKA KA DAMBEEYA CARDOSO AI*\n\nCARDOSO AI waxaa hindisay, naqshadeeyay, isla markaana horumariyay *Maxamed Daahir*, oo ah Software Engineer haysta shahaadada *Bachelor's Degree in Computer Science*, kana tirsanaa *Faculty of Software Engineering* ee Jaamacadda Abaarso Tech University, halkaas oo uu ku qalin-jabiyay sharaf (Honors). 🎓🏆\n\nWaa hal-abuur leh aragti fog, dadaal iyo jacayl uu u qabo teknoolojiyadda. Himiladiisu waa inuu awoodda Artificial Intelligence iyo teknoolojiyadda casriga ah ka dhigo kuwo bulshada anfaca, aqoontana qof walba u fududeeya. Wuxuu ku nool yahay magaalada *Berbera (Xaafadda Jamalaaye)*.\n\n*Maxamed Daahir — aqoon, hal-abuur iyo himilo teknoolojiyadeed oo mustaqbalka wax ka beddeli karta.* 🚀`;
      }

      return {
        replyText: creatorReply,
        studentId: student.studentId,
        intent: 'creator',
        language: isEnglish ? 'en' : 'so',
        latencyMs: Date.now() - startTime,
      };
    }

    // 8. Handle Help command
    if (intentResult.intent === 'help') {
      const helpText = lang === 'en'
        ? `*🌟 CARDOSO AI — Your Intelligent Assistant*\nI can help you with anything — ask me freely!\n• Questions, advice, explanations on any topic.\n• Science, math, history, religion, technology, health, relationships, and more.\n• 🎙️ Voice notes, 🖼️ images, and 📄 documents — I can read them!\n• 🌐 Live web search for news, sports scores, exchange rates and more.\n• ⏰ Set reminders (say "remind me in 30 minutes to study").\n• Somali, English, or mixed language — I adapt to you.\n\n*Commands:*\n• \`!tirtir\` or \`!clear\` — Delete your conversation history.`
        : `*🌟 CARDOSO AI — La-Taliyahaaga Caqliga*\nWaxaad i weydiin kartaa wax kasta — xoriyad buuxda!\n• Su'aalo, talo, sharaxaad mawduuc kasta ah.\n• Sayniska, xisaabta, taariikhda, diinta, teknoolajiyada, caafimaadka, xiriirka, iwm.\n• 🎙️ Codadka, 🖼️ Sawirrada, iyo 📄 Dukumentiyada — waan akhriyaa!\n• 🌐 Baadhi tooska ah wararka, cayaaraha, sarifka lacagta, iwm.\n• ⏰ Xasuusin-dejin (dheh "i xasuusi 30 daqiiqo gudahood").\n• Af-Soomaali, Ingiriis, ama isku qas — waxaan kuu qabsadaa.\n\n*Awaamiirta:*\n• \`!tirtir\` ama \`!clear\` — Si aad u tirtirto dhammaan xogtaada wada-hadalka.`;
      return {
        replyText: helpText,
        studentId: student.studentId,
        intent: 'help',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 8.5. Detect and persist user profile data from this message
    const detectedName = UserProfiler.extractName(content);
    const detectedOccupation = UserProfiler.extractOccupation(content);
    const detectedTopics = UserProfiler.detectTopics(content);

    const profileUpdates: { firstName?: string; interests?: string; occupation?: string } = {};
    let currentStudent = student;

    if (detectedName && detectedName !== student.firstName) {
      profileUpdates.firstName = detectedName;
    }
    if (detectedOccupation && detectedOccupation !== student.occupation) {
      profileUpdates.occupation = detectedOccupation;
    }
    if (detectedTopics.length > 0) {
      profileUpdates.interests = UserProfiler.mergeInterests(student.interests, detectedTopics);
    }

    if (Object.keys(profileUpdates).length > 0) {
      await this.memory.updateUserProfile(student.studentId, profileUpdates);
      // Merge updates into local copy for use in this response
      currentStudent = { ...student, ...profileUpdates };
    }

    // 9. Build system instruction
    const systemInstruction = PromptBuilder.buildSystemInstruction({
      detectedLanguage: lang,
      isGroupChat: isGroup,
      userName: currentStudent.firstName,
      userInterests: currentStudent.interests,
      userOccupation: currentStudent.occupation,
    });

    // 10. Enrich prompt with glossary hints and optional web search context
    let enrichedPrompt = PromptBuilder.enrichUserPrompt(content, lang);

    // ── LIVE WEB SEARCH (100% Free) ──────────────────────────────────────────
    if (!media && WebSearchService.shouldSearch(content)) {
      const snippets = await WebSearchService.search(content);
      if (snippets.length > 0) {
        const searchContext = snippets.join('\n• ');
        enrichedPrompt = `[Live Web Context — use to answer accurately]:\n• ${searchContext}\n\n[User question]: ${enrichedPrompt}`;
      }
    }

    // 11. Call AI provider (with optional media attachment for voice/image/document)
    const aiResult = await this.ai.generateResponse(enrichedPrompt, aiHistory, {
      systemInstruction,
      studentId: student.studentId,
      media: media ? { mimeType: media.mimeType, dataBase64: media.dataBase64 } : undefined,
    });

    // 12. Save conversation turns to database memory
    await this.memory.saveMessage({
      studentId: student.studentId,
      chatId,
      role: 'user',
      content,
      languageDetected: lang,
      timestamp,
    });

    await this.memory.saveMessage({
      studentId: student.studentId,
      chatId,
      role: 'model',
      content: aiResult.text,
      languageDetected: lang,
      timestamp: Date.now(),
    });

    return {
      replyText: aiResult.text,
      studentId: student.studentId,
      intent: intentResult.intent,
      language: lang,
      latencyMs: Date.now() - startTime,
    };
  }
}
