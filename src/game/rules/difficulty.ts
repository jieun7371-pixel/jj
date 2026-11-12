export type DifficultyPresetId = 'easy' | 'normal' | 'hard';

export interface DifficultyPreset {
  id: DifficultyPresetId;
  label: string;
  speedMultiplier: number;
  collectRadiusM: number;
  comboWindowSec: number;
  energyDrainMultiplier: number;
  summary: string;
}

export type HighScoreMap = Record<DifficultyPresetId, number>;

export const DIFFICULTY_ORDER: readonly DifficultyPresetId[] = ['easy', 'normal', 'hard'];

export const DEFAULT_DIFFICULTY: DifficultyPresetId = 'normal';

export const DIFFICULTY_STORAGE_KEY = 'busan_seagull_difficulty_v1';
export const HIGH_SCORES_STORAGE_KEY = 'busan_seagull_shrimp_high_scores_v2';
export const LEGACY_HIGH_SCORE_STORAGE_KEY = 'busan_seagull_shrimp_high_score_v1';

export const DIFFICULTY_PRESETS: Record<DifficultyPresetId, DifficultyPreset> = {
  easy: {
    id: 'easy',
    label: '쉬움',
    speedMultiplier: 0.7,
    collectRadiusM: 9.0,
    comboWindowSec: 6.0,
    energyDrainMultiplier: 0.7,
    summary: '속도 0.7x · 획득 반경 9m · 콤보 유지 6초 · 에너지 소모 0.7배',
  },
  normal: {
    id: 'normal',
    label: '보통',
    speedMultiplier: 1.0,
    collectRadiusM: 7.0,
    comboWindowSec: 4.0,
    energyDrainMultiplier: 1.0,
    summary: '속도 1.0x · 획득 반경 7m · 콤보 유지 4초 · 에너지 소모 1.0배',
  },
  hard: {
    id: 'hard',
    label: '어려움',
    speedMultiplier: 1.4,
    collectRadiusM: 5.0,
    comboWindowSec: 3.0,
    energyDrainMultiplier: 1.2,
    summary: '속도 1.4x · 획득 반경 5m · 콤보 유지 3초 · 에너지 소모 1.2배',
  },
};

export function isDifficultyPresetId(val: unknown): val is DifficultyPresetId {
  return val === 'easy' || val === 'normal' || val === 'hard';
}

export function getDifficultyPreset(id: DifficultyPresetId): DifficultyPreset {
  return DIFFICULTY_PRESETS[id] ?? DIFFICULTY_PRESETS[DEFAULT_DIFFICULTY];
}

export function createEmptyHighScores(): HighScoreMap {
  return { easy: 0, normal: 0, hard: 0 };
}

export function loadSelectedDifficulty(): DifficultyPresetId {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_DIFFICULTY;
    }
    const raw = window.localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    return isDifficultyPresetId(raw) ? raw : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

export function saveSelectedDifficulty(difficulty: DifficultyPresetId): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty);
  } catch {
    // Ignore storage quota / security errors cleanly
  }
}

function sanitizeScore(val: unknown): number {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

export function loadHighScores(): HighScoreMap {
  const map = createEmptyHighScores();
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return map;
    }
    const rawMap = window.localStorage.getItem(HIGH_SCORES_STORAGE_KEY);
    if (rawMap) {
      const parsed = JSON.parse(rawMap) as Partial<Record<DifficultyPresetId, unknown>>;
      if (parsed && typeof parsed === 'object') {
        map.easy = sanitizeScore(parsed.easy);
        map.normal = sanitizeScore(parsed.normal);
        map.hard = sanitizeScore(parsed.hard);
      }
    }
    if (map.normal === 0) {
      const legacy = window.localStorage.getItem(LEGACY_HIGH_SCORE_STORAGE_KEY);
      map.normal = sanitizeScore(legacy);
    }
    return map;
  } catch {
    return map;
  }
}

export function saveHighScores(scores: HighScoreMap): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const clean: HighScoreMap = {
      easy: sanitizeScore(scores.easy),
      normal: sanitizeScore(scores.normal),
      hard: sanitizeScore(scores.hard),
    };
    window.localStorage.setItem(HIGH_SCORES_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadHighScoreForDifficulty(difficulty: DifficultyPresetId): number {
  return loadHighScores()[difficulty];
}

export function saveHighScoreForDifficulty(
  difficulty: DifficultyPresetId,
  score: number
): HighScoreMap {
  const current = loadHighScores();
  const cleanScore = sanitizeScore(score);
  if (cleanScore > current[difficulty]) {
    const updated: HighScoreMap = {
      ...current,
      [difficulty]: cleanScore,
    };
    saveHighScores(updated);
    return updated;
  }
  return current;
}
