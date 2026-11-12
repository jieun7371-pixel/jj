import {
  DEFAULT_DIFFICULTY,
  createEmptyHighScores,
  getDifficultyPreset,
  loadHighScores,
  loadSelectedDifficulty,
  saveHighScoreForDifficulty,
  saveSelectedDifficulty,
  type DifficultyPresetId,
  type HighScoreMap,
} from './difficulty.ts';
import { GAME_CONFIG } from './gameConfig.ts';
import {
  applyCollisionPenalty,
  calculateSnackPoints,
  getComboMultiplier,
  isInvulnerable,
  type SnackScoreBreakdown,
} from './scoring.ts';

export type GamePhase = 'READY' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'RESULT';
export type CountdownReason = 'start' | 'resume';
export type PauseReason = 'manual' | 'tab-hidden' | 'webcam-lost';

export interface GameRoundState {
  phase: GamePhase;
  difficulty: DifficultyPresetId;
  countdownSec: number;
  countdownReason: CountdownReason;
  pauseReason: PauseReason | null;
  timeLeftSec: number;
  playElapsedSec: number;
  score: number;
  highScore: number;
  highScoresByDifficulty: HighScoreMap;
  isNewRecord: boolean;
  eatenCount: number;
  goldenEatenCount: number;
  combo: number;
  maxCombo: number;
  comboTimerSec: number;
  energy: number; // 0..100
  isExhausted: boolean;
  collisionCooldownSec: number;
  crashCount: number;
  totalPenalty: number;
  lastHitTime: number | null;
  noCrashBonus: number;
}

export function clampSpeedMultiplier(val: number): number {
  if (!Number.isFinite(val)) return GAME_CONFIG.speedMultiplierDefault;
  const clamped = Math.max(
    GAME_CONFIG.speedMultiplierMin,
    Math.min(GAME_CONFIG.speedMultiplierMax, val)
  );
  return Math.round(clamped * 10) / 10;
}

export function loadSpeedMultiplier(): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return GAME_CONFIG.speedMultiplierDefault;
    }
    const raw = window.localStorage.getItem(GAME_CONFIG.speedMultiplierStorageKey);
    if (!raw) return GAME_CONFIG.speedMultiplierDefault;
    return clampSpeedMultiplier(Number(raw));
  } catch {
    return GAME_CONFIG.speedMultiplierDefault;
  }
}

export function saveSpeedMultiplier(mult: number): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      GAME_CONFIG.speedMultiplierStorageKey,
      clampSpeedMultiplier(mult).toFixed(1)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export const loadDifficulty = loadSelectedDifficulty;
export const saveDifficulty = saveSelectedDifficulty;

export function loadHighScore(difficulty: DifficultyPresetId = DEFAULT_DIFFICULTY): number {
  return loadHighScores()[difficulty];
}

export function saveHighScore(
  score: number,
  difficulty: DifficultyPresetId = DEFAULT_DIFFICULTY
): HighScoreMap {
  return saveHighScoreForDifficulty(difficulty, score);
}

export function createInitialGameRoundState(options?: {
  difficulty?: DifficultyPresetId;
  highScores?: HighScoreMap;
  phase?: GamePhase;
}): GameRoundState {
  const difficulty = options?.difficulty ?? DEFAULT_DIFFICULTY;
  const highScoresByDifficulty: HighScoreMap = options?.highScores
    ? { ...options.highScores }
    : createEmptyHighScores();
  const phase = options?.phase ?? 'READY';

  return {
    phase,
    difficulty,
    countdownSec: phase === 'COUNTDOWN' ? GAME_CONFIG.countdownDurationSec : 0,
    countdownReason: 'start',
    pauseReason: null,
    timeLeftSec: GAME_CONFIG.roundDurationSec,
    playElapsedSec: 0,
    score: 0,
    highScore: highScoresByDifficulty[difficulty] ?? 0,
    highScoresByDifficulty,
    isNewRecord: false,
    eatenCount: 0,
    goldenEatenCount: 0,
    combo: 0,
    maxCombo: 0,
    comboTimerSec: 0,
    energy: GAME_CONFIG.energyStart,
    isExhausted: false,
    collisionCooldownSec: 0,
    crashCount: 0,
    totalPenalty: 0,
    lastHitTime: null,
    noCrashBonus: 0,
  };
}

