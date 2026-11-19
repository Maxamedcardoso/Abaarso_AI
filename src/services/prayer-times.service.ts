import { VoiceReplyService } from './voice-reply.service.js';

export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface PrayerDefinition {
  key: PrayerKey;
  somaliName: string;
  arabicName: string;
  hour: number;
  minute: number;
  isFajr?: boolean;
}

export interface TodayPrayerSchedule {
  dateStr: string;
  prayers: PrayerDefinition[];
}

/**
 * PrayerTimesService — 100% Autonomous Islamic Prayer Times, Athan & Du'a Engine
 *
 * Capabilities:
 * 1. Computes accurate daily prayer times for Somalia & East Africa (UTC+3 / EAT).
 * 2. Auto-notifies groups with a reverent, beautifully formatted text reminder.
 * 3. Sends authentic Voice Note Athan (Ogg Opus / MP3 with PTT waveform).
 * 4. Sends authentic Sunnah Du'a after Athan in text and Voice Note.
 * 5. Prevents duplicate alerts (exactly once per prayer per day per group).
 */
export class PrayerTimesService {
  // Monthly solar offset table for Somalia (Mogadishu/Hargeisa/Garowe, UTC+3)
  // [Fajr, Dhuhr, Asr, Maghrib, Isha]
  private static readonly MONTHLY_SCHEDULES: Record<number, Array<{ h: number; m: number }>> = {
    0:  [{ h: 4, m: 50 }, { h: 12, m: 5 },  { h: 15, m: 25 }, { h: 18, m: 2 },  { h: 19, m: 12 }], // Jan
    1:  [{ h: 4, m: 52 }, { h: 12, m: 8 },  { h: 15, m: 26 }, { h: 18, m: 8 },  { h: 19, m: 16 }], // Feb
    2:  [{ h: 4, m: 48 }, { h: 12, m: 5 },  { h: 15, m: 20 }, { h: 18, m: 8 },  { h: 19, m: 16 }], // Mar
    3:  [{ h: 4, m: 40 }, { h: 12, m: 0 },  { h: 15, m: 12 }, { h: 18, m: 6 },  { h: 19, m: 15 }], // Apr
    4:  [{ h: 4, m: 33 }, { h: 11, m: 57 }, { h: 15, m: 10 }, { h: 18, m: 6 },  { h: 19, m: 17 }], // May
    5:  [{ h: 4, m: 35 }, { h: 12, m: 0 },  { h: 15, m: 16 }, { h: 18, m: 11 }, { h: 19, m: 23 }], // Jun
    6:  [{ h: 4, m: 40 }, { h: 12, m: 4 },  { h: 15, m: 19 }, { h: 18, m: 16 }, { h: 19, m: 27 }], // Jul
    7:  [{ h: 4, m: 42 }, { h: 12, m: 4 },  { h: 15, m: 16 }, { h: 18, m: 13 }, { h: 19, m: 22 }], // Aug
    8:  [{ h: 4, m: 38 }, { h: 11, m: 58 }, { h: 15, m: 8 },  { h: 18, m: 4 },  { h: 19, m: 12 }], // Sep
    9:  [{ h: 4, m: 32 }, { h: 11, m: 52 }, { h: 15, m: 4 },  { h: 17, m: 55 }, { h: 19, m: 4 }],  // Oct
    10: [{ h: 4, m: 32 }, { h: 11, m: 51 }, { h: 15, m: 8 },  { h: 17, m: 52 }, { h: 19, m: 3 }],  // Nov
    11: [{ h: 4, m: 40 }, { h: 11, m: 57 }, { h: 15, m: 18 }, { h: 17, m: 57 }, { h: 19, m: 8 }],  // Dec
  };

  private static readonly PRAYER_METADATA: Array<{ key: PrayerKey; somaliName: string; arabicName: string; isFajr?: boolean }> = [
    { key: 'fajr', somaliName: 'Subax', arabicName: 'الفجر', isFajr: true },
    { key: 'dhuhr', somaliName: 'Duhur', arabicName: 'الظهر' },
    { key: 'asr', somaliName: 'Casar', arabicName: 'العصر' },
    { key: 'maghrib', somaliName: 'Maqrib', arabicName: 'المغرب' },
    { key: 'isha', somaliName: 'Cishe', arabicName: 'العشاء' },
  ];

