import fs from 'fs';
import path from 'path';
import { IMessagingTransport } from '../transports/transport.interface.js';
import { VoiceReplyService } from './voice-reply.service.js';

/**
 * Section 2: Official Somali Voice Advertisement Script
 */
export const ABAARSO_VOICE_AD_SCRIPT = `📢 BISHAARO! BISHAARO! BISHAARO!

Ma doonaysaa inaad mustaqbalkaaga dhisato? Ma raadinaysaa jaamacad kugu habboon oo aad ka heli karto aqoon iyo xirfad kuu horseeda inaad gaadho himilooyinkaaga?

Haddaba, war wanaagsan ayaannu kuu haynaa!

Abaarso Tech University – Berbera Campus ayaa kuu furaysa albaabka aqoonta, hal-abuurka iyo horumarka.

Haddii aad ku hammiyaysay inaad noqoto injineer software oo tiknoolajiyadda wax ku soo kordhiya, xirfadle caafimaad oo bulshada u adeega, ganacsade, khabiir maaliyadeed ama sharci yaqaan, Abaarso waxay kuu haysaa barnaamijyo waxbarasho oo kala duwan oo aad ka dhex dooran karto.

Waxaa ka mid ah Software Engineering, Clinical Nursing, Midwifery, Medical Laboratory Sciences, Nutrition and Food Sciences, Accounting and Finance, Business Administration, Human Resource Management, Islamic Banking and Finance, Law, Information and Communications Technologies, Logistics and Procurement iyo barnaamijyo kale oo badan!

Jaamacaddu waxay xoogga saartaa kobcinta aqoonta iyo xirfadaha ardayda, si ay u noqdaan dad awood u leh inay horumariyaan naftooda iyo bulshadooda.

Waxaa tusaale u ah Maxamed Daahir, aasaasaha Cardoso AI, oo aqoontiisa iyo xirfaddiisa u adeegsanaya hal-abuurka iyo tiknoolajiyadda.

Haddaba, ha lumin fursaddaada waxbarasho!

Diiwaangelinta sannad-dugsiyeedka cusub ee 2026/2027 way socotaa!

Diiwaangelintu waxay ka socotaa labada gelinba: subaxdii siddeedda ilaa laba iyo tobanka duhurnimo, iyo galabtii afarta ilaa siddeedda fiidnimo.

Waxaad iska diiwaangelin kartaa xarunta Jaamacadda Abaarso Tech ee magaalada Berbera, dhismaha Fooqa Kayd, una dhow Masaajidka Caynu-Raxma ama Wasaaradda Waxbarashada.

Hore u gaadh, qaado tallaabada koowaad ee safarkaaga waxbarasho.

Abaarso Tech University – Berbera Campus!

Aqoontaada kobci, kartidaada muuji, himilooyinkaagana xaqiiji!

MUSTAQBALKAAGA BERRI MAANTA DHIS!`;

/**
 * Phonetically tuned script for natural Somali radio-announcer delivery via Edge TTS
 */
