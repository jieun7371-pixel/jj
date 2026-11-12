import { FLIGHT_CONFIG } from '../../config.ts';
import { getDifficultyPreset, type DifficultyPresetId } from './difficulty.ts';
import { GAME_CONFIG } from './gameConfig.ts';

export interface SnackScoreBreakdown {
  basePoints: number;
  climbBonus: number;
  diveBonus: number;
  highAltBonus: number;
  multiplier: number;
  totalPoints: number;
  tags: string[];
}

export interface CollisionPenaltyResult {
  newScore: number;
  penalty: number;
  isLightTouch: boolean;
}

export function getComboMultiplier(combo: number): number {
  for (const tier of GAME_CONFIG.comboMultipliers) {
    if (combo >= tier.minCombo) {
      return tier.multiplier;
    }
  }
  return 1;
}

/**
 * Pure aerial scoring calculation:
 * - Climb bonus (+50) when flapping strongly (flapPower >= 0.5)
 * - Dive bonus (+50) when swooping down with fist dive (diveStrength >= 0.5)
 * - High-altitude bonus (+30) when collected at >= 60m AGL
 */
export function calculateSnackPoints(params: {
  isGolden: boolean;
  altitudeAglM: number;
  flapPower: number;
  diveStrength: number;
  nextCombo: number;
}): SnackScoreBreakdown {
  const basePoints = params.isGolden
    ? GAME_CONFIG.pointsGoldenBase
    : GAME_CONFIG.pointsNormalBase;

  const climbBonus =
    params.flapPower >= GAME_CONFIG.climbBonusMinFlapPower ? GAME_CONFIG.climbBonusPoints : 0;

  const diveBonus =
    params.diveStrength >= GAME_CONFIG.diveBonusMinStrength ? GAME_CONFIG.diveBonusPoints : 0;

  const highAltBonus =
    params.altitudeAglM >= GAME_CONFIG.highAltBonusMinAglM ? GAME_CONFIG.highAltBonusPoints : 0;

  const multiplier = getComboMultiplier(params.nextCombo);
  const totalPoints = (basePoints + climbBonus + diveBonus + highAltBonus) * multiplier;

  const tags: string[] = [];
  if (params.isGolden) tags.push('황금');
  if (climbBonus > 0) tags.push('상승 보너스');
  if (diveBonus > 0) tags.push('급강하 보너스');
  if (highAltBonus > 0) tags.push('고공 보너스');
  if (multiplier > 1) tags.push(`x${multiplier}`);

  return {
    basePoints,
    climbBonus,
    diveBonus,
    highAltBonus,
    multiplier,
    totalPoints,
    tags,
  };
}

/**
 * Pure building-collision score penalty calculator:
 * - Fixed difficulty penalty (easy -50, normal -100, hard -150), independent of combo multiplier.
 * - Half penalty ("가벼운 접촉") if impactSpeed < 60% of baseline glide speed.
 * - Final score never drops below 0.
 */
export function applyCollisionPenalty(
  score: number,
  difficulty: DifficultyPresetId,
  impactSpeed: number,
  options?: { minGlideSpeedMps?: number }
): CollisionPenaltyResult {
  const basePenalty = GAME_CONFIG.collisionPenalties[difficulty] ?? 100;
  const presetMult = getDifficultyPreset(difficulty).speedMultiplier;
  const refGlideSpeed = options?.minGlideSpeedMps ?? FLIGHT_CONFIG.glideSpeedMps * presetMult;
  const lightTouchThreshold = refGlideSpeed * GAME_CONFIG.collisionLightTouchSpeedRatio;

  const cleanImpactSpeed = Number.isFinite(impactSpeed) ? Math.max(0, impactSpeed) : refGlideSpeed;
  const isLightTouch = cleanImpactSpeed < lightTouchThreshold;
  const penalty = isLightTouch ? Math.round(basePenalty * 0.5) : basePenalty;
  const safeScore = Number.isFinite(score) ? Math.max(0, score) : 0;

  return {
    newScore: Math.max(0, safeScore - penalty),
    penalty,
    isLightTouch,
  };
}

/**
 * Pure post-hit invulnerability window check (default 1.5 seconds).
 */
export function isInvulnerable(
  now: number,
  lastHitTime: number | null,
  invulnDurationSec = GAME_CONFIG.collisionInvulnSec
): boolean {
  if (lastHitTime === null || !Number.isFinite(lastHitTime) || lastHitTime < 0) {
    return false;
  }
  if (!Number.isFinite(now) || now < lastHitTime) {
    return false;
  }
  return now - lastHitTime < invulnDurationSec;
}

export function getRankGrade(score: number): string {
  for (const rank of GAME_CONFIG.ranks) {
    if (score >= rank.minScore) {
      return rank.title;
    }
  }
  return '아기 갈매기';
}