  /** Cache of synthesized audio buffers to avoid duplicate TTS calls across multiple groups */
  private athanAudioCache: Map<string, { buffer: Buffer; mimeType: string; timestamp: number }> = new Map();
  private duaAudioCache?: { buffer: Buffer; mimeType: string; timestamp: number };

  /** Track prayers already posted today per group: Map<dateKey, Set<prayerKey>> */
  private postedPrayers: Map<string, Set<string>> = new Map();

  /**
   * Returns current East Africa Time (UTC+3) Date object.
   */
  public getEATDate(customDate?: Date): Date {
    const base = customDate || new Date();
    // Convert to UTC+3 (Somalia standard time)
    const utc = base.getTime() + base.getTimezoneOffset() * 60000;
    return new Date(utc + 3 * 3600000);
  }

  /**
   * Generates the 5 daily prayer times for a given date in East Africa Time.
   */
  public getTodaySchedule(customDate?: Date): TodayPrayerSchedule {
    const eat = this.getEATDate(customDate);
    const month = eat.getMonth();
    const table = PrayerTimesService.MONTHLY_SCHEDULES[month] || PrayerTimesService.MONTHLY_SCHEDULES[0];

    const prayers: PrayerDefinition[] = PrayerTimesService.PRAYER_METADATA.map((meta, idx) => {
      const time = table[idx] || { h: 12, m: 0 };
      return {
        ...meta,
        hour: time.h,
        minute: time.m,
      };
    });

    const y = eat.getFullYear();
    const m = String(eat.getMonth() + 1).padStart(2, '0');
    const d = String(eat.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    return { dateStr, prayers };
  }

  /**
   * Formats prayer hour and minute to standard HH:MM format.
   */
  public formatTime(hour: number, minute: number): string {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * Checks if a prayer is currently due at the given minute for a group.
   * Returns the due prayer definition or null if no prayer is due or already notified today.
   */
  public checkDuePrayer(groupJid: string, customDate?: Date): PrayerDefinition | null {
    const eat = this.getEATDate(customDate);
    const currentHour = eat.getHours();
    const currentMinute = eat.getMinutes();

    const schedule = this.getTodaySchedule(customDate);
    const groupDateKey = `${schedule.dateStr}:${groupJid}`;
    let postedSet = this.postedPrayers.get(groupDateKey);
    if (!postedSet) {
      postedSet = new Set();
      this.postedPrayers.set(groupDateKey, postedSet);
    }

    for (const prayer of schedule.prayers) {
      if (prayer.hour === currentHour && prayer.minute === currentMinute) {
        if (!postedSet.has(prayer.key)) {
          return prayer;
        }
      }
    }

    return null;
  }

  /**
   * Records that a prayer was successfully notified for a group today.
   */
  public markPrayerPosted(groupJid: string, prayerKey: PrayerKey, customDate?: Date): void {
    const schedule = this.getTodaySchedule(customDate);
    const groupDateKey = `${schedule.dateStr}:${groupJid}`;
    let postedSet = this.postedPrayers.get(groupDateKey);
    if (!postedSet) {
      postedSet = new Set();
      this.postedPrayers.set(groupDateKey, postedSet);
    }
    postedSet.add(prayerKey);
  }

  /**
   * Generates the reverent Somali & Arabic text reminder for a prayer.
   */
  public getPrayerReminderText(prayer: PrayerDefinition): string {
    const timeFormatted = this.formatTime(prayer.hour, prayer.minute);
    const fajrExtra = prayer.isFajr ? '\n🌙 *Xusuusin:* «الصَّلَاةُ خَيْرٌ مِنَ النَّوْمِ» — _Salaaddu waxay ka khayr badan tahay hurdada._\n' : '';

    return (
      `🕌✨ *[XUSUUSINTA SALAADDA: SALAADDA ${prayer.somaliName.toUpperCase()} / صَلَاةُ ${prayer.arabicName}]* ✨🕌\n\n` +
      `🕐 *Waqtiga:* \`${timeFormatted}\` (Waqtiga Geeska Afrika / EAT)\n` +
      `📢 *Ogeysiis:* Waxaa la gaadhay xilligii salaadda barakeysan ee *${prayer.somaliName}*.\n` +
      fajrExtra +
      `\n📖 *Aayadda Qur'aanka:*` +
      `\n_«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا»_` +
      `\n_"Xaqiiqdii salaaddu waxay ku tahay mu'miniinta waajib waqtiyeysan oo go'an."_ [An-Nisa: 103]\n\n` +
      `💡 Fadlan u kiciya weesada iyo gudashada salaadda adigoo jamaaco raadinaya.` +
      `\n🎧 _Hoos ka dhageyso Eedanka tooska ah iyo Ducada eedanka kaddib..._ 🤲`
    );
  }

  /**
   * Returns authentic Arabic text of Athan for speech synthesis.
   */
  public getAthanSpeechText(isFajr: boolean = false): string {
    const fajrLine = isFajr ? ' الصَّلَاةُ خَيْرٌ مِنَ النَّوْمِ، الصَّلَاةُ خَيْرٌ مِنَ النَّوْمِ.' : '';
    return (
      `اللهُ أَكْبَرُ، اللهُ أَكْبَرُ. ` +
      `اللهُ أَكْبَرُ، اللهُ أَكْبَرُ. ` +
      `أَشْهَدُ أَنْ لَا إِلٰهَ إِلَّا اللهُ. ` +
      `أَشْهَدُ أَنْ لَا إِلٰهَ إِلَّا اللهُ. ` +
      `أَشْهَدُ أَنَّ مُحَمَّدًا رَسُولُ اللهِ. ` +
      `أَشْهَدُ أَنَّ مُحَمَّدًا رَسُولُ اللهِ. ` +
      `حَيَّ عَلَى الصَّلَاةِ، حَيَّ عَلَى الصَّلَاةِ. ` +
      `حَيَّ عَلَى الْفَلَاحِ، حَيَّ عَلَى الْفَلَاحِ.` +
      fajrLine +
      ` اللهُ أَكْبَرُ، اللهُ أَكْبَرُ. ` +
      `لَا إِلٰهَ إِلَّا اللهُ.`
    );
  }

  /**
   * Returns authentic Sunnah Du'a after Athan in text (Arabic + Somali meaning).
   */
  public getDuaAfterAthanText(): string {
    return (
      `🤲✨ *[DUCADII EEDANKA KADDIB & DHIIRIGELINTA]* ✨🤲\n\n` +
      `_اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلَاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ._\n\n` +
      `💡 *Macnaha:*` +
      `\n_"Ilaahayow, Rabbiga baaqan qumman iyo salaaddan taagan, sii Nebi Muxammad (SCW) darajada sare iyo fadliga, una soo bixi booska ammaananka badan ee aad u yaboohday."_ [Saxiixul Bukhaari]\n\n` +
      `🤲 _Ilaahay ha naga aqbalo dhammaanteen salaadaha, ducada iyo camallada wanaagsan. Aamiin yaa Rabbal Caalamiin!_ 🌟`
    );
  }

  /**
   * Generates or fetches cached Athan audio buffer (Voice Note / Ogg Opus).
   */
  public async getAthanAudio(isFajr: boolean = false): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const cacheKey = isFajr ? 'athan_fajr' : 'athan_standard';
    const cached = this.athanAudioCache.get(cacheKey);
    const oneDay = 24 * 60 * 60 * 1000;
    if (cached && Date.now() - cached.timestamp < oneDay) {
      return { buffer: cached.buffer, mimeType: cached.mimeType };
    }

    try {
      const speechText = this.getAthanSpeechText(isFajr);
      const voiceResult = await VoiceReplyService.synthesizeVoice(speechText, 'ar');
      if (voiceResult && voiceResult.buffer.length > 0) {
        this.athanAudioCache.set(cacheKey, {
          buffer: voiceResult.buffer,
          mimeType: voiceResult.mimeType,
          timestamp: Date.now(),
        });
        return voiceResult;
      }
    } catch (err: any) {
      console.warn(`[PrayerTimesService] Athan audio generation warning: ${err?.message}`);
    }
    return null;
  }

  /**
   * Generates or fetches cached Du'a after Athan audio buffer (Voice Note / Ogg Opus).
   */
  public async getDuaAudio(): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const oneDay = 24 * 60 * 60 * 1000;
    if (this.duaAudioCache && Date.now() - this.duaAudioCache.timestamp < oneDay) {
      return { buffer: this.duaAudioCache.buffer, mimeType: this.duaAudioCache.mimeType };
    }

    try {
      const duaSpeech =
        `اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلَاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ. ` +
        `Ilaahayow naga aqbal salaadaha iyo camallada wanaagsan, dhammaanteenna noo dambi dhaaf. Aamiin yaa Rabbal Caalamiin!`;
      const voiceResult = await VoiceReplyService.synthesizeVoice(duaSpeech, 'ar');
      if (voiceResult && voiceResult.buffer.length > 0) {
        this.duaAudioCache = {
          buffer: voiceResult.buffer,
          mimeType: voiceResult.mimeType,
          timestamp: Date.now(),
        };
        return voiceResult;
      }
    } catch (err: any) {
      console.warn(`[PrayerTimesService] Du'a audio generation warning: ${err?.message}`);
    }
    return null;
  }

