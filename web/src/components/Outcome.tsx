import type { Outcome } from "../../../src/server/contract.ts";
import { useStore } from "../store.ts";
import { formatNumber } from "./Metric.tsx";
import { Chip, cx, Td, Th } from "./ui.tsx";

const FALLBACK_FORMULA = "badness = min(clearance95, cap) + w1·densityDangerPS + w2·smokeExposurePS + w3·remainingAtTarget";

export function BadnessFormula() {
  const f = useStore((s) => s.badnessFormula);
  return (
    <div className="mt-2 text-[11px] leading-relaxed text-ink-3" data-testid="badness-formula" title={f ? "from the latest run summary" : "from src/sim/run.ts"}>
      <span className="num">{f ?? FALLBACK_FORMULA}</span> (lower is better)
    </div>
  );
}

const ROWS: { key: keyof Outcome; label: string; unit: string }[] = [
  { key: "clearance95Sec", label: "95% clearance", unit: "s" },
  { key: "remainingAtTarget", label: "Not yet protected at target time", unit: "people" },
  { key: "densityDangerPS", label: "Time above danger density", unit: "p·s" },
  { key: "smokeExposurePS", label: "Smoke exposure", unit: "p·s" },
  { key: "gridlock", label: "Gridlock", unit: "" },
  { key: "badness", label: "Badness", unit: "" },
];

function cell(o: Outcome | null | undefined, key: keyof Outcome): string {
  if (!o) return "—";
  const v = o[key];
  if (key === "clearance95Sec" && v === null) return "not reached";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return formatNumber(v);
  return v === undefined || v === null ? "—" : String(v);
}

export interface OutcomeColumn {
  title: string;
  outcome: Outcome | null | undefined;
  extra?: string;
}

export function OutcomeTable({ columns, onRef, testId }: { columns: OutcomeColumn[]; onRef?: (ref: string) => void; testId?: string }) {
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th className="pl-0">Figure</Th>
            {columns.map((c) => <Th key={c.title} className="text-right! first-letter:uppercase">{c.title}</Th>)}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key} className={r.key === "badness" ? "font-medium" : undefined}>
              <Td className="pl-0 text-ink-2">{r.label}{r.unit ? <span className="num ml-1.5 text-[11px] text-ink-4">{r.unit}</span> : null}</Td>
              {columns.map((c) => {
                const text = cell(c.outcome, r.key);
                const muted = text === "—" || text === "not reached";
                return (
                  <Td key={c.title} className={cx("text-right", muted ? "text-ink-3" : "num text-ink", r.key === "gridlock" && c.outcome?.gridlock && "font-medium text-danger-ink")} title={c.outcome ? `source: ${c.outcome.ref}` : undefined}>
                    {text}
                  </Td>
                );
              })}
            </tr>
          ))}
          <tr>
            <Td className="border-b-0! pl-0 text-ink-3">Source record</Td>
            {columns.map((c) => (
              <Td key={c.title} className="border-b-0! text-right">
                {c.outcome ? <Chip onClick={onRef ? () => onRef(c.outcome!.ref) : undefined}>{c.outcome.ref}</Chip> : <span className="text-ink-3">{"—"}</span>}
                {c.extra ? <div className="mt-0.5 text-[11px] text-ink-3">{c.extra}</div> : null}
              </Td>
            ))}
          </tr>
        </tbody>
      </table>
      <BadnessFormula />
    </div>
  );
}
