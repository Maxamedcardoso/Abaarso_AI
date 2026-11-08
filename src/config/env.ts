import dotenv from 'dotenv';
import path from 'path';
import { FREE_TIER_LIMITS, SUPPORTED_MODELS } from './limits.js';

// Load .env file
dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  gemini: {
    apiKey: string;
    apiKeys: string[];
    model: string;
    dailyLimit: number;
    rpmLimit: number;
  };
  llamaFallback: {
    enabled: boolean;
    url: string;
    model: string;
  };
  messaging: {
    mode: 'console' | 'baileys' | 'webhook';
    groupResponseMode: 'mention_only' | 'all';
    prefix: string;
  };
  security: {
    adminPhoneNumbers: string[];
    allowedGroups: string[];
    webhookVerifyToken: string;
  };
  database: {
    path: string;
    retentionDays: number;
    maxContextMessages: number;
  };
  server: {
    port: number;
  };
}

function parseAdminNumbers(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(num => num.trim().replace(/[^0-9]/g, ''))
    .filter(num => num.length > 0);
}

function parseAllowedGroups(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(g => g.trim())
    .filter(g => g.length > 0);
}

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || (process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',')[0].trim() : ''),
    apiKeys: (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean),
    model: process.env.GEMINI_MODEL || SUPPORTED_MODELS.GEMINI_FLASH_LATEST,
    dailyLimit: (parseInt(process.env.DAILY_REQUEST_LIMIT || '', 10) || FREE_TIER_LIMITS.MAX_DAILY_REQUESTS) * Math.max(1, (process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',').filter(Boolean).length : 1)),
    rpmLimit: (parseInt(process.env.REQUESTS_PER_MINUTE_LIMIT || '', 10) || FREE_TIER_LIMITS.MAX_RPM) * Math.max(1, (process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',').filter(Boolean).length : 1)),
  },
  llamaFallback: {
    enabled: process.env.ENABLE_LOCAL_FALLBACK === 'true',
    url: process.env.LOCAL_FALLBACK_URL || 'http://127.0.0.1:8080/v1',
    model: process.env.LOCAL_FALLBACK_MODEL || 'llama-3.2-3b',
  },
  messaging: {
    mode: (process.env.MESSAGING_MODE as 'console' | 'baileys' | 'webhook') || 'console',
    groupResponseMode: (process.env.GROUP_RESPONSE_MODE as 'mention_only' | 'all') || 'mention_only',
    prefix: process.env.BOT_PREFIX || '!cardoso',
  },
  security: {
    adminPhoneNumbers: parseAdminNumbers(process.env.ADMIN_PHONE_NUMBERS),
    allowedGroups: parseAllowedGroups(process.env.ALLOWED_GROUPS),
    webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'cardoso_secret_verify_token',
  },
  database: {
    path: process.env.DATABASE_PATH || './data/abarso.db',
    retentionDays: parseInt(process.env.DATA_RETENTION_DAYS || '', 10) || 30,
    maxContextMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '', 10) || FREE_TIER_LIMITS.MAX_STUDENT_HISTORY_MESSAGES,
  },
  server: {
    port: parseInt(process.env.PORT || '', 10) || 3000,
  },
};

/**
 * Validates critical environment settings without crashing unless required for production.
 */
export function validateConfig(): { valid: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!config.gemini.apiKey) {
    warnings.push('GEMINI_API_KEY is not set. Gemini responses will fail unless local fallback is active.');
  }

  if (config.messaging.mode === 'baileys' && config.security.adminPhoneNumbers.length === 0) {
    warnings.push('No ADMIN_PHONE_NUMBERS configured. Anyone in groups will have regular access, but admin controls cannot be verified.');
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

