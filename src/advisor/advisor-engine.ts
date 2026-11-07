import { IStudentMemory } from '../memory/memory.interface.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { LanguageDetector } from './language-detector.js';
import { IntentClassifier } from './intent-classifier.js';
import { PromptBuilder } from './prompt-builder.js';
import { MotivationCoach } from './motivation-coach.js';
import { AcademicAdvisor } from './academic-advisor.js';
import { HomeworkHelper } from './homework-helper.js';
import { ConversationMessage } from '../ai/ai-provider.interface.js';

export interface ProcessMessageInput {
  rawSenderId: string;
  chatId: string;
  isGroup: boolean;
  content: string;
  timestamp?: number;
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
    const { rawSenderId, chatId, isGroup, content, timestamp = Date.now() } = input;

    // 1. Get or create secure, isolated student profile
    const student = await this.memory.getOrCreateStudent(rawSenderId);

    // 2. Classify student intent
    const intentResult = IntentClassifier.classify(content);

    // 3. Detect language (Somali, English, Mixed)
    const langResult = this.detector.detect(content);
    const lang = langResult.language;

    // 4. Handle Privacy / Right-to-be-Forgotten command
    if (intentResult.intent === 'privacy_forget') {
      await this.memory.deleteStudentHistory(student.studentId);
      const reply = lang === 'en'
        ? '🗑️ *[Privacy Confirmation]*: All your conversation history and student records have been permanently deleted from ABARSO AI memory.'
        : '🗑️ *[Xaqiijinta Xog-tirtiridda]*: Dhammaan taariikhdii wada-hadalkaaga iyo xogtaadii ardaynimo waxaa si rasmi ah looga tirtiray kaydka ABARSO AI.';

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

    // 6. Retrieve student's isolated conversation history (max 10 turns to save tokens)
    const storedHistory = await this.memory.getConversationHistory(student.studentId, 10);
    const aiHistory: ConversationMessage[] = storedHistory.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // 7. Handle pure single Greeting intent directly with instant polite Wcs (only for initial hello)
    if (intentResult.intent === 'greeting' && storedHistory.length === 0) {
      const isEnglishGreeting = /^(hello|hi|hey|good\s+morning|good\s+afternoon)/i.test(content.trim());
      const greetingReply = isEnglishGreeting
        ? 'Hello walaal! How can I help you today? 😊'
        : 'Wcs walaal! Maxaan kugu caawin karaa maanta? 📚💻';

      return {
        replyText: greetingReply,
        studentId: student.studentId,
        intent: 'greeting',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 8. Handle Help / Information command
    if (intentResult.intent === 'help') {
      const helpText = lang === 'en'
        ? `
*🌟 Welcome to ABARSO AI — Your Smart Student Advisor*
I am here to guide you with:
• *Academic Advice:* Study planning, time management, exam prep.
• *Programming:* Python, JavaScript, React, Node.js, Flutter, HTML/CSS.
• *Homework Guidance:* Socratic explanations and problem breakdown.
• *Motivation:* Study discipline and positive encouragement.

*Commands:*
• \`!tirtir\` or \`!clear\` — Delete your conversation history.
• Type your questions in Somali, English, or mixed language!
`
        : `
*🌟 Kusoo dhawoow ABARSO AI — La-taliyahaaga Waxbarasho*
Waxaan diyaar u ahay inaan kugu caawiyo:
• *Talo Jaamacadeed & Iskuul:* Qorshaynta waqtiga, diyaarinta imtixaanka.
• *Barashada Koodhka:* Python, JavaScript, React, Node.js, Flutter, HTML/CSS.
• *Caawinta Howl-guri:* Fahamka su'aalaha adag talaabo-tallaabo.
• *Dhiirigelin:* Dhisidda caadooyin waxbarasho oo miro-dhal ah.

*Awaamiirta:*
• \`!tirtir\` ama \`!clear\` — Si aad u tirtirto dhammaan xogtaada wada-hadalka.
• Iigu soo qor Af-Soomaali, Ingiriis, ama isku qas (Mixed)!
`;
      return {
        replyText: helpText,
        studentId: student.studentId,
        intent: 'help',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 9. Build specialized system instruction based on language and intent
    let systemInstruction = PromptBuilder.buildSystemInstruction({
      detectedLanguage: lang,
      isGroupChat: isGroup,
    });

    if (intentResult.intent === 'homework') {
      systemInstruction += `\n\n${HomeworkHelper.getSocraticDirective()}`;
    }

    // 9. Enrich prompt with glossary hints if needed
    const enrichedPrompt = PromptBuilder.enrichUserPrompt(content, lang);

    // 10. Call AI provider
    const aiResult = await this.ai.generateResponse(enrichedPrompt, aiHistory, {
      systemInstruction,
      studentId: student.studentId,
    });

    // 11. Save conversation turns to database memory
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

