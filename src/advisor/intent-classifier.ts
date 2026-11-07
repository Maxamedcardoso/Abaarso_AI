export type AdvisorIntent =
  | 'academic'
  | 'programming'
  | 'homework'
  | 'motivation'
  | 'privacy_forget'
  | 'help'
  | 'greeting'
  | 'general';

export interface ClassifiedIntent {
  intent: AdvisorIntent;
  confidence: number;
  tags: string[];
}

export class IntentClassifier {
  public static classify(text: string): ClassifiedIntent {
    const lower = text.toLowerCase().trim();

    // 1. Privacy / Right-to-be-Forgotten commands
    if (
      lower === '!tirtir' ||
      lower === '!clear' ||
      lower.includes('tirtir taariikhdayda') ||
      lower.includes('delete my history') ||
      lower.includes('clear my data') ||
      lower.includes('isoo tirtir xogta')
    ) {
      return { intent: 'privacy_forget', confidence: 0.99, tags: ['privacy', 'gdpr'] };
    }

    // 2. Help commands
    if (lower === '!help' || lower === '!caawi' || lower === 'help' || lower === 'caawimaad') {
      return { intent: 'help', confidence: 0.95, tags: ['system'] };
    }

    // 2.5. Pure Greetings (asc, wcs, hello, hi)
    const cleanGreeting = lower.replace(/[^a-z0-9\s]/g, '').trim();
    const isPureGreeting = /^(asc|wcs|salaam|salaan|assalaamu\s*calaykum|assalamu\s*alaykum|hello|hi)(\s+(sxb|wll|walaal|saaxiib|saaxib|sxbo|abwaan|ai|abarso|dhammaan))*$/i.test(cleanGreeting);
    if (isPureGreeting) {
      return { intent: 'greeting', confidence: 0.98, tags: ['greeting'] };
    }

    // 3. Programming keywords
    const progKeywords = [
      'python', 'javascript', 'js', 'react', 'node', 'nodejs', 'flutter', 'dart',
      'html', 'css', 'sql', 'database', 'koodh', 'code', 'error', 'bug', 'loop',
      'function', 'variable', 'array', 'api', 'class', 'github', 'debug', 'git',
      'frontend', 'backend', 'syntax', 'terminal', 'compile', 'exception',
    ];
    const progMatches = progKeywords.filter(k => lower.includes(k));
    if (progMatches.length > 0) {
      return { intent: 'programming', confidence: Math.min(0.95, 0.7 + (progMatches.length * 0.1)), tags: progMatches };
    }

    // 4. Homework keywords
    const hwKeywords = [
      'homework', 'howl-guri', 'shaqo-guri', 'suaal', 'exercise', 'assignment',
      'quiz', 'problem', 'solve', 'calculate', 'xisaabi', 'jawaab', 'answer this',
      'ii xalli', 'suaashan', 'question',
    ];
    const hwMatches = hwKeywords.filter(k => lower.includes(k));
    if (hwMatches.length > 0) {
      return { intent: 'homework', confidence: Math.min(0.95, 0.65 + (hwMatches.length * 0.1)), tags: hwMatches };
    }

    // 5. Academic advice keywords
    const academicKeywords = [
      'imtixaan', 'exam', 'test', 'study', 'baro', 'jaamacad', 'university', 'iskuul',
      'schedule', 'jadwal', 'time management', 'waqti', 'maareyn', 'revision',
      'semester', 'major', 'kulliyad', 'gpa', 'degree', 'degree course',
    ];
    const academicMatches = academicKeywords.filter(k => lower.includes(k));
    if (academicMatches.length > 0) {
      return { intent: 'academic', confidence: Math.min(0.95, 0.7 + (academicMatches.length * 0.1)), tags: academicMatches };
    }

    // 6. Motivation & wellbeing keywords
    const motivationKeywords = [
      'dhiirigelin', 'motivation', 'caajis', 'quus', 'stress', 'tired', 'daallan',
      'walwal', 'anxiety', 'worried', 'hopeless', 'encouragement', 'dhiiri-geli',
      'kalsoni', 'confidence', 'bilaabid', 'burnout',
    ];
    const motMatches = motivationKeywords.filter(k => lower.includes(k));
    if (motMatches.length > 0) {
      return { intent: 'motivation', confidence: Math.min(0.95, 0.7 + (motMatches.length * 0.1)), tags: motMatches };
    }

    return { intent: 'general', confidence: 0.5, tags: [] };
  }
}

