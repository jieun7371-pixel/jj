import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalLeaderboardStore,
  getLeaderboardTopScoresMap,
  type StorageLike,
} from './leaderboardStore.ts';
import {
  loadLastNickname,
  normalizeNicknameDraft,
  sanitizeNickname,
  saveLastNickname,
} from './nickname.ts';
import {
  canEnterLeaderboard,
  getRankForScore,
  insertEntry,
  sortAndTrimEntries,
  type LeaderboardEntry,
} from './rank.ts';

function createMemoryStorage(initial?: Record<string, string>): StorageLike {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function createBlockedStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('SecurityError: storage blocked');
    },
    setItem: () => {
      throw new Error('SecurityError: storage blocked');
    },
    removeItem: () => {
      throw new Error('SecurityError: storage blocked');
    },
  };
}

test('Nickname sanitization strips spaces/special chars, caps at 8 chars, defaults empty/banned to 갈매기', () => {
  assert.equal(normalizeNicknameDraft('부산 갈매기!! 12345'), '부산갈매기123');
  assert.equal(normalizeNicknameDraft('abc def_999'), 'abcdef99');
  assert.equal(sanitizeNickname('   !@#$   '), '갈매기');
  assert.equal(sanitizeNickname(''), '갈매기');
  assert.equal(sanitizeNickname('시발갈매기'), '갈매기');
  assert.equal(sanitizeNickname('MyFUCK1'), '갈매기');
  assert.equal(sanitizeNickname('서면왕갈매기짱이다'), '서면왕갈매기짱이');

  const mem = createMemoryStorage();
  assert.equal(loadLastNickname(mem), '');
  saveLastNickname('항구왕 123', mem);
  assert.equal(loadLastNickname(mem), '항구왕123');
});

test('Pure leaderboard ranking sorts descending, preserves earlier timestamp on tie, rejects score 0, and computes gap to #10', () => {
  const entries: LeaderboardEntry[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `e${idx + 1}`,
    nickname: `유저${idx + 1}`,
    score: (10 - idx) * 100, // 1000, 900, ..., 100
    eatenCount: 5,
    maxCombo: 2,
    crashCount: 0,
    createdAtMs: 1000 + idx,
  }));

  // Score 0 is never eligible even when leaderboard is empty
  assert.equal(canEnterLeaderboard(0, []), false);
  const zeroStatus = getRankForScore(0, []);
  assert.equal(zeroStatus.inTop10, false);
  assert.equal(zeroStatus.rank, null);
  assert.equal(zeroStatus.pointsNeededForTop10, 1);

  // Tying #10 (score 100) does NOT replace earlier #10
  assert.equal(canEnterLeaderboard(100, entries), false);
  const tieTenthStatus = getRankForScore(100, entries);
  assert.equal(tieTenthStatus.inTop10, false);
  assert.equal(tieTenthStatus.pointsNeededForTop10, 1);

  // Score 75 needs 26 points to beat 10th place (100 -> 101)
  const lowStatus = getRankForScore(75, entries);
  assert.equal(lowStatus.inTop10, false);
  assert.equal(lowStatus.pointsNeededForTop10, 26);

  // Tying #5 (600) enters at #6 because earlier record stays higher
  const tieMidStatus = getRankForScore(600, entries);
  assert.equal(tieMidStatus.inTop10, true);
  assert.equal(tieMidStatus.rank, 6);

  const inserted = insertEntry(entries, {
    id: 'late600',
    nickname: '후발주자',
    score: 600,
    eatenCount: 8,
    maxCombo: 4,
    crashCount: 0,
    createdAtMs: 99999,
  });
  assert.equal(inserted.inserted, true);
  assert.equal(inserted.rank, 6);
  assert.equal(inserted.entries.length, 10);
  assert.equal(inserted.entries[4].id, 'e5');
  assert.equal(inserted.entries[5].id, 'late600');

  // Filtering & sorting drops score <= 0 and caps at 10
  const trimmed = sortAndTrimEntries([
    ...entries,
    { ...entries[0], id: 'zero', score: 0 },
    { ...entries[0], id: 'top', score: 2500 },
  ]);
  assert.equal(trimmed.length, 10);
  assert.equal(trimmed[0].id, 'top');
});

test('LocalLeaderboardStore separates difficulties cleanly, recovers from corrupted JSON, and falls back when storage is blocked', () => {
  const mem = createMemoryStorage({
    'seagull.lb.easy': '{broken json!!!',
    'seagull.lb.normal': JSON.stringify([
      {
        id: 'bad',
        nickname: 'bad',
        score: -50,
        eatenCount: 0,
        maxCombo: 0,
        crashCount: 0,
        createdAtMs: 10,
      },
      {
        id: 'valid1',
        nickname: '노말챔프',
        score: 2200,
        eatenCount: 10,
        maxCombo: 5,
        crashCount: 0,
        createdAtMs: 1000,
      },
    ]),
  });

  const store = new LocalLeaderboardStore(mem);
  assert.equal(store.isPersistent(), true);
  assert.deepEqual(store.getTop('easy'), []);
  assert.equal(store.getTop('normal').length, 1);
  assert.equal(store.getTop('normal')[0].score, 2200);

  // Submit into easy & check per-difficulty top scores map
  const subEasy = store.submit({
    difficulty: 'easy',
    nickname: '갈매기 킹!',
    score: 1450,
    eatenCount: 7,
    maxCombo: 3,
    crashCount: 1,
    createdAtMs: 2000,
  });
  assert.equal(subEasy.saved, true);
  assert.equal(subEasy.rank, 1);
  assert.equal(subEasy.entry?.nickname, '갈매기킹');

  assert.deepEqual(getLeaderboardTopScoresMap(store), {
    easy: 1450,
    normal: 2200,
    hard: 0,
  });

  // Clearing easy leaves normal intact and drops easy top score to 0
  store.clear('easy');
  assert.deepEqual(getLeaderboardTopScoresMap(store), {
    easy: 0,
    normal: 2200,
    hard: 0,
  });

  // Zero-score run is rejected without persisting
  const zeroSub = store.submit({
    difficulty: 'hard',
    nickname: '빵점',
    score: 0,
    eatenCount: 0,
    maxCombo: 0,
    crashCount: 3,
  });
  assert.equal(zeroSub.saved, false);
  assert.deepEqual(store.getTop('hard'), []);

  // Blocked localStorage falls back seamlessly to in-memory store with isPersistent() === false
  const blockedStore = new LocalLeaderboardStore(createBlockedStorage());
  assert.equal(blockedStore.isPersistent(), false);
  const memSub = blockedStore.submit({
    difficulty: 'hard',
    nickname: '인메모리',
    score: 3300,
    eatenCount: 12,
    maxCombo: 6,
    crashCount: 0,
  });
  assert.equal(memSub.saved, true);
  assert.equal(memSub.rank, 1);
  assert.equal(blockedStore.getTop('hard')[0].score, 3300);
});
