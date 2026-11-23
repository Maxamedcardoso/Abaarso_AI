import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  HumanMixSegment,
  decodeTrimmedMonoPcm48k,
  encodeMasteredPodcastAudio,
  masterHumanVoiceReplyToOggOpus,
  mixHumanPodcastTimeline,
  renderPodcastVideoAudiogram,
} from './podcast-studio.service.js';

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
} catch (e) {
  console.warn('[VoiceReply] FFmpeg initialization notice:', e);
}

export type SomaliVoiceSpeaker = 'mohamed' | 'safa' | 'muuse' | 'ubax';
export type CanonicalPodcastSpeaker = 'mohamed' | 'safa';
export type PodcastStyle = 'debate' | 'study' | 'story' | 'ad' | 'diini';
export type PodcastEmotion = 'neutral' | 'laugh' | 'debate' | 'excited' | 'calm' | 'whisper' | 'backchannel';
export type PodcastSoundMode = 'chime' | 'ambient' | 'clean';

export interface DialogueTurn {
  speaker: SomaliVoiceSpeaker;
  text: string;
  emotion?: PodcastEmotion;
  pauseAfterMs?: number;
}

export interface ParsedPodcastCommand {
  topic: string;
  style: PodcastStyle;
  durationMinutes: number;
  outputKind: 'ogg' | 'video';
  soundMode: PodcastSoundMode;
  postToStatus?: boolean;
  sourceUrl?: string;
  isHelp?: boolean;
}

export const PODCAST_STYLE_LABELS: Record<PodcastStyle, string> = {
  debate: '🔥 Dood Kulul & Kala Aragti Duwanaan',
  study: '📚 Cashar & Su\'aal-Jawaab',
  story: '📖 Sheeko & Falanqayn Macaan',
  ad: '📢 Xayeysiis Radio Commercial',
  diini: '🕌 Wacdi & Aqoon Diini ah (Cod Saafi ah)',
};

export function normalizePodcastSpeaker(speaker: string): CanonicalPodcastSpeaker {
  const s = String(speaker || '').trim().toLowerCase();
  if (s === 'safa' || s === 'ubax' || s === 'gabadh' || s === 'female' || s === 'girl') {
    return 'safa';
  }
  return 'mohamed';
}

export const DEFAULT_CARDOSO_PROMO_DIALOGUE: DialogueTurn[] = [
  {
    speaker: 'safa',
    emotion: 'excited',
    text: 'Assalaamu calaykum Mohamed! War maanta dadkoo dhan waxay hadal hayaan CARDOSO AI — adigana ma ogtahay inaan markii hore u haystay inuu yahay bot caadi ah oo qoraal keliya jawaaba?',
    pauseAfterMs: 170,
  },
  {
    speaker: 'mohamed',
    emotion: 'laugh',
    text: 'Wa calaykumus salaam Safa! Haa-haa, taasi waa qaladkii dad badan galeen! Maya walaal, CARDOSO AI waa kaaliye casri ah oo Af-Soomaali dabiici ah kula sheekeysta sida qof kula fadhiya.',
    pauseAfterMs: 150,
  },
  {
    speaker: 'safa',
    emotion: 'debate',
    text: 'Sug sug Mohamed, ha igu buunbuunin! Bal i tusi waxa uu kaga duwan yahay barnaamijyada kale ee caalamiga ah?',
    pauseAfterMs: 140,
  },
  {
    speaker: 'mohamed',
    emotion: 'debate',
    text: 'Wallaahi farqi weyn baa jira Safa! Marka hore, Af-Soomaaliga ayuu si qoto dheer u fahmaa oo cod cad kuugu hadlaa. Marka labaad, ardayda wuxuu u sharxaa casharrada iyo koodhka, sawirro casri ah ayuu kuu curiyaa, waqtiga salaaddana wuu ku xasuusiyaa!',
    pauseAfterMs: 180,
  },
  {
    speaker: 'safa',
    emotion: 'backchannel',
    text: 'Haa-haa, run miyaa? Oo ma WhatsApp keliya baa laga helaa?',
    pauseAfterMs: 130,
  },
  {
    speaker: 'mohamed',
    emotion: 'excited',
    text: 'Maya! Labadaba — WhatsApp-kaaga ayuu toos uga shaqeeyaa, sidoo kalena wuxuu leeyahay App casri ah oo telefoonkaaga lagu install gareysto, ganacsatadana Views Hub iyo macmiil-maamul diyaar ah ayaa u yaalla!',
    pauseAfterMs: 180,
  },
  {
    speaker: 'safa',
    emotion: 'laugh',
    text: 'Wallaahi waad i qancisay Mohamed! Hadda aniguba waan tijaabinayaa. Asxaabey, adinkuna ha moogaanina CARDOSO AI — barasho, ganacsi, iyo hal-abuur hal meel ku wada jira!',
    pauseAfterMs: 160,
  },
  {
    speaker: 'mohamed',
    emotion: 'calm',
    text: 'Ku soo dhawaada CARDOSO AI Studio — nabad gelyo iyo horumar wacan!',
    pauseAfterMs: 0,
  },
];

export interface PodcastSynthesisResult {
  buffer: Buffer;
  mimeType: string;
  turnCount: number;
  seconds: number;
  waveform: Uint8Array;
  transcript: string;
  turns: DialogueTurn[];
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

  private static voiceJitterSeq = 0;

  /**
   * Computes authentic human voice prosody (rate & pitch) matched to the user's detected
   * emotional tone (empathy when sick/sad, lively warmth when joking/happy, sharp confident
   * punch when roasting/clapping back at insults, plus subtle organic micro-jitter).
   */
  public static prosodyForChatEmotion(emotion?: string, text?: string): { rate: string; pitch: string } {
    const seq = (this.voiceJitterSeq = (this.voiceJitterSeq + 1) % 6);
    const rateJitter = [0, 1, -1, 2, -1, 1][seq];
    const pitchJitter = [0, 1, -1, 0, 1, 0][seq];
    const fmtRate = (v: number) => `${v >= 0 ? '+' : ''}${v}%`;
    const fmtPitch = (v: number) => `${v >= 0 ? '+' : ''}${v}Hz`;

    const emo = String(emotion || 'neutral').toLowerCase();
    const t = String(text || '');

    if (
      emo === 'sick' ||
      emo === 'sad' ||
      emo === 'heartbroken' ||
      emo === 'stressed' ||
      /\b(?:alle\s+ha\s+ku\s+caafiyo|caafimaad\s+degdeg|waan\s+ka\s+xumahay|samir\s+iyo\s+iimaan)\b/i.test(t)
    ) {
      return { rate: fmtRate(-7 + rateJitter), pitch: fmtPitch(-2 + pitchJitter) };
    }
    if (
      emo === 'angry' ||
      emo === 'insult' ||
      emo === 'roast' ||
      /\b(?:afkaaga\s+qabso|maxaa\s+kaa\s+qaldan|nacas|doqon|waalan|meel\s+kale\s+la\s+aad|ha\s+igu\s+soo\s+daadin|wasakh)\b/i.test(t) ||
      /\?!/.test(t)
    ) {
      // Sharp, confident, punchy Somali clapback tone (NOT soft or timid!)
      return { rate: fmtRate(5 + rateJitter), pitch: fmtPitch(1 + pitchJitter) };
    }
    if (emo === 'happy' || emo === 'excited' || emo === 'laugh' || /\b(?:haha|haa-haa|kkkk|hehe)\b/i.test(t)) {
      return { rate: fmtRate(4 + rateJitter), pitch: fmtPitch(3 + pitchJitter) };
    }
    if (emo === 'tired' || emo === 'sleepy') {
      return { rate: fmtRate(-5 + rateJitter), pitch: fmtPitch(-1 + pitchJitter) };
    }
    return { rate: fmtRate(-2 + rateJitter), pitch: fmtPitch(0 + pitchJitter) };
  }

