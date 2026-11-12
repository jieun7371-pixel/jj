import {
  DIFFICULTY_ORDER,
  type DifficultyPresetId,
  type HighScoreMap,
} from '../rules/difficulty.ts';
import { GAME_CONFIG } from '../rules/gameConfig.ts';
import { sanitizeNickname, saveLastNickname } from './nickname.ts';
import {
  getRankForScore,
  insertEntry,
  sortAndTrimEntries,
  type LeaderboardEntry,
  type LeaderboardRankStatus,
  type LeaderboardSubmitInput,
  type LeaderboardSubmitResult,
} from './rank.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LeaderboardStore {
  getTop(difficulty: DifficultyPresetId): LeaderboardEntry[];
  submit(input: LeaderboardSubmitInput): LeaderboardSubmitResult;
  getRankFor(score: number, difficulty: DifficultyPresetId): LeaderboardRankStatus;
  clear(difficulty: DifficultyPresetId): void;
  isPersistent(): boolean;
}

function generateEntryId(nowMs: number): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `lb_${nowMs}_${rand}`;
}

function isValidEntryCandidate(raw: unknown): raw is LeaderboardEntry {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  const score = Number(obj.score);
  const createdAtMs = Number(obj.createdAtMs);
  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (!Number.isFinite(score) || Math.floor(score) <= 0) return false;
  if (!Number.isFinite(createdAtMs) || createdAtMs < 0) return false;
  return true;
}

function normalizeLoadedEntry(raw: LeaderboardEntry): LeaderboardEntry {
  return {
    id: raw.id,
    nickname: sanitizeNickname(typeof raw.nickname === 'string' ? raw.nickname : ''),
    score: Math.floor(raw.score),
    eatenCount: Math.max(0, Math.floor(Number(raw.eatenCount) || 0)),
    maxCombo: Math.max(0, Math.floor(Number(raw.maxCombo) || 0)),
    crashCount: Math.max(0, Math.floor(Number(raw.crashCount) || 0)),
    createdAtMs: Math.floor(raw.createdAtMs),
  };
}

function probeStorage(storage: StorageLike | null): boolean {
  if (!storage) return false;
  const probeKey = '__seagull_lb_probe__';
  try {
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

export class LocalLeaderboardStore implements LeaderboardStore {
  private readonly storage: StorageLike | null;
  private persistent: boolean;
  private readonly memoryFallback = new Map<DifficultyPresetId, LeaderboardEntry[]>();

  constructor(storage?: StorageLike | null) {
    if (storage !== undefined) {
      this.storage = storage;
    } else if (typeof window !== 'undefined') {
      try {
        this.storage = window.localStorage ?? null;
      } catch {
        this.storage = null;
      }
    } else {
      this.storage = null;
    }

    this.persistent = probeStorage(this.storage);
    for (const diff of DIFFICULTY_ORDER) {
      this.memoryFallback.set(diff, []);
    }
  }

  isPersistent(): boolean {
    return this.persistent;
  }

  getTop(difficulty: DifficultyPresetId): LeaderboardEntry[] {
    if (!this.persistent || !this.storage) {
      return [...(this.memoryFallback.get(difficulty) ?? [])];
    }

    const key = GAME_CONFIG.leaderboard.storageKeys[difficulty];
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const clean = parsed
        .filter(isValidEntryCandidate)
        .map(normalizeLoadedEntry);
      return sortAndTrimEntries(clean, GAME_CONFIG.leaderboard.maxEntries);
    } catch {
      return [];
    }
  }

  getRankFor(score: number, difficulty: DifficultyPresetId): LeaderboardRankStatus {
    return getRankForScore(score, this.getTop(difficulty), GAME_CONFIG.leaderboard.maxEntries);
  }

  submit(input: LeaderboardSubmitInput): LeaderboardSubmitResult {
    const existing = this.getTop(input.difficulty);
    const createdAtMs = input.createdAtMs ?? Date.now();
    const id = input.id ?? generateEntryId(createdAtMs);
    const cleanNick = sanitizeNickname(input.nickname);

    const candidate: LeaderboardEntry = {
      id,
      nickname: cleanNick,
      score: Math.floor(input.score),
      eatenCount: Math.max(0, Math.floor(input.eatenCount)),
      maxCombo: Math.max(0, Math.floor(input.maxCombo)),
      crashCount: Math.max(0, Math.floor(input.crashCount)),
      createdAtMs,
    };

    const res = insertEntry(existing, candidate, GAME_CONFIG.leaderboard.maxEntries);
    if (!res.inserted || res.rank === null) {
      return {
        saved: false,
        rank: null,
        entry: null,
        entries: res.entries,
        isTopRecord: false,
      };
    }

    this.writeDifficultyEntries(input.difficulty, res.entries);
    if (this.persistent && this.storage && input.nickname.trim().length > 0) {
      saveLastNickname(cleanNick, this.storage);
    }

    const savedEntry = res.entries.find((e) => e.id === id) ?? candidate;
    return {
      saved: true,
      rank: res.rank,
      entry: savedEntry,
      entries: res.entries,
      isTopRecord: res.rank === 1,
    };
  }

  clear(difficulty: DifficultyPresetId): void {
    this.memoryFallback.set(difficulty, []);
    if (!this.storage) return;
    try {
      this.storage.removeItem(GAME_CONFIG.leaderboard.storageKeys[difficulty]);
    } catch {
      this.persistent = false;
    }
  }

  private writeDifficultyEntries(
    difficulty: DifficultyPresetId,
    entries: LeaderboardEntry[]
  ): void {
    this.memoryFallback.set(difficulty, [...entries]);
    if (!this.persistent || !this.storage) return;
    try {
      this.storage.setItem(
        GAME_CONFIG.leaderboard.storageKeys[difficulty],
        JSON.stringify(entries)
      );
    } catch {
      // Blocked or over-quota storage gracefully degrades to in-memory store
      this.persistent = false;
    }
  }
}

export const localLeaderboardStore = new LocalLeaderboardStore();

export function getLeaderboardTopScoresMap(
  store: LeaderboardStore = localLeaderboardStore
): HighScoreMap {
  return {
    easy: store.getTop('easy')[0]?.score ?? 0,
    normal: store.getTop('normal')[0]?.score ?? 0,
    hard: store.getTop('hard')[0]?.score ?? 0,
  };
}

export function getAllLeaderboardsMap(
  store: LeaderboardStore = localLeaderboardStore
): Record<DifficultyPresetId, LeaderboardEntry[]> {
  return {
    easy: store.getTop('easy'),
    normal: store.getTop('normal'),
    hard: store.getTop('hard'),
  };
}
