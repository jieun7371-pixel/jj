import { Navigation2 } from 'lucide-react';
import type { SnackHudOverlayData } from '../game/rules/snackManager.ts';

interface SnackArrowProps {
  snackOverlay: SnackHudOverlayData;
  visible: boolean;
}

function formatAltDiff(deltaAltM: number): { text: string; colorClass: string } {
  if (deltaAltM >= 1) {
    return { text: `↑ ${deltaAltM}m`, colorClass: 'text-emerald-300' };
  }
  if (deltaAltM <= -1) {
    return { text: `↓ ${Math.abs(deltaAltM)}m`, colorClass: 'text-amber-300' };
  }
  return { text: '= 0m', colorClass: 'text-sky-200' };
}

export function SnackArrow({ snackOverlay, visible }: SnackArrowProps) {
  if (!visible) return null;

  const { nearest, visibleMarkers } = snackOverlay;
  const altBadge = nearest ? formatAltDiff(nearest.deltaAltM) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {/* On-screen circular snack target reticles + distance */}
      {visibleMarkers.map((m) => (
        <div
          key={m.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
          style={{
            left: `${m.screenX * 100}%`,
            top: `${m.screenY * 100}%`,
          }}
        >
          <div
            className={`w-7 h-7 md:w-8 md:h-8 rounded-full border-2 flex items-center justify-center ${
              m.isGolden
                ? 'border-yellow-300 bg-yellow-400/15 shadow-[0_0_12px_rgba(250,204,21,0.65)]'
                : 'border-orange-400 bg-orange-400/10 shadow-[0_0_8px_rgba(251,146,60,0.45)]'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                m.isGolden ? 'bg-yellow-300' : 'bg-orange-300'
              }`}
            />
          </div>
          <span
            className={`mt-0.5 font-mono-num text-[10px] md:text-xs font-extrabold hud-shadow ${
              m.isGolden ? 'text-yellow-300' : 'text-orange-200'
            }`}
          >
            {m.isGolden ? `황금 ${m.distanceM}m` : `${m.distanceM}m`}
          </span>
        </div>
      ))}

      {/* Off-screen edge compass arrow + distance + vertical altitude offset (↑ 12m / ↓ 8m) */}
      {nearest && !nearest.inView && altBadge && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 rounded-lg bg-slate-950/85 border border-orange-400/60 px-2 py-1 shadow-lg"
          style={{
            left: `${nearest.screenX * 100}%`,
            top: `${nearest.screenY * 100}%`,
          }}
        >
          <div style={{ transform: `rotate(${Math.round(nearest.edgeAngleDeg)}deg)` }}>
            <Navigation2
              className={`w-5 h-5 ${
                nearest.isGolden ? 'text-yellow-300 fill-yellow-300/30' : 'text-orange-400 fill-orange-400/30'
              }`}
            />
          </div>
          <span
            className={`font-mono-num text-[11px] font-extrabold leading-none hud-shadow ${
              nearest.isGolden ? 'text-yellow-200' : 'text-orange-200'
            }`}
          >
            {nearest.distanceM}m
          </span>
          <span className={`font-mono-num text-[10px] font-extrabold leading-none hud-shadow ${altBadge.colorClass}`}>
            {altBadge.text}
          </span>
        </div>
      )}
    </div>
  );
}
