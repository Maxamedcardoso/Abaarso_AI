export type PlanTier = 'trial_free' | 'starter' | 'business' | 'education' | 'owner';
export type BotCategory = 'personal' | 'business' | 'education';

export interface PlanFeatures {
  maxDailyAiCalls: number;
  maxDailyVoice: number;
  maxDailyImages: number;
  maxDailyBroadcast: number;
  allowStatusReactor: boolean;
  allowStatusPosting: boolean;
  allowLeadsCapture: boolean;
  allowAutoReplies: boolean;
  showTrialFooter: boolean;
}

export interface PlanMetadata {
  tier: PlanTier;
  label: string;
  somaliLabel: string;
  defaultDays: number;
  recommendedCategory?: BotCategory;
  features: PlanFeatures;
}

export const PLAN_CATALOG: Record<PlanTier, PlanMetadata> = {
  trial_free: {
    tier: 'trial_free',
    label: 'Free Trial (30 Days)',
    somaliLabel: 'Bisha 1aad Bilaash (Trial)',
    defaultDays: 30,
    features: {
      maxDailyAiCalls: 80,
      maxDailyVoice: 10,
      maxDailyImages: 10,
      maxDailyBroadcast: 20,
      allowStatusReactor: true,
      allowStatusPosting: true,
      allowLeadsCapture: true,
      allowAutoReplies: true,
      showTrialFooter: true,
    },
  },
  starter: {
    tier: 'starter',
    label: 'Personal Monthly',
    somaliLabel: 'Qof Caadi ah (Bile)',
    defaultDays: 30,
    recommendedCategory: 'personal',
    features: {
      maxDailyAiCalls: 250,
      maxDailyVoice: 30,
      maxDailyImages: 30,
      maxDailyBroadcast: 40,
      allowStatusReactor: true,
      allowStatusPosting: true,
      allowLeadsCapture: true,
      allowAutoReplies: true,
      showTrialFooter: false,
    },
  },
  business: {
    tier: 'business',
    label: 'Business Pro Monthly',
    somaliLabel: 'Ganacsato Pro (Bile)',
    defaultDays: 30,
    recommendedCategory: 'business',
    features: {
      maxDailyAiCalls: 600,
      maxDailyVoice: 100,
      maxDailyImages: 100,
      maxDailyBroadcast: 150,
      allowStatusReactor: true,
      allowStatusPosting: true,
      allowLeadsCapture: true,
      allowAutoReplies: true,
      showTrialFooter: false,
    },
  },
  education: {
    tier: 'education',
    label: 'Education Pro Monthly',
    somaliLabel: 'Waxbarasho Pro (Bile)',
    defaultDays: 30,
    recommendedCategory: 'education',
    features: {
      maxDailyAiCalls: 600,
      maxDailyVoice: 100,
      maxDailyImages: 100,
      maxDailyBroadcast: 150,
      allowStatusReactor: true,
      allowStatusPosting: true,
      allowLeadsCapture: true,
      allowAutoReplies: true,
      showTrialFooter: false,
    },
  },
  owner: {
    tier: 'owner',
    label: 'Owner Lifetime',
    somaliLabel: 'Milkiilaha (Aan Dhicin)',
    defaultDays: 36500,
    features: {
      maxDailyAiCalls: 100000,
      maxDailyVoice: 10000,
      maxDailyImages: 10000,
      maxDailyBroadcast: 10000,
      allowStatusReactor: true,
      allowStatusPosting: true,
      allowLeadsCapture: true,
      allowAutoReplies: true,
      showTrialFooter: false,
    },
  },
};

export function resolveEffectiveFeatures(
  tier: PlanTier,
  overridesJson?: string | Partial<PlanFeatures> | null,
  hasOwnGeminiKey: boolean = false
): PlanFeatures {
  const base = PLAN_CATALOG[tier]?.features || PLAN_CATALOG.trial_free.features;
  let parsedOverrides: Partial<PlanFeatures> = {};

  if (typeof overridesJson === 'string' && overridesJson.trim()) {
    try {
      const obj = JSON.parse(overridesJson);
      if (obj && typeof obj === 'object') {
        parsedOverrides = obj;
      }
    } catch {}
  } else if (overridesJson && typeof overridesJson === 'object') {
    parsedOverrides = overridesJson;
  }

  const resolved: PlanFeatures = {
    ...base,
    ...parsedOverrides,
  };

  // Users bringing their own free Google AI Studio key unlock up to 1,400/day without draining host keys
  if (hasOwnGeminiKey && resolved.maxDailyAiCalls < 1400) {
    resolved.maxDailyAiCalls = 1400;
  }

  return resolved;
}

export type GuardedFeature = 'ai' | 'voice' | 'image' | 'broadcast' | 'status_reactor' | 'status_post' | 'leads';

export interface PlanGuard {
  getFeatures(): PlanFeatures;
  checkFeature(feature: GuardedFeature): { allowed: boolean; reason?: string; remaining?: number };
  recordUsage(feature: 'ai' | 'voice' | 'image' | 'broadcast'): void;
}

