export class MotivationCoach {
  // Distress keywords that trigger compassionate boundary warnings
  private static DISTRESS_KEYWORDS = [
    'suicide', 'kill myself', 'end my life', 'self harm', 'depression',
    'inaan is dilo', 'is dilaa', 'naftayda gooyo', 'quus gooyay', 'noloshu micno ma leh',
  ];

  /**
   * Checks if a message contains crisis or self-harm signals.
   */
  public static hasDistressSignals(text: string): boolean {
    const lower = text.toLowerCase();
    return this.DISTRESS_KEYWORDS.some(k => lower.includes(k));
  }

  /**
   * Compassionate boundary disclaimer providing real human support resources.
   */
  public static getCrisisSupportMessage(language: string): string {
    if (language === 'en') {
      return `
*❤️ Compassionate Notice from CARDOSO AI:*
I hear that you are going through a very heavy and overwhelming time. Please know that you are not alone and your life matters deeply.

As an AI assistant, I am not a licensed medical professional or counselor. Please reach out right now to:
1. A trusted family member, teacher, or friend.
2. A healthcare professional or your student wellness center.
3. If you are in crisis, please contact your local emergency services or a mental health helpline.

Please take care of yourself, walaal.
`;
    }

    return `
*❤️ Fariin Naxariis leh oo ka socota CARDOSO AI:*
Walaal, waan dareemayaa inaad marayso waqti aad u adag oo culus. Fadlan ogow inaadan keligaa ahayn, qiimo weynna aad leedahay.

Anigu waxaan ahay caawiye waxbarasho iyo caqli macmal ah (AI), mana ihi dhaqtar ama la-taliye caafimaad. Waxaan si kal iyo laab ah kuugula talinayaa inaad la hadasho:
1. Qof qoyskaaga ka mid ah, saaxiib aad ku kalsoon tahay, ama macallin.
2. Xarunta caafimaadka ama la-talinta ee jaamacaddaada/iskuulkaaga.
3. Dhaqtar ku takhasusay caafimaadka maskaxda.

Fadlan noloshaada iyo caafimaadkaaga daryeel, wax kasta wey hagaagi doonaan Insha'Allah.
`;
  }

  /**
   * Returns healthy motivational advice for common student burnout or fatigue.
   */
  public static getStudyMotivation(language: 'so' | 'en' | 'mixed'): string {
    if (language === 'en') {
      return `
*💪 Academic Encouragement:*
- "Progress, not perfection." Consistent small daily efforts beat exhausting all-nighters every time.
- If you feel overwhelmed, break your task down into a single 15-minute action.
- Take a walk, hydrate, and remember why you started this educational journey!
`;
    }

    return `
*💪 Dhiirigelin iyo Talo Waxbarasho:*
- "Dhib kasta wuxuu wataa guul." Wax yar oo aad maalin kasta barato ayaa ka wanaagsan habeen dhan oo aad soo jeeddo.
- Haddii aad dareento culays, koodhka ama buugga 15 daqiiqo iska dhig, biyo cab, oo dib ugu laabo adigoo maskax cusub wata.
- Guushu ma timaado hal habeen, laakiin waxay timaadaa joogteyn iyo sabar.
`;
  }
}

