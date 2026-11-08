import { IStudentMemory } from '../memory/memory.interface.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { LanguageDetector } from './language-detector.js';
import { IntentClassifier } from './intent-classifier.js';
import { PromptBuilder } from './prompt-builder.js';
import { MotivationCoach } from './motivation-coach.js';
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
        ? '🗑️ *[Privacy Confirmation]*: All your conversation history has been permanently deleted from ABARSO AI memory.'
        : '🗑️ *[Xaqiijinta Xog-tirtiridda]*: Dhammaan taariikhdii wada-hadalkaaga waxaa si rasmi ah looga tirtiray kaydka ABARSO AI.';

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

    // 8. Handle Help command
    if (intentResult.intent === 'help') {
      const helpText = lang === 'en'
        ? `*🌟 ABARSO AI — Your Intelligent Assistant*\nI can help you with anything — ask me freely!\n• Questions, advice, explanations on any topic.\n• Science, math, history, religion, technology, health, relationships, and more.\n• Somali, English, or mixed language — I adapt to you.\n\n*Commands:*\n• \`!tirtir\` or \`!clear\` — Delete your conversation history.`
        : `*🌟 ABARSO AI — La-Taliyahaaga Caqliga*\nWaxaad i weydiin kartaa wax kasta — xoriyad buuxda!\n• Su'aalo, talo, sharaxaad mawduuc kasta ah.\n• Sayniska, xisaabta, taariikhda, diinta, teknoolajiyada, caafimaadka, xiriirka, iwm.\n• Af-Soomaali, Ingiriis, ama isku qas — waxaan kuu qabsadaa.\n\n*Awaamiirta:*\n• \`!tirtir\` ama \`!clear\` — Si aad u tirtirto dhammaan xogtaada wada-hadalka.`;
      return {
        replyText: helpText,
        studentId: student.studentId,
        intent: 'help',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 9. Build system instruction
    const systemInstruction = PromptBuilder.buildSystemInstruction({
      detectedLanguage: lang,
      isGroupChat: isGroup,
    });

    // 10. Enrich prompt with glossary hints if needed
    const enrichedPrompt = PromptBuilder.enrichUserPrompt(content, lang);

    // 11. Call AI provider
    const aiResult = await this.ai.generateResponse(enrichedPrompt, aiHistory, {
      systemInstruction,
      studentId: student.studentId,
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
