import type { DifficultyPresetId } from '../rules/difficulty.ts';
import { GAME_CONFIG } from '../rules/gameConfig.ts';

export interface LeaderboardEntry {
  id: string;
  nickname: string;
  score: number;
  eatenCount: number;
  maxCombo: number;
  crashCount: number;
  createdAtMs: number;
}

export interface LeaderboardRankStatus {
  inTop10: boolean;
  rank: number | null;
  pointsNeededForTop10: number;
}

export interface LeaderboardSubmitInput {
  difficulty: DifficultyPresetId;
  nickname: string;
  score: number;
  eatenCount: number;
  maxCombo: number;
  crashCount: number;
  createdAtMs?: number;
  id?: string;
}

export interface LeaderboardSubmitResult {
  saved: boolean;
  rank: number | null;
  entry: LeaderboardEntry | null;
  entries: LeaderboardEntry[];
  isTopRecord: boolean;
}

/**
 * Sorts leaderboard entries descending by score; ties keep earlier createdAtMs higher.
 * Filters out invalid / 0-point runs and caps length to maxEntries (default 10).
 */
export function sortAndTrimEntries(
  entries: readonly LeaderboardEntry[],
  maxEntries = GAME_CONFIG.leaderboard.maxEntries
): LeaderboardEntry[] {
  const valid = entries.filter(
    (entry) => Number.isFinite(entry.score) && Math.floor(entry.score) > 0
  );

  return [...valid]
    .sort((a, b) => {
      const scoreDiff = Math.floor(b.score) - Math.floor(a.score);
      if (scoreDiff !== 0) return scoreDiff;
      const timeDiff = a.createdAtMs - b.createdAtMs;
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxEntries);
}

/**
 * Checks whether a score enters TOP 10:
 * - Score <= 0 is never recorded.
 * - Fewer than 10 entries: any score >= 1 qualifies immediately.
 * - At 10 entries: must strictly beat the 10th entry score (ties preserve earlier entry).
 */
export function canEnterLeaderboard(
  score: number,
  entries: readonly LeaderboardEntry[],
  maxEntries = GAME_CONFIG.leaderboard.maxEntries
): boolean {
  const cleanScore = Number.isFinite(score) ? Math.floor(score) : 0;
  if (cleanScore <= 0) return false;

  const sorted = sortAndTrimEntries(entries, maxEntries);
  if (sorted.length < maxEntries) return true;
  return cleanScore > Math.floor(sorted[maxEntries - 1].score);
}

/**
 * Pure ranking check for an unsubmitted run against existing TOP 10 entries.
 */
export function getRankForScore(
  score: number,
  entries: readonly LeaderboardEntry[],
  maxEntries = GAME_CONFIG.leaderboard.maxEntries
): LeaderboardRankStatus {
  const cleanScore = Number.isFinite(score) ? Math.floor(score) : 0;
  const sorted = sortAndTrimEntries(entries, maxEntries);

  if (cleanScore <= 0) {
    const thresholdScore = sorted.length < maxEntries ? 1 : Math.floor(sorted[maxEntries - 1].score) + 1;
    return {
      inTop10: false,
      rank: null,
      pointsNeededForTop10: thresholdScore,
    };
  }

  if (!canEnterLeaderboard(cleanScore, sorted, maxEntries)) {
    const tenthScore = Math.floor(sorted[maxEntries - 1].score);
    return {
      inTop10: false,
      rank: null,
      pointsNeededForTop10: Math.max(1, tenthScore - cleanScore + 1),
    };
  }

  // Ties place earlier records higher, so count existing entries >= cleanScore
  let higherOrEqualCount = 0;
  for (const entry of sorted) {
    if (Math.floor(entry.score) >= cleanScore) {
      higherOrEqualCount += 1;
    }
  }

  return {
    inTop10: true,
    rank: higherOrEqualCount + 1,
    pointsNeededForTop10: 0,
  };
}

/**
 * Pure insertion returning updated TOP 10 list and 1-based rank (if inserted).
 */
export function insertEntry(
  entries: readonly LeaderboardEntry[],
  newEntry: LeaderboardEntry,
  maxEntries = GAME_CONFIG.leaderboard.maxEntries
): { inserted: boolean; rank: number | null; entries: LeaderboardEntry[] } {
  const baseSorted = sortAndTrimEntries(entries, maxEntries);
  const cleanScore = Number.isFinite(newEntry.score) ? Math.floor(newEntry.score) : 0;

  if (!canEnterLeaderboard(cleanScore, baseSorted, maxEntries)) {
    return { inserted: false, rank: null, entries: baseSorted };
  }

  const normalizedEntry: LeaderboardEntry = {
    ...newEntry,
    score: cleanScore,
    eatenCount: Math.max(0, Math.floor(newEntry.eatenCount)),
    maxCombo: Math.max(0, Math.floor(newEntry.maxCombo)),
    crashCount: Math.max(0, Math.floor(newEntry.crashCount)),
  };

  const nextSorted = sortAndTrimEntries([...baseSorted, normalizedEntry], maxEntries);
  const idx = nextSorted.findIndex((item) => item.id === normalizedEntry.id);

  if (idx === -1) {
    return { inserted: false, rank: null, entries: baseSorted };
  }

  return {
    inserted: true,
    rank: idx + 1,
    entries: nextSorted,
  };
}

export function formatLeaderboardDate(createdAtMs: number): string {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return '-';
  const d = new Date(createdAtMs);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}.${dd}`;
}
