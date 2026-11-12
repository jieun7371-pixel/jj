interface CountdownProps {
  visible: boolean;
  countdownSec: number;
  reason: 'start' | 'resume';
}

export function Countdown({ visible, countdownSec, reason }: CountdownProps) {
  if (!visible) return null;

  const digit = Math.max(1, Math.min(3, Math.ceil(countdownSec)));

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center select-none ${
        reason === 'resume' ? 'bg-slate-950/55' : 'bg-slate-950/35'
      }`}
      aria-live="assertive"
      aria-label={`시작 카운트다운 ${digit}`}
    >
      <div
        key={digit}
        className="animate-countdown-pop font-mono-num text-8xl md:text-9xl font-black text-white hud-shadow leading-none"
      >
        {digit}
      </div>
      <p className="mt-3 text-base md:text-lg font-extrabold text-amber-200 hud-shadow">
        {reason === 'resume' ? '잠시 후 비행 재개' : '출발 준비!'}
      </p>
    </div>
  );
}