  /**
   * Returns a complete daily prayer times summary text for the group command `!salaad`.
   */
  public getScheduleSummaryText(customDate?: Date): string {
    const schedule = this.getTodaySchedule(customDate);
    const eat = this.getEATDate(customDate);
    const currentTotalMinutes = eat.getHours() * 60 + eat.getMinutes();

    let out =
      `🕌✨ *[JADWALKA SALAADDA EE MAANTA — GEESKA AFRIKA / EAT]* ✨🕌\n` +
      `📅 *Taariikhda:* \`${schedule.dateStr}\` | 📍 *Magaalooyinka:* Muqdisho, Hargeysa, Garoowe, Kismaayo\n\n`;

    let nextPrayer: PrayerDefinition | null = null;
    let minutesUntilNext = Infinity;

    schedule.prayers.forEach((p, idx) => {
      const pMinutes = p.hour * 60 + p.minute;
      const isPassed = currentTotalMinutes > pMinutes;
      const statusIcon = isPassed ? '✅' : '⏳';
      out += `${idx + 1}. *Salaadda ${p.somaliName}* (${p.arabicName}): \`${this.formatTime(p.hour, p.minute)}\` ${statusIcon}\n`;

      if (!isPassed && (pMinutes - currentTotalMinutes) < minutesUntilNext) {
        minutesUntilNext = pMinutes - currentTotalMinutes;
        nextPrayer = p;
      }
    });

    if (nextPrayer) {
      const nextP: PrayerDefinition = nextPrayer;
      const hrs = Math.floor(minutesUntilNext / 60);
      const mins = minutesUntilNext % 60;
      const remainingStr = hrs > 0 ? `${hrs} saac iyo ${mins} daqiiqo` : `${mins} daqiiqo`;
      out += `\n⏰ *Salaadda Xigta:* *${nextP.somaliName}* (\`${this.formatTime(nextP.hour, nextP.minute)}\`)\n` +
             `⏳ *Waxaa ka harsan:* \`${remainingStr}\`\n`;
    } else {
      out += `\n✅ Dhammaan 5-tii salaadood ee maanta waqtigoodii waa la gaadhay. Ilaahay ha aqbalo!\n`;
    }

    out += `\n🤖 _Cardoso AI wuxuu si toos ah kooxda ugu soo dirayaa Eedan cod ah iyo Duco xilliga salaad kasta._`;
    return out;
  }
}

export const prayerTimesService = new PrayerTimesService();
