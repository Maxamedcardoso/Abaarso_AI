import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
} catch (e) {
  console.warn('[VoiceReply] FFmpeg initialization notice:', e);
}

export type SomaliVoiceSpeaker = 'muuse' | 'ubax';

export interface DialogueTurn {
  speaker: SomaliVoiceSpeaker;
  text: string;
  pauseAfterMs?: number;
}

export const DEFAULT_CARDOSO_PROMO_DIALOGUE: DialogueTurn[] = [
  {
    speaker: 'ubax',
    text: 'Assalaamu calaykum Muuse! War ma maqashay barnaamijka cusub ee dadkoo dhan maanta ka hadlayaan ee la dhaho CARDOSO AI?',
    pauseAfterMs: 320,
  },
  {
    speaker: 'muuse',
    text: 'Wa calaykumus salaam Ubax! Haa walaal, aad baan u maqlay, xataa anigaa maalin kasta isticmaala. Waa kaaliye casri ah oo Af-Soomaali dabiici ah ku hadla.',
    pauseAfterMs: 320,
  },
  {
    speaker: 'ubax',
    text: 'Alla! Oo muxuu qabtaa? Ma qoraal kaliya ayuu kaga jawaabaa su aalaha?',
    pauseAfterMs: 280,
  },
  {
    speaker: 'muuse',
    text: 'Maya Ubax, waxyaabo cajiib ah ayuu qabtaa! Su aal kasta oo waxbarasho, ganacsi, ama barashada koodhka ah ayuu Af-Soomaali fudud kuugu sharxaa. Waxaa intaa dheer, sawirro cusub ayuu kuu sameeyaa, cod Soomaali ah ayuu kuugu hadlaa, waqtiga salaaddana wuu ku xasuusiyaa!',
    pauseAfterMs: 350,
  },
  {
    speaker: 'ubax',
    text: 'Masha Allaah! Oo ma WhatsApp kaliya ayaa laga isticmaalaa mise App u gaar ah ayuu leeyahay?',
    pauseAfterMs: 300,
  },
  {
    speaker: 'muuse',
    text: 'Labadaba! Waxaad toos ugala sheekeysan kartaa WhatsApp, sidoo kalena wuxuu leeyahay App casri ah oo aad telefoonkaaga ku install gareysan karto, iyadoo ganacsatadu iyo ardayduba ay ku maamulan karaan adeegyadooda.',
    pauseAfterMs: 340,
  },
  {
    speaker: 'ubax',
    text: 'Waa wax lala yaabo runtii! Haddii qofku rabo inuu Views-ka WhatsApp Status-kiisa kordhiyo ama ganacsigiisa xayeysiiyana maxaa u yaalla?',
    pauseAfterMs: 300,
  },
  {
    speaker: 'muuse',
    text: 'CARDOSO AI wuxuu leeyahay qaybta Views Hub oo hal gujis dadku isku kaydsan karaan iyadoo aan wax spam ah ama ban ah jirin, ganacsatadana boosas gaar ah oo VIP ah ayaa u diyaar ah!',
    pauseAfterMs: 340,
  },
  {
    speaker: 'ubax',
    text: 'Hadda ayaan tijaabinayaa aniguba! Asxaabey, adinkuna ha moogaanina CARDOSO AI — barasho, ganacsi, iyo horumar hal meel ku wada jira!',
    pauseAfterMs: 280,
  },
  {
    speaker: 'muuse',
    text: 'Ku soo dhawaada CARDOSO AI! Nabad gelyo!',
    pauseAfterMs: 0,
  },
];

export interface PodcastSynthesisResult {
  buffer: Buffer;
  mimeType: string;
  turnCount: number;
  seconds: number;
  waveform: Uint8Array;
}

/**
 * Parses exact audio duration (in seconds) from an Ogg Opus buffer by reading
 * the 64-bit little-endian granule position from the final OggS page (Opus = 48kHz).
 */
