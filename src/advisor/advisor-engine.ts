import { IStudentMemory } from '../memory/memory.interface.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { LanguageDetector } from './language-detector.js';
import { IntentClassifier } from './intent-classifier.js';
import { PromptBuilder } from './prompt-builder.js';
import { MotivationCoach } from './motivation-coach.js';
import { ConversationMessage } from '../ai/ai-provider.interface.js';
import { WebSearchService } from '../services/web-search.service.js';
import { ReminderService, reminderService } from '../services/reminder.service.js';
import { MessageMedia, OutgoingMedia } from '../transports/transport.interface.js';
import { UserProfiler } from '../services/user-profiler.service.js';
import { ImageGeneratorService } from '../services/image-generator.service.js';
import { VoiceReplyService } from '../services/voice-reply.service.js';
import { ResponseCacheService } from '../services/response-cache.service.js';
import { EmotionDetector } from './emotion-detector.js';
import { detectInstantGreetingReply, polishSomaliReply } from './somali-dictionary.js';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import { BroadcastService, broadcastService } from '../services/broadcast.service.js';
import { BotCategory, PlanGuard } from '../tenants/plan-catalog.js';
import { inspectCustomerImageForPayment, ReceiptVerificationOutcome } from './receipt-verifier.js';

export interface AdvisorEngineOptions {
  broadcast?: BroadcastService;
  reminderService?: ReminderService;
  cacheScope?: string;
  tenantCategory?: BotCategory;
  ownerDisplayName?: string;
  isAwayMode?: () => boolean;
  planGuard?: PlanGuard;
}

export interface ProcessMessageInput {
  rawSenderId: string;
  chatId: string;
  isGroup: boolean;
  content: string;
  timestamp?: number;
  media?: MessageMedia;
  forceVoiceReply?: boolean;
  forbidVoiceReply?: boolean;
  hasCardosoMention?: boolean;
  rawContent?: string;
  senderName?: string;
}

export interface ProcessMessageOutput {
  replyText: string;
  studentId: string;
  intent: string;
  language: string;
  latencyMs: number;
  replyMedia?: OutgoingMedia;
}

export class StudentAdvisorEngine {
  private memory: IStudentMemory;
  private ai: AIOrchestrator;
  private detector: LanguageDetector;
  private broadcast: BroadcastService;
  private reminders: ReminderService;
  private cacheScope: string;
  private tenantCategory?: BotCategory;
  private ownerDisplayName?: string;
  private isAwayMode?: () => boolean;
  private planGuard?: PlanGuard;

  constructor(memory: IStudentMemory, ai: AIOrchestrator, options?: AdvisorEngineOptions) {
    this.memory = memory;
    this.ai = ai;
    this.detector = new LanguageDetector();
    this.broadcast = options?.broadcast || broadcastService;
    this.reminders = options?.reminderService || reminderService;
    this.cacheScope = options?.cacheScope || 'default';
    this.tenantCategory = options?.tenantCategory;
    this.ownerDisplayName = options?.ownerDisplayName;
    this.isAwayMode = options?.isAwayMode;
    this.planGuard = options?.planGuard;
  }

  public getAIOrchestrator(): AIOrchestrator {
    return this.ai;
  }

  public setTenantCategory(category: BotCategory, ownerDisplayName?: string): void {
    this.tenantCategory = category;
    if (ownerDisplayName !== undefined) {
      this.ownerDisplayName = ownerDisplayName;
    }
  }

