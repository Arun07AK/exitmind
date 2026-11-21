export interface MetricProps {
  label: string;
  value: number | null | undefined;
  source: string;
  unit?: string;
  digits?: number;
  hint?: string;
}

export function formatNumber(v: number, digits = 2): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function Metric({ label, value, source, unit, digits = 2, hint }: MetricProps) {
  const has = typeof value === "number" && Number.isFinite(value);
  return (
    <div className="min-w-[7rem] rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2" title={`source: ${source}`} data-testid="metric" data-label={label}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-mono text-lg text-slate-100" data-testid="metric-value">
        {has ? formatNumber(value, digits) : "\u2014"}
        {has && unit ? <span className="ml-1 text-xs text-slate-400">{unit}</span> : null}
      </div>
      {!has && value === null && hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
      <div className="truncate text-[10px] text-slate-500">source: {source}</div>
    </div>
  );
}