/**
 * Starts a fresh game on the chosen difficulty, returning a brand-new COUNTDOWN state
 * with zero residual score, combo, energy, or timer values from prior games.
 */
export function startGame(
  prev: GameRoundState,
  difficulty: DifficultyPresetId = prev.difficulty
): GameRoundState {
  const fresh = createInitialGameRoundState({
    difficulty,
    highScores: prev.highScoresByDifficulty,
    phase: 'COUNTDOWN',
  });
  return {
    ...fresh,
    countdownReason: 'start',
  };
}

/**
 * Backward-compatible alias that immediately enters PLAYING (without countdown) when needed.
 */
export function startRoundState(prev: GameRoundState): GameRoundState {
  return {
    ...createInitialGameRoundState({
      difficulty: prev.difficulty,
      highScores: prev.highScoresByDifficulty,
      phase: 'PLAYING',
    }),
  };
}

/**
 * Transitions PLAYING (or active COUNTDOWN) into PAUSED, preserving full round state.
 */
export function pauseGame(
  state: GameRoundState,
  reason: PauseReason = 'manual'
): GameRoundState {
  if (state.phase === 'PLAYING') {
    return {
      ...state,
      phase: 'PAUSED',
      pauseReason: reason,
    };
  }
  if (state.phase === 'COUNTDOWN') {
    return {
      ...state,
      phase: 'PAUSED',
      countdownSec: 0,
      pauseReason: reason,
    };
  }
  return state;
}

/**
 * Resumes from PAUSED via a 3-2-1 COUNTDOWN before continuing PLAYING.
 */
export function resumeGame(state: GameRoundState): GameRoundState {
  if (state.phase !== 'PAUSED') return state;
  return {
    ...state,
    phase: 'COUNTDOWN',
    countdownSec: GAME_CONFIG.countdownDurationSec,
    countdownReason: 'resume',
    pauseReason: null,
  };
}

/**
 * Discards current round progress cleanly without updating high scores and returns to READY.
 */
export function resetGame(
  prev: GameRoundState,
  difficulty: DifficultyPresetId = prev.difficulty
): GameRoundState {
  return createInitialGameRoundState({
    difficulty,
    highScores: prev.highScoresByDifficulty,
    phase: 'READY',
  });
}

/**
 * Updates selected difficulty preset and displayed high score while on READY.
 */
export function selectDifficultyInReady(
  state: GameRoundState,
  difficulty: DifficultyPresetId
): GameRoundState {
  return {
    ...state,
    difficulty,
    highScore: state.highScoresByDifficulty[difficulty] ?? 0,
  };
}

export interface StepRoundResult {
  nextState: GameRoundState;
  countdownTickDigit: number | null;
  countdownFinished: boolean;
  timeWarningBeepSec: number | null;
  justEnded: boolean;
  lowEnergyAlert: boolean;
}

/**
 * Pure per-frame round state machine tick:
 * - READY / PAUSED / RESULT: frozen (no timer, energy, or combo progression)
 * - COUNTDOWN: counts down 3 -> 2 -> 1 -> transitions to PLAYING
 * - PLAYING: advances 60s countdown, difficulty-scaled energy drain/regen, combo decay, and end trigger
 */
