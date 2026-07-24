export default function DonutChart({ value, max, size = 72, strokeWidth = 6, color = '#ff3b30' }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const gap = circ - dash;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-[var(--color-border)]" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`} className="transition-all duration-1000 ease-out" />
      </svg>
      <span className="absolute text-[11px] font-bold tracking-tight text-[var(--color-text)]">{Math.round(pct * 100)}%</span>
    </div>
  );
}
