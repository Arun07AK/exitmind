export function Sparkline({ xs, ys, label, source, height = 56 }: { xs: number[]; ys: number[]; label: string; source: string; height?: number }) {
  const W = 300;
  if (ys.length < 2) return <div className="text-xs text-slate-500">{label}: waiting for frames</div>;
  const x0 = xs[0]!, x1 = xs[xs.length - 1]!, y0 = 0, ymax = Math.max(...ys), y1 = ymax > 0 ? ymax : 1;
  const pts = ys.map((y, i) => `${(((xs[i]! - x0) / Math.max(1e-9, x1 - x0)) * W).toFixed(1)},${(height - ((y - y0) / (y1 - y0)) * (height - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <div title={`source: ${source}`} data-testid="sparkline">
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span className="font-mono">{ys[ys.length - 1]} at {x1} s (max {ymax})</span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-14 w-full" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#34d399" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="text-[10px] text-slate-500">source: {source}</div>
    </div>
  );
}
