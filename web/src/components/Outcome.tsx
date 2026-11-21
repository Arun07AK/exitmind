import type { Outcome } from "../../../src/server/contract.ts";
import { useStore } from "../store.ts";
import { formatNumber } from "./Metric.tsx";
import { Chip, Td, Th } from "./ui.tsx";

const FALLBACK_FORMULA = "badness = min(clearance95, cap) + w1·densityDangerPS + w2·smokeExposurePS + w3·remainingAtTarget";

export function BadnessFormula() {
  const f = useStore((s) => s.badnessFormula);
  return (
    <div className="mt-1 font-mono text-[11px] text-slate-500" data-testid="badness-formula" title={f ? "from the latest run summary" : "from src/sim/run.ts"}>
      {f ?? FALLBACK_FORMULA} (lower is better)
    </div>
  );
}

const ROWS: { key: keyof Outcome; label: string; unit: string }[] = [
  { key: "clearance95Sec", label: "95% clearance", unit: "s" },
  { key: "remainingAtTarget", label: "not yet protected at target time", unit: "people" },
  { key: "densityDangerPS", label: "time above danger density", unit: "p·s" },
  { key: "smokeExposurePS", label: "smoke exposure", unit: "p·s" },
  { key: "gridlock", label: "gridlock", unit: "" },
  { key: "badness", label: "badness", unit: "" },
];

function cell(o: Outcome | null | undefined, key: keyof Outcome): string {
  if (!o) return "\u2014";
  const v = o[key];
  if (key === "clearance95Sec" && v === null) return "not reached";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return formatNumber(v);
  return v === undefined || v === null ? "\u2014" : String(v);
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
            <Th>figure</Th>
            {columns.map((c) => <Th key={c.title}>{c.title}</Th>)}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <Td className="text-slate-400">{r.label}{r.unit ? <span className="ml-1 text-[10px] text-slate-500">{r.unit}</span> : null}</Td>
              {columns.map((c) => (
                <Td key={c.title} className={`font-mono ${r.key === "gridlock" && c.outcome?.gridlock ? "text-red-400" : ""}`} title={c.outcome ? `source: ${c.outcome.ref}` : undefined}>
                  {cell(c.outcome, r.key)}
                </Td>
              ))}
            </tr>
          ))}
          <tr>
            <Td className="text-slate-400">source record</Td>
            {columns.map((c) => (
              <Td key={c.title}>
                {c.outcome ? <Chip onClick={onRef ? () => onRef(c.outcome!.ref) : undefined}>{c.outcome.ref}</Chip> : "\u2014"}
                {c.extra ? <div className="text-[10px] text-slate-500">{c.extra}</div> : null}
              </Td>
            ))}
          </tr>
        </tbody>
      </table>
      <BadnessFormula />
    </div>
  );
}
