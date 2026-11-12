import { ABAARSO_DEGREE_PROGRAMS, ABAARSO_ADMISSION_INFO, ABAARSO_SCREENING_QUESTION } from '../services/abaarso-ad.service.js';

export class AcademicAdvisor {
  /**
   * Generates a tailored study plan template in Somali or English.
   */
  public static getStudyScheduleGuidance(language: 'so' | 'en' | 'mixed'): string {
    if (language === 'en') {
      return `
*📚 Recommended Study Method: Pomodoro Technique & Spaced Repetition*

1. *Focus Blocks:* 25 minutes of deep, uninterrupted study followed by a 5-minute break.
2. *Deep Cycle:* After 4 cycles (2 hours), take a longer 20-30 minute restorative break.
3. *Active Recall:* Instead of re-reading notes, close your notebook and write down everything you remember from memory.
4. *Feynman Technique:* Try explaining the difficult topic in simple words as if teaching a beginner.
`;
    }

    // Somali / Mixed
    return `
*📚 Talo Qorshe Waxbarasho: Habka Pomodoro & Ku-celcelinta Maanka*

1. *25 Daqiiqo oo Xoog-saaris ah:* Dhig taleefanka meel ka fog, 25 daqiiqo wax akhri adigoon wax kale ku mashquulin.
2. *5 Daqiiqo oo Nasasho ah:* Neefso, biyo cab, oo indhaha nasii.
3. *Nasasho Dheer:* Markaad 4 wareeg samayso (2 saacadood), qaado 20-30 daqiiqo oo nasasho ah.
4. *Active Recall (Xusuusin Toos ah):* Ha ku ekaan akhris kaliya; buugga xir oo warqad cad ku qor waxaad xusuusato.
5. *Feynman Technique:* Casharka aad fahmeysay isku day inaad qof kale si fudud ugu sharaxdo.
`;
  }

  /**
   * Returns the official Abaarso Tech University (Berbera Campus) degree programs list.
   */
  public static getAbaarsoDegreeProgramsList(language: 'so' | 'en' | 'mixed' = 'so'): string {
    const list = ABAARSO_DEGREE_PROGRAMS.map((prog, idx) => `${idx + 1}. *${prog}*`).join('\n');
    if (language === 'en') {
      return `🎓 *Abaarso Tech University (Berbera Campus) — Degree Programs:*\n\n${list}\n\nTo apply online: ${ABAARSO_ADMISSION_INFO.onlineRegistrationLink}`;
    }
    return `🎓 *Jaamacadda Abaarso Tech (Berbera Campus) — Barnaamijyada Shahaadada Koowaad (Degrees):*\n\n${list}\n\n👇 *Link-ga Isdiiwaangelinta Online-ka:*\n${ABAARSO_ADMISSION_INFO.onlineRegistrationLink}`;
  }

  /**
   * Returns official admission instructions including registration hours, location, and online form.
   */
  public static getAbaarsoAdmissionDetails(language: 'so' | 'en' | 'mixed' = 'so'): string {
    if (language === 'en') {
      return `📋 *Abaarso Tech University – Berbera Campus Admission (2026/2027)*\n\nRegistration is currently **ongoing**! You can register either in person or online:\n\n🏢 *Physical Registration:*\n• *Location:* ${ABAARSO_ADMISSION_INFO.physicalLocation}\n• *Morning Hours:* 8:00 AM – 12:00 PM\n• *Afternoon Hours:* 4:00 PM – 8:00 PM\n\n📲 *Online Registration:*\n${ABAARSO_ADMISSION_INFO.onlineRegistrationLink}\n\nAfter submitting the online form, the admissions office will contact you to finalize your admission.`;
    }

    return `📋 *Diiwaangelinta Jaamacadda Abaarso Tech – Berbera Campus (Sannadka 2026/2027)*\n\nDiiwaangelinta ardayda cusub **way socotaa**! Waxaad isku diiwaangelin kartaa laba hab:\n\n🏢 *1. Diiwaangelin Toos ah (Xarunta Jaamacadda):*\n• *Goobta:* ${ABAARSO_ADMISSION_INFO.physicalLocation}\n• *Subaxdii:* ${ABAARSO_ADMISSION_INFO.morningHours}\n• *Galabtii:* ${ABAARSO_ADMISSION_INFO.afternoonHours}\n\n📲 *2. Diiwaangelinta Online-ka:* Buuxi foomka hoose:\n${ABAARSO_ADMISSION_INFO.onlineRegistrationLink}\n\nMarkaad buuxiso foomka, maamulka jaamacadda ayaa kula soo xidhiidhi doona.`;
  }

