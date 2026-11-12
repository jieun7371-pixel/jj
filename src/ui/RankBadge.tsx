interface RankBadgeProps {
  rank: number | null;
  compact?: boolean;
}

export function RankBadge({ rank, compact = false }: RankBadgeProps) {
  if (rank === null || rank <= 0) {
    return (
      <span className="font-mono-num text-xs font-bold text-slate-500">
        -
      </span>
    );
  }

  if (rank === 1) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 font-mono-num font-black text-amber-300 whitespace-nowrap ${
          compact ? 'text-xs' : 'text-sm'
        }`}
        aria-label="1위 금메달"
      >
        <span aria-hidden="true">🥇</span>
        <span>1</span>
      </span>
    );
  }

  if (rank === 2) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 font-mono-num font-black text-slate-200 whitespace-nowrap ${
          compact ? 'text-xs' : 'text-sm'
        }`}
        aria-label="2위 은메달"
      >
        <span aria-hidden="true">🥈</span>
        <span>2</span>
      </span>
    );
  }

  if (rank === 3) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 font-mono-num font-black text-orange-300 whitespace-nowrap ${
          compact ? 'text-xs' : 'text-sm'
        }`}
        aria-label="3위 동메달"
      >
        <span aria-hidden="true">🥉</span>
        <span>3</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center font-mono-num font-bold text-slate-400 whitespace-nowrap ${
        compact ? 'text-xs' : 'text-sm'
      }`}
    >
      {rank}
    </span>
  );
}
