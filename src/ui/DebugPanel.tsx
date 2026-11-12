import { useEffect, useRef } from 'react';
import type { TelemetrySnapshot } from '../game/loop.ts';
import type { TunableVisionSettings } from '../vision/gestureConfig.ts';

interface DebugPanelProps {
  telemetry: TelemetrySnapshot;
  config: TunableVisionSettings;
  onChangeConfig: (next: TunableVisionSettings) => void;
  onClose: () => void;
}

interface HistorySample {
  turn: number;
  dive: number;
  flap: number;
  impulse: number;
}

export function DebugPanel({
  telemetry,
  config,
  onChangeConfig,
  onClose,
}: DebugPanelProps) {
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<HistorySample[]>([]);

  useEffect(() => {
    const arr = historyRef.current;
    arr.push({
      turn: telemetry.control.turn,
      dive: telemetry.control.diveStrength,
      flap: telemetry.control.flapPower,
      impulse: telemetry.control.flapImpulse,
    });
    if (arr.length > 90) {
      arr.shift();
    }

    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#09111e';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    const drawSeries = (
      selector: (s: HistorySample) => number,
      color: string,
      mapY: (v: number) => number
    ) => {
      if (arr.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let i = 0; i < arr.length; i++) {
        const x = (i / 89) * w;
        const y = mapY(selector(arr[i]));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawSeries((s) => s.turn, '#38bdf8', (v) => h * 0.5 - v * (h * 0.42));
    drawSeries((s) => s.impulse, '#22d3ee', (v) => h - 6 - v * (h - 12));
    drawSeries((s) => s.flap, '#4ade80', (v) => h - 6 - v * (h - 12));
    drawSeries((s) => s.dive, '#fbbf24', (v) => h - 6 - v * (h - 12));
  }, [telemetry]);

  const updateNum = <K extends keyof TunableVisionSettings>(
    key: K,
    val: TunableVisionSettings[K]
  ) => {
    onChangeConfig({ ...config, [key]: val });
  };

  const fmtRatio = (val: number | null) => (val === null ? '--' : val.toFixed(2));
  const fmtSpeed = (val: number | null) => (val === null ? '--' : `${val.toFixed(1)}S/s`);

  const c = telemetry.control;
  const climbStr = `${telemetry.climbRateMps >= 0 ? '+' : ''}${telemetry.climbRateMps.toFixed(1)} m/s`;
  const energyPct = Math.round(telemetry.gameState.energy);

  return (
    <aside className="fixed bottom-4 right-2.5 z-40 w-[min(94vw,380px)] max-h-[76dvh] overflow-y-auto rounded-xl bg-slate-950/92 border border-white/20 p-3.5 text-xs text-slate-100 shadow-2xl">
      <div className="flex items-center justify-between pb-2 border-b border-white/15">
        <span className="font-bold text-sm text-white">날갯짓·제스처 디버그</span>
        <div className="flex items-center gap-2">
          <span className="font-mono-num text-emerald-300">{telemetry.fps} FPS</span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>

      {/* Live Flight & Climb State Metrics */}
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono-num text-[11px]">
        <div className="flex justify-between">
          <span className="text-sky-300">현재 상승률</span>
          <span className={telemetry.climbRateMps >= 0 ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'}>
            {climbStr}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sky-300">고도 / 에너지</span>
          <span>
            {telemetry.altitudeAglM}m · {energyPct}%
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-emerald-300">진폭 A (왼/오)</span>
          <span>
            {c.leftAmp.toFixed(2)} / {c.rightAmp.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-emerald-300">주파수 f (왼/오)</span>
          <span>
            {c.leftFreqHz.toFixed(1)} / {c.rightFreqHz.toFixed(1)}Hz
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-emerald-200 font-semibold">flapPower</span>
          <span className="text-emerald-300 font-bold">{c.flapPower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-cyan-200 font-semibold">flapImpulse</span>
          <span className="text-cyan-300 font-bold">{c.flapImpulse.toFixed(2)}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-300">왼손 d_avg / 속도</span>
          <span>
            {fmtRatio(c.leftHandDAvg)} · {fmtSpeed(c.leftHandSpeedS)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-300">오른손 d_avg / 속도</span>
          <span>
            {fmtRatio(c.rightHandDAvg)} · {fmtSpeed(c.rightHandSpeedS)}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-sky-300">고개 각도 / turn</span>
          <span>
            {c.tiltDeg.toFixed(1)}° / {c.turn.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-amber-300">제스처 판정</span>
          <span className="font-sans font-bold text-white">
            {c.priorityGesture} ({telemetry.mode})
          </span>
        </div>
      </div>

      {/* Cause Diagnostics when hand motion is treated as Dive or Glide */}
      {c.gestureBlockReason && (
        <div className="mt-2.5 rounded-lg bg-amber-950/70 border border-amber-400/45 px-2.5 py-1.5 text-[11px] font-mono-num text-amber-200">
          <span className="font-sans font-bold text-amber-300 mr-1">판정 원인:</span>
          {c.gestureBlockReason}
        </div>
      )}

      {/* Real-time Waveform Graph */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] mb-1 text-slate-300">
          <span>실시간 제어 신호</span>
          <span className="flex items-center gap-2">
            <span className="text-sky-400">선회</span>
            <span className="text-emerald-400">flapPower</span>
            <span className="text-cyan-300">펄스</span>
            <span className="text-amber-400">하강</span>
          </span>
        </div>
        <canvas
          ref={chartRef}
          width={330}
          height={72}
          className="w-full h-[72px] rounded border border-white/10"
        />
      </div>

      {/* Sensitivity & Threshold Tuning Sliders */}
      <div className="mt-3 space-y-2 border-t border-white/15 pt-2.5">
        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>날갯짓 진폭 기준 A (기본 0.35)</span>
            <span className="font-mono-num text-emerald-300">{config.flapAmpRef.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.15}
            max={0.8}
            step={0.05}
            value={config.flapAmpRef}
            onChange={(e) => updateNum('flapAmpRef', Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>날갯짓 주파수 기준 f (기본 2.0Hz)</span>
            <span className="font-mono-num text-emerald-300">{config.flapFreqRef.toFixed(1)}Hz</span>
          </div>
          <input
            type="range"
            min={1.0}
            max={3.5}
            step={0.1}
            value={config.flapFreqRef}
            onChange={(e) => updateNum('flapFreqRef', Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>하강 스트로크 펄스 임계값 (기본 0.25S)</span>
            <span className="font-mono-num text-cyan-300">{config.flapImpulseThreshold.toFixed(2)}S</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={0.6}
            step={0.05}
            value={config.flapImpulseThreshold}
            onChange={(e) => updateNum('flapImpulseThreshold', Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>주먹 진입 비율 (d_avg &lt;, 4손가락)</span>
            <span className="font-mono-num text-amber-300">{config.fistEnterDistRatio.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.8}
            max={1.35}
            step={0.05}
            value={config.fistEnterDistRatio}
            onChange={(e) => updateNum('fistEnterDistRatio', Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>주먹 해제 히스테리시스 (d_avg &ge;)</span>
            <span className="font-mono-num text-amber-300">{config.fistExitDistRatio.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={1.2}
            max={1.7}
            step={0.05}
            value={config.fistExitDistRatio}
            onChange={(e) => updateNum('fistExitDistRatio', Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>주먹 유지 시간 (기본 0.20초)</span>
            <span className="font-mono-num text-amber-300">{config.fistHoldEnterSec.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min={0.06}
            max={0.35}
            step={0.02}
            value={config.fistHoldEnterSec}
            onChange={(e) => updateNum('fistHoldEnterSec', Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>고개 데드존 (°)</span>
            <span className="font-mono-num text-sky-300">{config.headDeadzoneDeg}°</span>
          </div>
          <input
            type="range"
            min={2}
            max={12}
            step={1}
            value={config.headDeadzoneDeg}
            onChange={(e) => updateNum('headDeadzoneDeg', Number(e.target.value))}
            className="w-full accent-sky-400"
          />
        </label>

        <label className="block">
          <div className="flex justify-between mb-0.5">
            <span>고개 최대 각도 (°)</span>
            <span className="font-mono-num text-sky-300">{config.headMaxDeg}°</span>
          </div>
          <input
            type="range"
            min={15}
            max={40}
            step={1}
            value={config.headMaxDeg}
            onChange={(e) => updateNum('headMaxDeg', Number(e.target.value))}
            className="w-full accent-sky-400"
          />
        </label>
      </div>
    </aside>
  );
}
