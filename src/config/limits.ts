/**
 * Free-tier safety limits and zero-cost protection thresholds.
 */
export const FREE_TIER_LIMITS = {
  // Google Gemini Free Tier for Flash:
  // Typically 15 RPM (Requests Per Minute) and 1,500 RPD (Requests Per Day).
  MAX_DAILY_REQUESTS: 1400, // Safe threshold below 1,500
  MAX_RPM: 14,              // Safe threshold below 15 RPM
  TOKEN_DAILY_BUFFER: 500000, // Daily estimated token safeguard
  
  // Exponential backoff configuration
  RETRY: {
    MAX_RETRIES: 3,
    INITIAL_DELAY_MS: 1000,
    BACKOFF_FACTOR: 2,
    MAX_DELAY_MS: 8000
  },

  // Student conversation limits
  MAX_STUDENT_HISTORY_MESSAGES: 10, // Avoid token bloat while maintaining context
  STUDENT_COOLDOWN_SECONDS: 3,      // Anti-spam cooldown per student
};

export const SUPPORTED_MODELS = {
  GEMINI_FLASH_1_5: 'gemini-1.5-flash',
  GEMINI_FLASH_LATEST: 'gemini-flash-latest',
  GEMINI_FLASH_2_0: 'gemini-2.0-flash',
  GEMINI_FLASH_8B: 'gemini-1.5-flash-8b',
} as const;

