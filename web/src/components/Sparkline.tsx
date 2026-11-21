export function Sparkline({ xs, ys, label, source, height = 56 }: { xs: number[]; ys: number[]; label: string; source: string; height?: number }) {
  const W = 300;
  if (ys.length < 2) return <div className="text-[12px] text-ink-3"><span className="inline-block first-letter:uppercase">{label}</span>: waiting for frames</div>;
  const x0 = xs[0]!, x1 = xs[xs.length - 1]!, y0 = 0, ymax = Math.max(...ys), y1 = ymax > 0 ? ymax : 1;
  const px = (i: number) => ((xs[i]! - x0) / Math.max(1e-9, x1 - x0)) * W;
  const py = (y: number) => height - ((y - y0) / (y1 - y0)) * (height - 4) - 2;
  const pts = ys.map((y, i) => `${px(i).toFixed(1)},${py(y).toFixed(1)}`).join(" ");
  return (
    <div title={`source: ${source}`} data-testid="sparkline">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="inline-block text-ink-3 first-letter:uppercase">{label}</span>
        <span className="num text-ink-2"><span className="text-ink">{ys[ys.length - 1]}</span> at {x1} s <span className="text-ink-3">(max {ymax})</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="mt-1 h-14 w-full" preserveAspectRatio="none" aria-hidden="true">
        <line x1={0} x2={W} y1={height - 2} y2={height - 2} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" className="stroke-ink" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-0.5 truncate text-[11px] text-ink-4">source: {source}</div>
    </div>
  );
}