  /**
   * Synthesizes a natural, human-mastered WhatsApp Voice Note (Ogg Opus PTT with exact duration
   * and 64-bar speech waveform). Defaults strictly to Mohamed (`so-SO-MuuseNeural`), adapts prosody
   * to the user's emotion (empathy, humor, or sharp comeback), trims dead TTS gaps, and applies
   * warm phone-mic mastering!
   */
  public static async synthesizeVoice(
    text: string,
    language: string = 'so',
    options?: {
      emotion?: string;
      speaker?: 'mohamed' | 'safa';
      humanMaster?: boolean;
    }
  ): Promise<{ buffer: Buffer; mimeType: string; seconds: number; waveform: Uint8Array } | null> {
    const clean = this.cleanTextForSpeech(text, language);
    if (!clean) return null;

    // Default strictly to Mohamed (so-SO-MuuseNeural) unless explicitly set to Safa or another language
    let voiceName = options?.speaker === 'safa' ? 'so-SO-UbaxNeural' : 'so-SO-MuuseNeural';
    if (language === 'en') {
      voiceName = options?.speaker === 'safa' ? 'en-US-JennyNeural' : 'en-US-ChristopherNeural';
    } else if (language === 'ar') {
      voiceName = options?.speaker === 'safa' ? 'ar-SA-ZariyahNeural' : 'ar-SA-HamedNeural';
    } else if (language === 'fr') {
      voiceName = 'fr-FR-HenriNeural';
    } else if (language === 'tr') {
      voiceName = 'tr-TR-AhmetNeural';
    }

    const prosody = this.prosodyForChatEmotion(options?.emotion, clean);
    const applyHumanMaster = options?.humanMaster !== false;

    // Try up to 2 attempts for 100% zero-error reliability against transient network glitches
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.synthesizeSingleAttempt(clean, voiceName, language, prosody);
        if (result && result.buffer.length > 0) {
          let opusBuffer: Buffer;
          if (applyHumanMaster) {
            try {
              opusBuffer = await masterHumanVoiceReplyToOggOpus(result.buffer);
            } catch (masterErr: any) {
              console.warn('[VoiceReply] Human voice mastering fallback to standard Opus:', masterErr?.message || masterErr);
              opusBuffer = await this.convertMp3ToOggOpus(result.buffer);
            }
          } else {
            opusBuffer = await this.convertMp3ToOggOpus(result.buffer);
          }
          const isOggOpus = opusBuffer.slice(0, 4).toString('ascii') === 'OggS';
          return {
            buffer: opusBuffer,
            mimeType: isOggOpus ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
            seconds: isOggOpus ? getOggOpusDurationSeconds(opusBuffer) : Math.max(1, Math.round(opusBuffer.length / 6000)),
            waveform: generateSpeechWaveform(opusBuffer),
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
    if (language === 'so_female' || language === 'ubax' || language === 'safa') {
      voiceName = 'so-SO-UbaxNeural';
      speechLang = 'so';
    } else if (language === 'mohamed' || language === 'muuse') {
      voiceName = 'so-SO-MuuseNeural';
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
   * Formats dialogue turns into a readable Safa & Mohamed podcast transcript.
   */
  public static formatPodcastTranscript(turns: DialogueTurn[]): string {
    return (turns || [])
      .map((t) => {
        const label = normalizePodcastSpeaker(t.speaker) === 'safa' ? 'Safa' : 'Mohamed';
        return `${label}: ${String(t.text || '').trim()}`;
      })
      .filter((l) => l.length > 6)
      .join('\n');
  }

  /**
   * Parses natural `!podcast` command arguments:
   * Examples:
   * - `!podcast Ganacsiga Online 3min` -> topic="Ganacsiga Online", durationMinutes=3, style='debate'
   * - `!podcast debate Jacaylka iyo Lacagta 4 daqiiqo` -> style='debate', durationMinutes=4
   * - `!podcast study Python 2` -> style='study', durationMinutes=2
   * - `!podcast video Tech-ka Soomaaliya 1m` -> outputKind='video', durationMinutes=1
   * - `!podcast diini Sabirka 3m` -> style='diini', soundMode='clean'
   * - `!podcast https://example.com/article 2m` -> sourceUrl extracted
   */
  public static parsePodcastCommandArgs(rawArg: string): ParsedPodcastCommand {
    let text = String(rawArg || '').trim();
    if (/^(?:help|caawimo|\?)$/i.test(text)) {
      return {
        topic: '',
        style: 'debate',
        durationMinutes: 2,
        outputKind: 'ogg',
        soundMode: 'chime',
        isHelp: true,
      };
    }

    let outputKind: 'ogg' | 'video' = 'ogg';
    let postToStatus = false;
    let style: PodcastStyle = 'debate';
    let explicitStyle = false;
    let durationMinutes: number | null = null;
    let soundMode: PodcastSoundMode = 'chime';
    let sourceUrl: string | undefined;

    // 1. Extract URL if present
    const urlMatch = text.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      sourceUrl = urlMatch[0].replace(/[),.;]+$/, '');
      text = text.replace(urlMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    // 1b. Extract leading/trailing `status` flag (post directly to WhatsApp Status!)
    if (/^(?:status|post-status|sheeko)\b/i.test(text)) {
      postToStatus = true;
      text = text.replace(/^(?:status|post-status|sheeko)\b\s*/i, '').trim();
    } else if (/\b(?:status|post-status)$/i.test(text)) {
      postToStatus = true;
      text = text.replace(/\s*\b(?:status|post-status)$/i, '').trim();
    }

    // 2. Extract leading/trailing video mode flag
    if (/^(?:video|mp4|audiogram|muuqaal)\b/i.test(text)) {
      outputKind = 'video';
      text = text.replace(/^(?:video|mp4|audiogram|muuqaal)\b\s*/i, '').trim();
    } else if (/\b(?:video|mp4|audiogram|muuqaal)$/i.test(text)) {
      outputKind = 'video';
      text = text.replace(/\s*\b(?:video|mp4|audiogram|muuqaal)$/i, '').trim();
    }

    // Also allow `status` after `video` (e.g. `!podcast video status <topic>`)
    if (!postToStatus && /^(?:status|post-status)\b/i.test(text)) {
      postToStatus = true;
      text = text.replace(/^(?:status|post-status)\b\s*/i, '').trim();
    }

    // 3. Extract optional sound mode keyword
    if (/\b(?:ambient|lofi|music|muusig)\b/i.test(text)) {
      soundMode = 'ambient';
      text = text.replace(/\b(?:ambient|lofi|music|muusig)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    } else if (/\b(?:clean|nomusic|saafi)\b/i.test(text)) {
      soundMode = 'clean';
      text = text.replace(/\b(?:clean|nomusic|saafi)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    // 4. Extract leading style keyword (debate / study / story / ad / diini)
    const stylePatterns: Array<{ re: RegExp; val: PodcastStyle }> = [
      { re: /^(?:debate|dood|muran)\b\s*/i, val: 'debate' },
      { re: /^(?:study|cashar|waxbarasho|imtixaan)\b\s*/i, val: 'study' },
      { re: /^(?:story|sheeko|taariikh)\b\s*/i, val: 'story' },
      { re: /^(?:ad|xayeysiis|commercial|promo)\b\s*/i, val: 'ad' },
      { re: /^(?:diini|wacdi|islaam|islamic)\b\s*/i, val: 'diini' },
    ];
    for (const sp of stylePatterns) {
      if (sp.re.test(text)) {
        style = sp.val;
        explicitStyle = true;
        text = text.replace(sp.re, '').trim();
        break;
      }
    }

    // Also allow video keyword after style (`!podcast debate video <topic>`)
    if (outputKind === 'ogg' && /^(?:video|mp4|audiogram|muuqaal)\b/i.test(text)) {
      outputKind = 'video';
      text = text.replace(/^(?:video|mp4|audiogram|muuqaal)\b\s*/i, '').trim();
    }

    // 5. Extract duration in minutes or seconds (e.g. "3min", "3m", "3 daqiiqo", "45s", or trailing " 3")
    const minMatch = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m|daqiiqado|daqiiqo|daqiiqad|daq)\b/i);
    if (minMatch) {
      durationMinutes = parseFloat(minMatch[1]);
      text = text.replace(minMatch[0], ' ').replace(/\s+/g, ' ').trim();
    } else {
      const secMatch = text.match(/(?:^|\s)(\d{2,3})\s*(?:seconds?|secs?|sec|s|ilbiriqsi)\b/i);
      if (secMatch) {
        durationMinutes = parseFloat(secMatch[1]) / 60;
        text = text.replace(secMatch[0], ' ').replace(/\s+/g, ' ').trim();
      } else {
        // Trailing standalone digit 1..5 (e.g. `!podcast Jacaylka iyo Lacagta 3`)
        const trailNum = text.match(/\s+([1-5])$/);
        if (trailNum && text.replace(/\s+[1-5]$/, '').trim().length >= 3) {
          durationMinutes = parseInt(trailNum[1], 10);
          text = text.replace(/\s+[1-5]$/, '').trim();
        }
      }
    }

    // Auto-select clean sound mode for religious/diini podcasts
    if (style === 'diini') {
      soundMode = 'clean';
    }

    const defaultDur = postToStatus ? 0.85 : style === 'ad' ? 0.75 : 1.5;
    const clampedDur = Math.max(0.5, Math.min(5, durationMinutes ?? defaultDur));
    if (!explicitStyle && /\b(?:diin|quraan|salaad|sunnah|nabiga|xadiis|ramadaan|duco)\b/i.test(text)) {
      style = 'diini';
      soundMode = 'clean';
    }

    return {
      topic: text.replace(/^[\-–:|]+|[\-–:|]+$/g, '').trim(),
      style,
      durationMinutes: Number(clampedDur.toFixed(2)),
      outputKind,
      soundMode,
      postToStatus,
      sourceUrl,
    };
  }

  /**
   * Builds the sleek, radio-broadcast style Somali announcement sent right before
   * Safa & Mohamed's Podcast Voice Note / Video arrives (ZERO boring waiting boilerplate!).
   */
  public static buildPodcastTeaserMessage(options: {
    topic?: string;
    style?: PodcastStyle;
    durationMinutes?: number;
    outputKind?: 'ogg' | 'video';
    isPromo?: boolean;
  }): string {
    const style = options.style || 'debate';
    const styleLabel = PODCAST_STYLE_LABELS[style] || PODCAST_STYLE_LABELS.debate;
    const durMin = options.durationMinutes || 1.5;
    const durLabel =
      durMin < 1
        ? `${Math.round(durMin * 60)} ilbiriqsi`
        : durMin === 1
          ? '1 daqiiqo'
          : `${Number.isInteger(durMin) ? durMin : durMin.toFixed(1)} daqiiqo`;

    if (options.isPromo || !options.topic) {
      return (
        `🎙️ *CARDOSO AI — PODCAST STUDIO* ✨\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 *Mawduuca Maanta:* Barashada CARDOSO AI\n` +
        `🗣️ *Daadihiyayaasha:* Safa & Mohamed\n\n` +
        `📻 _Goor dhow la soco! Safa & Mohamed waxay maanta si xiiso leh uga wada hadlayaan CARDOSO AI..._ 🎧`
      );
    }

    const cleanTitle = options.topic.trim().slice(0, 120);
    const mediaTag = options.outputKind === 'video' ? '🎬 *Nooca:* Video Audiogram (Status/TikTok)' : '🎧 *Nooca:* Studio Voice Note';
    return (
      `🎙️ *CARDOSO AI — PODCAST STUDIO* ✨\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 *Mawduuca Maanta:* ${cleanTitle}\n` +
      `🗣️ *Daadihiyayaasha:* Safa & Mohamed\n` +
      `🎭 *Qaabka:* ${styleLabel}\n` +
      `⏱️ *Muddada:* ~${durLabel}\n` +
      `${mediaTag}\n\n` +
      `📻 _Goor dhow la soco! Safa & Mohamed waxay maanta si qoto dheer oo xiiso leh uga wada hadlayaan "${cleanTitle}"..._ 🔥`
    );
  }

  /**
   * Safely fetches and extracts clean article text from a public URL for NotebookLM-style Podcasts.
   */
  public static async fetchArticleExcerptForPodcast(url: string): Promise<{ title?: string; excerpt: string } | null> {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(parsed.toString(), {
          signal: controller.signal,
          headers: { 'User-Agent': 'CARDOSO-AI-Podcast/2.0', Accept: 'text/html,text/plain' },
        });
        if (!res.ok) return null;
        const html = (await res.text()).slice(0, 120000);
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120) : undefined;
        const cleaned = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&quot;/gi, '"')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
        if (cleaned.length < 60) return null;
        return { title, excerpt: cleaned };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }

  private static extractEmotionAndCleanLine(rawLine: string): { emotion: PodcastEmotion; text: string } {
    let text = String(rawLine || '').trim();
    let emotion: PodcastEmotion = 'neutral';

    const tagMatch = text.match(/^\[\s*(laugh|qosol|debate|muran|excited|yaab|calm|warm|deggan|whisper|sir|backchannel|neutral)\s*\]\s*/i);
    if (tagMatch) {
      const tag = tagMatch[1].toLowerCase();
      text = text.slice(tagMatch[0].length).trim();
      if (tag === 'laugh' || tag === 'qosol') emotion = 'laugh';
      else if (tag === 'debate' || tag === 'muran') emotion = 'debate';
      else if (tag === 'excited' || tag === 'yaab') emotion = 'excited';
      else if (tag === 'calm' || tag === 'warm' || tag === 'deggan') emotion = 'calm';
      else if (tag === 'whisper' || tag === 'sir') emotion = 'whisper';
      else if (tag === 'backchannel') emotion = 'backchannel';
    }

    // Strip any stray inline stage brackets like [laughs], (laughs), [qosol] so TTS never reads them literally
    text = text.replace(/\[(?:laugh|laughs|qosol|debate|muran|excited|yaab|calm|warm|whisper|sir|backchannel|pause|music|sigh)[^\]]*\]/gi, '').trim();

    // Auto-infer natural emotion if none tagged
    if (emotion === 'neutral') {
      const lower = text.toLowerCase();
      const wordCount = lower.split(/\s+/).filter(Boolean).length;
      if (/\b(?:haha|haa-haa|hehe|qosol|kaftan)\b/i.test(lower)) {
        emotion = 'laugh';
      } else if (wordCount <= 5 && /^(?:haa|maya|sax|waa run|wallaahi|sug|alla|run|subxaan)/i.test(lower)) {
        emotion = 'backchannel';
      } else if (/\b(?:maya|sug sug|kugu ma raacsani|been|iga daa|ha i jarin|ma ogoli|taasi waa qalad)\b/i.test(lower)) {
        emotion = 'debate';
      } else if (text.includes('!')) {
        emotion = 'excited';
      }
    }

    return { emotion, text };
  }

  private static defaultPauseForEmotion(emotion: PodcastEmotion, defaultPauseMs: number): number {
    switch (emotion) {
      case 'backchannel':
        return 115;
      case 'debate':
        return 145;
      case 'laugh':
        return 165;
      case 'excited':
        return 185;
      case 'calm':
        return 320;
      case 'whisper':
        return 340;
      default:
        return Math.min(260, defaultPauseMs);
    }
  }

  public static prosodyForEmotion(emotion: PodcastEmotion, turnIndex: number = 0): { rate: string; pitch: string } {
    // Organic per-turn micro-jitter so consecutive sentences never sound identically flat!
    const rateJitter = [0, 2, -1, 1, -2, 2][Math.abs(turnIndex) % 6];
    const pitchJitter = [0, 1, -1, 1, 0, -1][Math.abs(turnIndex) % 6];
    const fmtRate = (base: number) => `${base >= 0 ? '+' : ''}${base}%`;
    const fmtPitch = (base: number) => `${base >= 0 ? '+' : ''}${base}Hz`;

    switch (emotion) {
      case 'laugh':
        return { rate: fmtRate(5 + rateJitter), pitch: fmtPitch(4 + pitchJitter) };
      case 'debate':
        return { rate: fmtRate(4 + rateJitter), pitch: fmtPitch(2 + pitchJitter) };
      case 'excited':
        return { rate: fmtRate(3 + rateJitter), pitch: fmtPitch(3 + pitchJitter) };
      case 'backchannel':
        return { rate: fmtRate(6 + rateJitter), pitch: fmtPitch(2 + pitchJitter) };
      case 'calm':
        return { rate: fmtRate(-5 + rateJitter), pitch: fmtPitch(-1 + pitchJitter) };
      case 'whisper':
        return { rate: fmtRate(-8 + rateJitter), pitch: fmtPitch(-2 + pitchJitter) };
      default:
        return { rate: fmtRate(-1 + rateJitter), pitch: fmtPitch(0 + pitchJitter) };
    }
  }

  /**
   * Detects natural opposing sides for debate & comparison topics so Safa & Mohamed
   * take clear, passionate, culturally grounded stances (e.g. Gender debates: Safa defends Women,
   * Mohamed defends Men; Comparison debates "X iyo Y": Safa vs Mohamed take opposing sides!).
   */
  public static detectPodcastDebateContext(topic: string): {
    isGenderDebate: boolean;
    isComparison: boolean;
    safaSide?: string;
    mohamedSide?: string;
    directive: string;
  } {
    const clean = String(topic || '').trim();
    const lower = clean.toLowerCase();

    const hasMen = /\b(?:rag|raga|ragga|niman|nimanka|wiil|wiilasha|nin|ninka|aabe|aabaha)\b/i.test(lower);
    const hasWomen = /\b(?:dumar|dumarka|hablo|hablaha|gabadh|gabadha|gabdho|gabdhaha|naag|naagaha|hooyo|xaas|xaaska)\b/i.test(lower);
    const isRelationshipGender =
      (hasMen && hasWomen) ||
      ((hasMen || hasWomen) && /\b(?:khiyaano|qayaano|jacayl|guur|masayr|hinaaso|shukaansi|daacad|lacag|furin|xiriir|beenta|qalbi|xanaaq)\b/i.test(lower));

    if (isRelationshipGender) {
      return {
        isGenderDebate: true,
        isComparison: true,
        safaSide: 'Dumarka & Hablaha (difaaca dumarka, doodda ka dhanka ah ragga)',
        mohamedSide: 'Ragga & Wiilasha (difaaca ragga, doodda ka dhanka ah dumarka)',
        directive: `XEERKA GAARKA AH EE DOODDA RAGGA IYO DUMARKA (AAD U MUHIIM AH):
- Mawduucani wuxuu ku saabsan yahay **RAGGA IYO DUMARKA** ("${clean}").
- **Safa** WAA INAY 100% U DOODDAA DUMARKA oo ay eedda / caddaymaha saarto **RAGGA**! (Tusaale: haddii la is weydiiyo "Ragga iyo Dumarka yaa khiyaano badan?", Safa waxay si cad u leedahay **RAGGA ayaa khiyaano badan!** Waxayna keentaa tusaalayaal dhab ah oo bulshada Soomaalida ka jira sida ballamo been ah, taleefanka la qariyo, laba-wejiilenimo, "saaxiibkay baan la joogaa", iwm).
- **Mohamed** WAA INUU 100% U DOODAA RAGGA oo uu eedda / caddaymaha saaro **DUMARKA**! (Tusaale: Mohamed wuxuu si cad u leeyahay **DUMARKA ayaa ka daran!** Wuxuuna keenaa tusaalayaal dhab ah oo bulshada Soomaalida ka jira sida qarsiga, xulashada jeebka/lacagta, "backup/friendzone", aamusnaan lagu khiyaamo qofka, iwm).
- Labadoodu si DHAB AH oo kulul balse xushmad iyo kaftan Soomaaliyeed leh ha u murmaan, ha u qoslaan ("Haa-haa war Mohamed beenta jooji!", "Sug sug Safa ha xanaaqin, runtaan kuu hayaa!"), tusaalayaal dhab ah oo dhaqanka iyo nolosha Soomaalida yaqaana ha soo qaataan — marna midkoodna si fudud ha isugu dhiibin kan kale ilaa dhammaadka!`,
      };
    }

    // Generic comparison detection: "X iyo Y", "X vs Y", "yaa ... badan", "midkee ka fiican"
    const vsMatch = clean.match(/^(.{2,45}?)\s+(?:iyo|vs\.?|mise|ama)\s+(.{2,45}?)(?:\s+(?:ayaa|yaa|keebaa|midkee|maxaa).*)?$/i);
    const isComparison = Boolean(vsMatch) || /\b(?:ayaa\s+\w+\s+badan|yaa\s+\w+\s+badan|midkee|keebaa|ka\s+fiican|ka\s+muhiimsan|ka\s+daran)\b/i.test(lower);

    if (isComparison) {
      const sideA = vsMatch?.[1]?.trim();
      const sideB = vsMatch?.[2]?.trim();
      return {
        isGenderDebate: false,
        isComparison: true,
        safaSide: sideA || 'Dhinaca 1-aad',
        mohamedSide: sideB || 'Dhinaca 2-aad',
        directive: `XEERKA DOODDA IS-BARBARDHIGGA ("${clean}"):
- Mawduucani waa is-barbardhig cad! Labada daadihiye WAA INAY KALA QAATAAN LABADA DHINAC OO SI ADAG U DOODAAN:
${sideA && sideB ? `- **Safa** waxay taageeraysaa / u doodaysaa dhinaca: **"${sideA}"** (waxayna si adag uga hor imanaysaa "${sideB}").
- **Mohamed** wuxuu taageerayaa / u doodayaa dhinaca: **"${sideB}"** (wuxuuna si adag uga hor imanayaa "${sideA}").` : `- **Safa** iyo **Mohamed** mid walba mowqif ka soo horjeeda kan kale ha qaato oo si adag ha u difaaco!`}
- Mid kasta ha keeno tusaalayaal nololeed oo dhab ah oo ka dhaca bulshada Soomaalida (suuqa, qoyska, shaqada, baraha bulshada, dhalinyarada) — qosol, muran caqli leh, iyo doodo nool oo aan AI loo malayn karin!`,
      };
    }

    return {
      isGenderDebate: false,
      isComparison: false,
      directive: `XEERKA KU XIDHNAANTA MAWDUUCA ("${clean}"):
- Sadar kasta WAA inuu 100% si toos ah uga hadlo **"${clean}"** — ha ku leexan wax guud ama wacdi aan mawduuca ku saabsanayn!
- **Safa** iyo **Mohamed** ha yeeshaan laba aragti oo kala duwan oo ku saabsan "${clean}", iyagoo tusaalayaal dhab ah oo dhaqanka & bulshada Soomaalida ka yimid isku celcelinaya!`,
    };
  }

  /**
   * Parses human-written or AI-generated dialogue lines like:
   *   Safa: [excited] Assalaamu calaykum Mohamed!
   *   Mohamed: [laugh] Wa calaykumus salaam Safa!
   * Handles collapsed single-line AI outputs, markdown bolding (**Safa:**), bullets (- Safa:),
   * and remains 100% compatible with legacy Ubax:/Muuse: scripts.
   */
  public static parseDialogueScript(rawScript: string): DialogueTurn[] {
    // Pre-normalize markdown bolding/bullets and split inline speaker labels if newlines were ever collapsed
    let normalized = String(rawScript || '')
      .replace(/\r\n/g, '\n')
      .replace(/\*{1,2}\s*(safa|mohamed|maxamed|muuse|ubax|gabadh|wiil|female|male|girl|boy)\s*\*{0,2}\s*[:\-–]\s*\*{0,2}/gi, '\n$1: ')
      .replace(/(?:^|\s)[•\-\*]\s*(safa|mohamed|maxamed|muuse|ubax|gabadh|wiil|female|male|girl|boy)\s*[:\-–]\s*/gi, '\n$1: ')
      .replace(/([^\n])\s+\b(safa|mohamed|maxamed|muuse|ubax)\s*:\s*/gi, '$1\n$2: ');

    const lines = normalized
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const turns: DialogueTurn[] = [];
    let nextAutoSpeaker: CanonicalPodcastSpeaker = 'safa';

    for (const line of lines) {
      const m = line.match(/^(safa|mohamed|maxamed|muuse|ubax|gabadh|wiil|female|male|girl|boy)\s*[:\-–]\s*(.+)$/i);
      if (m) {
        const speaker = normalizePodcastSpeaker(m[1]);
        const { emotion, text } = this.extractEmotionAndCleanLine(m[2]);
        if (text) {
          turns.push({ speaker, text, emotion });
          nextAutoSpeaker = speaker === 'safa' ? 'mohamed' : 'safa';
        }
      } else {
        const { emotion, text } = this.extractEmotionAndCleanLine(line);
        if (text) {
          turns.push({ speaker: nextAutoSpeaker, text, emotion });
          nextAutoSpeaker = nextAutoSpeaker === 'safa' ? 'mohamed' : 'safa';
        }
      }
    }
    return turns.slice(0, 42);
  }

  /**
   * Returns true if the text already looks like an explicit multi-speaker script
   * (e.g. "Safa: ... \n Mohamed: ..."), versus a topic/title like "faa'iidada waxbarashada".
   */
  public static isExplicitDialogueScript(rawText: string): boolean {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    const labeledLines = lines.filter((l) =>
      /^(?:\*{0,2})(safa|mohamed|maxamed|muuse|ubax|gabadh|wiil|female|male|girl|boy)(?:\*{0,2})\s*[:\-–]\s*.+/i.test(l)
    );
    return labeledLines.length >= 2;
  }

  /**
   * Generates a world-class, ultra-natural Somali Podcast conversation between
   * Safa (female) & Mohamed (male) with real disagreement, gender/comparison side-taking,
   * Somali cultural fluency, laughter, and exact duration scaling (0.5 to 5 minutes)!
   */
  public static async generateTopicDialogueTurns(
    topic: string,
    ai?: { generateResponse: (prompt: string, history?: any[], options?: any) => Promise<{ text: string }> },
    options?: {
      style?: PodcastStyle;
      durationMinutes?: number;
      sourceText?: string;
      sourceMedia?: { type: 'image' | 'document' | 'audio' | 'video'; mimeType: string; dataBase64: string };
    }
  ): Promise<DialogueTurn[]> {
    const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const style: PodcastStyle = options?.style || 'debate';
    const durationMinutes = Math.max(0.5, Math.min(5, options?.durationMinutes ?? 1.5));

    if (!cleanTopic && !options?.sourceText && !options?.sourceMedia) {
      return DEFAULT_CARDOSO_PROMO_DIALOGUE;
    }

    const debateCtx = this.detectPodcastDebateContext(cleanTopic);

    // Scale turns and word budget precisely to requested minutes (~155 Somali spoken words/minute)
    const targetTurns = Math.max(6, Math.min(36, Math.round(durationMinutes * 7.2)));
    const minTurns = Math.max(6, targetTurns - 2);
    const maxTurns = Math.min(38, targetTurns + 2);
    const targetWords = Math.round(durationMinutes * 155);
    const maxOutputTokens = Math.min(3600, Math.max(1200, Math.round(targetWords * 3.4)));

    const styleDirectiveMap: Record<PodcastStyle, string> = {
      debate: `QAABKA: DOOD KULUL & MURAN DHAB AH OO BULSHADA SOOMAALIDA KU SALAYSAN
- Safa iyo Mohamed WAA INAY KALA ARAGTI DUWANAADAAN — mid walba dhinaciisa si xamaasad, caddeyn, iyo kaftan leh ha u difaaco!
- Safa: geesiyad, af-tahanad, bulshada iyo dhaqanka si fiican u taqaanna, Mohamed way ku qoslaysaa oo way ku qabsanaysaa ("Haa-haa, war Mohamed beenta jooji!", "Sug sug, taas bulshadu way ogtahay!").
- Mohamed: wiil af-tahan ah, kaftan yaqaan, xaqiiqooyin iyo tusaalayaal maalinle ah oo bulshada Soomaalida ah keena ("Maya Safa, ha caroonin bal i dhagayso!", "Wallaahi taa anigaa caddayn u haya!").
- Ku dar 2-3 jawaabood oo gaaban oo degdeg ah ([backchannel]) sida "Haa-haa waa been!", "Maya wallaahi!", "Sug sug!" si loo dareemo laba qof oo dhab ahaan studio ku wada murmaya!`,
      study: `QAABKA: CASHAR & IMTIXAAN DIYAARIN (NOTEBOOKLM STUDY PODCAST)
- Safa waa ardayad fariid ah oo su'aalo caqli leh weydiisa, mararka qaar qalad yar oo caan ah sheegta si Mohamed u saxo, kadibna qosol yar iyo faham cusub muujisa.
- Mohamed waa macallin saaxiib ah oo tusaalayaal maalinle ah oo fudud ku sharxa qodob kasta si qofku hal dhageysi ugu xifdiyo.`,
      story: `QAABKA: SHEEKO & FALANQAYN MACAAN (STORYTELLING PODCAST)
- Safa & Mohamed waxay u sheekaynayaan sida barnaamij idaacadeed oo xiiso leh, tusaalayaal nool, taariikh ama qisooyin cajiib ah oo qalbiga taabanaya.`,
      ad: `QAABKA: XAYEYSIIS RADIO COMMERCIAL OO XIRFAD LEH
- Safa & Mohamed waxay wada sheekaysanayaan sida laba saaxiib oo la yaaban tayada iyo faa'iidada adeeggan/ganacsigan, si dabiici ah oo qosol iyo kalsooni leh (Call-to-Action xooggan dhammaadka).`,
      diini: `QAABKA: WACDI & AQOON DIINI AH OO XUSHMAD LEH
- Safa & Mohamed waxay si deggan, xushmad leh, xikmad iyo naxariis leh uga wada hadlayaan mawduucan diiniga ah iyadoo la ilaalinayo asluubta Islaamka (kaftan xad-dhaaf ah ma jiro, cod deggan oo qalbiga taabanaya).`,
    };

    if (ai && typeof ai.generateResponse === 'function') {
      const systemInstruction = `Waxaad tahay Agaasime & Qoraa Heer Caalami ah oo Somali Podcast & Radio Studio ah.
Qor wada-sheekeysi 100% DHAB U EEG, NOOL, XIISO LEH, oo u dhexeeya LABA QOF OO SOOMAALI AH oo dhaqanka iyo nolosha bulshada si fiican u yaqaanna:
- **Safa** (Gabadh furfuran, af-tahanad, dhiirran, kaftan & qosol dabiici ah leh)
- **Mohamed** (Wiil cod culus, af-tahan, xikmad iyo kaftan leh, tusaalayaal dhab ah keena)

${styleDirectiveMap[style]}

${debateCtx.directive}

XEERARKA ADAG EE HEERKA CAALAMIGA AH (WAA WAAJIB):
1. FAHAMKA TITLE-KA & KU XIDHNAANTA 100%:
   - Si qoto dheer u faham ciwaanka/su'aasha la siiyay ("${cleanTopic}").
   - Sadar kasta WAA inuu toos uga jawaabo ama uga doodo ciwaankaas — MARNABA ha ka leexan ciwaanka, hana qorin wacdi guud oo aan mawduuca ku saabsanayn!
   - Keen tusaalayaal DHAB AH oo ka dhaca bulshada Soomaalida maanta (sheekooyinka maalinlaha ah, dhaqanka, qoyska, suuqa, baraha bulshada, dhalinyarada).
2. DHERERKA SAXDA AH: Qor u dhexeeya ${minTurns} ilaa ${maxTurns} sadar (wadarta ereyada ~${targetWords} erey oo Af-Soomaali ah) si codku u socdo qiyaastii ${durationMinutes} daqiiqo!
3. QAABKA SADARKA: Sadar kasta hal layn gaar ah ku qor oo ku bilow KELIYA \`Safa: [emotion] ...\` ama \`Mohamed: [emotion] ...\`
   - Emotion tags la ogol yahay: \`[excited]\`, \`[debate]\`, \`[laugh]\`, \`[calm]\`, \`[backchannel]\`.
4. HA U EKAANIN AI MARNABA (SIRTA BINI'AADAMKA DHABTA AH):
   - Waa MAMNUUC jumladaha robot-ka sida "Mawduucan waa mid muhiim ah", "Ugu dambeyn waxaan soo gabagabeynaynaa", "Su'aal fiican baad weydiisay", "Qorshe cad iyo joogteyn".
   - Toos ugu bood su'aasha & doodda laga billaabo sadarka 1-aad!
   - Isku dar DHERERRO KALA DUWAN (Burstiness): mar sadar aad u gaaban oo 2-5 erey ah ([backchannel] qofka kale ka dhex galaya sida "War been badanaa!", "Maya, maya, maya!", "Haa-haa sug!"), marna sheeko yar oo nool oo bulshada ka dhacday (2-3 jumladood)!
   - Isticmaal lahjad & eray-bixin dadka dhabta ahi ku hadlaan maalin walba: "Maxamedow!", "Safaay!", "Horta...", "I dhagayso...", "Sug, sug, sug!", "Ma garatay?", "Wallaahi", "Alla beerka!", "War iga daa!", "Taasi waa run balse...".
5. NAADIIFINTA CODKA (TTS SAFE):
   - HA ISTICMAALIN emojis, xiddigo (*), hashtags (#), ama markdown bold (**).
   - Qosolka u qor "Haa-haa!" ama "Hehe!" si codku si dabiici ah ugu dhawaaqo.
6. HA QORIN wax hordhac ah ama sharraxaad bannaanka ah — toos u qor sadarrada Safa: iyo Mohamed: oo keliya!`;

      const contextBlock = options?.sourceText
        ? `\n\nXOGTA / MAQAALKA / DUKUMENTIGA AY KA WADA HADLAYAAN:\n"""\n${options.sourceText.slice(0, 4800)}\n"""`
        : '';

      const userPrompt =
        `CIWAANKA / MAWDUUCA PODCAST-KA MAANTA WAA: "${cleanTopic || 'Dukumentiga/Sawirka la soo diray'}".` +
        `\nMuddada la rabo: ${durationMinutes} daqiiqo (${minTurns}-${maxTurns} sadar, ~${targetWords} erey).` +
        (debateCtx.isGenderDebate
          ? `\nXUSUUSIN: Safa waxay u doodaysaa DUMARKA (oo ragga ku doodaysaa), Mohamed-na wuxuu u doodayaa RAGGA (oo dumarka ku doodaya)! Si dhab ah ha u murmaan oo tusaalayaal bulsho ha keenaan!`
          : '') +
        `${contextBlock}` +
        `\nHadda toos u qor sadarrada Safa: iyo Mohamed: — 100% ku xidhan ciwaanka "${cleanTopic}", qosol, muran dhab ah, iyo dhaqan Soomaaliyeed oo nool!`;

      try {
        const result = await ai.generateResponse(userPrompt, [], {
          systemInstruction,
          temperature: style === 'diini' ? 0.65 : 0.9,
          maxOutputTokens,
          timeoutMs: 35000,
          ...(options?.sourceMedia ? { media: options.sourceMedia } : {}),
        });
        const rawOut = String(result?.text || '').trim();
        const isErrorMsg =
          !rawOut ||
          rawOut.includes('Zero-Cost Safeguard') ||
          rawOut.includes('No AI provider is active') ||
          rawOut.includes('CARDOSO AI Error') ||
          rawOut.includes('Gemini API request failed') ||
          rawOut.includes('server-ka AI ayaa mashquul') ||
          rawOut.includes('server-ka Gemini AI ayaa hadda') ||
          rawOut.includes('xiriirka wuu yara mashquulsan yahay');

        if (!isErrorMsg) {
          const parsed = this.parseDialogueScript(rawOut).filter((t) => t.text.length >= 4);
          if (parsed.length >= 4) {
            return parsed.slice(0, 40);
          }
          console.warn(`[VoiceReply] AI output for "${cleanTopic}" parsed only ${parsed.length} turn(s); using topic-aware fallback.`);
        } else {
          console.warn(`[VoiceReply] AI unavailable/quota for "${cleanTopic}": ${rawOut.slice(0, 100)}`);
        }
      } catch (err: any) {
        console.warn(`[VoiceReply] AI topic dialogue fallback for "${cleanTopic}":`, err?.message || err);
      }
    }

    // Topic-aware Somali debate fallback (handles Men-vs-Women & comparisons naturally even if AI quota is exhausted!)
    const topicLabel = cleanTopic || 'mawduuca maanta';
    if (debateCtx.isGenderDebate) {
      const genderFallback: DialogueTurn[] = [
        {
          speaker: 'safa',
          emotion: 'excited',
          text: `Assalaamu calaykum Mohamed! Maanta dood kulul baa ina sugaysa — ${topicLabel}! Runta aan isku sheegno, jawaabtu way iska cad dahay, raggaa ku horreeya!`,
        },
        {
          speaker: 'mohamed',
          emotion: 'laugh',
          text: `Wa calaykumus salaam Safa! Haa-haa, war maanta dagaal culus baad la soo kalahday! Sug sug, sidee ragga u eedaysay adigoon xataa dumarka eegin? Wallaahi dumarkaa ka qarsoon oo ka daran!`,
        },
        {
          speaker: 'safa',
          emotion: 'debate',
          text: `War Mohamed beenta jooji! Bal bulshada Soomaalida eeg! Nin baa hal mar saddex qof ballan u qaadaya, taleefankiisana password adag ku xidhaya, haddana wuxuu ku leeyahay saaxiibkay baan la fadhiyaa!`,
        },
        {
          speaker: 'mohamed',
          emotion: 'debate',
          text: `Maya Safa, ha igu soo ordin! Ninku ugu yaraan haddii uu qalad galo waa la qabtaa oo wuu is kashifaa! Laakiin gabadhu intay kuu dhoolla-caddaynayso ayay qalbigeeda iyo sheekadeeda qarsataa — ilaa aad maalin qura aragto iyadoo qof kale la guursatay!`,
        },
        {
          speaker: 'safa',
          emotion: 'backchannel',
          text: `Haa-haa! Wallaahi taasi waa been cad Mohamed!`,
        },
        {
          speaker: 'safa',
          emotion: 'debate',
          text: `Gabadhu markay daacad u tahay qofka, qalbigeeda oo dhan bay siisaa oo way u dulqaadataa! Waxa dumarka niyad-jebiya ee beddela waa marka raggu ballankii iyo kalsoonidii jabiyaan!`,
        },
        {
          speaker: 'mohamed',
          emotion: 'laugh',
          text: `Haa-haa, mar walba eedda ragga uun baa la saaraa miyaa Safa? Bal imisa nin oo daacad ah oo shaqaysta ayaa intuu qof jeclaaday, markii nin ka lacag badan yimid laga tagay? Taasna ma raggaa leh?!`,
        },
        {
          speaker: 'safa',
          emotion: 'excited',
          text: `Wallaahi mararka qaar taasi way dhacdaa, qiranayaa, laakiin marka la is barbar dhigo ${topicLabel}, weli dumarku waxay kaga fiican yihiin daacadnimada iyo ilaalinta qoyska!`,
        },
        {
          speaker: 'mohamed',
          emotion: 'debate',
          text: `Aniguna waxaan leeyahay raggu waa tiirka daacadnimada marka la helo qof qaddarinaysa! Dhageystayaasha sharafta leh, idinka ha kala saareen dooddan — Safa iyo Mohamed yaa saxsan maanta?`,
        },
        {
          speaker: 'safa',
          emotion: 'laugh',
          text: `Haa-haa, comment-ga noogu qora cidda aad taageersan tihiin — Dumarka mise Ragga! Nabad gelyo asxaabey!`,
          pauseAfterMs: 0,
        },
      ];
      return genderFallback;
    }

    const baseFallback: DialogueTurn[] = [
      {
        speaker: 'safa',
        emotion: 'excited',
        text: `Assalaamu calaykum Mohamed! Maanta waxaan fadhiga u soo qaadannay dood aad u kulul oo ku saabsan ${topicLabel} — aniguna mowqif cad baan ka taaganahay!`,
      },
      {
        speaker: 'mohamed',
        emotion: 'laugh',
        text: `Wa calaykumus salaam Safa! Haa-haa, mar walba dooddaada waan ka baqaa! Bal ii sheeg, maxaad si gaar ah uga aaminsan tahay ${topicLabel}?`,
      },
      {
        speaker: 'safa',
        emotion: 'debate',
        text: `Bal bulshada Soomaalida maanta eeg Mohamed! Marka laga hadlayo ${topicLabel}, dad badan baa dusha sare uun ka arka iyagoon eegin xaqiiqada dhabta ah ee hooseysa!`,
      },
      {
        speaker: 'mohamed',
        emotion: 'debate',
        text: `Maya Safa, sug sug! Taas kugu ma raacsani boqolkiiba boqol! Sababtoo ah dadka maanta jooga way ka feejigan yihiin sidii hore, tusaalayaal nool baana muujinaya in ${topicLabel} uu laba weji leeyahay!`,
      },
      {
        speaker: 'safa',
        emotion: 'backchannel',
        text: `Haa-haa, bal ii sheeg wejiga aad sheegayso!`,
      },
      {
        speaker: 'mohamed',
        emotion: 'excited',
        text: `Fiiri, marka qofku si deggan uga fiirsado ${topicLabel} oo uu tusaale ka qaato wixii bulshada hore u soo maray, wuxuu arkayaa in go'aanka caqligu ka fiican yahay degdegga!`,
      },
      {
        speaker: 'safa',
        emotion: 'debate',
        text: `Laakiin Mohamed, run ahaantii mararka qaar dadku way ogyihiin runta ku saabsan ${topicLabel}, waxaase dhib ah ku dhaqankeeda iyo is-faham la'aanta bulshada dhexdeeda!`,
      },
      {
        speaker: 'mohamed',
        emotion: 'laugh',
        text: `Haa-haa, qodobkaas waad ku saxan tahay Safa! Dhageystayaasha sharafta leh, idinkuna aragtidiinna nala wadaaga — sidee u aragtaan ${topicLabel}?`,
      },
      {
        speaker: 'safa',
        emotion: 'calm',
        text: `Waa dood xiiso badan oo qof walba taabanaysa! Mahadsanid Mohamed, asxaabeyna nabad gelyo iyo kulan dambe oo xiiso leh!`,
        pauseAfterMs: 0,
      },
    ];

    if (durationMinutes >= 2.5) {
      const extraDepth: DialogueTurn[] = [
        {
          speaker: 'safa',
          emotion: 'debate',
          text: `Intaynaan xidhin Mohamed, dhalinyarada maanta joogta Hargeysa, Muqdisho, iyo Jigjiga aad bay uga doodaan ${topicLabel} baraha bulshada — adigu sideed u aragtaa saameynta baraha bulshada?`,
        },
        {
          speaker: 'mohamed',
          emotion: 'excited',
          text: `Wallaahi baraha bulshadu doodda ${topicLabel} aad bay u kululeeyeen! Qof walba aragtidiisa ayuu soo dhigaa, waxaase muhiim ah in xaqiiqada iyo dhaqanka wanaagsan la eego!`,
        },
        {
          speaker: 'safa',
          emotion: 'backchannel',
          text: `Wallaahi sax! Taasi waa run!`,
        },
      ];
      baseFallback.splice(baseFallback.length - 2, 0, ...extraDepth);
    }

    return baseFallback;
  }

  /**
   * Returns the official CARDOSO AI Promo Voice Note (Safa & Mohamed) as a verified WhatsApp OGG Opus PTT.
   * Checks for pre-generated studio asset first for instant <1s delivery, falling back to live synthesis.
   */
  public static async getCardosoPromoVoiceNote(): Promise<PodcastSynthesisResult | null> {
    if (this.cachedPromoOgg && this.cachedPromoOgg.buffer.length > 256) {
      return this.cachedPromoOgg;
    }

    const candidates = [
      path.join(process.cwd(), 'assets', 'audio', 'cardoso-ai-safa-mohamed-promo.ogg'),
      path.join(process.cwd(), 'assets', 'audio', 'cardoso-ai-muuse-ubax-promo.ogg'),
    ];
    for (const prebuiltPath of candidates) {
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
              transcript: this.formatPodcastTranscript(DEFAULT_CARDOSO_PROMO_DIALOGUE),
              turns: DEFAULT_CARDOSO_PROMO_DIALOGUE,
            };
            return this.cachedPromoOgg;
          }
        }
      } catch {}
    }

    const live = await this.synthesizeSomaliDialogue(DEFAULT_CARDOSO_PROMO_DIALOGUE, {
      outputFormat: 'ogg',
      defaultPauseMs: 220,
      soundMode: 'chime',
    });
    if (live) {
      this.cachedPromoOgg = live;
    }
    return live;
  }

  /**
   * Renders a 9:16 WhatsApp Status / TikTok MP4 Video Audiogram from any synthesized podcast audio.
   */
  public static async renderPodcastVideoAudiogram(
    audioBuffer: Buffer,
    options?: { title?: string; styleLabel?: string }
  ): Promise<Buffer> {
    return renderPodcastVideoAudiogram(audioBuffer, options);
  }

  /**
   * Synthesizes a world-class, broadcast-mastered Somali Podcast conversation between
   * Safa (so-SO-UbaxNeural) and Mohamed (so-SO-MuuseNeural) with dynamic emotion prosody,
   * snappy conversational pacing, optional Intro/Outro Studio Chime or Soft Ambient Bed,
   * broadcast EQ/compressor mastering, and subtle stereo host staging (on MP3)!
   */
  public static async synthesizeSomaliDialogue(
    turns: DialogueTurn[],
    options?: {
      outputFormat?: 'mp3' | 'ogg';
      defaultPauseMs?: number;
      soundMode?: PodcastSoundMode;
      masterAudio?: boolean;
    }
  ): Promise<PodcastSynthesisResult | null> {
    const validTurns = (turns || [])
      .map((t) => {
        const speaker = normalizePodcastSpeaker(t.speaker);
        const extracted = this.extractEmotionAndCleanLine(String(t.text || ''));
        const emotion: PodcastEmotion = t.emotion || extracted.emotion;
        const text = this.cleanTextForSpeech(extracted.text, 'so');
        return {
          speaker,
          text,
          emotion,
          pauseAfterMs: t.pauseAfterMs,
        };
      })
      .filter((t) => t.text.length > 0)
      .slice(0, 42);

    if (validTurns.length === 0) return null;

    const outputFormat = options?.outputFormat === 'ogg' ? 'ogg' : 'mp3';
    const isStereo = outputFormat === 'mp3';
    const defaultPauseMs = Math.max(0, Math.min(1200, options?.defaultPauseMs ?? 110));
    const soundMode: PodcastSoundMode = options?.soundMode || 'chime';
    const masterAudio = options?.masterAudio !== false;

    // 1. Synthesize each dialogue turn with per-turn micro-prosody jitter & trim Edge TTS dead silence!
    const mixSegments: HumanMixSegment[] = [];

    for (let i = 0; i < validTurns.length; i++) {
      const turn = validTurns[i];
      const voiceName = turn.speaker === 'safa' ? 'so-SO-UbaxNeural' : 'so-SO-MuuseNeural';
      const prosody = this.prosodyForEmotion(turn.emotion, i);
      let audioBuf: Buffer | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await this.synthesizeSingleAttempt(turn.text, voiceName, 'so', prosody);
        if (res && res.buffer.length > 0) {
          audioBuf = res.buffer;
          break;
        }
        if (attempt === 1) await new Promise((r) => setTimeout(r, 350));
      }

      if (!audioBuf || audioBuf.length === 0) {
        throw new Error(`Codka qaybta #${i + 1} (${turn.speaker}) lama samayn karin`);
      }

      const trimmedPcm = await decodeTrimmedMonoPcm48k(audioBuf);
      if (trimmedPcm.length === 0) {
        throw new Error(`Codka qaybta #${i + 1} (${turn.speaker}) wuu madhan yahay`);
      }

      mixSegments.push({
        speaker: turn.speaker,
        emotion: turn.emotion,
        samples: trimmedPcm,
        pauseAfterMs: turn.pauseAfterMs,
      });
    }

    // 2. Assemble sample-accurate Human Timeline:
    //    - Real human voice overlap (-140ms..-210ms) on [debate], [laugh], & [backchannel]
    //    - Continuous -48dB velvety Studio Room Tone (zero digital vacuum!)
    //    - Overlapping Intro/Outro Studio Chimes & Sidechain Auto-Ducking Ambient Bed
    const mixed = mixHumanPodcastTimeline(mixSegments, {
      isStereo,
      soundMode,
      defaultPauseMs,
    });

    // 3. Single fast Broadcast Mastering Pass (Warm EQ + 18ms Studio Booth Ambience + Compressor + Limiter)
    let finalBuf: Buffer = await encodeMasteredPodcastAudio(mixed.wavBuffer, {
      outputFormat,
      masterAudio,
    });

    if (outputFormat === 'ogg' && finalBuf.slice(0, 4).toString('ascii') !== 'OggS') {
      finalBuf = await this.convertMediaToOggOpusStrict(finalBuf);
    }

    const seconds =
      outputFormat === 'ogg'
        ? getOggOpusDurationSeconds(finalBuf)
        : mixed.totalSeconds;

    return {
      buffer: finalBuf,
      mimeType: outputFormat === 'ogg' ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
      turnCount: mixSegments.length,
      seconds,
      waveform: generateSpeechWaveform(finalBuf),
      transcript: this.formatPodcastTranscript(validTurns),
      turns: validTurns,
    };
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

  private static synthesizeSingleAttempt(
    clean: string,
    voiceName: string,
    language: string = 'so',
    prosody?: { rate?: string; pitch?: string }
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
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
            rate: prosody?.rate || (language === 'so' ? '-4%' : '-2%'),
            pitch: prosody?.pitch || '+0Hz',
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

