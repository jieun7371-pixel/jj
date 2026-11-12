import { Play, Trophy } from 'lucide-react';
import {
  DIFFICULTY_ORDER,
  DIFFICULTY_PRESETS,
  type DifficultyPresetId,
  type HighScoreMap,
} from '../game/rules/difficulty.ts';

interface ReadyScreenProps {
  difficulty: DifficultyPresetId;
  highScoresByDifficulty: HighScoreMap;
  webcamActive: boolean;
  fistStartProgress: number; // 0..1
  isStoragePersistent?: boolean;
  onSelectDifficulty: (id: DifficultyPresetId) => void;
  onOpenLeaderboard: () => void;
  onStart: () => void;
  onRecalibrate: () => void;
}

export function ReadyScreen({
  difficulty,
  highScoresByDifficulty,
  webcamActive,
  fistStartProgress,
  isStoragePersistent = true,
  onSelectDifficulty,
  onOpenLeaderboard,
  onStart,
  onRecalibrate,
}: ReadyScreenProps) {
  const activePreset = DIFFICULTY_PRESETS[difficulty];
  const activeHighScore = highScoresByDifficulty[difficulty] ?? 0;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/65 p-3 md:p-4 select-none">
      <div className="max-w-md w-full max-h-full overflow-y-auto rounded-xl bg-slate-900/95 border border-orange-400/50 p-4 md:px-5 md:py-5 text-center shadow-2xl">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
          <Trophy className="w-4 h-4 shrink-0" />
          <span className="font-mono-num">
            {activePreset.label} 최고 기록 {activeHighScore.toLocaleString('ko-KR')}점
          </span>
        </div>

        <h2 className="mt-1 text-xl md:text-2xl font-extrabold text-white hud-shadow leading-snug">
          부산 갈매기 - 새우깡 사냥
        </h2>
        <p className="mt-1 text-xs md:text-sm text-slate-300">
          60초 동안 공중의 새우깡을 모아 콤보 점수를 쌓으세요
        </p>

        {/* Per-Difficulty Records Summary */}
        <div className="mt-2 flex items-center justify-center gap-2.5 text-[11px] font-mono-num text-slate-400">
          {DIFFICULTY_ORDER.map((id, idx) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              {idx > 0 && <span aria-hidden="true">·</span>}
              <span className={difficulty === id ? 'text-amber-200 font-bold' : ''}>
                {DIFFICULTY_PRESETS[id].label} {(highScoresByDifficulty[id] ?? 0).toLocaleString('ko-KR')}
              </span>
            </span>
          ))}
        </div>

        {!isStoragePersistent && (
          <p className="mt-1.5 text-[11px] font-semibold text-amber-300">
            기록이 이 기기에 저장되지 않아요
          </p>
        )}

        {/* Difficulty Selector (Single-Select Segmented Buttons + Specs) */}
        <div className="mt-3.5 text-left">
          <div className="text-xs font-bold text-slate-200 mb-1.5">난이도 선택</div>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTY_ORDER.map((id) => {
              const p = DIFFICULTY_PRESETS[id];
              const isSelected = difficulty === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectDifficulty(id)}
                  className={`min-h-11 px-3 py-2 rounded-lg border text-sm font-extrabold transition-colors cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? 'bg-orange-500 border-orange-300 text-slate-950 shadow'
                      : 'bg-slate-800/90 border-white/15 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] md:text-xs font-medium text-sky-300 text-center font-mono-num">
            {activePreset.summary}
          </p>
        </div>

        {/* Concise Controls Reference */}
        <div className="mt-3 pt-2.5 border-t border-white/10 text-[11px] md:text-xs text-slate-300 flex items-center justify-between gap-2">
          <span className="font-bold text-slate-200 shrink-0">조종</span>
          <span className="text-right">고개 기울기: 선회 · 파닥임: 상승 · 주먹: 하강</span>
        </div>

        {/* Webcam 1-second Fist Start Gauge */}
        {webcamActive && (
          <div className="mt-3 pt-2.5 border-t border-white/10">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
              <span>주먹을 1초간 쥐고 있으면 시작</span>
              <span className="font-mono-num">{Math.round(fistStartProgress * 100)}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${Math.round(fistStartProgress * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenLeaderboard}
            className="min-h-12 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-amber-400/35 text-xs md:text-sm font-bold text-amber-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <span aria-hidden="true">🏆</span>
            <span>순위표</span>
          </button>
          {webcamActive && (
            <button
              type="button"
              onClick={onRecalibrate}
              className="min-h-12 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs md:text-sm font-bold text-slate-200 cursor-pointer whitespace-nowrap"
            >
              재보정
            </button>
          )}
          <button
            type="button"
            onClick={onStart}
            className="flex-1 min-h-12 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-slate-950 font-black text-base md:text-lg shadow-lg flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Play className="w-5 h-5 fill-current shrink-0" />
            <span>게임 시작</span>
          </button>
        </div>
      </div>
    </div>
  );
}