export function stepGameRoundState(
  state: GameRoundState,
  input: {
    dtSec: number;
    flapPower: number;
    isDiving: boolean;
    energyDrainMultiplier?: number;
  }
): StepRoundResult {
  const dt = Math.max(0, Math.min(0.1, input.dtSec));

  if (state.phase === 'COUNTDOWN') {
    const prevCeil = Math.ceil(state.countdownSec);
    const nextCountdown = Math.max(0, state.countdownSec - dt);
    const nextCeil = Math.ceil(nextCountdown);

    if (nextCountdown <= 0) {
      return {
        nextState: {
          ...state,
          phase: 'PLAYING',
          countdownSec: 0,
        },
        countdownTickDigit: null,
        countdownFinished: true,
        timeWarningBeepSec: null,
        justEnded: false,
        lowEnergyAlert: false,
      };
    }

    const countdownTickDigit = nextCeil >= 1 && nextCeil < prevCeil ? nextCeil : null;
    return {
      nextState: {
        ...state,
        countdownSec: nextCountdown,
      },
      countdownTickDigit,
      countdownFinished: false,
      timeWarningBeepSec: null,
      justEnded: false,
      lowEnergyAlert: false,
    };
  }

  if (state.phase !== 'PLAYING') {
    return {
      nextState: state,
      countdownTickDigit: null,
      countdownFinished: false,
      timeWarningBeepSec: null,
      justEnded: false,
      lowEnergyAlert: false,
    };
  }

  const preset = getDifficultyPreset(state.difficulty);
  const drainMult = input.energyDrainMultiplier ?? preset.energyDrainMultiplier;
  let energy = state.energy;
  let isExhausted = state.isExhausted;

  if (!isExhausted && !input.isDiving && input.flapPower > 0.14) {
    energy -= input.flapPower * GAME_CONFIG.energyDrainFlapPerSec * drainMult * dt;
  } else if (input.isDiving) {
    energy += GAME_CONFIG.energyRegenDivePerSec * dt;
  } else {
    energy += GAME_CONFIG.energyRegenGlidePerSec * dt;
  }

  energy = Math.max(0, Math.min(GAME_CONFIG.energyMax, energy));

  if (!isExhausted && energy <= 0) {
    energy = 0;
    isExhausted = true;
  } else if (isExhausted && energy >= GAME_CONFIG.energyExhaustedRecoverThreshold) {
    isExhausted = false;
  }

  // Play time progression & cooldowns
  const playElapsedSec = state.playElapsedSec + dt;
  const comboTimerSec = Math.max(0, state.comboTimerSec - dt);
  const combo = comboTimerSec > 0 ? state.combo : 0;

  // Collision cooldown
  const collisionCooldownSec = Math.max(0, state.collisionCooldownSec - dt);

  // 1-minute countdown with per-second beep during final 10 seconds
  const prevTimeCeil = Math.ceil(state.timeLeftSec);
  const nextTimeLeft = Math.max(0, state.timeLeftSec - dt);
  const nextTimeCeil = Math.ceil(nextTimeLeft);
  const timeWarningBeepSec =
    nextTimeCeil >= 1 &&
    nextTimeCeil <= GAME_CONFIG.criticalTimeWarningSec &&
    nextTimeCeil < prevTimeCeil
      ? nextTimeCeil
      : null;

  if (nextTimeLeft <= 0) {
    const noCrashBonus = state.crashCount === 0 ? GAME_CONFIG.noCrashBonusPoints : 0;
    const finalScore = Math.max(0, state.score + noCrashBonus);
    const prevDiffBest = state.highScoresByDifficulty[state.difficulty] ?? 0;
    const isNewRecord = finalScore > prevDiffBest && finalScore > 0;
    const finalDiffBest = Math.max(prevDiffBest, finalScore);
    const updatedMap: HighScoreMap = {
      ...state.highScoresByDifficulty,
      [state.difficulty]: finalDiffBest,
    };

    return {
      nextState: {
        ...state,
        phase: 'RESULT',
        timeLeftSec: 0,
        playElapsedSec,
        score: finalScore,
        noCrashBonus,
        energy,
        isExhausted,
        combo,
        comboTimerSec,
        collisionCooldownSec,
        highScore: finalDiffBest,
        highScoresByDifficulty: updatedMap,
        isNewRecord,
      },
      countdownTickDigit: null,
      countdownFinished: false,
      timeWarningBeepSec: null,
      justEnded: true,
      lowEnergyAlert: false,
    };
  }

  return {
    nextState: {
      ...state,
      timeLeftSec: nextTimeLeft,
      playElapsedSec,
      energy,
      isExhausted,
      combo,
      comboTimerSec,
      collisionCooldownSec,
    },
    countdownTickDigit: null,
    countdownFinished: false,
    timeWarningBeepSec,
    justEnded: false,
    lowEnergyAlert: energy <= GAME_CONFIG.energyLowWarningThreshold,
  };
}