export const ABAARSO_VOICE_AD_SPEECH_TEXT = `Bishaaro! Bishaaro! Bishaaro!

Ma doonaysaa inaad mustaqbalkaaga dhisato? Ma raadinaysaa jaamacad kugu habboon oo aad ka heli karto aqoon iyo xirfad kuu horseeda inaad gaadho himilooyinkaaga?

Haddaba, war wanaagsan ayaannu kuu haynaa!

Abaarso Tek Yuunifarsiti – Berbera Kambas ayaa kuu furaysa albaabka aqoonta, hal-abuurka iyo horumarka.

Haddii aad ku hammiyaysay inaad noqoto injineer software oo tiknoolajiyadda wax ku soo kordhiya, xirfadle caafimaad oo bulshada u adeega, ganacsade, khabiir maaliyadeed ama sharci yaqaan, Abaarso waxay kuu haysaa barnaamijyo waxbarasho oo kala duwan oo aad ka dhex dooran karto.

Waxaa ka mid ah Softweer Injineering, Klinikal Narsing, Mid-wifari, Medikal Laboratori Saayansis, Nuutrishan and Fuud Saayansis, Akaawnting and Faynaans, Biznis Administreeshan, Hyuuman Risoors Maneejment, Islaamik Baanking and Faynaans, Loo, Infarmeeshan and Komyunikeeshans Teknolojis, Lojistiks and Prokyuurment, iyo barnaamijyo kale oo badan!

Jaamacaddu waxay xoogga saartaa kobcinta aqoonta iyo xirfadaha ardayda, si ay u noqdaan dad awood u leh inay horumariyaan naftooda iyo bulshadooda.

Waxaa tusaale u ah Maxamed Daahir, aasaasaha Kaardooso Ey-Ay, oo aqoontiisa iyo xirfaddiisa u adeegsanaya hal-abuurka iyo tiknoolajiyadda.

Haddaba, ha lumin fursaddaada waxbarasho!

Diiwaangelinta sannad-dugsiyeedka cusub ee laba kun lix iyo labaatan ilaa laba kun toddoba iyo labaatan way socotaa!

Diiwaangelintu waxay ka socotaa labada gelinba: subaxdii siddeedda ilaa laba iyo tobanka duhurnimo, iyo galabtii afarta ilaa siddeedda fiidnimo.

Waxaad iska diiwaangelin kartaa xarunta Jaamacadda Abaarso Tech ee magaalada Berbera, dhismaha Fooqa Kayd, una dhow Masaajidka Caynu Raxma ama Wasaaradda Waxbarashada.

Hore u gaadh, qaado tallaabada koowaad ee safarkaaga waxbarasho.

Abaarso Tek Yuunifarsiti – Berbera Kambas!

Aqoontaada kobci, kartidaada muuji, himilooyinkaagana xaqiiji!

Mustaqbalkaaga berri maanta dhis!`;

/**
 * Section 4: Registration Link WhatsApp Text Message
 */
export const ABAARSO_REGISTRATION_TEXT = `📲 *HADDA ONLINE ISKA DIIWAANGELI!*

Ha lumin fursaddaada waxbarasho. Guji link-ga hoose oo buuxi foomka isdiiwaangelinta.

👇 *LINK-GA ISDIIWAANGELINTA ONLINE-KA:*
https://docs.google.com/forms/d/1iKj1AimYF8DctgpTa--62AXmDytgTJOCQWN5wuBB2bM/edit?pli=1`;

/**
 * Section 5: The 15 Official ATU Degree Programs
 */
export const ABAARSO_DEGREE_PROGRAMS = [
  'Bachelor in Clinical Nursing',
  'Bachelor in Midwifery',
  'Bachelor in Medical Laboratory Sciences',
  'Bachelor in Nutrition and Food Sciences',
  'Bachelor of Arts in Accounting and Finance (BAF)',
  'Bachelor of Business Administration',
  'Bachelor in Human Resource Management',
  'Bachelor in Islamic Banking and Finance',
  'Bachelor of Social Work (BSW)',
  'Bachelor of Laws (LLB)',
  'Bachelor in Informational and Communications Technologies',
  'Bachelor of Logistics and Procurement',
  'Bachelor of Software Engineering',
  'Bachelor of Business Management and Economics',
  'Bachelor of Development Studies',
] as const;

/**
 * Section 6: Official Admission Information
 */
export const ABAARSO_ADMISSION_INFO = {
  university: 'Abaarso Tech University (ATU)',
  campus: 'Berbera Campus, Somaliland',
  academicYear: '2026/2027',
  registrationStatus: 'Ongoing (Way socotaa)',
  morningHours: '8:00 AM – 12:00 PM (8:00 subaxnimo ilaa 12:00 duhurnimo)',
  afternoonHours: '4:00 PM – 8:00 PM (4:00 galabnimo ilaa 8:00 fiidnimo)',
  physicalLocation: 'Fooqa Kayd building, near Caynu-Raxma Mosque or the Ministry of Education, Berbera (Dhismaha Fooqa Kayd, una dhow Masaajidka Caynu-Raxma ama Wasaaradda Waxbarashada, Berbera)',
  onlineRegistrationLink: 'https://docs.google.com/forms/d/1iKj1AimYF8DctgpTa--62AXmDytgTJOCQWN5wuBB2bM/edit?pli=1',
  followUpNote: 'Ka dib marka aad foomka online-ka buuxiso, maamulka jaamacadda ayaa kula soo xidhiidhi doona si loo dhamaystiro diiwaangelintaada.',
};

/**
 * Section 7: Mandatory Screening Question for Course Advising
 */
