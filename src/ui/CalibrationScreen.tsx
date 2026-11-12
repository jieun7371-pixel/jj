import { CheckCircle2, Circle } from 'lucide-react';

interface CalibrationScreenProps {
  remainingSec: number;
  progress: number; // 0..1
  faceVisible: boolean;
  handVisible: boolean;
  onSkipToManual: () => void;
}

export function CalibrationScreen({
  remainingSec,
  progress,
  faceVisible,
  handVisible,
  onSkipToManual,
}: CalibrationScreenProps) {
  const displaySec = Math.max(1, Math.ceil(remainingSec));

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/75 p-3 md:px-5 text-center select-none">
      <div className="max-w-sm w-full max-h-full overflow-y-auto rounded-xl bg-slate-900/95 border border-sky-400/40 px-5 py-5 shadow-2xl">
        {/* Diagram: Neutral upright face + open palm held in camera view */}
        <div className="mx-auto mb-3 w-36 h-20 flex items-center justify-center">
          <svg
            viewBox="0 0 180 90"
            className="w-full h-full"
            aria-label="정면을 보고 한 손을 펴서 보여주는 자세 안내"
          >
            <circle cx="62" cy="42" r="21" fill="#334155" stroke="#94a3b8" strokeWidth="2" />
            <line
              x1="47"
              y1="39"
              x2="77"
              y2="39"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="52" cy="39" r="3.5" fill="#4ade80" />
            <circle cx="72" cy="39" r="3.5" fill="#4ade80" />
            <path
              d="M55 52 Q62 57 69 52"
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="2"
              strokeLinecap="round"
            />

            <g transform="translate(108, 14)">
              <rect
                x="10"
                y="34"
                width="22"
                height="22"
                rx="6"
                fill="#22c55e"
                opacity="0.25"
                stroke="#22c55e"
                strokeWidth="2.5"
              />
              <line x1="12" y1="36" x2="9" y2="16" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="17" y1="34" x2="17" y2="9" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="23" y1="34" x2="25" y2="8" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="29" y1="36" x2="34" y2="14" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="10" y1="45" x2="1" y2="34" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" />
            </g>
          </svg>
        </div>

        <h2 className="text-xl md:text-2xl font-bold text-white hud-shadow leading-snug">
          정면을 보고 한 손을 펴서 보여주세요
        </h2>

        <div className="mt-3 flex items-center justify-center gap-3">
          <span className="font-mono-num text-4xl font-extrabold text-sky-300 hud-shadow">
            {displaySec}
          </span>
          <span className="text-sm font-medium text-slate-200">초 기준 측정</span>
        </div>

        <div className="mt-3 w-full h-2.5 rounded bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-75"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-center gap-4 text-xs font-bold">
          <span
            className={`inline-flex items-center gap-1 ${
              faceVisible ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {faceVisible ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
            {faceVisible ? '얼굴 인식됨' : '얼굴 찾는 중'}
          </span>
          <span
            className={`inline-flex items-center gap-1 ${
              handVisible ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {handVisible ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
            {handVisible ? '손 인식됨' : '손 찾는 중'}
          </span>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-300">
          <span className="text-left">
            고개 기울기: 선회 · 파닥임: 날갯짓 · 주먹: 하강 · 손 펴고 정지: 활강
          </span>
          <button
            type="button"
            onClick={onSkipToManual}
            className="shrink-0 min-h-11 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold transition-colors cursor-pointer"
          >
            바로 시작
          </button>
        </div>
      </div>
    </div>
  );
}
