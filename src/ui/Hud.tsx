import { Bug, Compass, LayoutTemplate, Minus, Moon, Plus, RotateCcw, Sun, Sunset } from 'lucide-react';
import type { TelemetrySnapshot } from '../game/loop.ts';
import { GAME_CONFIG } from '../game/rules/gameConfig.ts';
import type { TimeOfDay } from '../game/scene.ts';
import type { FlightMode } from '../vision/types.ts';

interface HudProps {
  telemetry: TelemetrySnapshot;
  debugOpen: boolean;
  desktopLayout: 'pip' | 'split';
  isCalibrating: boolean;
  onRecalibrate: () => void;
  onToggleDebug: () => void;
  onToggleDesktopLayout: () => void;
  onCycleTimeOfDay: () => void;
  onResetPosition: () => void;
  onAdjustSpeed: (delta: number) => void;
}

function getModeStyle(mode: FlightMode): { border: string; text: string } {
  if (mode === '하강') {
    return { border: 'border-amber-400/80', text: 'text-amber-300' };
  }
  if (mode === '날갯짓') {
    return { border: 'border-emerald-400/80', text: 'text-emerald-300' };
  }
  return { border: 'border-sky-400/70', text: 'text-sky-200' };
}

function renderTimeIcon(timeOfDay: TimeOfDay) {
  if (timeOfDay === '낮') return <Sun className="w-4 h-4 text-amber-300 shrink-0" />;
  if (timeOfDay === '노을') return <Sunset className="w-4 h-4 text-orange-300 shrink-0" />;
  return <Moon className="w-4 h-4 text-sky-300 shrink-0" />;
}