export function getOggOpusDurationSeconds(buffer: Buffer): number {
  if (!buffer || buffer.length < 32) return 1;
  // Scan backwards for the last "OggS" page capture pattern
  for (let i = buffer.length - 14; i >= 0; i--) {
    if (
      buffer[i] === 0x4f && // O
      buffer[i + 1] === 0x67 && // g
      buffer[i + 2] === 0x67 && // g
      buffer[i + 3] === 0x53 // S
    ) {
      const low = buffer.readUInt32LE(i + 6);
      const high = buffer.readUInt32LE(i + 10);
      // Skip invalid -1 granule position (0xFFFFFFFFFFFFFFFF)
      if (low === 0xffffffff && high === 0xffffffff) continue;
      const granule = high * 4294967296 + low;
      if (granule > 0) {
        return Math.max(1, Math.round(granule / 48000));
      }
    }
  }
  // Safe bitrate estimate fallback (~48kbps = 6000 bytes/sec)
  return Math.max(1, Math.round(buffer.length / 6000));
}

/**
 * Builds a realistic 64-bar WhatsApp PTT Voice Note waveform (values 0..100)
 * sampled deterministically from the encoded audio buffer so Android & iOS
 * render an authentic playable Voice Note bubble.
 */
export function generateSpeechWaveform(buffer: Buffer): Uint8Array {
  const bars = new Uint8Array(64);
  if (!buffer || buffer.length < 64) {
    bars.fill(35);
    return bars;
  }
  const chunkSize = Math.max(1, Math.floor(buffer.length / 64));
  for (let i = 0; i < 64; i++) {
    const start = i * chunkSize;
    let acc = 0;
    const sampleCount = Math.min(chunkSize, 48);
    for (let j = 0; j < sampleCount; j++) {
      acc += Math.abs(buffer[start + j] - 128);
    }
    const avg = acc / sampleCount; // 0..128
    // Shape into natural speech envelope (fade edges slightly, lively mid peaks 18..94)
    const edgeFactor = i < 2 || i > 61 ? 0.55 : 1.0;
    const wave = Math.round((20 + (avg / 128) * 76) * edgeFactor);
    bars[i] = Math.max(10, Math.min(96, wave));
  }
  return bars;
}

/**
 * VoiceReplyService — Synthesizes natural, high-definition speech for WhatsApp Voice Notes
 * using Microsoft Edge Neural TTS (100% Free, No API Key, No Quota Limits).
 *
 * Supports:
 * - Somali Male: "so-SO-MuuseNeural" (warm, expressive native Somali male voice)
 * - Somali Female: "so-SO-UbaxNeural" (clear, friendly native Somali female voice)
 * - English: "en-US-ChristopherNeural" (clear, professional English voice)
 */
