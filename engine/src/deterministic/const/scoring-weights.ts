export const checkScorePoints = {
  pass: 1,
  warn: 0.5,
  fail: 0,
} as const;

export const scoreDefaults = {
  fullScore: 100,
  qualityFloor: 40,
  qualityRange: 60,
  tooShortMaximum: 25,
  thinDraftMaximum: 65,
} as const;

export const engagementPredictionWeights = {
  baseImpressionsPerThousandFollowers: 400,
  minimumFollowerScale: 0.2,
  maximumFollowerScale: 10,
  minimumTextLength: 15,
  highSignalUncertainty: 0.25,
  mediumSignalUncertainty: 0.4,
  lowSignalUncertainty: 0.6,
  highConfidenceSignalCount: 4,
  mediumConfidenceSignalCount: 2,
  highConfidenceScoreMinimum: 70,
  mediumConfidenceScoreMinimum: 50,
  timelyTermMaximumBonus: 0.4,
  timelyTermBonusPerMatch: 0.15,
  tensionMultiplier: 1.25,
} as const;

export const postCoachScoreBands = {
  topTierMinimum: 85,
  shipItMinimum: 60,
  almostThereMinimum: 45,
  targetScore: 60,
} as const;
