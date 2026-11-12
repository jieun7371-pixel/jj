import { RotateCcw, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import {
  formatLeaderboardDate,
  type LeaderboardEntry,
  type LeaderboardRankStatus,
} from '../game/leaderboard/rank.ts';
import { getDifficultyPreset } from '../game/rules/difficulty.ts';
import { GAME_CONFIG } from '../game/rules/gameConfig.ts';
import type { GameRoundState } from '../game/rules/gameState.ts';
import { getRankGrade } from '../game/rules/scoring.ts';
import { NicknameInput } from './NicknameInput.tsx';
import { RankBadge } from './RankBadge.tsx';

interface ResultScreenProps {
  gameState: GameRoundState;
  rankStatus: LeaderboardRankStatus;
  topEntries: LeaderboardEntry[];
  submittedEntryId: string | null;
  submittedRank: number | null;
  isStoragePersistent: boolean;
  onSubmitLeaderboard: (nickname: string) => void;
  onSkipLeaderboard: () => void;
  onOpenLeaderboard: () => void;
  onPlayAgain: () => void;
  onChangeDifficulty: () => void;
}

export function ResultScreen({
  gameState,
  rankStatus,
  topEntries,
  submittedEntryId,
  submittedRank,
  isStoragePersistent,
  onSubmitLeaderboard,
  onSkipLeaderboard,
  onOpenLeaderboard,
  onPlayAgain,
  onChangeDifficulty,
}: ResultScreenProps) {
  if (gameState.phase !== 'RESULT') return null;

  const grade = getRankGrade(gameState.score);
  const preset = getDifficultyPreset(gameState.difficulty);
  const isNoCrash = gameState.crashCount === 0;
  const isFirstPlace =
    submittedRank === 1 ||
    (submittedEntryId === null && rankStatus.rank === 1) ||
    (gameState.isNewRecord && gameState.score > 0);
  const needsNickname = rankStatus.inTop10 && submittedEntryId === null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/75 p-2.5 sm:p-4 select-none">
      <div className="max-w-md w-full max-h-full overflow-y-auto rounded-xl bg-slate-900/95 border border-amber-400/50 p-4 sm:p-5 text-center shadow-2xl">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm font-bold text-sky-300">
          <span>{preset.label} 난이도 사냥 종료</span>
          {isNoCrash && (
            <span className="inline-flex items-center gap-1 font-extrabold text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              노 크래시!
            </span>
          )}
        </div>

        {isFirstPlace && (
          <div className="mt-1.5 text-base sm:text-lg font-black text-yellow-300 hud-shadow">
            🎉 최고 기록!
          </div>
        )}

        <h2 className="mt-0.5 text-xl sm:text-2xl font-black text-white hud-shadow">{grade}</h2>

        <div className="mt-3 pt-2.5 border-t border-white/10">
          <div className="text-[11px] sm:text-xs font-semibold text-slate-400">최종 점수</div>
          <div className="mt-0.5 font-mono-num text-4xl sm:text-5xl font-black text-amber-300 hud-shadow">
            {gameState.score.toLocaleString('ko-KR')}
          </div>

          {gameState.noCrashBonus > 0 && (
            <div className="mt-1 text-xs font-extrabold text-emerald-300 font-mono-num">
              무충돌 보너스 +{GAME_CONFIG.noCrashBonusPoints}점 포함!
            </div>
          )}

          {/* 4 Key Round Metrics: Eaten, Max Combo, Crash Count, Total Penalty */}
          <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-white/10 pt-2.5 text-center">
            <div>
              <div className="text-[10px] sm:text-[11px] text-slate-400">먹은 개수</div>
              <div className="font-mono-num text-sm sm:text-base font-extrabold text-white">
                {gameState.eatenCount}개
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-slate-400">최대 콤보</div>
              <div className="font-mono-num text-sm sm:text-base font-extrabold text-orange-300">
                {gameState.maxCombo}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-slate-400">충돌 횟수</div>
              <div
                className={`font-mono-num text-sm sm:text-base font-extrabold ${
                  isNoCrash ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {gameState.crashCount}회
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-slate-400">감점 합계</div>
              <div
                className={`font-mono-num text-sm sm:text-base font-extrabold ${
                  gameState.totalPenalty > 0 ? 'text-rose-400' : 'text-slate-300'
                }`}
              >
                {gameState.totalPenalty > 0
                  ? `-${gameState.totalPenalty.toLocaleString('ko-KR')}`
                  : '0'}
              </div>
            </div>
          </div>
        </div>

        {!isStoragePersistent && (
          <p className="mt-2 text-[11px] font-semibold text-amber-300">
            기록이 이 기기에 저장되지 않아요
          </p>
        )}

        {/* TOP 10 Qualification Nickname Form OR Out-of-TOP-10 Hint */}
        {needsNickname ? (
          <NicknameInput
            rank={rankStatus.rank!}
            onSubmit={onSubmitLeaderboard}
            onSkip={onSkipLeaderboard}
          />
        ) : (
          <div className="mt-3 rounded-lg bg-slate-950/75 border border-white/10 p-2.5 text-left">
            {submittedEntryId !== null && submittedRank !== null ? (
              <div className="mb-2 text-xs font-extrabold text-emerald-300 flex items-center justify-between">
                <span>순위표 {submittedRank}위에 등록되었습니다!</span>
                <span className="font-mono-num">{preset.label} TOP 10</span>
              </div>
            ) : (
              <div className="mb-2 text-xs font-bold text-slate-300">
                {gameState.score <= 0 && topEntries.length === 0
                  ? '점수를 획득하면 순위표에 등록됩니다'
                  : `아쉬워요! 10등까지 ${rankStatus.pointsNeededForTop10.toLocaleString('ko-KR')}점 남았어요`}
              </div>
            )}

            {/* Compact TOP 10 List Preview */}
            <div className="max-h-40 overflow-y-auto divide-y divide-white/5">
              {Array.from({ length: GAME_CONFIG.leaderboard.maxEntries }, (_, idx) => {
                const rank = idx + 1;
                const entry = topEntries[idx] ?? null;
                const isMe = Boolean(entry && submittedEntryId && entry.id === submittedEntryId);
                return (
                  <div
                    key={rank}
                    className={`grid grid-cols-[30px_minmax(60px,1fr)_58px_38px] items-center gap-1.5 py-1 px-1.5 text-[11px] ${
                      isMe ? 'bg-emerald-500/20 rounded font-bold' : ''
                    }`}
                  >
                    <RankBadge rank={rank} compact />
                    {entry ? (
                      <>
                        <div className="min-w-0 flex items-center gap-1">
                          <span
                            className={`truncate ${
                              isMe ? 'text-emerald-200 font-bold' : 'text-slate-200 font-semibold'
                            }`}
                          >
                            {entry.nickname}
                          </span>
                          {isMe && (
                            <span className="font-mono-num text-[9px] font-black text-emerald-300 shrink-0">
                              NEW
                            </span>
                          )}
                        </div>
                        <span className="text-right font-mono-num font-black text-amber-300">
                          {entry.score.toLocaleString('ko-KR')}
                        </span>
                        <span className="text-right font-mono-num text-[10px] text-slate-400">
                          {formatLeaderboardDate(entry.createdAtMs)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-600 font-mono-num">-</span>
                        <span className="text-right text-slate-600 font-mono-num">-</span>
                        <span className="text-right text-slate-600 font-mono-num">-</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenLeaderboard}
            className="min-h-12 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-amber-400/35 text-xs sm:text-sm font-bold text-amber-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span aria-hidden="true">🏆</span>
            <span>순위표</span>
          </button>
          <button
            type="button"
            onClick={onChangeDifficulty}
            className="min-h-12 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <SlidersHorizontal className="w-4 h-4 shrink-0" />
            <span>난이도</span>
          </button>
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex-1 min-h-12 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-slate-950 font-black text-base shadow-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>다시 하기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
