import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_ORDER,
  DIFFICULTY_PRESETS,
  DIFFICULTY_STORAGE_KEY,
  HIGH_SCORES_STORAGE_KEY,
  LEGACY_HIGH_SCORE_STORAGE_KEY,
  type DifficultyPreset,
  type DifficultyPresetId,
} from './difficulty.ts';

export { DIFFICULTY_ORDER, DIFFICULTY_PRESETS, type DifficultyPreset, type DifficultyPresetId };

export const GAME_CONFIG = {
  // Flight speed multiplier bounds & HUD adjustment step
  speedMultiplierMin: 0.5,
  speedMultiplierMax: 1.5,
  speedMultiplierStep: 0.1,
  speedMultiplierDefault: 1.0,
  defaultDifficulty: DEFAULT_DIFFICULTY,

  // Countdown, round timer & ready fist-start trigger
  countdownDurationSec: 3.0,
  fistStartHoldSec: 1.0,
  roundDurationSec: 60,
  criticalTimeWarningSec: 10,

  // Active snack population & forward-biased placement
  activeSnackCount: 6,
  spawnMinDistM: 100,
  spawnMaxDistM: 250,
  minSnackSpacingM: 40,
  recycleBehindDistM: 200,
  spawnForwardConeDeg: 60,
  spawnForwardBiasChance: 0.85,

  // Airborne placement heights (above ground & clear of roofs)
  normalMinAltM: 25,
  normalMaxAltM: 60,
  normalPreferredCenterM: 40,
  goldenMinAltM: 60,
  goldenMaxAltM: 90,
  altProximityRangeM: 25,
  minBuildingClearanceM: 15,
  goldenSpawnChance: 0.1,
  goldenBonusTimeSec: 3,

  // Snack visuals & bobbing animation
  normalSnackScale: 2.35,
  goldenSnackScale: 2.8,
  snackBobAmplitudeM: 1.5,
  normalHaloRadiusM: 2.6,
  goldenHaloRadiusM: 3.3,
  normalBeamHeightM: 20,
  goldenBeamHeightM: 24,
  suctionAnimDurationSec: 0.2,

  // Default collection hitbox
  collectRadiusM: DIFFICULTY_PRESETS.normal.collectRadiusM,

  // Energy system (0..100)
  energyMax: 100,
  energyStart: 100,
  energyLowWarningThreshold: 25,
  energyExhaustedRecoverThreshold: 20,
  exhaustedSinkSpeedMps: -3.0,

  energyDrainFlapPerSec: 6.0,
  energyRegenGlidePerSec: 5.0,
  energyRegenDivePerSec: 8.0,
  energyGainNormalSnack: 15,
  energyGainGoldenSnack: 100,
  energyPenaltyCollision: 10,
  collisionCooldownSec: 1.5,
  collisionInvulnSec: 1.5,
  collisionLightTouchSpeedRatio: 0.6,
  collisionPenalties: {
    easy: 50,
    normal: 100,
    hard: 150,
  } as Record<DifficultyPresetId, number>,
  noCrashBonusPoints: 200,
  collisionFlashSec: 0.4,
  comboBreakBannerSec: 1.1,

  // Combo & Airborne Acrobatic Scoring
  comboWindowSec: DIFFICULTY_PRESETS.normal.comboWindowSec,
  pointsNormalBase: 100,
  pointsGoldenBase: 500,
  climbBonusMinFlapPower: 0.5,
  climbBonusPoints: 50,
  diveBonusMinStrength: 0.5,
  diveBonusPoints: 50,
  highAltBonusMinAglM: 60.0,
  highAltBonusPoints: 30,

  comboMultipliers: [
    { minCombo: 10, multiplier: 5 },
    { minCombo: 7, multiplier: 4 },
    { minCombo: 4, multiplier: 3 },
    { minCombo: 2, multiplier: 2 },
    { minCombo: 0, multiplier: 1 },
  ] as const,

  ranks: [
    { minScore: 6000, title: '전설의 새우깡 마스터' },
    { minScore: 3000, title: '부산 갈매기' },
    { minScore: 1000, title: '항구 갈매기' },
    { minScore: 0, title: '아기 갈매기' },
  ] as const,

  // Leaderboard (TOP 10 per difficulty) & Nickname Rules
  leaderboard: {
    maxEntries: 10,
    defaultNickname: '갈매기',
    maxNicknameLength: 8,
    lastNicknameStorageKey: 'seagull.lb.lastNickname',
    storageKeys: {
      easy: 'seagull.lb.easy',
      normal: 'seagull.lb.normal',
      hard: 'seagull.lb.hard',
    } as Record<DifficultyPresetId, string>,
    bannedNicknames: [
      '시발',
      '씨발',
      '병신',
      '개새끼',
      '미친놈',
      '지랄',
      '존나',
      'fuck',
      'shit',
      'bitch',
      'asshole',
    ] as readonly string[],
  } as const,

  highScoreStorageKey: LEGACY_HIGH_SCORE_STORAGE_KEY,
  highScoresByDifficultyStorageKey: HIGH_SCORES_STORAGE_KEY,
  speedMultiplierStorageKey: 'busan_seagull_speed_mult_v1',
  difficultyStorageKey: DIFFICULTY_STORAGE_KEY,
} as const;