  /**
   * Section 7: Course screening question to understand student preferences.
   */
  public static getScreeningQuestion(): string {
    return ABAARSO_SCREENING_QUESTION;
  }

  /**
   * Recommends one of the 15 ATU degree programs based on user interests.
   */
  public static matchDegreeProgram(interestText: string): { program: string; rationale: string } {
    const lower = interestText.toLowerCase();

    if (/(?:software|code|coding|barnaamij|programming|developer|computer|apps|web|tech|teknoolaji)/i.test(lower)) {
      return {
        program: 'Bachelor of Software Engineering',
        rationale: 'Waxay kugu habboon tahay maadaama aad xiisayso samaynta barnaamijyada kombiyuutarka, koodhka, iyo tiknoolajiyadda casriga ah.',
      };
    }
    if (/(?:it|network|information|technolog|ict)/i.test(lower)) {
      return {
        program: 'Bachelor in Informational and Communications Technologies',
        rationale: 'Waxay kugu habboon tahay maadaama aad danaynayso shabakadaha (networking), xogta kombiyuutarka, iyo nidaamyada IT-ga.',
      };
    }
    if (/(?:nurs|kalkaalis|caafimaad\s+(?:guud|bukaan))/i.test(lower)) {
      return {
        program: 'Bachelor in Clinical Nursing',
        rationale: 'Waxay kugu habboon tahay maadaama aad jeceshahay daryeelka tooska ah ee bukaanada iyo adeegyada caafimaadka bulshada.',
      };
    }
    if (/(?:midwif|umuliso|dhalmo|hooyo)/i.test(lower)) {
      return {
        program: 'Bachelor in Midwifery',
        rationale: 'Waxay kugu habboon tahay maadaama aad doonayso inaad caawiso daryeelka hooyada iyo dhallaanka xilliga uurka iyo dhalmada.',
      };
    }
    if (/(?:lab|shaybaar|medical\s*lab|dhiig|baadhitaan)/i.test(lower)) {
      return {
        program: 'Bachelor in Medical Laboratory Sciences',
        rationale: 'Waxay kugu habboon tahay maadaama aad xiisayso cilmi-baadhista shaybaarka caafimaadka iyo ogaanshaha cudurrada.',
      };
    }
    if (/(?:nutrit|cunto|nafaqo|food)/i.test(lower)) {
      return {
        program: 'Bachelor in Nutrition and Food Sciences',
        rationale: 'Waxay kugu habboon tahay haddii aad doonayso inaad barato cilmiga nafaqada, caafimaadka cuntada, iyo ilaalinta nolosha fayoow.',
      };
    }
    if (/(?:account|xisaab|finance|maaliy|baf)/i.test(lower)) {
      return {
        program: 'Bachelor of Arts in Accounting and Finance (BAF)',
        rationale: 'Waxay kugu habboon tahay maadaama aad ku fiican tahay xisaabaadka, maaraynta maaliyadda, iyo xisaabinta shirkadaha.',
      };
    }
    if (/(?:bank|bangig|islamic|maaliyadda\s+islaamka)/i.test(lower)) {
      return {
        program: 'Bachelor in Islamic Banking and Finance',
        rationale: 'Waxay kugu habboon tahay maadaama aad danaynayso bangiyada iyo nidaamyada maaliyadeed ee ku dhisan shareecada Islaamka.',
      };
    }
    if (/(?:business|ganacsi|maamul|bba)/i.test(lower)) {
      return {
        program: 'Bachelor of Business Administration',
        rationale: 'Waxay kugu habboon tahay maadaama aad xiisayso ganacsiga, hal-abuurka ganacsi, iyo maamulka shirkadaha.',
      };
    }
    if (/(?:hr|human\s*resource|shaqaale)/i.test(lower)) {
      return {
        program: 'Bachelor in Human Resource Management',
        rationale: 'Waxay kugu habboon tahay haddii aad jeceshahay maaraynta dadka, shaqaalaynta, iyo kobcinta kheyraadka aadanaha.',
      };
    }
    if (/(?:law|sharci|qaanuun|maxkamad|garsoor|llb)/i.test(lower)) {
      return {
        program: 'Bachelor of Laws (LLB)',
        rationale: 'Waxay kugu habboon tahay maadaama aad xiisayso u doodista caddaaladda, shuruucda dalka, iyo noqoshada sharci-yaqaan.',
      };
    }
    if (/(?:social\s*work|bulsho|caawin|daryeelka\s+bulshada|bsw)/i.test(lower)) {
      return {
        program: 'Bachelor of Social Work (BSW)',
        rationale: 'Waxay kugu habboon tahay haddii qalbigaagu jecel yahay u adeegidda danyarta iyo xallinta dhibaatooyinka bulshada.',
      };
    }
    if (/(?:logistics|procurement|sahay|keenis|gaadiid)/i.test(lower)) {
      return {
        program: 'Bachelor of Logistics and Procurement',
        rationale: 'Waxay kugu habboon tahay gaar ahaan Berbera oo ah magaalo dekedeed leh ganacsi iyo marinno caalami ah oo saadka ah.',
      };
    }
    if (/(?:economic|dhaqaale|management\s+and\s+economics)/i.test(lower)) {
      return {
        program: 'Bachelor of Business Management and Economics',
        rationale: 'Waxay kugu habboon tahay fahamka koboca dhaqaalaha, suuqyada, iyo maamulka ganacsiga heer qaran iyo mid caalami ah.',
      };
    }
    if (/(?:development|horumar|ngo|development\s+studies)/i.test(lower)) {
      return {
        program: 'Bachelor of Development Studies',
        rationale: 'Waxay kugu habboon tahay haddii aad doonayso inaad ka shaqeyso mashaariicda horumarinta dalka, hay’adaha, iyo bulshada.',
      };
    }

    return {
      program: 'Bachelor of Software Engineering',
      rationale: 'Waa barnaamij mustaqbal weyn leh oo ku siinaya xirfado heer caalami ah oo lagu dhiso tiknoolajiyadda casriga ah.',
    };
  }

  /**
   * Provides guidance on university majors and technology career pathways.
   */
  public static getMajorGuidance(majorName: string, language: 'so' | 'en' | 'mixed'): string {
    const isEn = language === 'en';
    const lower = majorName.toLowerCase();

    if (lower.includes('software') || lower.includes('se')) {
      return isEn
        ? `*⚙️ Software Engineering (SE):* Focuses on practical software development life cycles, testing, agile workflows, and building production-ready web and mobile apps.`
        : `*⚙️ Software Engineering (SE):* Waxay diiradda saartaa dhisidda barnaamijyada dhabta ah (web & mobile apps), habka koodhka loo tijaabiyo (testing), iyo maaraynta mashaariicda tiknoolajiyada.`;
    }

    return isEn
      ? `*🎓 Academic Guidance:* Abaarso Tech University offers 15 accredited degree programs at the Berbera campus. Choose based on your true strengths and career ambitions!`
      : `*🎓 Talo Jaamacadeed:* Jaamacadda Abaarso Tech waxay xarunta Berbera ku bixisaa 15 barnaamij oo shahaadada koowaad ah. Dooro barnaamijka ku habboon kartidaada iyo himilooyinkaaga!`;
  }
}