export class VoiceReplyService {
  private static cachedPromoOgg: PodcastSynthesisResult | null = null;
  /**
   * Cleans WhatsApp markdown and normalizes abbreviations, slangs, symbols,
   * and tech terms into natural phonetic speech for Edge Neural TTS.
   */
  public static cleanTextForSpeech(text: string, language: string = 'so'): string {
    let clean = text
      // Remove URLs
      .replace(/https?:\/\/\S+/gi, '')
      // Remove asterisks, underscores, tildes, backticks (WhatsApp formatting)
      .replace(/[*_~`]/g, '')
      // Remove emojis
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      // Clean leading bullet points with a comma so speech breathes naturally
      .replace(/^[•\-\*]\s+/gm, ', ')
      // Clean repetitive exclamation/question marks
      .replace(/[!]{2,}/g, '!')
      .replace(/[?]{2,}/g, '?');

    if (language === 'so' || language === 'mixed') {
      // 1. Expand Islamic & greeting abbreviations into full natural spoken words (as requested: asc, wcs -> full natural speech)
      clean = clean
        .replace(/\basc\b/gi, 'Assalaamu calaykum')
        .replace(/\bwcs\b/gi, 'Wa calaykumus salaam')
        .replace(/\bsc\b/gi, 'Salaamu calaykum')
        .replace(/\binsha\s*allah\b|\binshallah\b/gi, 'Insha Allaah')
        .replace(/\bmasha\s*allah\b|\bmashallah\b/gi, 'Maa shaa Allaah')
        .replace(/\balx\b/gi, 'Alxamdulillaah')
        .replace(/\bswt\b/gi, 'Subxaanahu wa tacaalaa')
        .replace(/\bcsw\b|\bsaw\b/gi, 'Calayhi salaatu wa salaam');

      // 2. Expand common Somali chat abbreviations
      clean = clean
        .replace(/\bsxb\b/gi, 'saaxiib')
        .replace(/\bsxbo\b/gi, 'saaxiibow')
        .replace(/\bwll\b|\bwlo\b/gi, 'walaal')
        .replace(/\bmcaan\b/gi, 'macaan')
        .replace(/\bpls\b|\bplz\b/gi, 'fadlan')
        .replace(/\btnx\b|\bthx\b/gi, 'mahadsanid');

      // 3. Phonetic pronunciation for tech and bot brand terms so Edge TTS sounds natural
      clean = clean
        .replace(/\bcardoso\s+ai\b/gi, 'Kaardooso Ey-Ay')
        .replace(/\bcardoso\b/gi, 'Kaardooso')
        .replace(/\bai\b/g, 'Ey-Ay')
        .replace(/\bapi\b/gi, 'Ey-Bii-Ay')
        .replace(/\burl\b/gi, 'Yu-Aar-El')
        .replace(/\bwhatsapp\b/gi, 'Watsap')
        .replace(/\bchatgpt\b/gi, 'Jaat-Jii-Bii-Tii')
        .replace(/\bpdf\b/gi, 'Bii-Dii-Ef')
        .replace(/\bmp3\b/gi, 'Em-Bii-Tharii');

      // 3b. Phonetic pronunciation for English degree program names so Somali Neural TTS pronounces them clearly
      clean = clean
        .replace(/\bsoftware\s+engineering\b/gi, 'Softweer Injineering')
        .replace(/\bclinical\s+nursing\b/gi, 'Klinikal Narsing')
        .replace(/\bmidwifery\b/gi, 'Mid-wifari')
        .replace(/\bmedical\s+laboratory\s+sciences\b/gi, 'Medikal Laboratori Saayansis')
        .replace(/\bmedical\s+laboratory\b/gi, 'Medikal Laboratori')
        .replace(/\bnutrition\s+and\s+food\s+sciences\b/gi, 'Nuutrishan and Fuud Saayansis')
        .replace(/\baccounting\s+and\s+finance\b/gi, 'Akaawnting and Faynaans')
        .replace(/\bbusiness\s+administration\b/gi, 'Biznis Administreeshan')
        .replace(/\bhuman\s+resource\s+management\b/gi, 'Hyuuman Risoors Maneejment')
        .replace(/\bislamic\s+banking\s+and\s+finance\b/gi, 'Islaamik Baanking and Faynaans')
        .replace(/\binformation\s+and\s+communications\s+technologies\b/gi, 'Infarmeeshan and Komyunikeeshans Teknolojis')
        .replace(/\blogistics\s+and\s+procurement\b/gi, 'Lojistiks and Prokyuurment')
        .replace(/\bbusiness\s+management\s+and\s+economics\b/gi, 'Biznis Maneejment and Ikonoomiks')
        .replace(/\bdevelopment\s+studies\b/gi, 'Divalobment Stadiis')
        .replace(/\bsocial\s+work\b/gi, 'Sooshal Wark')
        .replace(/\blaw\b/gi, 'Loo');

      // 4. Symbols to words
      clean = clean
        .replace(/&/g, ' iyo ')
        .replace(/%/g, ' boqolkiiba ')
        .replace(/\$/g, ' doolar ')
        .replace(/\+/g, ' iyo ');
    } else if (language === 'ar') {
      clean = clean
        .replace(/\bAI\b/gi, 'الذكاء الاصطناعي')
        .replace(/\bCARDOSO\b/gi, 'كاردوسو');
    }

    // Collapse multiple newlines/spaces
    clean = clean.replace(/\s+/g, ' ').trim();

    // Allow comprehensive, full-length voice explanations as requested by user.
    // Up to 4,000 characters allows natural 4-6 minute in-depth voice notes without artificial cutoff.
    if (clean.length > 4000) {
      const sentenceEnd = clean.slice(0, 4000).lastIndexOf('.');
      if (sentenceEnd > 2500) {
        clean = clean.slice(0, sentenceEnd + 1);
      } else {
        clean = clean.slice(0, 4000) + '...';
      }
    }

    return clean;
  }

  /**
   * Synthesizes audio buffer from text with automatic retry for 100% zero-error resilience.
   * Returns audio MP3 buffer or null on error.
   */
  public static async synthesizeVoice(text: string, language: string = 'so'): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const clean = this.cleanTextForSpeech(text, language);
    if (!clean) return null;

    // Select the best native Edge Neural TTS voice for the detected language
    let voiceName = 'so-SO-MuuseNeural'; // Default: Somali
    if (language === 'en') {
      voiceName = 'en-US-ChristopherNeural'; // English
    } else if (language === 'ar') {
      voiceName = 'ar-SA-HamedNeural'; // Arabic
    } else if (language === 'fr') {
      voiceName = 'fr-FR-HenriNeural'; // French
    } else if (language === 'tr') {
      voiceName = 'tr-TR-AhmetNeural'; // Turkish
    }

    // Try up to 2 attempts for 100% zero-error reliability against transient network glitches
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.synthesizeSingleAttempt(clean, voiceName, language);
        if (result && result.buffer.length > 0) {
          // Convert MP3 to WhatsApp-native Ogg Opus container ("OggS" header).
          // WhatsApp PTT (Voice Note) player strictly requires Ogg Opus to render waveforms and play without "This audio is not available" error.
          const opusBuffer = await this.convertMp3ToOggOpus(result.buffer);
          const isOggOpus = opusBuffer.slice(0, 4).toString() === 'OggS';
          return {
            buffer: opusBuffer,
            mimeType: isOggOpus ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
          };
        }
      } catch (err) {
        console.warn(`[VoiceReply] Attempt ${attempt} failed:`, err);
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
    return null;
  }

  /**
   * Synthesizes a native MP3 buffer (audio/mpeg) directly from Edge Neural TTS for the
   * installable Web/PWA App. Skips Ogg Opus transcoding so playback is faster and works
   * reliably across iPhone Safari, Android Chrome, Windows Edge, and macOS.
   */
  public static async synthesizeMp3ForWeb(text: string, language: string = 'so'): Promise<{ buffer: Buffer; mimeType: 'audio/mpeg' } | null> {
    const clean = this.cleanTextForSpeech(text, language);
    if (!clean) return null;

    let voiceName = 'so-SO-MuuseNeural';
    let speechLang = language;
    if (language === 'so_female' || language === 'ubax') {
      voiceName = 'so-SO-UbaxNeural';
      speechLang = 'so';
    } else if (language === 'en') {
      voiceName = 'en-US-ChristopherNeural';
    } else if (language === 'ar') {
      voiceName = 'ar-SA-HamedNeural';
    } else if (language === 'fr') {
      voiceName = 'fr-FR-HenriNeural';
    } else if (language === 'tr') {
      voiceName = 'tr-TR-AhmetNeural';
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.synthesizeSingleAttempt(clean, voiceName, speechLang);
        if (result && result.buffer.length > 0) {
          return { buffer: result.buffer, mimeType: 'audio/mpeg' };
        }
      } catch (err) {
        console.warn(`[VoiceReply] Web MP3 attempt ${attempt} failed:`, err);
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 350));
        }
      }
    }
    return null;
  }

  /**
   * Parses human-written dialogue lines like:
   *   Ubax: Assalaamu calaykum Muuse!
   *   Muuse: Wa calaykumus salaam Ubax!
   */
  public static parseDialogueScript(rawScript: string): DialogueTurn[] {
    const lines = String(rawScript || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const turns: DialogueTurn[] = [];
    let nextAutoSpeaker: SomaliVoiceSpeaker = 'ubax';

    for (const line of lines) {
      const m = line.match(/^(muuse|ubax|gabadh|wiil|female|male|girl|boy)\s*[:\-–]\s*(.+)$/i);
      if (m) {
        const rawSpk = m[1].toLowerCase();
        const speaker: SomaliVoiceSpeaker =
          rawSpk === 'ubax' || rawSpk === 'gabadh' || rawSpk === 'female' || rawSpk === 'girl'
            ? 'ubax'
            : 'muuse';
        const text = m[2].trim();
        if (text) {
          turns.push({ speaker, text });
          nextAutoSpeaker = speaker === 'ubax' ? 'muuse' : 'ubax';
        }
      } else {
        turns.push({ speaker: nextAutoSpeaker, text: line });
        nextAutoSpeaker = nextAutoSpeaker === 'ubax' ? 'muuse' : 'ubax';
      }
    }
    return turns.slice(0, 24);
  }

  /**
   * Returns true if the text already looks like an explicit multi-speaker script
   * (e.g. "Ubax: ... \n Muuse: ..."), versus a topic/title like "faa'iidada waxbarashada".
   */
  public static isExplicitDialogueScript(rawText: string): boolean {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    const labeledLines = lines.filter((l) =>
      /^(muuse|ubax|gabadh|wiil|female|male|girl|boy)\s*[:\-–]\s*.+/i.test(l)
    );
    return labeledLines.length >= 2;
  }

  /**
   * Generates a natural, crystal-clear Somali podcast conversation between Ubax (female)
   * and Muuse (male) about ANY given topic/title using Gemini AI (with a high-quality
   * zero-failure Somali template fallback if AI quota is unavailable).
   */
  public static async generateTopicDialogueTurns(
    topic: string,
    ai?: { generateResponse: (prompt: string, history?: any[], options?: any) => Promise<{ text: string }> }
  ): Promise<DialogueTurn[]> {
    const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    if (!cleanTopic) return DEFAULT_CARDOSO_PROMO_DIALOGUE;

    if (ai && typeof ai.generateResponse === 'function') {
      const systemInstruction = `Waxaad tahay qoraa sare oo Somali Podcast / Radio Dialogue ah.
Qor wada-sheekeysi dabiici ah, aad u cad, xiiso leh, oo u dhexeeya LABA QOF oo Soomaali ah:
- Ubax (Gabadh furfuran, su'aalo caqli leh weydiisa, ereyo diirran adeegsata)
- Muuse (Wiil aqoonyahan ah, deggan, si fudud oo cad u sharxa mawduuca)

XEERARKA ADAG (WAA WAAJIB):
1. Qor 8 ilaa 10 sadar oo is-daba-joog ah oo ku bilaabma KELIYA "Ubax: " ama "Muuse: ".
2. Af-Soomaali saafi ah oo aad u cad qor, sida laba qof oo dhab ahaan u wada sheekeysanaya (tusaale: "Assalaamu calaykum Muuse!", "Wa calaykumus salaam Ubax!", "Runtii taasi waa qodob muhiim ah!", "Bal si fudud iigu sharax...", "Masha Allaah!").
3. HA ISTICMAALIN emojis, xiddigo (*), hashtags (#), qawsyo ([]), ama calaamado qoraal qaldan — sababtoo ah cod toos ah (Neural TTS) ayaa akhrinaya!
4. Sadar kasta ha ahaado 1 ilaa 2 jumladood oo fudud oo si macaan loogu dhawaaqi karo (wadarta dhan ~55-75 ilbiriqsi oo dhageysi ah).
5. Ku soo gabagabee dhiirigelin qurux badan iyo nabad-gelyo diirran.
6. Ha qorin wax hordhac ah ama sharraxaad bannaanka ah — toos u qor sadarrada Ubax: iyo Muuse: oo keliya!`;

      try {
        const result = await ai.generateResponse(
          `Mawduuca Podcast-ka maanta waa: "${cleanTopic}". Fadlan qor wada-sheekeysiga Ubax iyo Muuse oo si qurux badan oo cad u sharxaya mawduucan.`,
          [],
          { systemInstruction, temperature: 0.78, maxOutputTokens: 950 }
        );
        const rawOut = String(result?.text || '').trim();
        const isErrorMsg =
          !rawOut ||
          rawOut.includes('Zero-Cost Safeguard') ||
          rawOut.includes('No AI provider is active') ||
          rawOut.includes('CARDOSO AI Error') ||
          rawOut.includes('Gemini API request failed');

        if (!isErrorMsg) {
          const parsed = this.parseDialogueScript(rawOut).filter((t) => t.text.length >= 6);
          if (parsed.length >= 4) {
            return parsed.slice(0, 12);
          }
        }
      } catch (err: any) {
        console.warn(`[VoiceReply] AI topic dialogue fallback for "${cleanTopic}":`, err?.message || err);
      }
    }

    // High-quality natural Somali conversational fallback (always works even offline/zero quota!)
    return [
      {
        speaker: 'ubax',
        text: `Assalaamu calaykum Muuse! Maanta waxaan rabaa inaan ka wada hadalno mawduuc aad u muhiim ah oo ah ${cleanTopic}. Bal maxaad nooga sheegi kartaa?`,
        pauseAfterMs: 320,
      },
      {
        speaker: 'muuse',
        text: `Wa calaykumus salaam Ubax! Runtii ${cleanTopic} waa mawduuc qiimo weyn leh oo maanta dad badan ay danaynayaan inay si fiican u fahmaan.`,
        pauseAfterMs: 320,
      },
      {
        speaker: 'ubax',
        text: `Haa walaal, dad badan baa is weydiiya halka ugu wanaagsan ee laga bilaabo marka la rabo in guul laga gaaro ${cleanTopic}. Adigu maxaad kula talin lahayd?`,
        pauseAfterMs: 300,
      },
      {
        speaker: 'muuse',
        text: `Tallaabada ugu horreysa waa qorshe cad, joogteyn, iyo in qofku si dhab ah u barto aasaaska ${cleanTopic}. Markaad maalin kasta wax yar ku darto, natiijo weyn ayaad gaaraysaa.`,
        pauseAfterMs: 340,
      },
      {
        speaker: 'ubax',
        text: `Masha Allaah! Taasi waa talo aad u qurux badan oo qof walba anfici karta. Mahadsanid Muuse sharraxaaddaada cad!`,
        pauseAfterMs: 280,
      },
      {
        speaker: 'muuse',
        text: `Adigaa mudan Ubax! Dhageystayaasha sharafta lehna waxaan u rajaynaynaa horumar iyo guul wacan. Nabad gelyo!`,
        pauseAfterMs: 0,
      },
    ];
  }

  /**
   * Returns the official CARDOSO AI Promo Voice Note (Muuse & Ubax) as a verified WhatsApp OGG Opus PTT.
   * Uses in-memory cache or pre-generated assets/audio file for instant <1s delivery, falling back to live synthesis.
   */
  public static async getCardosoPromoVoiceNote(): Promise<PodcastSynthesisResult | null> {
    if (this.cachedPromoOgg && this.cachedPromoOgg.buffer.length > 256) {
      return this.cachedPromoOgg;
    }

    const prebuiltPath = path.join(process.cwd(), 'assets', 'audio', 'cardoso-ai-muuse-ubax-promo.ogg');
    try {
      if (fs.existsSync(prebuiltPath)) {
        const buf = await fs.promises.readFile(prebuiltPath);
        if (buf.length > 256 && buf.slice(0, 4).toString('ascii') === 'OggS') {
          this.cachedPromoOgg = {
            buffer: buf,
            mimeType: 'audio/ogg; codecs=opus',
            turnCount: DEFAULT_CARDOSO_PROMO_DIALOGUE.length,
            seconds: getOggOpusDurationSeconds(buf),
            waveform: generateSpeechWaveform(buf),
          };
          return this.cachedPromoOgg;
        }
      }
    } catch { }

    const live = await this.synthesizeSomaliDialogue(DEFAULT_CARDOSO_PROMO_DIALOGUE, {
      outputFormat: 'ogg',
      defaultPauseMs: 300,
    });
    if (live) {
      this.cachedPromoOgg = live;
    }
    return live;
  }

  /**
   * Synthesizes a multi-speaker Somali conversation between Muuse (so-SO-MuuseNeural)
   * and Ubax (so-SO-UbaxNeural) merged seamlessly into ONE studio MP3 or WhatsApp Ogg Opus Voice Note!
   */
  public static async synthesizeSomaliDialogue(
    turns: DialogueTurn[],
    options?: { outputFormat?: 'mp3' | 'ogg'; defaultPauseMs?: number }
  ): Promise<PodcastSynthesisResult | null> {
    const validTurns = (turns || [])
      .map((t) => ({
        speaker: (t.speaker === 'ubax' ? 'ubax' : 'muuse') as SomaliVoiceSpeaker,
        text: this.cleanTextForSpeech(String(t.text || ''), 'so'),
        pauseAfterMs: t.pauseAfterMs,
      }))
      .filter((t) => t.text.length > 0)
      .slice(0, 24);

    if (validTurns.length === 0) return null;

    const outputFormat = options?.outputFormat === 'ogg' ? 'ogg' : 'mp3';
    const defaultPauseMs = Math.max(0, Math.min(1500, options?.defaultPauseMs ?? 300));
    const tmpBase = `cardoso_podcast_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tempFiles: string[] = [];
    const outPath = path.join(os.tmpdir(), `${tmpBase}_final.${outputFormat}`);

    try {
      // 1. Synthesize each dialogue turn using Muuse or Ubax Neural voice
      const segmentPaths: Array<{ filePath: string; pauseSec: number }> = [];
      for (let i = 0; i < validTurns.length; i++) {
        const turn = validTurns[i];
        const voiceName = turn.speaker === 'ubax' ? 'so-SO-UbaxNeural' : 'so-SO-MuuseNeural';
        let audioBuf: Buffer | null = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
          const res = await this.synthesizeSingleAttempt(turn.text, voiceName, 'so');
          if (res && res.buffer.length > 0) {
            audioBuf = res.buffer;
            break;
          }
          if (attempt === 1) await new Promise((r) => setTimeout(r, 350));
        }

        if (!audioBuf || audioBuf.length === 0) {
          throw new Error(`Codka qaybta #${i + 1} (${turn.speaker}) lama samayn karin`);
        }

        const segPath = path.join(os.tmpdir(), `${tmpBase}_seg_${i}.mp3`);
        await fs.promises.writeFile(segPath, audioBuf);
        tempFiles.push(segPath);
        const pauseMs = i === validTurns.length - 1 ? 0 : (turn.pauseAfterMs ?? defaultPauseMs);
        segmentPaths.push({ filePath: segPath, pauseSec: Math.max(0, pauseMs) / 1000 });
      }

      // 2. Stitch all segments cleanly with natural silent WAV pauses (100% compatible across all FFmpeg versions!)
      const createSilentWav = (durationMs: number, sampleRate: number = 48000): Buffer => {
        const numSamples = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
        const dataSize = numSamples * 2; // 16-bit mono PCM
        const buf = Buffer.alloc(44 + dataSize);
        buf.write('RIFF', 0);
        buf.writeUInt32LE(36 + dataSize, 4);
        buf.write('WAVE', 8);
        buf.write('fmt ', 12);
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20); // PCM
        buf.writeUInt16LE(1, 22); // Mono
        buf.writeUInt32LE(sampleRate, 24);
        buf.writeUInt32LE(sampleRate * 2, 28);
        buf.writeUInt16LE(2, 32);
        buf.writeUInt16LE(16, 34);
        buf.write('data', 36);
        buf.writeUInt32LE(dataSize, 40);
        return buf;
      };

      const orderedInputs: string[] = [];
      for (let i = 0; i < segmentPaths.length; i++) {
        const seg = segmentPaths[i];
        orderedInputs.push(seg.filePath);
        if (seg.pauseSec > 0.02) {
          const silPath = path.join(os.tmpdir(), `${tmpBase}_sil_${i}.wav`);
          await fs.promises.writeFile(silPath, createSilentWav(Math.round(seg.pauseSec * 1000)));
          tempFiles.push(silPath);
          orderedInputs.push(silPath);
        }
      }

      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg();
        for (const inp of orderedInputs) {
          cmd.input(inp);
        }

        const filterParts: string[] = [];
        const concatInputs: string[] = [];
        for (let i = 0; i < orderedInputs.length; i++) {
          const label = `a${i}`;
          filterParts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono[${label}]`);
          concatInputs.push(`[${label}]`);
        }
        filterParts.push(`${concatInputs.join('')}concat=n=${orderedInputs.length}:v=0:a=1[outa]`);

        cmd.complexFilter(filterParts, 'outa');

        if (outputFormat === 'ogg') {
          cmd
            .noVideo()
            .audioCodec('libopus')
            .audioBitrate('48k')
            .audioFrequency(48000)
            .audioChannels(1)
            .outputOptions(['-application', 'voip', '-vbr', 'on'])
            .format('ogg');
        } else {
          cmd
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('96k')
            .audioFrequency(44100)
            .audioChannels(1)
            .format('mp3');
        }

        cmd
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outPath);
      });

      let finalBuf: Buffer = await fs.promises.readFile(outPath);
      if (!finalBuf || finalBuf.length < 256) {
        throw new Error('Faylka podcast-ka ee la isku daray wuu madhan yahay');
      }

      if (outputFormat === 'ogg' && finalBuf.slice(0, 4).toString('ascii') !== 'OggS') {
        finalBuf = await this.convertMediaToOggOpusStrict(finalBuf);
      }

      const seconds =
        outputFormat === 'ogg'
          ? getOggOpusDurationSeconds(finalBuf)
          : Math.max(1, Math.round(finalBuf.length / 12000));

      return {
        buffer: finalBuf,
        mimeType: outputFormat === 'ogg' ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
        turnCount: segmentPaths.length,
        seconds,
        waveform: generateSpeechWaveform(finalBuf),
      };
    } finally {
      for (const f of tempFiles) {
        await fs.promises.unlink(f).catch(() => { });
      }
      await fs.promises.unlink(outPath).catch(() => { });
    }
  }

  public static getFfmpegPath(): string | undefined {
    return ffmpegInstaller?.path || undefined;
  }

  /**
   * Converts ANY audio or video buffer (MP3, MP4, M4A, WEBM, WAV, AAC, FLAC, MKV, OGG)
   * into a strictly validated WhatsApp-native Ogg Opus buffer ("OggS" magic header).
   * Uses seekable temp files so MP4/M4A containers with trailing moov atoms NEVER fail!
   */
  public static async convertMediaToOggOpusStrict(inputBuffer: Buffer): Promise<Buffer> {
    if (!inputBuffer || inputBuffer.length === 0) {
      throw new Error('Faylka codka/muuqaalka waa faaruq (0 bytes)');
    }

    const tmpId = `cardoso_media_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const inPath = path.join(os.tmpdir(), `${tmpId}.input`);
    const outPath = path.join(os.tmpdir(), `${tmpId}.ogg`);

    try {
      await fs.promises.writeFile(inPath, inputBuffer);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inPath)
          .noVideo()
          .audioCodec('libopus')
          .audioBitrate('48k')
          .audioFrequency(48000)
          .audioChannels(1)
          .outputOptions(['-application', 'voip', '-vbr', 'on'])
          .format('ogg')
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outPath);
      });

      const outBuf = await fs.promises.readFile(outPath);
      if (!outBuf || outBuf.length < 32 || outBuf.slice(0, 4).toString('ascii') !== 'OggS') {
        throw new Error('FFmpeg ma soo saarin fayl OGG Opus sax ah');
      }
      return outBuf;
    } finally {
      await fs.promises.unlink(inPath).catch(() => { });
      await fs.promises.unlink(outPath).catch(() => { });
    }
  }

