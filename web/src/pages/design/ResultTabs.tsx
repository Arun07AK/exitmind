import type { ReactNode } from "react";
import type { AdversaryResult, BottleneckResult, OptimiserResult, PlaybookEntry, RatingCell, RatingResult, ScenarioRef } from "../../../../src/server/contract.ts";
import { isNotFound, useApi } from "../../api.ts";
import { formatNumber, Metric } from "../../components/Metric.tsx";
import { BadnessFormula, OutcomeTable } from "../../components/Outcome.tsx";
import { Badge, Button, Card, Empty, Td, Th } from "../../components/ui.tsx";

export const RATING_DISCLAIMER = "Decision support for professional safety review, not certification.";
type Replay = (ref: ScenarioRef) => void;

function DesignResult<T>({ name, cli, children }: { name: string; cli: string; children: (d: T) => ReactNode }) {
  const { data, error, reload, loading } = useApi<T>(`/api/design/${name}`);
  if (error && isNotFound(error)) return <Empty><span data-testid="not-generated">not generated yet — run <code className="text-sky-300">npm run {cli}</code></span></Empty>;
  if (error) return <Empty>Could not load /api/design/{name}: {error.message}</Empty>;
  if (!data) return <Empty>{loading ? `Loading /api/design/${name}` : "No data"}</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button tone="ghost" onClick={reload}>Reload</Button></div>
      {children(data)}
    </div>
  );
}

function ReplayButton({ refx, onReplay }: { refx: ScenarioRef; onReplay: Replay }) {
  return <Button tone="ghost" className="px-2 py-0.5 text-xs" onClick={() => onReplay(refx)} data-testid="replay" title={refx.label}>Replay</Button>;
}

const ASSUMPTIONS = "The model shows these outcomes under the stated assumptions; they are not observations of the real building.";

