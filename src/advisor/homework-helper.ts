export class HomeworkHelper {
  /**
   * Generates Socratic guidance instructions for homework questions.
   */
  public static getSocraticDirective(): string {
    return `
[SOCRATIC HOMEWORK TUTOR RULE]:
- The student is asking a homework, assignment, or exercise question.
- DO NOT provide the complete solution or final answer directly.
- Tallaabo 1: Explain the underlying rule or concept in simple language.
- Tallaabo 2: Provide an analogous (different numbers or simplified) example showing the step-by-step logic.
- Tallaabo 3: Give the student a guiding hint and ask them: "Now try applying step 1 to your question, what do you get?"
- Encourage them to think and build problem-solving confidence!
`;
  }

  /**
   * Practice quiz generator prompt.
   */
  public static generatePracticeQuiz(topic: string, language: 'so' | 'en' | 'mixed'): string {
    const isEn = language === 'en';
    if (isEn) {
      return `
*📝 Quick Practice Quiz on ${topic}:*
Here are 2 conceptual questions to test your understanding:
1. What is the main purpose of this concept?
2. In what practical scenario would you avoid using it?
Reply with your thoughts and I will review them with you!
`;
    }

    return `
*📝 Su'aalo Tababar ah oo ku saabsan ${topic}:*
Waa kuwan laba su'aalood oo aad isku tijaabin karto:
1. Maxaa faa'iido ah oo uu fikradani kuu leeyahay marka aad koodh qorayso?
2. Goormay tahay xaalad aadan isticmaali lahayn?
Iisoo qor fikirkaaga si aan wada saxno!
`;
  }
}

