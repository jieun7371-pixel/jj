import { useEffect, useState } from 'react';
import { Trash2, Trophy, X } from 'lucide-react';
import {
  formatLeaderboardDate,
  type LeaderboardEntry,
} from '../game/leaderboard/rank.ts';
import {
  DIFFICULTY_ORDER,
  DIFFICULTY_PRESETS,
  type DifficultyPresetId,
} from '../game/rules/difficulty.ts';
import { GAME_CONFIG } from '../game/rules/gameConfig.ts';
import { RankBadge } from './RankBadge.tsx';

interface LeaderboardScreenProps {
  isOpen: boolean;
  initialDifficulty: DifficultyPresetId;
  entriesByDifficulty: Record<DifficultyPresetId, LeaderboardEntry[]>;
  highlightEntryId?: string | null;
  isPersistent: boolean;
  onClearDifficulty: (difficulty: DifficultyPresetId) => void;
  onClose: () => void;
}

export function LeaderboardScreen({
  isOpen,
  initialDifficulty,
  entriesByDifficulty,
  highlightEntryId = null,
  isPersistent,
  onClearDifficulty,
  onClose,
}: LeaderboardScreenProps) {
  const [activeTab, setActiveTab] = useState<DifficultyPresetId>(initialDifficulty);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialDifficulty);
      setConfirmClear(false);
    }
  }, [isOpen, initialDifficulty]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (confirmClear) {
          setConfirmClear(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, confirmClear, onClose]);

  if (!isOpen) return null;

  const entries = entriesByDifficulty[activeTab] ?? [];
  const activePreset = DIFFICULTY_PRESETS[activeTab];
  const slots = Array.from({ length: GAME_CONFIG.leaderboard.maxEntries }, (_, idx) => ({
    rank: idx + 1,
    entry: entries[idx] ?? null,
  }));

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/85 p-2 sm:p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="최고 점수 순위표"
    >
      <div className="w-full max-w-lg max-h-[96dvh] flex flex-col rounded-xl bg-slate-900/98 border border-amber-400/45 p-3 sm:p-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-300 shrink-0" />
            <h2 className="text-base sm:text-lg font-black text-white hud-shadow">
              최고 점수 순위표 TOP 10
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="순위표 닫기"
            className="min-h-11 min-w-11 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Difficulty Tabs */}
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="tablist" aria-label="난이도별 순위표 탭">
          {DIFFICULTY_ORDER.map((id) => {
            const p = DIFFICULTY_PRESETS[id];
            const isSelected = activeTab === id;
            const topScore = entriesByDifficulty[id]?.[0]?.score ?? 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setActiveTab(id);
                  setConfirmClear(false);
                }}
                className={`min-h-11 px-2 py-1.5 rounded-lg border text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-orange-500 border-orange-300 text-slate-950 shadow'
                    : 'bg-slate-800/90 border-white/15 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <span>{p.label}</span>
                {topScore > 0 && (
                  <span
                    className={`font-mono-num text-[10px] sm:text-xs font-bold ${
                      isSelected ? 'text-slate-900' : 'text-amber-300'
                    }`}
                  >
                    {topScore.toLocaleString('ko-KR')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Storage Fallback Warning */}
        {!isPersistent && (
          <p className="mt-1.5 text-center text-[11px] font-semibold text-amber-300">
            기록이 이 기기에 저장되지 않아요 (브라우저 저장 공간 제한됨)
          </p>
        )}

        {/* Fixed 10-slot Table (All 1..10 rows visible cleanly on mobile portrait) */}
        <div className="mt-2 rounded-lg bg-slate-950/70 border border-white/10 overflow-hidden">
          <div className="grid grid-cols-[34px_minmax(60px,1fr)_58px_32px_32px_30px_40px] sm:grid-cols-[44px_minmax(80px,1fr)_74px_42px_42px_38px_48px] items-center gap-1 px-2 py-1.5 border-b border-white/10 text-[10px] sm:text-[11px] font-bold text-slate-400">
            <span>순위</span>
            <span>닉네임</span>
            <span className="text-right">점수</span>
            <span className="text-right">개수</span>
            <span className="text-right">콤보</span>
            <span className="text-right">충돌</span>
            <span className="text-right">날짜</span>
          </div>

          <div className="divide-y divide-white/5">
            {slots.map(({ rank, entry }) => {
              const isHighlighted = Boolean(entry && highlightEntryId && entry.id === highlightEntryId);
              const rowBg = isHighlighted
                ? 'bg-emerald-500/20 border-l-2 border-l-emerald-400'
                : rank === 1 && entry
                ? 'bg-amber-400/12 border-l-2 border-l-amber-300'
                : rank === 2 && entry
                ? 'bg-slate-300/8 border-l-2 border-l-slate-300'
                : rank === 3 && entry
                ? 'bg-orange-400/10 border-l-2 border-l-orange-400'
                : '';

              return (
                <div
                  key={rank}
                  className={`grid grid-cols-[34px_minmax(60px,1fr)_58px_32px_32px_30px_40px] sm:grid-cols-[44px_minmax(80px,1fr)_74px_42px_42px_38px_48px] items-center gap-1 px-2 py-1.5 min-h-[31px] sm:min-h-[34px] text-xs ${rowBg}`}
                >
                  <div>
                    <RankBadge rank={rank} compact />
                  </div>

                  {entry ? (
                    <>
                      <div className="min-w-0 flex items-center gap-1">
                        <span
                          className={`truncate font-bold text-[11px] sm:text-xs ${
                            isHighlighted
                              ? 'text-emerald-200'
                              : rank <= 3
                              ? 'text-white'
                              : 'text-slate-200'
                          }`}
                        >
                          {entry.nickname}
                        </span>
                        {isHighlighted && (
                          <span className="font-mono-num text-[9px] sm:text-[10px] font-black text-emerald-300 shrink-0">
                            NEW
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-right font-mono-num font-black text-[11px] sm:text-xs ${
                          rank === 1
                            ? 'text-amber-300'
                            : rank <= 3
                            ? 'text-orange-200'
                            : 'text-white'
                        }`}
                      >
                        {entry.score.toLocaleString('ko-KR')}
                      </div>
                      <div className="text-right font-mono-num text-[11px] text-slate-300">
                        {entry.eatenCount}
                      </div>
                      <div className="text-right font-mono-num text-[11px] text-orange-300">
                        {entry.maxCombo}
                      </div>
                      <div
                        className={`text-right font-mono-num text-[11px] ${
                          entry.crashCount === 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {entry.crashCount}
                      </div>
                      <div className="text-right font-mono-num text-[10px] sm:text-[11px] text-slate-400">
                        {formatLeaderboardDate(entry.createdAtMs)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-slate-600 font-mono-num">-</div>
                      <div className="text-right text-slate-600 font-mono-num">-</div>
                      <div className="text-right text-slate-600 font-mono-num">-</div>
                      <div className="text-right text-slate-600 font-mono-num">-</div>
                      <div className="text-right text-slate-600 font-mono-num">-</div>
                      <div className="text-right text-slate-600 font-mono-num">-</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions: Subtle Per-Difficulty Clear + Close */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {!confirmClear ? (
            <>
              <button
                type="button"
                disabled={entries.length === 0}
                onClick={() => setConfirmClear(true)}
                className="min-h-11 px-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-rose-300 disabled:opacity-40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>기록 지우기</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="min-h-11 px-5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-sm font-bold text-white cursor-pointer whitespace-nowrap"
              >
                닫기
              </button>
            </>
          ) : (
            <div className="w-full flex items-center justify-between gap-2 rounded-lg bg-rose-950/60 border border-rose-500/40 px-2.5 py-1.5">
              <span className="text-xs font-bold text-rose-100 leading-snug">
                ‘{activePreset.label}’ 순위표 기록을 모두 지울까요?
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-11 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer whitespace-nowrap"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearDifficulty(activeTab);
                    setConfirmClear(false);
                  }}
                  className="min-h-11 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap"
                >
                  삭제
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