export function applySnackCollected(
  state: GameRoundState,
  params: {
    isGolden: boolean;
    altitudeAglM: number;
    flapPower: number;
    diveStrength: number;
    comboWindowSec?: number;
  }
): { nextState: GameRoundState; breakdown: SnackScoreBreakdown } {
  const preset = getDifficultyPreset(state.difficulty);
  const nextCombo = state.comboTimerSec > 0 ? state.combo + 1 : 1;
  const maxCombo = Math.max(state.maxCombo, nextCombo);
  const comboWindow = params.comboWindowSec ?? preset.comboWindowSec;

  const breakdown = calculateSnackPoints({
    isGolden: params.isGolden,
    altitudeAglM: params.altitudeAglM,
    flapPower: params.flapPower,
    diveStrength: params.diveStrength,
    nextCombo,
  });

  const nextScore = state.score + breakdown.totalPoints;
  const nextEnergy = params.isGolden
    ? GAME_CONFIG.energyMax
    : Math.min(GAME_CONFIG.energyMax, state.energy + GAME_CONFIG.energyGainNormalSnack);

  const nextExhausted =
    state.isExhausted && nextEnergy < GAME_CONFIG.energyExhaustedRecoverThreshold;

  // Golden snack adds +3s capped cleanly at 60s max
  const nextTimeLeft = params.isGolden
    ? Math.min(GAME_CONFIG.roundDurationSec, state.timeLeftSec + GAME_CONFIG.goldenBonusTimeSec)
    : state.timeLeftSec;

  const prevDiffBest = state.highScoresByDifficulty[state.difficulty] ?? 0;
  const isNewRecord = state.isNewRecord || (nextScore > prevDiffBest && nextScore > 0);
  const nextHighScore = Math.max(prevDiffBest, nextScore);

  return {
    breakdown,
    nextState: {
      ...state,
      score: nextScore,
      highScore: nextHighScore,
      isNewRecord,
      eatenCount: state.eatenCount + 1,
      goldenEatenCount: state.goldenEatenCount + (params.isGolden ? 1 : 0),
      combo: nextCombo,
      maxCombo,
      comboTimerSec: comboWindow,
      energy: nextEnergy,
      isExhausted: nextExhausted,
      timeLeftSec: nextTimeLeft,
    },
  };
}

export function applyBuildingCollision(
  state: GameRoundState,
  params?: {
    nowSec?: number;
    impactSpeedMps?: number;
    minGlideSpeedMps?: number;
  }
): {
  nextState: GameRoundState;
  applied: boolean;
  penalty: number;
  isLightTouch: boolean;
  comboBroken: boolean;
} {
  if (state.phase !== 'PLAYING') {
    return { nextState: state, applied: false, penalty: 0, isLightTouch: false, comboBroken: false };
  }

  const nowSec = params?.nowSec ?? state.playElapsedSec;
  if (isInvulnerable(nowSec, state.lastHitTime)) {
    return { nextState: state, applied: false, penalty: 0, isLightTouch: false, comboBroken: false };
  }

  const preset = getDifficultyPreset(state.difficulty);
  const impactSpeed = params?.impactSpeedMps ?? preset.speedMultiplier * 12;
  const penaltyRes = applyCollisionPenalty(state.score, state.difficulty, impactSpeed, {
    minGlideSpeedMps: params?.minGlideSpeedMps,
  });

  const nextEnergy = Math.max(0, state.energy - GAME_CONFIG.energyPenaltyCollision);
  const nextExhausted = state.isExhausted || nextEnergy <= 0;
  const comboBroken = state.combo > 0;

  return {
    applied: true,
    penalty: penaltyRes.penalty,
    isLightTouch: penaltyRes.isLightTouch,
    comboBroken,
    nextState: {
      ...state,
      score: penaltyRes.newScore,
      energy: nextEnergy,
      isExhausted: nextExhausted,
      combo: 0,
      comboTimerSec: 0,
      collisionCooldownSec: GAME_CONFIG.collisionInvulnSec,
      crashCount: state.crashCount + 1,
      totalPenalty: state.totalPenalty + penaltyRes.penalty,
      lastHitTime: nowSec,
    },
  };
}

export function getComboProgress(
  state: GameRoundState,
  comboWindowSec = getDifficultyPreset(state.difficulty).comboWindowSec
): number {
  const denom = Math.max(0.5, comboWindowSec);
  return Math.max(0, Math.min(1, state.comboTimerSec / denom));
}

export function getActiveComboMultiplier(state: GameRoundState): number {
  return getComboMultiplier(state.combo);
}