export function BottlenecksTab({ onReplay }: { onReplay: Replay }) {
  return (
    <DesignResult<BottleneckResult> name="bottlenecks" cli="bottlenecks">
      {(d) => {
        const src = `bottleneck result, ${d.runs} runs`;
        return (
          <>
            <div className="flex flex-wrap gap-2">
              <Metric label="runs" value={d.runs} source={src} digits={0} />
              <Metric label="danger density threshold" value={d.densityThreshold} unit="p/m²" source={src} />
            </div>
            <p className="text-xs text-slate-500">seeds: {d.seeds.join(", ")}. {ASSUMPTIONS} Turn on the plan heatmap "time above threshold" to see where.</p>
            <Card title="Ranked hotspots">
              <table className="w-full border-collapse">
                <thead><tr><Th>rank</Th><Th>where</Th><Th>kind</Th><Th>floor</Th><Th>queue (p·s)</Th><Th>above threshold (p·s)</Th><Th /></tr></thead>
                <tbody>
                  {d.hotspots.map((h) => (
                    <tr key={h.id}>
                      <Td className="font-mono">{h.rank}</Td>
                      <Td>{h.label}<div className="font-mono text-[10px] text-slate-500">{h.id} ({formatNumber(h.x, 1)}, {formatNumber(h.y, 1)}) ft</div></Td>
                      <Td>{h.kind}</Td>
                      <Td>{h.floor}</Td>
                      <Td className="font-mono">{formatNumber(h.queuePS)}</Td>
                      <Td className="font-mono">{formatNumber(h.dangerPS)}</Td>
                      <Td><ReplayButton refx={h.replay} onReplay={onReplay} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Exit balance">
              <table className="w-full border-collapse">
                <thead><tr><Th>exit</Th><Th>share of people</Th><Th>status</Th></tr></thead>
                <tbody>
                  {d.exits.map((e) => (
                    <tr key={e.id}>
                      <Td>{e.label} <span className="font-mono text-[10px] text-slate-500">{e.id}</span></Td>
                      <Td className="font-mono">{formatNumber(e.share * 100, 1)}%</Td>
                      <Td><Badge color={e.status === "balanced" ? "green" : e.status === "overloaded" ? "red" : "amber"}>{e.status.replace("_", " ")}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        );
      }}
    </DesignResult>
  );
}

export function AdversaryTab({ onReplay }: { onReplay: Replay }) {
  return (
    <DesignResult<AdversaryResult> name="adversary" cli="adversary">
      {(d) => {
        const src = `adversary result, layout ${d.layout}`;
        const maxB = Math.max(...d.history.map((h) => h.best), 0);
        return (
          <>
            <div className="flex flex-wrap gap-2">
              <Metric label="evaluations" value={d.evaluations} source={src} digits={0} />
              <Metric label="baseline badness" value={d.baseline.badness} source={d.baseline.ref} />
              <Metric label="worst badness found" value={d.worst.badness} source={d.worst.ref} />
            </div>
            <Card title="Baseline vs worst scenario found">
              <OutcomeTable columns={[{ title: `baseline: ${d.baseline.scenario.label}`, outcome: d.baseline }, { title: `worst: ${d.worst.scenario.label}`, outcome: d.worst }]} />
              <div className="mt-2 flex gap-2">
                <ReplayButton refx={d.baseline.scenario} onReplay={onReplay} />
                <Button tone="warn" className="px-2 py-0.5 text-xs" onClick={() => onReplay(d.worst.scenario)} data-testid="replay-worst">Replay worst</Button>
              </div>
            </Card>
            <Card title="Why it breaks">
              <ul className="list-disc space-y-1 pl-5 text-sm">{d.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <p className="mt-2 text-xs text-slate-500">{ASSUMPTIONS} seeds: {d.seeds.join(", ")}</p>
            </Card>
            <Card title="Search history">
              <table className="w-full border-collapse">
                <thead><tr><Th>generation</Th><Th>best badness</Th><Th>mean badness</Th><Th /></tr></thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.generation}>
                      <Td className="font-mono">{h.generation}</Td>
                      <Td className="font-mono">{formatNumber(h.best)}</Td>
                      <Td className="font-mono">{formatNumber(h.mean)}</Td>
                      <Td className="w-1/3"><div className="h-2 rounded bg-red-500/70" style={{ width: `${maxB > 0 ? (h.best / maxB) * 100 : 0}%` }} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <BadnessFormula />
            </Card>
          </>
        );
      }}
    </DesignResult>
  );
}

export function OptimiserTab() {
  return (
    <DesignResult<OptimiserResult> name="optimiser" cli="optimise">
      {(d) => {
        const src = "optimiser result";
        return (
          <>
            <div className="flex flex-wrap gap-2">
              <Metric label="budget" value={d.budget} source={`${src}, ${d.costTable}`} />
              <Metric label="spent" value={d.spent} source={`${src}, ${d.costTable}`} />
              <div className="flex items-center text-xs">code limits: {d.codeLimitsOk ? <Badge color="green" className="ml-1">kept</Badge> : <Badge color="red" className="ml-1">not kept</Badge>}</div>
            </div>
            <Card title="Edits considered">
              <table className="w-full border-collapse">
                <thead><tr><Th>edit</Th><Th>cost</Th><Th>feasible</Th><Th>worst before</Th><Th>worst after</Th><Th>accepted</Th><Th>trade-offs</Th></tr></thead>
                <tbody>
                  {d.steps.map((s, i) => (
                    <tr key={i} className={s.accepted ? "" : "opacity-60"}>
                      <Td>{s.label}<div className="font-mono text-[10px] text-slate-500">{s.edit.kind} {s.edit.target}{s.edit.amount !== undefined ? ` +${s.edit.amount}` : ""}{s.edit.protocol ? ` ${s.edit.protocol}` : ""}</div></Td>
                      <Td className="font-mono">{formatNumber(s.cost)}</Td>
                      <Td>{s.feasible ? "yes" : "no"}</Td>
                      <Td className="font-mono">{formatNumber(s.worstBefore)}</Td>
                      <Td className="font-mono">{formatNumber(s.worstAfter)}</Td>
                      <Td>{s.accepted ? <Badge color="green">accepted</Badge> : <Badge>rejected</Badge>}</Td>
                      <Td className="text-xs text-slate-400">{s.tradeoffs.join("; ")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-slate-500">worst before/after are badness values of the worst scenario found.</p>
              <BadnessFormula />
            </Card>
            <Card title="Original vs optimised (worst case)">
              <OutcomeTable columns={[{ title: "original", outcome: d.original }, { title: "optimised", outcome: d.optimised }]} />
              <p className="mt-2 text-xs text-slate-500">seeds: {d.seeds.join(", ")}. {ASSUMPTIONS}</p>
            </Card>
          </>
        );
      }}
    </DesignResult>
  );
}

function RatingCellView({ c, onReplay }: { c: RatingCell | undefined; onReplay: Replay }) {
  if (!c) return <span className="text-slate-600">{"\u2014"}</span>;
  const ok = c.survived === c.total;
  return (
    <div>
      <div className={`font-mono ${ok ? "text-emerald-300" : "text-amber-300"}`} title={`scenarios meeting the ${c.targetSec} s target`}>{c.survived}/{c.total} meet target</div>
      <div className="text-[10px] text-slate-500">target {c.targetSec} s</div>
      {c.breaking.map((b) => (
        <div key={b.id} className="mt-1 flex items-center gap-1 text-[11px]">
          <span className="truncate text-slate-400" title={b.label}>{b.label}</span>
          <ReplayButton refx={b} onReplay={onReplay} />
        </div>
      ))}
    </div>
  );
}

export function RatingTab({ onReplay }: { onReplay: Replay }) {
  return (
    <div className="space-y-3">
      <p className="rounded border border-sky-800 bg-sky-950/40 p-2 text-sm text-sky-200" data-testid="rating-disclaimer">{RATING_DISCLAIMER}</p>
      <DesignResult<RatingResult> name="rating" cli="rate">
        {(d) => {
          const hazards = [...new Set(d.cells.map((c) => c.hazard))];
          const profiles = [...new Set(d.cells.map((c) => c.profile))];
          return (
            <Card title={`Crash-test matrix, layout ${d.layout}`}>
              <table className="w-full border-collapse">
                <thead><tr><Th>hazard</Th>{profiles.map((p) => <Th key={p}>{p}</Th>)}</tr></thead>
                <tbody>
                  {hazards.map((h) => (
                    <tr key={h}>
                      <Td className="font-medium">{h}</Td>
                      {profiles.map((p) => <Td key={p}><RatingCellView c={d.cells.find((c) => c.hazard === h && c.profile === p)} onReplay={onReplay} /></Td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.disclaimer && d.disclaimer !== RATING_DISCLAIMER ? <p className="mt-2 text-xs text-slate-400">{d.disclaimer}</p> : null}
              <p className="mt-1 text-xs text-slate-500">{ASSUMPTIONS}</p>
            </Card>
          );
        }}
      </DesignResult>
    </div>
  );
}

export function PlaybookTab() {
  return (
    <DesignResult<PlaybookEntry[] | { entries: PlaybookEntry[] }> name="playbook" cli="playbook">
      {(raw) => {
        const entries = Array.isArray(raw) ? raw : raw.entries ?? [];
        return (
          <Card title={`Playbook (${entries.length} entries)`}>
            <div className="space-y-3">
              {entries.map((e) => (
                <div key={e.id} className="rounded border border-slate-800 p-2" data-testid="playbook-entry">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-500">{e.id}</span>
                    <Badge color="red">{e.situation.hazard}</Badge>
                    <span className="text-slate-300">zone {e.situation.zone}</span>
                    <span className="text-slate-400">{e.situation.profile}, {e.situation.occupancy}</span>
                    {e.situation.blocked.length ? <span className="text-xs text-red-300">blocked: {e.situation.blocked.join(", ")}</span> : null}
                    <Badge color="sky" className="ml-auto">{e.protocol}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{e.rationale}</p>
                  <div className="mt-1 text-xs text-slate-400">
                    {e.policy.zones.map((z) => `${z.zone}: ${z.instruction.toLowerCase().replace(/_/g, " ")}${z.via ? ` via ${z.via}` : ""}${z.delaySec ? ` after ${z.delaySec} s` : ""}`).join(" · ")}
                    {e.policy.closedRoutes.length ? ` · closed: ${e.policy.closedRoutes.join(", ")}` : ""}
                  </div>
                  <div className="mt-2"><OutcomeTable columns={[{ title: "verified plan", outcome: e.verified }, { title: "do nothing", outcome: e.doNothing }]} /></div>
                </div>
              ))}
            </div>
          </Card>
        );
      }}
    </DesignResult>
  );
}