  public async processMessage(input: ProcessMessageInput): Promise<ProcessMessageOutput> {
    const startTime = Date.now();
    const { rawSenderId, chatId, isGroup, content, timestamp = Date.now(), media } = input;

    // 1. Get or create secure, isolated user profile
    const student = await this.memory.getOrCreateStudent(rawSenderId);

    // 2. Classify intent
    const intentResult = IntentClassifier.classify(content);

    // 3. Detect language (Somali, English, Arabic, French, Turkish, mixed, or other)
    const langResult = this.detector.detect(content);
    const lang = langResult.language;

    // 3b. Resolve identity from memory + synced WhatsApp phonebook contacts
    const savedContactName = this.broadcast.getContactName(chatId) || this.broadcast.getContactName(rawSenderId);
    const knownUserName = student.firstName || input.senderName || savedContactName;
    const knownGender = UserProfiler.detectGender(knownUserName, content);
    const isReturning = student.totalMessagesCount > 2;
    let cachedCustomConfig: { botName?: string; businessName?: string; systemRole?: string; knowledgeBase?: string } | undefined;
    if (this.memory instanceof SQLiteStudentMemory) {
      try {
        cachedCustomConfig = await this.memory.getBotConfig();
      } catch {}
    }

    // 1.5. Instant Islamic/Somali greeting shortcut — personalized by person + bot role (0 AI quota!)
    const instantReply = detectInstantGreetingReply(content, {
      userName: knownUserName,
      userGender: knownGender,
      roleCategory: this.tenantCategory,
      businessName: cachedCustomConfig?.businessName || this.ownerDisplayName,
      isReturning,
    });
    if (instantReply && !media) {
      // Still learn vocab & save message for context
      if (this.memory instanceof SQLiteStudentMemory) {
        this.memory.learnVocabFromText(content);
      }
      await this.memory.saveMessage({ studentId: student.studentId, chatId, role: 'user', content, languageDetected: lang, timestamp });
      await this.memory.saveMessage({ studentId: student.studentId, chatId, role: 'model', content: instantReply, languageDetected: lang, timestamp: Date.now() });
      return {
        replyText: instantReply,
        studentId: student.studentId,
        intent: 'greeting',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 1.5. Handle Gibberish / Keyboard Smash Guard (Zero AI Quota Burn)
    if (intentResult.intent === 'gibberish' && !media) {
      const gibberishReplies = lang === 'en'
        ? [
            "Hi there! Did you want to ask me something? Please type your question clearly and I'll be happy to help! 😊",
            "Hello! I am here and listening. Please type what you need clearly! ✨",
          ]
        : [
            "Haa walaal, wax ma i weydiinaysaa? Fariintaada si fiican iigu soo qor waan kula socdaaye! 😊",
            "Haa sxb, waan ku maqlayaaye maxaad doonaysay? Fariinta si fiican iigu soo qor! ✨",
            "Waan kula socdaa walaal! Wixii su'aal ama caawimaad ah ee aad u baahan tahay si cad iigu soo qor 😊",
          ];
      const reply = gibberishReplies[Math.floor(Math.random() * gibberishReplies.length)];

      await this.memory.saveMessage({ studentId: student.studentId, chatId, role: 'user', content, languageDetected: lang, timestamp });
      await this.memory.saveMessage({ studentId: student.studentId, chatId, role: 'model', content: reply, languageDetected: lang, timestamp: Date.now() });

      return {
        replyText: reply,
        studentId: student.studentId,
        intent: 'gibberish',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 1.6. Learn Somali vocabulary from every incoming user message (background, non-blocking)
    if (this.memory instanceof SQLiteStudentMemory) {
      this.memory.learnVocabFromText(content);
    }

    // 3.5. Detect emotional tone — used to shape empathetic AI responses
    const emotionResult = EmotionDetector.detect(content);
    if (emotionResult.tone !== 'neutral') {
      console.log(`💚 [Emotion] Detected: ${emotionResult.tone} (${emotionResult.intensity}) — keywords: [${emotionResult.keywords.join(', ')}]`);
    }

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
        const minutesFromNow = Math.max(1, Math.round((parsed.fireAtMs - Date.now()) / 60000));
        this.reminders.addReminder(student.studentId, chatId, parsed.reminderText, parsed.fireAtMs);

        let timeStr = `${minutesFromNow} daqiiqo`;
        if (minutesFromNow >= 60) {
          const hrs = Math.floor(minutesFromNow / 60);
          const remMins = minutesFromNow % 60;
          timeStr = remMins > 0 ? `${hrs} saacadood iyo ${remMins} daqiiqo` : `${hrs} saacadood`;
        }

        const confirmText = lang === 'en'
          ? `⏰ *Reminder Confirmed!*\nI will remind you about:\n👉 *${parsed.reminderText}*\nIn approximately *${timeStr}*. ✅`
          : `⏰ *Xasuusiyaha Waa La Dejiyay!*\nWaxaan kugu xasuusin doonaa:\n👉 *${parsed.reminderText}*\nMuddo qiyaastii *${timeStr}* kadib. Waan kuu soo diri doonaa fariinta xilligaas saxda ah! ✅`;

        return {
          replyText: confirmText,
          studentId: student.studentId,
          intent: 'reminder',
          language: lang,
          latencyMs: Date.now() - startTime,
        };
      } else {
        // User asked for a reminder but didn't specify time
        const askTimeText = lang === 'en'
          ? `⏰ *When would you like me to remind you?*\nPlease specify a time, for example:\n• "Remind me in 15 minutes to call mom"\n• "Remind me at 8:00 PM to study"`
          : `⏰ *Goormaad jeceshahay inaan ku xasuusiyo walaal?*\nFadlan waqtiga ii sheeg, tusaale ahaan:\n• *"15 daqiiqo kadib igu xasuusi inaan wax akhriyo"*\n• *"8:00 fiidnimo igu xasuusi shaqada"*\n• *"1 saacad kadib igu xasuusi"*`;

        return {
          replyText: askTimeText,
          studentId: student.studentId,
          intent: 'reminder',
          language: lang,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // 5.55. Handle pure Voice-Note request (e.g. "@cod", "!cod", "@cardoso cod isoo duub")
    // If user asked a specific question with @cod (e.g. "@cod sidee wax loo bartaa?"),
    // we want Gemini to answer the actual question, then synthesize voice at step 11.5!
    // We only trigger this pure greeting reply if there is NO specific question attached.
    const cleanNoCod = content.replace(/@?cod\b/gi, '').replace(/[!.,?،\s]/g, '').trim();
    const isPureVoiceRequest =
      !media &&
      (!cleanNoCod ||
       /^(?:@?cod|!cod|cod\s+i[si]oo?\s+duub|cod\s+ii?\s+duub|cod\s+ahaan\s*(?:ku\s+jawaab)?|cod\s+iigu\s+(?:soo\s+)?jawaab|codka?\s*(?:ah\s+ku\s+jawaab)?|voice\s+note|send\s+(?:a\s+)?voice(?:\s+note)?)[.!،\s]*$/i.test(content.trim()));
    if (isPureVoiceRequest) {
      const voicePrompt = lang === 'en'
        ? 'You are recording a rich, warm, engaging spoken WhatsApp voice note welcoming the user (duration around 45 to 60 seconds). Greet them with great warmth and respect, introduce yourself as CARDOSO AI created by Mohamed Dahir, describe the wide range of questions and topics you can help with (learning, advice, science, general knowledge, web searches, languages, images), ask how their day is going, and invite them to speak or ask about anything on their mind. Speak naturally in 3 substantial conversational paragraphs.'
        : 'Waxaad duubaysaa cod WhatsApp ah oo diirran, qoto dheer oo soconaya muddo fiican (qiyaastii 45 ilaa 60 ilbiriqsi). Qofka si heer sare ah oo saaxiibtinimo leh u soo dhawee, is-bar adigoo ah CARDOSO AI oo uu sameeyay Maxamed Daahir, u sharax waxyaabaha ballaadhan ee aad qaban karto (suaalo kasta, cilmiga, waxbarashada, talooyinka, baadhista tooska ah ee internet-ka, sawirrada), weydii sida uu maanta yahay, kuna dhiirrigeli inuu suxool kasta ama mawduuc kasta cod ama qoraal kuula wadaago. U hadal si dabiici ah oo cod maqal ah u macaan oo 3 cutub oo faahfaahsan ka kooban.';
      const sysInstruction = PromptBuilder.buildSystemInstruction({
        detectedLanguage: lang,
        isGroupChat: isGroup,
        isVoiceReply: true,
        emotionResult,
      });
      const aiVoiceResult = await this.ai.generateResponse(voicePrompt, [], { systemInstruction: sysInstruction, studentId: student.studentId });
      const voiceReply = await VoiceReplyService.synthesizeVoice(aiVoiceResult.text, lang);
      return {
        replyText: aiVoiceResult.text,
        studentId: student.studentId,
        intent: 'general',
        language: lang,
        latencyMs: Date.now() - startTime,
        replyMedia: voiceReply
          ? { type: 'audio', dataBuffer: voiceReply.buffer, mimeType: voiceReply.mimeType || 'audio/mpeg', ptt: true }
          : undefined,
      };
    }

    // 5.56. Handle Voice Capability Question (e.g. "cod ma ku hadli kartaa?", "ma ila hadli kartaa?", "can you speak?")
    // NEVER say "I cannot speak" — explain how to use @cod or voice notes, AND respond with a voice note demonstration!
    const isVoiceCapabilityQuery =
      /(?:cod\s+ma\s+(?:ku\s+)?(?:hadli\s+kartaa|heli\s+karaa|diri\s+kartaa|yeelan\s+kartaa)|ma\s+ila\s+hadli\s+kartaa(?:\s+cod)?|can\s+you\s+(?:speak|talk|send\s+voice)|halagu\s+hadlo|cod\s+ma\s+leedahay|sida\s+cod\s+loogu\s+hadlo|sidee\s+cod\s+(?:kuugu\s+duubaa|kuula\s+hadlaa)|waxaan\s+rabaa\s+inaad\s+cod\s+iigu\s+jawaabto)/i.test(content);

    if (isVoiceCapabilityQuery) {
      const guidanceText = lang === 'en'
        ? `🎙️ *Yes, absolutely! I can speak with voice!* ✨\n\nTo talk with me using voice:\n1. *Use the command \`@cod\`*: Type \`@cod\` followed by your question (e.g. \`@cod explain how computers work\`).\n2. *Send a Voice Note*: Record a WhatsApp voice note directly, and I will listen and reply back in voice! 🔊✅`
        : `🎙️ *Dabcan, waan kula hadli karaa cod ahaan!* ✨\n\nSi aan cod kuugu soo duubo, labadan hab midkood raac:\n1. *Isticmaal *@cod*:* Qor *@cod* iyo wixii aad doonayso (tusaale: *@cod ii sharax mawduucan*).\n2. *Toos Cod Ii Soo Duub:* WhatsApp-ka toos cod iigu soo dir (ama codkaaga reply u gal), aniguna markiiba cod ayaan kuugu soo jawaabayaa! 🔊✅`;

      // Demonstrate voice capability by synthesizing this response as a voice note!
      const demoVoice = await VoiceReplyService.synthesizeVoice(guidanceText, lang);
      return {
        replyText: guidanceText,
        studentId: student.studentId,
        intent: 'general',
        language: lang,
        latencyMs: Date.now() - startTime,
        replyMedia: demoVoice
          ? { type: 'audio', dataBuffer: demoVoice.buffer, mimeType: demoVoice.mimeType || 'audio/mpeg', ptt: true }
          : undefined,
      };
    }

    // 5.6. Handle Image Generation request ("@sawir...", "!sawir...", "ii samee sawir...")
    if (ImageGeneratorService.isImageRequest(content)) {
      const prompt = ImageGeneratorService.extractPrompt(content);

      // If user typed only "@sawir" without a description, guide them warmly with examples
      if (!prompt || prompt.length < 2) {
        const guideText = lang === 'en'
          ? `🎨 *How to create AI Images with CARDOSO AI:*\nType *@sawir* followed by what you want to see!\n\n*Examples:*\n• *@sawir a majestic lion in the savanna*\n• *@sawir a futuristic red sports car*\n• *@sawir Berbera coastal city sunset*\n• *@sawir cute kitten playing*\n\nTry it right now! ✨`
          : `🎨 *Sida Sawir Loogu Sameeyo CARDOSO AI:*\nQor *@sawir* iyo waxa aad rabto in laguu sawiro!\n\n*Tusaalayaal:*\n• *@sawir libaax weyn oo duurka jooga*\n• *@sawir baabuur cas oo xawaare ku socda*\n• *@sawir xeebta Berbera xilliga qorrax-u-dhaca*\n• *@sawir arday buug akhrinaya*\n\nToos hadda u tijaabi! ✨`;

        return {
          replyText: guideText,
          studentId: student.studentId,
          intent: 'image_generation',
          language: lang,
          latencyMs: Date.now() - startTime,
        };
      }

      if (this.planGuard) {
        const imgCheck = this.planGuard.checkFeature('image');
        if (!imgCheck.allowed) {
          return {
            replyText: `⏳ ${imgCheck.reason}`,
            studentId: student.studentId,
            intent: 'image_generation',
            language: lang,
            latencyMs: Date.now() - startTime,
          };
        }
      }
      // Send prompt directly to Pollinations — Somali/Arabic text works without translation.
      // Translation step removed: saves 2-4s latency and Pollinations handles non-English well.
      const generated = await ImageGeneratorService.generateImage(prompt);
      if (generated) {
        this.planGuard?.recordUsage('image');
        const caption = lang === 'en'
          ? `🎨 *Generated Image:* "${prompt}"\nCreated by CARDOSO AI ✨`
          : `🎨 *Sawirka aad codsatay:* "${prompt}"\nWaxa soo saaray CARDOSO AI ✨`;

        return {
          replyText: caption,
          studentId: student.studentId,
          intent: 'image_generation',
          language: lang,
          latencyMs: Date.now() - startTime,
          replyMedia: {
            type: 'image',
            dataBuffer: generated.buffer,
            mimeType: generated.mimeType,
            caption,
          },
        };
      } else {
        // All 4 attempts failed — show a friendly soft message, NO scary error text.
        const softRetry = lang === 'en'
          ? `🎨 *CARDOSO AI*: Your image is on its way! The artist is still painting... 🖨️ Please send your request again in a moment and it will appear! ✨`
          : `🎨 *CARDOSO AI*: Sawirkaagu wuu socday! Ressaamaha weli wuu rinjiyeynayaa... 🖨️ Daqiiqad yar kadib mar kale iiga dir codsigaaga, si degdeg ah ayuu kuu soo muuqan doonaa! ✨`;

        return {
          replyText: softRetry,
          studentId: student.studentId,
          intent: 'image_generation',
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

    // 7. Handle pure greeting intent — with warm onboarding for first-time users
    if (intentResult.intent === 'greeting') {
      const clean = content.toLowerCase().trim();
      const isFirstTime = student.totalMessagesCount <= 1;
      let greetingReply: string;

      if (/^(s[\s.]*c[\s.]*w|scw|sallallahu\s*calayhi\s*wasallam|calayhi\s*salaatu\s*wasalaam|nnkh)/i.test(clean)) {
        greetingReply = 'Sallallaahu Calayhi Wasallam 🌿 (SCW ﷺ)';
      } else if (/^(hello|hi|hey|how\s+are\s+you|good\s+(morning|afternoon|evening)|wassup|whats\s*up|howdy)/i.test(clean)) {
        greetingReply = isFirstTime
          ? 'Hi! Welcome to *CARDOSO AI*! 🌟 I am your smart personal companion — feel free to ask me anything, send voice notes, photos, or ask me to generate images. How are you? 😊'
          : 'Hi! How are you? 😊';
      } else if (/^(asc|assalamu|assalaamu|salaam|salaan)/i.test(clean)) {
        greetingReply = isFirstTime
          ? 'Wcs! Waan fiicanahay, ku soo dhawow *CARDOSO AI*! 🌟 Waxaan ahay saaxiibkaaga caqliga badan — i weydii wax kasta, iigu soo dir codadka/sawirrada, ama iga codso inaan sawir kuu sameeyo. Adiguna sidee tahay? 😊'
          : 'Wcs! Waan fiicanahay. Adiguna? 😊';
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

    // 7.5. Handle Creator / Author inquiry — reply in the SAME language the user asked
    if (intentResult.intent === 'creator') {
      // Somali & English: fast hardcoded polished answers
      if (lang === 'so') {
        const isLocationQuery = /(halkee|meelkee|halkuu|xaggee|xagguu)/i.test(content);
        const creatorReply = isLocationQuery
          ? `📍 *Goobta Uu Joogo Qofka I Sameeyay*\n\n*Maxamed Daahir* wuxuu joogaa oo uu ku nool yahay magaalada qadiimiga ah ee *Berbera*, gaar ahaan *Xaafadda Jamalaaye*! 🌊📍`
          : `🌟 *QOFKA KA DAMBEEYA CARDOSO AI*\n\nCARDOSO AI waxaa hindisay, naqshadeeyay, isla markaana horumariyay *Maxamed Daahir*, oo ah Software Engineer haysta shahaadada *Bachelor's Degree in Computer Science*, kana tirsanaa *Faculty of Software Engineering* ee Jaamacadda Abaarso Tech University, halkaas oo uu ku qalin-jabiyay sharaf (Honors). 🎓🏆\n\nWaa hal-abuur leh aragti fog, dadaal iyo jacayl uu u qabo teknoolojiyadda. Wuxuu ku nool yahay magaalada *Berbera (Xaafadda Jamalaaye)*.\n\n*Maxamed Daahir — aqoon, hal-abuur iyo himilo teknoolojiyadeed oo mustaqbalka wax ka beddeli karta.* 🚀`;
        return { replyText: creatorReply, studentId: student.studentId, intent: 'creator', language: 'so', latencyMs: Date.now() - startTime };
      }
      if (lang === 'en') {
        const isLocationQuery = /(where\s+(does|is)|located|live)/i.test(content);
        const creatorReply = isLocationQuery
          ? `📍 *Creator's Location*\n\n*Mohamed Dahir* is based and lives in the historic coastal city of *Berbera*, specifically in the *Jamalaaye neighborhood*! 🌊🏢`
          : `🌟 *MEET THE CREATOR OF CARDOSO AI*\n\nCARDOSO AI was envisioned, designed, and developed by *Mohamed Dahir*, a Software Engineer holding a *Bachelor's Degree in Computer Science* from Abaarso Tech University, where he studied in the *Faculty of Software Engineering and graduated with Honors*. 🎓🏆\n\nHe is an ambitious technology innovator driven by creativity, dedication, and a passion for building intelligent solutions. He resides in *Berbera (Jamalaaye neighborhood)*.\n\n*Mohamed Dahir — combining knowledge, innovation, and vision to create technology that makes a difference.* 🚀`;
        return { replyText: creatorReply, studentId: student.studentId, intent: 'creator', language: 'en', latencyMs: Date.now() - startTime };
      }
      if (lang === 'ar') {
        const isLocationQuery = /(أين|فين|مكان|يسكن|يقيم|يعيش)/i.test(content);
        const creatorReply = isLocationQuery
          ? `📍 *موقع المبدع*\n\n*محمد داهر (Maxamed Daahir)* يقيم ويسكن في مدينة *بربرة* الساحلية التاريخية، تحديداً في *حي جمالية*! 🌊📍`
          : `🌟 *مُنشئ CARDOSO AI*\n\nCARDOSO AI صمّمه وطوّره *محمد داهر (Maxamed Daahir)*، مهندس برمجيات حاصل على درجة البكالوريوس في علوم الحاسوب من جامعة *Abaarso Tech University*، من كلية هندسة البرمجيات، وتخرّج بمرتبة الشرف. 🎓🏆\n\nيمتلك رؤية تقنية طموحة، ويسعى لجعل الذكاء الاصطناعي والتقنية في متناول الجميع. يقيم في مدينة *بربرة (حي جمالية)*. 🌊📍\n\n*محمد داهر — يجمع بين المعرفة والابتكار والرؤية لصناعة مستقبل مختلف.* 🚀`;
        return { replyText: creatorReply, studentId: student.studentId, intent: 'creator', language: 'ar', latencyMs: Date.now() - startTime };
      }
      // French, Turkish, or any other language — Gemini translates from the system prompt
      const creatorSys = PromptBuilder.buildSystemInstruction({ detectedLanguage: lang, isGroupChat: isGroup, emotionResult });
      const creatorPrompt = `The user wants to know who created CARDOSO AI. Reply warmly in the SAME language the user is using (detected: ${lang}). Include: Mohamed Dahir, Software Engineer, Bachelor's CS with Honors, Abaarso Tech University, Faculty of Software Engineering, lives in Berbera Jamalaaye. Format nicely for WhatsApp with emojis.`;
      const aiCreator = await this.ai.generateResponse(creatorPrompt, [], { systemInstruction: creatorSys, studentId: student.studentId });
      return { replyText: aiCreator.text, studentId: student.studentId, intent: 'creator', language: lang, latencyMs: Date.now() - startTime };
    }

    // 7.6. Handle WhatsApp Owner inquiry ("Qofkii WhatsApp-ka lahaa aaway?", "Ninkii lambarka lahaa aaway?")
    if (intentResult.intent === 'owner_inquiry') {
      const ownerLabel = this.ownerDisplayName?.trim();
      let ownerReply: string;
      if (lang === 'so') {
        ownerReply = ownerLabel
          ? `Walaal, hadda aniga ayaa maamulaya oo haya lambarkan, ${ownerLabel} hadda ma joogo (wuu maqan yahay). Ma jirtaa fariin aan u reebo ama wax aan kuu qaban karo? 😊`
          : `Walaal, hadda aniga ayaa maamulaya oo haya lambarkan, qofkii lambarka lahaa hadda ma joogo (wuu maqan yahay). Ma jirtaa fariin ama wax aan kuu qaban karo oo aan u reebo ama kaa caawiyo? 😊`;
      } else if (lang === 'en') {
        ownerReply = ownerLabel
          ? `Hello! I am currently managing and holding this number; ${ownerLabel} isn't around right now. Is there a message you'd like me to leave for them, or anything I can help you with? 😊`
          : `Hello! I am currently managing and holding this number; the owner of the number isn't around right now. Is there a message you'd like me to leave for them, or anything I can help you with? 😊`;
      } else if (lang === 'ar') {
        ownerReply = `أهلاً بك! أنا حالياً من يدير ويحمل هذا الرقم، وصاحب الرقم غير متواجد حالياً. هل هناك رسالة تود تركها له أو أي شيء يمكنني مساعدتك به؟ 😊`;
      } else {
        ownerReply = `Hello! I am currently managing and holding this number; the owner of the number isn't around right now. Is there a message or anything I can help you with? 😊`;
      }
      if (this.memory.recordLead && (!this.planGuard || this.planGuard.checkFeature('leads').allowed)) {
        await this.memory.recordLead({
          chatId,
          senderName: knownUserName || '',
          senderPhone: chatId.split('@')[0].split(':')[0],
          category: 'owner_inquiry',
          summary: `${knownUserName || rawSenderId} asked for owner (${content.slice(0, 120)})`,
        });
      }
      return {
        replyText: ownerReply,
        studentId: student.studentId,
        intent: 'owner_inquiry',
        language: lang,
        latencyMs: Date.now() - startTime,
      };
    }

    // 8. Handle Help command — reply in user's language
    if (intentResult.intent === 'help') {
      if (lang === 'so') {
        const helpText = `*🌟 CARDOSO AI — La-Taliyahaaga Caqliga*\nWaxaad i weydiin kartaa wax kasta — xoriyad buuxda!\n• Su'aalo, talo, sharaxaad mawduuc kasta ah.\n• Sayniska, xisaabta, taariikhda, diinta, teknoolajiyada, caafimaadka, xiriirka, iwm.\n• 🎙️ Codadka, 🖼️ Sawirrada, iyo 📄 Dukumentiyada — waan akhriyaa!\n• 🌐 Baadhi tooska ah wararka, cayaaraha, sarifka lacagta, iwm.\n• ⏰ Xasuusin-dejin (dheh "i xasuusi 30 daqiiqo gudahood").\n• Af-Soomaali, Ingiriis, Carabi — waxaan kuu qabsadaa.\n\n*Awaamiirta:*\n• \`!tirtir\` ama \`!clear\` — Si aad u tirtirto dhammaan xogtaada wada-hadalka.`;
        return { replyText: helpText, studentId: student.studentId, intent: 'help', language: lang, latencyMs: Date.now() - startTime };
      }
      if (lang === 'en') {
        const helpText = `*🌟 CARDOSO AI — Your Intelligent Assistant*\nI can help you with anything — ask me freely!\n• Questions, advice, explanations on any topic.\n• Science, math, history, religion, technology, health, relationships, and more.\n• 🎙️ Voice notes, 🖼️ images, and 📄 documents — I can read them!\n• 🌐 Live web search for news, sports scores, exchange rates and more.\n• ⏰ Set reminders (say "remind me in 30 minutes to study").\n• Somali, English, Arabic, French — I adapt to you.\n\n*Commands:*\n• \`!tirtir\` or \`!clear\` — Delete your conversation history.`;
        return { replyText: helpText, studentId: student.studentId, intent: 'help', language: lang, latencyMs: Date.now() - startTime };
      }
      if (lang === 'ar') {
        const helpText = `*🌟 CARDOSO AI — مساعدك الذكي*\nيمكنك أن تسألني عن أي شيء — بحرية تامة!\n• أسئلة، نصائح، شرح لأي موضوع.\n• العلوم، الرياضيات، التاريخ، الدين، التقنية، الصحة، العلاقات، وأكثر.\n• 🎙️ الرسائل الصوتية، 🖼️ الصور، و📄 المستندات — أستطيع قراءتها!\n• 🌐 بحث مباشر عن الأخبار، المباريات، أسعار الصرف.\n• ⏰ تذكيرات — قل "ذكّرني بعد 30 دقيقة".\n• العربية، الصومالية، الإنجليزية — أتكيّف معك.\n\n*الأوامر:*\n• \`!tirtir\` أو \`!clear\` — لحذف سجل محادثتك.`;
        return { replyText: helpText, studentId: student.studentId, intent: 'help', language: lang, latencyMs: Date.now() - startTime };
      }
      // Other language — Gemini generates help in that language
      const helpSys = PromptBuilder.buildSystemInstruction({ detectedLanguage: lang, isGroupChat: isGroup, emotionResult });
      const helpPrompt = `Generate a WhatsApp-formatted help/feature list for CARDOSO AI in the user's language (detected: ${lang}). Include: answers any question, reads voice notes/images/documents, live web search, reminders, multi-language. Use bullet points and bold headers. Keep it clean and friendly.`;
      const aiHelp = await this.ai.generateResponse(helpPrompt, [], { systemInstruction: helpSys, studentId: student.studentId });
      return { replyText: aiHelp.text, studentId: student.studentId, intent: 'help', language: lang, latencyMs: Date.now() - startTime };
    }

    // 8.5. Detect and persist user profile data from this message
    const detectedName = UserProfiler.extractName(content);
    const detectedOccupation = UserProfiler.extractOccupation(content);
    const detectedTopics = UserProfiler.detectTopics(content);

    const profileUpdates: { firstName?: string; interests?: string; occupation?: string } = {};
    let currentStudent = student;

    if (detectedName && detectedName !== student.firstName) {
      profileUpdates.firstName = detectedName;
      // Also update the user's real name in the broadcast contacts list
      if (!isGroup) {
        this.broadcast.recordContact(chatId, detectedName, false);
      }
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

    // Determine effective user name & inferred gender (nin mise naag), falling back to synced WhatsApp contact name
    const effectiveUserName = currentStudent.firstName || input.senderName || savedContactName;
    const detectedGender = UserProfiler.detectGender(effectiveUserName, content);

    // 8.9. Detect early whether this response will be delivered as an audio voice note
    // STRICT USER RULE: "@cardoso hadii qoro marnaba qof cod hagu jaawibin"
    // If the message contains "@cardoso", NEVER reply with a voice note! Always text!
    const isCardosoMentioned =
      Boolean(input.hasCardosoMention) ||
      Boolean(input.forbidVoiceReply) ||
      /@cardoso\b/i.test(content) ||
      /@cardoso\b/i.test(input.rawContent || '');

    // Ordinary conversations remain text-only unless explicitly requested with @cod, !cod, voice note, or forceVoiceReply
    const isExplicitVoiceCmd =
      Boolean(input.forceVoiceReply) ||
      /(?:@?cod\b|!cod\b|cod\s+i[si]oo?\s+duub|cod\s+ii?\s+duub|cod\s+ahaan|cod\s+ku\s+jawaab|cod\s+iigu\s+soo\s+jawaab|cod\s+iigu\s+jawaab)/i.test(content);

    const wantsVoice = !isCardosoMentioned && (isExplicitVoiceCmd || media?.type === 'audio');

    // 9. Build system instruction (includes language directive + role behavior + people recognition + custom knowledge)
    let learnedVocab: Array<{ word: string; frequency: number }> | undefined;
    let vocabCount: number | undefined;
    let recentPhrases: string[] | undefined;
    const customConfig = cachedCustomConfig;
    if (this.memory instanceof SQLiteStudentMemory) {
      learnedVocab = this.memory.getTopVocab(60);
      vocabCount = this.memory.getVocabCount();
      recentPhrases = this.memory.getRecentPhrases(chatId, 12);
    }

    const systemInstruction = PromptBuilder.buildSystemInstruction({
      detectedLanguage: lang,
      isGroupChat: isGroup,
      userName: effectiveUserName,
      savedContactName,
      userGender: detectedGender,
      userInterests: currentStudent.interests,
      userOccupation: currentStudent.occupation,
      isReturningUser: isReturning || storedHistory.length > 0,
      totalMessagesCount: currentStudent.totalMessagesCount,
      roleCategory: this.tenantCategory,
      ownerDisplayName: this.ownerDisplayName,
      awayMode: this.isAwayMode?.(),
      emotionResult,
      isVoiceReply: wantsVoice,
      learnedVocab,
      vocabCount,
      recentPhrases,
      chatId,
      customConfig,
    });

    // 10. Enrich prompt with glossary hints, audio comprehension directive, and optional web search context
    // For Somali/mixed: prefer spelling-normalized text so the model understands informal chat better
    const promptSource =
      (lang === 'so' || lang === 'mixed') && langResult.normalizedText
        ? langResult.normalizedText
        : content;
    let enrichedPrompt = PromptBuilder.enrichUserPrompt(
      promptSource,
      lang,
      customConfig?.knowledgeBase || ''
    );

    // Spoken Voice Note Natural & Proportional Guidance:
    if (wantsVoice) {
      enrichedPrompt = `[🎙️ SPOKEN VOICE NOTE MODE — NATURAL & PROPORTIONAL DIRECTIVE]:
The user is listening to your answer as a SPOKEN AUDIO VOICE NOTE on WhatsApp.
1. Answer ONLY what the user asked — do NOT bring in other topics or unasked background ("wixii la waydiiya kaliya ka jawaaba oo aan mowduuc kale dhex galin").
2. Match your spoken answer length to the length/scope of their question ("hadalka aad ugu jawaabayso wuxuu ku waydiiyey intuu leeg yahay ugu jawaab"):
   - If they gave a simple question or greeting, give a short, warm spoken reply (1-2 sentences).
   - If they asked a moderate question, give a clear, direct spoken answer (approx. 20-45 seconds of speech).
   - If they asked an in-depth question or asked for detail, give a well-structured spoken answer.
   - Do NOT artificially inflate, repeat, or pad your answer.
3. Speak naturally like a real human caring friend on WhatsApp (no emojis, no markdown asterisks or bullet points, smooth spoken sentences).

${enrichedPrompt}`;
    }

    // Audio Understanding Enhancement (Normal & View-Once / One-Click 1️⃣ Voice Notes):
    // If incoming message contains an audio voice note, instruct Gemini with high-accuracy speech comprehension.
    if (media?.type === 'audio') {
      const viewOnceNote = media.isViewOnce ? ' (sent as a WhatsApp View-Once / One-Click 1️⃣ Voice Note)' : '';
      enrichedPrompt = `[🎧 HIGH-ACCURACY VOICE NOTE COMPREHENSION DIRECTIVE${viewOnceNote}]:
You are listening directly to an authentic human voice message (spoken audio)${viewOnceNote}.
1. Listen with acute, human-level attention to every word, phrase, regional accent, and emotional nuance spoken ("codka uu ku soo duubay fahan ereyada uu ku hadlayo ka jawaab").
2. Accurately understand colloquial Somali (e.g. sxb, sxp, wll, wlo, haye, see tahay, maxaa cusub, ii sheeg, maxaad ka taqaan, iwm), standard Somali, English, or Arabic.
3. Answer ONLY what was asked in the voice note — never wander into other topics ("wixii la waydiiya kaliya ka jawaaba oo aan mowduuc kale dhex galin"). NEVER output [SILENCE]!
4. Formulate your response as a natural, warm, thoughtful human conversation partner speaking back directly to what they said ("AI la moodin"). Do NOT meta-reference "I heard your recording" — just talk back directly to their points!
5. Match the length of your answer to the depth of what they asked ("hadalka aad igu jawaabayso wuxuu ku waydiiyey intuu leeg yahay ugu jawaab").
6. Optional Transcription metadata: At the very end of your response, output a single-line hidden transcript comment:
<!-- transcript: [the user's exact words spoken in the audio] -->

[User Spoken Audio Attached]: ${enrichedPrompt}`;
    } else if (media?.type === 'image' || media?.type === 'video') {
      const viewOnceTag = media.isViewOnce ? ' (sent as a WhatsApp View-Once / One-Click 1️⃣ media)' : '';
      const mediaLabel = media.type === 'video' ? 'video (visual frames + audio track)' : 'image/photo';
      enrichedPrompt = `[👁️ HIGH-ACCURACY VISION & MULTIMODAL COMPREHENSION DIRECTIVE${viewOnceTag}]:
You are looking directly at a ${mediaLabel}${viewOnceTag} sent by the user on WhatsApp ("arki karo oo dhagaysan karo qofka waxa WhatsApp one-click ku soo diro").
1. Examine everything in the ${mediaLabel} clearly and attentively:
   - If it shows a person (or people), notice how they look, their expression, outfit/style, posture, setting, and vibe, and respond warmly, naturally, and respectfully like a real human friend on WhatsApp!
   - If it shows text, a question, a document, a screenshot, an object, or a scene, read/understand it accurately and respond directly to it.
   - If it is a video, both WATCH the visual frames and LISTEN to everything spoken in the audio track.
2. NEVER say "I cannot see View-Once photos", "I cannot see people", or output [SILENCE]! Always give a warm, natural, human-like response in the user's language (defaulting to natural Somali if no text caption was provided).

[User Visual/Video Media Attached]: ${enrichedPrompt}`;
    }

    // ── LIVE WEB SEARCH (100% Free) ──────────────────────────────────────────
    if (!media && WebSearchService.shouldSearch(content)) {
      const snippets = await WebSearchService.search(content);
      if (snippets.length > 0) {
        const searchContext = snippets.join('\n• ');
        enrichedPrompt = `[Live Web Context — use to answer accurately]:\n• ${searchContext}\n\n[User question]: ${enrichedPrompt}`;
      }
    }

    // 10.5. Check Smart Response Cache (scoped per tenant, instant response)
    if (!media && ResponseCacheService.isCacheable(content)) {
      const cached = ResponseCacheService.get(content, lang, this.cacheScope);
      if (cached) {
        return {
          replyText: cached,
          studentId: student.studentId,
          intent: intentResult.intent,
          language: lang,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // 10.9. Enforce tenant plan AI daily quota before outbound call
    if (this.planGuard) {
      const aiCheck = this.planGuard.checkFeature('ai');
      if (!aiCheck.allowed) {
        return {
          replyText: `⚠️ ${aiCheck.reason}`,
          studentId: student.studentId,
          intent: intentResult.intent,
          language: lang,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // 10.95. Isolated Zero-History Anti-Fraud Payment Receipt Verification (Business / Education images)
    let receiptOutcome: ReceiptVerificationOutcome | null = null;
    if (media?.type === 'image' && (this.tenantCategory === 'business' || this.tenantCategory === 'education')) {
      receiptOutcome = await inspectCustomerImageForPayment({
        ai: this.ai,
        memory: this.memory,
        media: { mimeType: media.mimeType, dataBase64: media.dataBase64 },
        chatId,
        senderPhone: chatId.split('@')[0].split(':')[0],
        businessName: customConfig?.businessName || this.ownerDisplayName || '',
        knowledgeBase: customConfig?.knowledgeBase || '',
        systemRole: customConfig?.systemRole || '',
      }).catch(() => null);

      if (receiptOutcome && receiptOutcome.classification !== 'non_receipt') {
        if (receiptOutcome.fraudCode !== 'DUPLICATE_SCREENSHOT' && receiptOutcome.parsed) {
          this.planGuard?.recordUsage('ai');
        }
        if (receiptOutcome.advisorGuidanceBlock) {
          enrichedPrompt = `${receiptOutcome.advisorGuidanceBlock}\n\n${enrichedPrompt}`;
        }
        if (this.memory.recordLead && (!this.planGuard || this.planGuard.checkFeature('leads').allowed)) {
          const p = receiptOutcome.parsed;
          const summary =
            receiptOutcome.classification === 'verified' && p
              ? `[VERIFIED] ${p.provider} Tix:${p.tix} — ${p.amount} ${p.currency} -> ${p.receiver_name || p.receiver_account || 'Store'}`
              : `[REJECTED:${receiptOutcome.fraudCode || 'INVALID'}] ${receiptOutcome.rejectionReasonSomali || 'Rasiid aan sax ahayn'}`;
          await this.memory.recordLead({
            chatId,
            senderName: effectiveUserName || '',
            senderPhone: chatId.split('@')[0].split(':')[0],
            category: receiptOutcome.classification === 'verified' ? 'payment_verified' : 'payment_rejected_fraud',
            summary,
          });
        }
      }
    }

    // 11. Call AI provider (with optional media attachment for voice/image/document)
    const aiResult = await this.ai.generateResponse(enrichedPrompt, aiHistory, {
      systemInstruction,
      studentId: student.studentId,
      maxOutputTokens: wantsVoice ? 2000 : 1000,
      media: media ? { mimeType: media.mimeType, dataBase64: media.dataBase64 } : undefined,
    });
    if (!aiResult.text.includes('Zero-Cost Safeguard') && !aiResult.text.includes('API key is missing')) {
      this.planGuard?.recordUsage('ai');
    }

    if (
      receiptOutcome?.classification === 'rejected' &&
      (aiResult.text.includes('Zero-Cost Safeguard') || aiResult.text.includes('API key is missing') || aiResult.text.includes('CARDOSO AI Error'))
    ) {
      aiResult.text = `⚠️ ${receiptOutcome.rejectionReasonSomali || 'Rasiidkan lama aqbalin. Fadlan soo dir rasiid sax ah oo aan horay loo isticmaalin.'}`;
    }

    // Extract voice transcript tag if provided, to store real user words into SQLite conversation memory
    let userTurnSavedContent = content;
    const transcriptMatch = aiResult.text.match(/<!--\s*transcript:\s*([\s\S]*?)-->/i);
    if (transcriptMatch) {
      const cleanTranscript = transcriptMatch[1].trim();
      if (cleanTranscript.length > 0 && !cleanTranscript.startsWith('[')) {
        userTurnSavedContent = `🎙️ "${cleanTranscript}"`;
      }
      aiResult.text = aiResult.text.replace(/<!--\s*transcript:\s*[\s\S]*?-->/gi, '').trim();
    }

    // Extract hidden lead/order/note tag if emitted by Business/Education/Personal away roles
    const rawLeadTag = aiResult.text.match(/<!--\s*lead:\s*([\s\S]*?)-->/i);
    if (rawLeadTag) {
      const inner = rawLeadTag[1].trim();
      let leadCat = 'lead';
      let leadSummary = inner;
      if (inner.startsWith('{')) {
        try {
          const parsed = JSON.parse(inner);
          leadCat = String(parsed.category || 'lead').trim().toLowerCase();
          leadSummary = String(parsed.summary || '').trim();
        } catch {}
      } else if (inner.includes('|')) {
        const idx = inner.indexOf('|');
        leadCat = inner.slice(0, idx).trim().toLowerCase() || 'lead';
        leadSummary = inner.slice(idx + 1).trim();
      }
      const isDuplicateReceiptLead =
        receiptOutcome &&
        receiptOutcome.classification !== 'non_receipt' &&
        (leadCat === 'payment_verified' || leadCat === 'payment_rejected_fraud');
      if (!isDuplicateReceiptLead && leadSummary && this.memory.recordLead && (!this.planGuard || this.planGuard.checkFeature('leads').allowed)) {
        await this.memory.recordLead({
          chatId,
          senderName: effectiveUserName || '',
          senderPhone: chatId.split('@')[0].split(':')[0],
          category: leadCat,
          summary: leadSummary,
        });
      }
      aiResult.text = aiResult.text.replace(/<!--\s*lead:\s*[\s\S]*?-->/gi, '').trim();
    }

    // Optional silence token handling from model output
    if (aiResult.text.includes('[SILENCE]') || aiResult.text.trim() === '[SILENCE]') {
      aiResult.text = '[SILENCE]';
    } else if (lang === 'so' || lang === 'mixed') {
      // Polish Somali / mixed replies: strip robotic openers and awkward translated phrasing
      aiResult.text = polishSomaliReply(aiResult.text);
    }

    // Store successful generic responses in scoped cache for subsequent users
    if (!media && ResponseCacheService.isCacheable(content) && aiResult.text.length > 15 && !aiResult.text.includes('Error') && aiResult.text !== '[SILENCE]') {
      ResponseCacheService.set(content, lang, aiResult.text, undefined, this.cacheScope);
    }

    // 11.4. Track opening phrase of bot reply to avoid repeating same openers per chat
    if (this.memory instanceof SQLiteStudentMemory && aiResult.text.length > 5) {
      // Extract first sentence / first 80 chars as the "phrase fingerprint"
      const firstPhrase = aiResult.text.split(/[.!?\n]/)[0]?.trim().slice(0, 80) || '';
      if (firstPhrase.length > 5) {
        this.memory.recordPhraseUsed(chatId, firstPhrase);
      }
    }

    // 11.5. Synthesize voice reply if user sent a voice note or explicitly requested voice.
    // Also respond with voice when user is replying in a group via voice (media.type === 'audio').
    let replyMedia: OutgoingMedia | undefined;

    if (wantsVoice && (!this.planGuard || this.planGuard.checkFeature('voice').allowed)) {
      console.log(`🎙️ [AdvisorEngine] Voice reply la doonayaa — synthesizing Somali/English TTS...`);
      try {
        const voiceResult = await VoiceReplyService.synthesizeVoice(aiResult.text, lang);
        if (voiceResult) {
          this.planGuard?.recordUsage('voice');
          replyMedia = {
            type: 'audio',
            dataBuffer: voiceResult.buffer,
            mimeType: voiceResult.mimeType || 'audio/mpeg',
            ptt: true,
          };
          console.log(`✅ [AdvisorEngine] Voice note (PTT Waveform) la diyaariyay — ${voiceResult.buffer.length} bytes`);
        }
      } catch (voiceErr) {
        console.warn('[AdvisorEngine] Voice synthesis error:', voiceErr);
      }
    }

    // 12. Save conversation turns to database memory
    // User turn is always saved (with audio transcription if available) to ensure complete conversation history
    await this.memory.saveMessage({
      studentId: student.studentId,
      chatId,
      role: 'user',
      content: userTurnSavedContent,
      languageDetected: lang,
      timestamp,
    });

    const isErrorOutput = aiResult.text.includes('CARDOSO AI Error') ||
      aiResult.text.includes('Gemini API request failed') ||
      aiResult.text.includes('Zero-Cost Safeguard');

    if (!isErrorOutput) {
      await this.memory.saveMessage({
        studentId: student.studentId,
        chatId,
        role: 'model',
        content: aiResult.text,
        languageDetected: lang,
        timestamp: Date.now(),
      });
    }

    return {
      replyText: aiResult.text,
      studentId: student.studentId,
      intent: intentResult.intent,
      language: lang,
      latencyMs: Date.now() - startTime,
      replyMedia,
    };
  }
}
