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
   * Provides guidance on university majors and technology career pathways.
   */
  public static getMajorGuidance(majorName: string, language: 'so' | 'en' | 'mixed'): string {
    const isEn = language === 'en';
    const lower = majorName.toLowerCase();

    if (lower.includes('cs') || lower.includes('computer science')) {
      return isEn
        ? `*💻 Computer Science (CS):* Focuses on algorithms, computation theory, data structures, math, and software architecture. Best if you love problem-solving and deep backend/AI logic.`
        : `*💻 Computer Science (CS):* Waxay diiradda saartaa hab-xisaabeedka (algorithms), qaab-dhismeedka xogta (data structures), xisaabta, iyo caqliga sirdoonka (AI). Waxay kugu habboon tahay haddii aad jeceshahay xallinta mushkilaadka adag.`;
    }

    if (lower.includes('software') || lower.includes('se')) {
      return isEn
        ? `*⚙️ Software Engineering (SE):* Focuses on practical software development life cycles, testing, agile workflows, and building production-ready web and mobile apps.`
        : `*⚙️ Software Engineering (SE):* Waxay diiradda saartaa dhisidda barnaamijyada dhabta ah (web & mobile apps), habka koodhka loo tijaabiyo (testing), iyo maaraynta mashaariicda tiknoolajiyada.`;
    }

    return isEn
      ? `*🎓 Academic Guidance:* Focus on building practical projects alongside your degree, maintaining a steady GPA, and contributing to open-source or student clubs.`
      : `*🎓 Talo Jaamacadeed:* Waxaa muhiim ah inaadan ku ekaan buugta jaamacadda oo kaliya; dhis mashaariic gacanta ah (projects) oo ku xirnoow ardayda kale ee wax baratay.`;
  }
}

