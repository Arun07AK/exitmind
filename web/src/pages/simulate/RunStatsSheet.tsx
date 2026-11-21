import { Sheet } from "../../components/ui.tsx";
import { fmtTime } from "../../sim/derive.ts";
import { useStore } from "../../store.ts";

const fmt = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d }));

export function RunStatsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const summary = useStore((s) => s.summary);
  const frame = useStore((s) => s.frame);
  const personas = useStore((s) => s.personas);
  const channel = useStore((s) => s.channel);
  const formula = useStore((s) => s.badnessFormula);
  const m = summary?.metrics;
  const rows: [string, string, string?][] = m ? [
    ["Occupants", fmt(m.occupants)],
    ["Out of the building", fmt(m.protected)],
    ["Sheltered in place", fmt(m.sheltered)],
    ["In a refuge", fmt(m.inRefuge)],
    ["Still inside at the end", fmt(m.remaining)],
    ["Still inside at the clearance target", fmt(m.remainingAtTarget)],
    ["95% out", m.clearance95Sec !== null ? fmtTime(m.clearance95Sec) : "not reached"],
    ["Everyone out", m.clearanceAllSec !== null ? fmtTime(m.clearanceAllSec) : "not reached"],
    ["Time above 5 p/m²", fmt(m.densityDangerPS, 1), "person-seconds"],
    ["Smoke exposure", fmt(m.smokeExposurePS, 1), "person-seconds"],
    ["Threat exposure", fmt(m.threatExposurePS, 1), "person-seconds"],
    ["Doorway flow collapse", fmt(m.crushSec, 1), "seconds"],
    ["Gridlock", m.gridlock ? `yes, at ${fmt(m.gridlockAtSec)} s` : "no"],
    ["Mean pre-movement delay", fmt(m.meanPremoveSec, 1), "seconds"],
    ["Badness score", fmt(summary.badness, 1)],
  ] : [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Run statistics" description={channel ? `Run ${channel} · model results under stated assumptions` : undefined} width={460} testId="stats-sheet">
      {!m ? (
        <p className="text-ink-2">The run is still being computed{frame ? ` (simulated ${fmtTime(frame.t)} so far)` : ""}. Final statistics appear when it finishes.</p>
      ) : (
        <div className="flex flex-col gap-5" data-testid="run-summary">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {rows.map(([k, v, unit]) => (
                <tr key={k} className="border-b border-inset">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">{k}</th>
                  <td className="num py-2 text-right">{v}{unit ? <span className="ml-1 text-[11px] text-ink-3">{unit}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {formula ? <p className="num text-[11px] leading-[1.5] text-ink-3">{formula}</p> : null}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Exit and stair use</h3>
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {Object.entries(m.exitUsage).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <tr key={k} className="border-b border-inset"><th scope="row" className="num py-1.5 text-left font-normal">{k}</th><td className="num py-1.5 text-right">{v}</td><td className="num w-16 py-1.5 text-right text-ink-3">{((v / Math.max(1, m.protected)) * 100).toFixed(1)}%</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {personas.length ? (
        <section className="mt-6" data-testid="persona-feed">
          <h3 className="text-[13px] font-semibold">Live persona decisions</h3>
          <p className="mt-0.5 mb-2 text-[12px] text-warn-ink">Modelled behaviour, not validated against real evacuations.</p>
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {[...personas].reverse().slice(0, 40).map((p, i) => (
              <li key={`${p.tick}-${p.agent}-${i}`} className="rounded-lg border border-line p-2">
                <div className="flex justify-between text-ink-3"><span>#{p.agent} · {p.point.replace(/_/g, " ").toLowerCase()}</span><span className="num">tick {p.tick}</span></div>
                <div>{p.chosen}</div>
                <div className="text-[11px] text-ink-3">{p.persona.age}, {p.persona.role}, {p.persona.mobility}, {p.persona.familiar ? "knows the building" : "unfamiliar"} · {p.source}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  );
}
