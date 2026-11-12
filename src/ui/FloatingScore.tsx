import type { FloatingScorePopup } from '../game/loop.ts';

interface FloatingScoreProps {
  popups: readonly FloatingScorePopup[];
}

export function FloatingScore({ popups }: FloatingScoreProps) {
  if (popups.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
      {popups.map((p) => {
        const isPenalty = Boolean(p.isPenalty || p.points < 0);
        const absPoints = Math.abs(p.points).toLocaleString('ko-KR');
        const numberColor = isPenalty
          ? 'text-rose-400'
          : p.isGolden
          ? 'text-yellow-300'
          : 'text-orange-300';
        const tagColor = isPenalty ? 'text-rose-200' : 'text-white';

        return (
          <div
            key={p.id}
            className="absolute animate-score-float text-center"
            style={{
              left: `${p.screenX * 100}%`,
              top: `${p.screenY * 100}%`,
            }}
          >
            <div
              className={`font-mono-num text-2xl md:text-3xl font-black hud-shadow leading-none ${numberColor}`}
            >
              {isPenalty ? `-${absPoints}` : `+${absPoints}`}
            </div>
            {p.tags.length > 0 && (
              <div
                className={`mt-0.5 text-[11px] md:text-xs font-extrabold hud-shadow whitespace-nowrap ${tagColor}`}
              >
                {p.tags.join(' · ')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
