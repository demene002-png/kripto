export type StrategyThreshold = { minScore:number; minConfidence:number; maxRisk:number };

export const PAPER100_TEST_MODE = process.env.PAPER100_TEST_MODE !== 'false';

export const PROD_ENGINE_THRESHOLDS: Record<'SCALP'|'DAY'|'SWING', StrategyThreshold> = {
  SCALP: { minScore:82, minConfidence:76, maxRisk:40 },
  DAY:   { minScore:80, minConfidence:72, maxRisk:45 },
  SWING: { minScore:78, minConfidence:70, maxRisk:48 }
};

// Data-collection thresholds for the 100 USDT PAPER test only.
// They are intentionally looser than production so we can observe actual entries,
// exits, fees and portfolio behaviour without weakening TESTNET/LIVE policy.
export const PAPER100_ENGINE_THRESHOLDS: Record<'SCALP'|'DAY'|'SWING', StrategyThreshold> = {
  SCALP: { minScore:66, minConfidence:70, maxRisk:55 },
  DAY:   { minScore:68, minConfidence:70, maxRisk:55 },
  SWING: { minScore:70, minConfidence:70, maxRisk:55 }
};

export const PROD_COMBINED_THRESHOLDS = {
  opportunity:80,
  maxRisk:45,
  confidence:72,
  strongOpportunity:88,
  strongMaxRisk:35,
  strongConfidence:80
};

export const PAPER100_COMBINED_THRESHOLDS = {
  opportunity:66,
  maxRisk:55,
  confidence:70,
  strongOpportunity:74,
  strongMaxRisk:45,
  strongConfidence:78
};

export const PAPER100_PROFIT_THRESHOLDS = {
  NORMAL:66,
  CAUTION:72,
  TARGET_REACHED:78,
  LOCKDOWN:86
};

export function engineThresholds(name:'SCALP'|'DAY'|'SWING') {
  return PAPER100_TEST_MODE ? PAPER100_ENGINE_THRESHOLDS[name] : PROD_ENGINE_THRESHOLDS[name];
}

export function combinedThresholds() {
  return PAPER100_TEST_MODE ? PAPER100_COMBINED_THRESHOLDS : PROD_COMBINED_THRESHOLDS;
}
