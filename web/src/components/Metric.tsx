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
    <div className="min-w-[7rem] max-w-[16rem] rounded-[10px] border border-line bg-panel px-3 py-2" title={`source: ${source}`} data-testid="metric" data-label={label}>
      <div className="text-[12px] text-ink-3 first-letter:uppercase">{label}</div>
      <div className="num mt-0.5 text-[18px] leading-6 font-medium text-ink" data-testid="metric-value">
        {has ? formatNumber(value, digits) : <span className="text-ink-4">{"—"}</span>}
        {has && unit ? <span className="ml-1 text-[12px] font-normal text-ink-3">{unit}</span> : null}
      </div>
      {!has && value === null && hint ? <div className="text-[11px] text-ink-3">{hint}</div> : null}
      <div className="mt-0.5 truncate text-[11px] text-ink-4">source: {source}</div>
    </div>
  );
}
