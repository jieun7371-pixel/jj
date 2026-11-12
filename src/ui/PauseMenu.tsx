import { useEffect, useState } from 'react';
import { Home, Play, RotateCcw } from 'lucide-react';
import { getDifficultyPreset } from '../game/rules/difficulty.ts';
import type { GameRoundState } from '../game/rules/gameState.ts';

interface PauseMenuProps {
  gameState: GameRoundState;
  onResume: () => void;
  onRestart: () => void;
  onExitToReady: () => void;
}

type PendingConfirm = 'restart' | 'exit' | null;

function getPauseReasonText(reason: GameRoundState['pauseReason']): string | null {
  if (reason === 'tab-hidden') {
    return '브라우저 탭이 비활성화되어 자동 일시정지되었습니다.';
  }
  if (reason === 'webcam-lost') {
    return '웹캠 연결이 끊어져 자동 일시정지되었습니다.';
  }
  return null;
}

export function PauseMenu({
  gameState,
  onResume,
  onRestart,
  onExitToReady,
}: PauseMenuProps) {
  const [confirmAction, setConfirmAction] = useState<PendingConfirm>(null);

  useEffect(() => {
    if (!confirmAction) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setConfirmAction(null);
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [confirmAction]);

  if (gameState.phase !== 'PAUSED') return null;

  const preset = getDifficultyPreset(gameState.difficulty);
  const autoReason = getPauseReasonText(gameState.pauseReason);
  const timeCeil = Math.ceil(gameState.timeLeftSec);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-3 md:p-4 select-none">
      <div className="max-w-sm w-full max-h-full overflow-y-auto rounded-xl bg-slate-900/95 border border-white/20 p-5 text-center shadow-2xl">
        <h2 className="text-2xl font-black text-white hud-shadow">일시정지</h2>

        {autoReason && (
          <p className="mt-1.5 text-xs font-semibold text-amber-300">{autoReason}</p>
        )}

        {/* Quiet unboxed snapshot of paused round state */}
        <div className="mt-2.5 flex items-center justify-center gap-2 text-xs text-slate-300 font-mono-num">
          <span className="font-sans font-bold text-sky-300">{preset.label}</span>
          <span aria-hidden="true">·</span>
          <span>남은 {timeCeil}초</span>
          <span aria-hidden="true">·</span>
          <span>{gameState.score.toLocaleString('ko-KR')}점</span>
          <span aria-hidden="true">·</span>
          <span>{gameState.eatenCount}개</span>
        </div>

        {confirmAction === null ? (
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full min-h-12 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-slate-950 font-black text-base shadow-lg flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current shrink-0" />
              <span>계속하기</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction('restart')}
              className="w-full min-h-11 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-sm font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>다시 시작</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction('exit')}
              className="w-full min-h-11 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-sm font-bold text-slate-200 flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Home className="w-4 h-4 shrink-0" />
              <span>종료하고 처음으로</span>
            </button>

            <p className="mt-1 text-[11px] text-slate-400">
              단축키: P 또는 Esc로 계속하기
            </p>
          </div>
        ) : (
          <div className="mt-5 border-t border-white/15 pt-4">
            <p className="text-sm font-bold text-white leading-snug">
              {confirmAction === 'restart'
                ? '현재 기록이 사라져요. 다시 시작할까요?'
                : '현재 기록이 사라져요. 처음으로 돌아갈까요?'}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="flex-1 min-h-11 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-sm font-bold text-slate-200 cursor-pointer whitespace-nowrap"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const act = confirmAction;
                  setConfirmAction(null);
                  if (act === 'restart') onRestart();
                  else onExitToReady();
                }}
                className="flex-1 min-h-11 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-extrabold shadow cursor-pointer whitespace-nowrap"
              >
                {confirmAction === 'restart' ? '다시 시작' : '처음으로'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