  /**
   * Converts an audio/video buffer to WhatsApp-native Ogg Opus format.
   * WhatsApp PTT (Voice Note) player strictly requires Ogg Opus container ("OggS" header).
   * Falls back to original buffer only if FFmpeg is unavailable (for TTS compatibility).
   */
  public static async convertMp3ToOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
    try {
      return await VoiceReplyService.convertMediaToOggOpusStrict(mp3Buffer);
    } catch (err: any) {
      console.warn('[VoiceReply] FFmpeg Opus conversion error:', err?.message || err);
      return mp3Buffer;
    }
  }

  private static synthesizeSingleAttempt(clean: string, voiceName: string, language: string = 'so'): Promise<{ buffer: Buffer; mimeType: string } | null> {
    return new Promise((resolve) => {
      const tts = new MsEdgeTTS();
      let isResolved = false;

      // 60-second timeout per attempt to allow full-length extended voice notes to stream completely
      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try { tts.close(); } catch { }
          resolve(null);
        }
      }, 60000);

      (async () => {
        try {
          await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
          const { audioStream } = tts.toStream(clean, {
            rate: language === 'so' ? '-4%' : '-2%',
            pitch: '+0Hz',
          });

          const chunks: Buffer[] = [];
          audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));

          audioStream.on('end', () => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              try { tts.close(); } catch { }
              const buffer = Buffer.concat(chunks);
              resolve({ buffer, mimeType: 'audio/mpeg' });
            }
          });

          audioStream.on('error', (err) => {
            console.warn('[VoiceReply] audioStream error:', err);
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              try { tts.close(); } catch { }
              resolve(null);
            }
          });
        } catch (err) {
          console.warn('[VoiceReply] Failed to synthesize voice:', err);
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            try { tts.close(); } catch { }
            resolve(null);
          }
        }
      })();
    });
  }
}