export const ABAARSO_SCREENING_QUESTION =
  'Si aan kuugu doorto course kugu habboon, maxaad ku fiican tahay, maxaadse xiisaysaa? Ma jeceshahay technology, caafimaadka, ganacsiga, sharciga mise inaad bulshada caawiso?';

export class AbaarsoAdService {
  private static cachedAudioBuffer: Buffer | null = null;
  private static cachedMimeType: string = 'audio/ogg; codecs=opus';
  private static cacheFilePath = path.join(process.cwd(), 'data', 'abaarso_ad_voice.ogg');

  /**
   * Checks disk cache or synthesizes the official Somali radio commercial voice advertisement.
   */
  public static async getOrGenerateAdAudio(): Promise<{ buffer: Buffer; mimeType: string } | null> {
    // 1. In-memory cache
    if (this.cachedAudioBuffer && this.cachedAudioBuffer.length > 1000) {
      return { buffer: this.cachedAudioBuffer, mimeType: this.cachedMimeType };
    }

    // 2. Disk cache
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const stats = fs.statSync(this.cacheFilePath);
        if (stats.size > 1000) {
          const diskBuffer = fs.readFileSync(this.cacheFilePath);
          this.cachedAudioBuffer = diskBuffer;
          console.log(`[AbaarsoAdService] Loaded cached ad voice audio from disk (${diskBuffer.length} bytes)`);
          return { buffer: diskBuffer, mimeType: this.cachedMimeType };
        }
      }
    } catch (readErr: any) {
      console.warn('[AbaarsoAdService] Error reading disk audio cache:', readErr.message);
    }

    // 3. Generate speech using VoiceReplyService
    console.log('[AbaarsoAdService] Synthesizing Abaarso voice advertisement audio via Edge Neural TTS...');
    try {
      const result = await VoiceReplyService.synthesizeVoice(ABAARSO_VOICE_AD_SPEECH_TEXT, 'so');
      if (result && result.buffer && result.buffer.length > 1000) {
        this.cachedAudioBuffer = result.buffer;
        this.cachedMimeType = result.mimeType || 'audio/ogg; codecs=opus';

        // Ensure data directory exists
        const dataDir = path.dirname(this.cacheFilePath);
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(this.cacheFilePath, result.buffer);
        console.log(`[AbaarsoAdService] Successfully synthesized and cached ad audio (${result.buffer.length} bytes) to ${this.cacheFilePath}`);
        return { buffer: result.buffer, mimeType: this.cachedMimeType };
      }
    } catch (err: any) {
      console.error('[AbaarsoAdService] Failed to synthesize ad voice audio:', err.message);
    }

    return null;
  }

  /**
   * Delivers the official Abaarso University advertisement workflow:
   * 1. Send Voice Message ONLY.
   * 2. Wait for WhatsApp confirmation of successful delivery.
   * 3. Only AFTER delivery confirmation, send registration link as a separate text message.
   */
  public static async deliverAdvertisement(chatId: string, transport: IMessagingTransport): Promise<boolean> {
    if (!transport.sendMedia) {
      console.error('[AbaarsoAdService] Transport does not support sendMedia; cannot deliver voice advertisement.');
      return false;
    }

    const audioData = await this.getOrGenerateAdAudio();
    if (!audioData) {
      console.error('[AbaarsoAdService] Voice advertisement audio unavailable; cannot deliver advertisement.');
      return false;
    }

    console.log(`🎙️ [AbaarsoAdService] Step 1: Sending Somali Voice Advertisement to ${chatId}...`);
    const voiceSent = await transport.sendMedia(chatId, {
      type: 'audio',
      dataBuffer: audioData.buffer,
      mimeType: audioData.mimeType,
      ptt: true,
    });

    if (!voiceSent) {
      console.warn(`⚠️ [AbaarsoAdService] Voice message delivery failed to ${chatId}. Registration link will NOT be sent.`);
      return false;
    }

    console.log(`✅ [AbaarsoAdService] Step 2: Voice message delivered! Step 3: Sending registration link text...`);
    // Brief breath pause (600ms) before sending follow-up text link
    await new Promise(resolve => setTimeout(resolve, 600));

    await transport.sendMessage(chatId, ABAARSO_REGISTRATION_TEXT);
    console.log(`🎉 [AbaarsoAdService] Registration link sent to ${chatId}. Workflow complete.`);
    return true;
  }
}