export function Hud({
  telemetry,
  debugOpen,
  desktopLayout,
  isCalibrating,
  onRecalibrate,
  onToggleDebug,
  onToggleDesktopLayout,
  onCycleTimeOfDay,
  onResetPosition,
  onAdjustSpeed,
}: HudProps) {
  const modeStyle = getModeStyle(telemetry.mode);
  const canSlowDown = telemetry.speedMultiplier > GAME_CONFIG.speedMultiplierMin + 0.01;
  const canSpeedUp = telemetry.speedMultiplier < GAME_CONFIG.speedMultiplierMax - 0.01;
  const c = telemetry.control;
  const maxAmp = Math.max(c.leftAmp, c.rightAmp);
  const climbStr = `${telemetry.climbRateMps >= 0 ? '+' : ''}${telemetry.climbRateMps.toFixed(1)}`;
  const climbColor =
    telemetry.climbRateMps > 0.4
      ? 'text-emerald-300'
      : telemetry.climbRateMps < -1.5
      ? 'text-amber-300'
      : 'text-slate-100';
  const energyPct = Math.round(telemetry.gameState.energy);
  const energyColor =
    energyPct > 50
      ? 'text-emerald-300'
      : energyPct > GAME_CONFIG.energyLowWarningThreshold
      ? 'text-amber-300'
      : 'text-rose-400';
  const gestureDisplay =
    c.priorityGesture === '날갯짓'
      ? '날갯짓'
      : c.priorityGesture === '하강'
      ? '하강'
      : '활공';

  return (
    <>
      {telemetry.impactAlert && (
        <div
          className="pointer-events-none fixed inset-0 z-30 border-4 border-rose-500/80"
          aria-hidden="true"
        />
      )}

      {/* Top Semi-Transparent Korean Telemetry Bar */}
      <header className="pointer-events-none fixed top-0 inset-x-0 z-30 px-2 pt-2 md:px-3 md:pt-2.5">
        <div className="mx-auto max-w-6xl rounded-lg bg-slate-950/75 border border-white/15 px-2.5 py-1.5 flex flex-wrap md:flex-nowrap items-center justify-between gap-1.5 lg:gap-2 shadow-lg">
          {/* Primary Readouts: Altitude, Climb Rate, Speed, Energy, Gesture & Live Flap Metrics */}
          <div className="flex flex-wrap md:flex-nowrap items-center gap-2 lg:gap-3">
            <div>
              <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow">
                고도
              </div>
              <div className="font-mono-num text-base md:text-lg lg:text-xl font-extrabold text-white hud-shadow leading-none">
                {telemetry.altitudeAglM}
                <span className="ml-0.5 text-[10px] md:text-xs font-bold text-slate-300">m</span>
              </div>
            </div>

            <div className="hidden lg:block h-6 w-px bg-white/20" />

            <div>
              <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow">
                상승률
              </div>
              <div
                className={`font-mono-num text-base md:text-lg lg:text-xl font-extrabold ${climbColor} hud-shadow leading-none whitespace-nowrap`}
              >
                {climbStr}
                <span className="ml-0.5 text-[10px] md:text-xs font-bold text-slate-300">m/s</span>
              </div>
            </div>

            <div className="hidden lg:block h-6 w-px bg-white/20" />

            <div>
              <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow">
                속도
              </div>
              <div className="font-mono-num text-base md:text-lg lg:text-xl font-extrabold text-white hud-shadow leading-none whitespace-nowrap">
                {telemetry.speedKmh}
                <span className="ml-0.5 text-[10px] md:text-xs font-bold text-slate-300">km/h</span>
              </div>
            </div>

            <div className="hidden lg:block h-6 w-px bg-white/20" />

            <div>
              <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow">
                에너지
              </div>
              <div
                className={`font-mono-num text-base md:text-lg lg:text-xl font-extrabold ${energyColor} hud-shadow leading-none`}
              >
                {energyPct}
                <span className="ml-0.5 text-[10px] md:text-xs font-bold text-slate-300">%</span>
              </div>
            </div>

            <div className="hidden lg:block h-6 w-px bg-white/20" />

            <div className={`border-b-2 ${modeStyle.border} pb-0.5`}>
              <div className="text-[10px] md:text-xs font-semibold text-slate-300 hud-shadow">
                제스처
              </div>
              <div
                className={`text-sm md:text-base lg:text-lg font-extrabold ${modeStyle.text} hud-shadow leading-none whitespace-nowrap`}
              >
                {gestureDisplay}
              </div>
            </div>

            <div className="hidden lg:block h-6 w-px bg-white/20" />

            {/* Live Flap & Gesture Signal Numerics (always visible on HUD) */}
            <div
              className="flex flex-col leading-tight font-mono-num text-[10px] xl:text-[11px] text-slate-200 hud-shadow whitespace-nowrap"
              title={c.gestureBlockReason ?? '손 y 진폭 A, 주파수 f, flapPower, flapImpulse'}
            >
              <div>
                <span className="text-slate-400">A</span>{' '}
                <span className="text-white font-bold">{maxAmp.toFixed(2)}</span>
                <span className="mx-1 text-slate-500">·</span>
                <span className="text-slate-400">f</span>{' '}
                <span className="text-white font-bold">{c.flapFreqHz.toFixed(1)}Hz</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>
                  <span className="text-slate-400">P</span>{' '}
                  <span className="text-emerald-300 font-bold">{c.flapPower.toFixed(2)}</span>
                </span>
                <span>
                  <span className="text-slate-400">I</span>{' '}
                  <span className="text-cyan-300 font-bold">{c.flapImpulse.toFixed(2)}</span>
                </span>
                {c.gestureBlockReason && (
                  <span className="hidden xl:inline text-amber-300 font-sans font-semibold max-w-[180px] truncate">
                    · {c.gestureBlockReason}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Action Controls + In-Game Speed Stepper (- / 1.0x / +) */}
          <div className="pointer-events-auto flex items-center gap-1 lg:gap-1.5 shrink-0">
            <div className="flex items-center rounded-lg bg-slate-800/90 border border-white/15 overflow-hidden">
              <button
                type="button"
                onClick={() => onAdjustSpeed(-GAME_CONFIG.speedMultiplierStep)}
                disabled={!canSlowDown}
                title="비행 속도 감속 (-)"
                aria-label="비행 속도 감속"
                className="min-h-11 min-w-10 px-2 hover:bg-slate-700 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 font-mono-num text-xs md:text-sm font-extrabold text-emerald-300 hud-shadow whitespace-nowrap">
                {telemetry.speedMultiplier.toFixed(1)}x
              </span>
              <button
                type="button"
                onClick={() => onAdjustSpeed(GAME_CONFIG.speedMultiplierStep)}
                disabled={!canSpeedUp}
                title="비행 속도 가속 (+)"
                aria-label="비행 속도 가속"
                className="min-h-11 min-w-10 px-2 hover:bg-slate-700 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={onCycleTimeOfDay}
              title="시간대 전환: 낮 / 노을 / 밤 (T)"
              aria-label={`시간대 전환 (${telemetry.timeOfDay})`}
              className="min-h-11 px-2.5 lg:px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/15 text-xs md:text-sm font-bold text-white hud-shadow flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {renderTimeIcon(telemetry.timeOfDay)}
              <span className="hidden lg:inline">{telemetry.timeOfDay}</span>
            </button>

            <button
              type="button"
              onClick={onRecalibrate}
              disabled={isCalibrating}
              title="정면 자세 재보정 (R)"
              aria-label="정면 자세 재보정"
              className="min-h-11 min-w-11 px-2.5 lg:px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 disabled:opacity-50 border border-white/15 text-xs md:text-sm font-bold text-white hud-shadow flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">재보정</span>
            </button>

            <button
              type="button"
              onClick={onResetPosition}
              title="시작 위치로 복귀 (Home)"
              aria-label="시작 위치로 복귀"
              className="min-h-11 min-w-11 px-2.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/15 text-xs md:text-sm font-bold text-white hud-shadow flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Compass className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">출발지</span>
            </button>

            <button
              type="button"
              onClick={onToggleDesktopLayout}
              title="데스크톱 화면 배치 전환"
              aria-label="데스크톱 화면 배치 전환"
              className="hidden md:inline-flex min-h-11 px-2.5 lg:px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/15 text-sm font-bold text-white hud-shadow items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <LayoutTemplate className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">{desktopLayout === 'pip' ? '좌우 분할' : 'PIP 보기'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleDebug}
              title="디버그 패널 열기/닫기"
              aria-label="디버그 패널 열기/닫기"
              className={`min-h-11 min-w-11 px-2.5 lg:px-3 rounded-lg border text-xs md:text-sm font-bold text-white hud-shadow flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                debugOpen
                  ? 'bg-sky-700/90 border-sky-400/70'
                  : 'bg-slate-800/90 hover:bg-slate-700 border-white/15'
              }`}
            >
              <Bug className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">디버그</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
