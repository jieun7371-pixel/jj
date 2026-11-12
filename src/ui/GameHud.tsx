import { Pause, Volume2, VolumeX, Zap } from 'lucide-react';
import { getDifficultyPreset } from '../game/rules/difficulty.ts';
import { GAME_CONFIG } from '../game/rules/gameConfig.ts';
import {
  getActiveComboMultiplier,
  getComboProgress,
  type GameRoundState,
} from '../game/rules/gameState.ts';

interface GameHudProps {
  gameState: GameRoundState;
  comboWindowSec: number;
  collisionFlash?: boolean;
  comboBreakAlert?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
}

export function GameHud({
  gameState,
  comboWindowSec,
  collisionFlash = false,
  comboBreakAlert = false,
  muted,
  onToggleMute,
  onPause,
}: GameHudProps) {
  if (gameState.phase !== 'PLAYING') return null;

  const timeCeil = Math.ceil(gameState.timeLeftSec);
  const isTimeCritical = timeCeil <= GAME_CONFIG.criticalTimeWarningSec;
  const energyPct = Math.round(gameState.energy);
  const isEnergyLow = gameState.energy <= GAME_CONFIG.energyLowWarningThreshold;
  const comboMult = getActiveComboMultiplier(gameState);
  const comboPct = Math.round(getComboProgress(gameState, comboWindowSec) * 100);
  const preset = getDifficultyPreset(gameState.difficulty);

  const energyBarColor =
    energyPct > 50
      ? 'bg-emerald-400'
      : energyPct > GAME_CONFIG.energyLowWarningThreshold
      ? 'bg-amber-400'
      : 'bg-rose-500 animate-energy-blink';

  return (
    <>
      {collisionFlash && (
        <div
          className="pointer-events-none fixed inset-0 z-20 bg-rose-600/15 shadow-[inset_0_0_88px_rgba(244,63,94,0.82)] transition-opacity duration-75"
          aria-hidden="true"
        />
      )}

      <div className="pointer-events-none absolute inset-x-2 top-2 md:inset-x-4 md:top-[76px] z-20 flex flex-col gap-1.5">
        <div className="mx-auto w-full max-w-4xl rounded-lg bg-slate-950/75 border border-white/15 px-3 py-2 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Left: 60s Countdown Timer & Score + Combo */}
            <div className="flex items-center gap-3 md:gap-4">
              <div>
                <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow flex items-center gap-1.5">
                  <span>남은 시간</span>
                  <span className="hidden sm:inline text-sky-300">· {preset.label}</span>
                </div>
                <div
                  className={`font-mono-num text-2xl md:text-3xl font-black leading-none hud-shadow ${
                    isTimeCritical ? 'text-rose-400 animate-energy-blink' : 'text-white'
                  }`}
                >
                  {timeCeil}
                  <span className="ml-0.5 text-xs md:text-sm font-bold text-slate-300">초</span>
                </div>
              </div>

              <div className="h-7 w-px bg-white/20" />

              <div>
                <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow">
                  새우깡 점수
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono-num text-xl md:text-3xl font-extrabold leading-none hud-shadow ${
                      collisionFlash ? 'text-rose-400 animate-energy-blink' : 'text-amber-300'
                    }`}
                  >
                    {gameState.score.toLocaleString('ko-KR')}
                  </span>
                  <span className="hidden sm:inline font-mono-num text-[11px] font-semibold text-slate-300">
                    최고 {gameState.highScore.toLocaleString('ko-KR')}
                  </span>
                </div>
              </div>

              {gameState.combo > 0 && gameState.comboTimerSec > 0 && (
                <>
                  <div className="h-7 w-px bg-white/20" />
                  <div className="min-w-[72px]">
                    <div className="flex items-baseline gap-1.5 leading-none">
                      <span className="font-mono-num text-base md:text-xl font-black text-orange-300 hud-shadow">
                        {gameState.combo} COMBO
                      </span>
                      <span className="font-mono-num text-xs md:text-sm font-extrabold text-yellow-300 hud-shadow">
                        x{comboMult}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-orange-400 transition-[width] duration-75"
                        style={{ width: `${comboPct}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right: Energy Gauge + Mute + Top-Right Pause Button (never overlaps webcam) */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-1 sm:flex-initial justify-end min-w-[180px]">
              <div className="flex-1 sm:w-36 md:w-44">
                <div className="flex items-center justify-between text-[11px] md:text-xs font-bold mb-1">
                  <span
                    className={`flex items-center gap-1 hud-shadow ${
                      gameState.isExhausted
                        ? 'text-rose-400 animate-energy-blink'
                        : isEnergyLow
                        ? 'text-rose-300'
                        : 'text-emerald-200'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 shrink-0" />
                    {gameState.isExhausted ? '지쳤어요!' : '에너지'}
                  </span>
                  <span className="font-mono-num text-white hud-shadow">{energyPct}%</span>
                </div>
                <div className="w-full h-2.5 rounded bg-slate-800 border border-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-100 ${energyBarColor}`}
                    style={{ width: `${energyPct}%` }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onToggleMute}
                title={muted ? '효과음 켜기' : '효과음 끄기'}
                aria-label={muted ? '효과음 켜기' : '효과음 끄기'}
                className="pointer-events-auto min-h-11 min-w-11 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/15 text-white flex items-center justify-center cursor-pointer"
              >
                {muted ? (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-amber-300" />
                )}
              </button>

              <button
                type="button"
                onClick={onPause}
                title="일시정지 (P / Esc)"
                aria-label="일시정지"
                className="pointer-events-auto min-h-11 px-2.5 sm:px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/20 text-xs md:text-sm font-bold text-white hud-shadow flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Pause className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">일시정지</span>
              </button>
            </div>
          </div>
        </div>

        {comboBreakAlert && (
          <div className="mx-auto rounded-lg bg-rose-950/95 border border-rose-400/80 px-4 py-1 text-center shadow-lg">
            <p className="font-mono-num text-xs md:text-sm font-black tracking-wider text-rose-200 hud-shadow">
              COMBO BREAK!
            </p>
          </div>
        )}

        {gameState.isExhausted && (
          <div className="mx-auto rounded-lg bg-rose-950/90 border border-rose-400/70 px-3.5 py-1.5 text-center shadow-lg">
            <p className="text-xs md:text-sm font-extrabold text-rose-100 hud-shadow">
              지쳤어요! 날갯짓을 멈추고 활공/하강으로 에너지를 20%까지 회복하세요
            </p>
          </div>
        )}
      </div>
    </>
  );
}
