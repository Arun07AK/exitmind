import { ChevronRight, Info, Play, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { AdversaryResult, BottleneckResult, OptimiserResult, PlaybookEntry, RatingCell, RatingResult, ScenarioRef } from "../../../../src/server/contract.ts";
import { isNotFound, useApi } from "../../api.ts";
import { formatNumber, Metric } from "../../components/Metric.tsx";
import { BadnessFormula, OutcomeTable } from "../../components/Outcome.tsx";
import { Badge, Button, Card, cx, Empty, HazardTag, Td, Th } from "../../components/ui.tsx";

export const RATING_DISCLAIMER = "Decision support for professional safety review, not certification.";
type Replay = (ref: ScenarioRef) => void;

const words = (s: string): string => s.toLowerCase().replace(/_/g, " ");
const sentence = (s: string): string => { const w = words(s); return w.charAt(0).toUpperCase() + w.slice(1); };

function DesignResult<T>({ name, cli, children }: { name: string; cli: string; children: (d: T) => ReactNode }) {
  const { data, error, reload, loading } = useApi<T>(`/api/design/${name}`);
  if (error && isNotFound(error)) return <Empty><span data-testid="not-generated">Not generated yet. Run <code className="num rounded bg-inset px-1.5 py-0.5 text-[12px] text-ink">npm run {cli}</code> to create it.</span></Empty>;
  if (error) return <Empty>Could not load /api/design/{name}: {error.message}</Empty>;
  if (!data) return <Empty>{loading ? `Loading /api/design/${name}` : "No data"}</Empty>;
  return (
    <div className="@container space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-ink-4">From <span className="num">/api/design/{name}</span></span>
        <Button tone="ghost" className="h-7! px-2! text-[12px]!" onClick={reload} disabled={loading}><RefreshCw size={13} aria-hidden="true" className={loading ? "animate-spin" : undefined} />Reload</Button>
      </div>
      {children(data)}
    </div>
  );
}

function ReplayButton({ refx, onReplay, compact, text = "Replay" }: { refx: ScenarioRef; onReplay: Replay; compact?: boolean; text?: string }) {
  return <Button tone="ghost" className={cx("h-7! shrink-0 text-[12px]!", compact ? "w-7 px-0!" : "px-2!")} onClick={() => onReplay(refx)} data-testid="replay" title={compact ? `Replay: ${refx.label}` : refx.label}><Play size={12} aria-hidden="true" /><span className={compact ? "sr-only" : undefined}>{text}</span></Button>;
}

/** The finding first: a short kicker, the headline, one or two sentences, then the figures it rests on. */
function Lead({ kicker, title, children, aside, actions }: { kicker: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-[16rem] flex-[1_1_28rem]">
          <div className="text-[12px] text-ink-3">{kicker}</div>
          <h3 className="mt-1 text-[15px] leading-snug font-semibold text-ink">{title}</h3>
          {children ? <div className="mt-1.5 max-w-[760px] text-[13px] leading-relaxed text-ink-2">{children}</div> : null}
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {aside ? <div className="flex flex-wrap gap-2">{aside}</div> : null}
      </div>
    </section>
  );
}

function More({ summary, children, className, testId }: { summary: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <details className={cx("group", className)} data-testid={testId}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[12px] text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("max-w-[900px] text-[12px] leading-relaxed text-ink-3", className)}>{children}</div>;
}

function Seeds({ seeds }: { seeds: number[] }) {
  if (seeds.length <= 12) return <span>seeds: <span className="num">{seeds.join(", ")}</span>.</span>;
  return (
    <More summary={<span>seeds (<span className="num">{seeds.length}</span>)</span>} className="inline-block align-top">
      <div className="num max-h-28 overflow-auto rounded-lg bg-inset px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">{seeds.join(", ")}</div>
    </More>
  );
}

/** Horizontal data bar; the number it draws sits next to it. */
function Bar({ frac, tone = "ink" }: { frac: number; tone?: "ink" | "danger" | "safe" | "muted" }) {
  const fill = tone === "danger" ? "bg-danger" : tone === "safe" ? "bg-safe" : tone === "muted" ? "bg-idle" : "bg-ink-3";
  return (
    <div className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
    </div>
  );
}

const ASSUMPTIONS = "The model shows these outcomes under the stated assumptions; they are not observations of the real building.";

export function BottlenecksTab({ onReplay }: { onReplay: Replay }) {
  return (
    <DesignResult<BottleneckResult> name="bottlenecks" cli="bottlenecks">
      {(d) => {
        const src = `bottleneck result, ${d.runs} runs`;
        const top = d.hotspots.find((h) => h.rank === Math.min(...d.hotspots.map((x) => x.rank)));
        const overloaded = d.exits.filter((e) => e.status === "overloaded");
        const maxQ = Math.max(...d.hotspots.map((h) => h.queuePS), 0);
        const maxD = Math.max(...d.hotspots.map((h) => h.dangerPS), 0);
        const maxShare = Math.max(...d.exits.map((e) => e.share), 0);
        return (
          <>
            <Lead
              kicker="Bottlenecks"
              title={top ? <>Top-ranked hotspot: {top.label}</> : "No hotspots ranked"}
              aside={<>
                <Metric label="Runs" value={d.runs} source={src} digits={0} />
                <Metric label="Danger density threshold" value={d.densityThreshold} unit="p/m²" source={src} />
              </>}
            >
              {top ? <p>Queue <span className="num text-ink">{formatNumber(top.queuePS)}</span> p·s, and <span className="num text-ink">{formatNumber(top.dangerPS)}</span> p·s above the danger density threshold.</p> : null}
              {overloaded.length ? (
                <p className="mt-1">Overloaded: {overloaded.map((e, i) => <span key={e.id}>{i ? ", " : ""}<span className="num text-ink">{e.id}</span> carries <span className="num text-ink">{formatNumber(e.share * 100, 1)}%</span> of people</span>)}.</p>
              ) : <p className="mt-1">No exit is marked overloaded.</p>}
            </Lead>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card title="Ranked hotspots" className="min-w-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse">
                    <thead><tr><Th className="pl-0">Rank</Th><Th>Where</Th><Th className="text-right! whitespace-nowrap">Queue <span className="num text-ink-4">p·s</span></Th><Th className="text-right! whitespace-nowrap">Above threshold <span className="num text-ink-4">p·s</span></Th><Th /></tr></thead>
                    <tbody>
                      {d.hotspots.map((h) => (
                        <tr key={h.id} className="hover:bg-hover">
                          <Td className="num pl-0 text-ink-2">{h.rank}</Td>
                          <Td>
                            <div className="text-ink">{h.label}</div>
                            <div className="mt-0.5 text-[11px] text-ink-3">{h.kind} · floor <span className="num">{h.floor}</span> · <span className="num">{h.id} ({formatNumber(h.x, 1)}, {formatNumber(h.y, 1)}) ft</span></div>
                          </Td>
                          <Td className="w-28 text-right"><div className="num">{formatNumber(h.queuePS)}</div><div className="mt-1"><Bar frac={maxQ > 0 ? h.queuePS / maxQ : 0} /></div></Td>
                          <Td className="w-28 text-right"><div className={cx("num", h.dangerPS > 0 ? "text-danger-ink" : "text-ink-3")}>{formatNumber(h.dangerPS)}</div><div className="mt-1"><Bar frac={maxD > 0 ? h.dangerPS / maxD : 0} tone="danger" /></div></Td>
                          <Td className="w-px pr-0 text-right"><ReplayButton refx={h.replay} onReplay={onReplay} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Exit balance" className="self-start">
                <ul className="divide-y divide-line">
                  {d.exits.map((e) => (
                    <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="num font-medium text-ink">{e.id}</span>
                          <div className="text-[12px] leading-snug text-ink-3">{e.label}</div>
                        </div>
                        <Badge color={e.status === "balanced" ? "green" : e.status === "overloaded" ? "red" : "amber"}>{words(e.status)}</Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1"><Bar frac={maxShare > 0 ? e.share / maxShare : 0} tone={e.status === "overloaded" ? "danger" : "ink"} /></div>
                        <span className="num w-14 text-right text-[12px] text-ink">{formatNumber(e.share * 100, 1)}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <Note className="mt-3">Share of people, by exit.</Note>
              </Card>
            </div>
            <Note>{ASSUMPTIONS} Turn on the plan heatmap "time above threshold" to see where. <Seeds seeds={d.seeds} /></Note>
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
        const chosen = d.explanation.filter((e) => e.startsWith("Worst scenario: "));
        const reasons = d.explanation.filter((e) => !e.startsWith("Worst scenario: "));
        return (
          <>
            <Lead
              kicker={<>Stress test · adversary search · layout {d.layout}</>}
              title={<>Worst scenario found: badness <span className="num">{formatNumber(d.worst.badness)}</span>, against <span className="num">{formatNumber(d.baseline.badness)}</span> for the baseline</>}
              aside={<>
                <Metric label="Evaluations" value={d.evaluations} source={src} digits={0} />
                <Metric label="Baseline badness" value={d.baseline.badness} source={d.baseline.ref} />
                <Metric label="Worst badness found" value={d.worst.badness} source={d.worst.ref} />
              </>}
              actions={<>
                <Button tone="primary" className="h-7! px-2.5! text-[12px]!" onClick={() => onReplay(d.worst.scenario)} data-testid="replay-worst" title={d.worst.scenario.label}><Play size={12} aria-hidden="true" />Replay worst</Button>
                <ReplayButton refx={d.baseline.scenario} onReplay={onReplay} text="Replay baseline" />
              </>}
            >
              <p>Baseline: {d.baseline.scenario.label}. Worst: {d.worst.scenario.label}. Lower badness is better.</p>
            </Lead>
            <div className="grid gap-4 @4xl:grid-cols-2">
              <Card title="Why it breaks">
                <ul className="space-y-2 text-[13px] leading-relaxed text-ink">
                  {reasons.map((e, i) => (
                    <li key={i} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-3" aria-hidden="true" /><span>{e}</span></li>
                  ))}
                </ul>
                {chosen.length ? (
                  <More summary={<span>Values the search chose for the worst scenario (<span className="num">{chosen.length}</span>)</span>} className="mt-3 border-t border-line pt-3">
                    <ul className="space-y-1 text-[12px] leading-relaxed text-ink-2">{chosen.map((e, i) => <li key={i}>{e.slice("Worst scenario: ".length)}</li>)}</ul>
                  </More>
                ) : null}
                <Note className="mt-3">{ASSUMPTIONS} <Seeds seeds={d.seeds} /></Note>
              </Card>
              <Card title="Baseline vs worst scenario found" className="self-start">
                <OutcomeTable columns={[{ title: `baseline: ${d.baseline.scenario.label}`, outcome: d.baseline }, { title: `worst: ${d.worst.scenario.label}`, outcome: d.worst }]} />
              </Card>
            </div>
            <Card title="Search history">
              <table className="w-full border-collapse">
                <thead><tr><Th className="pl-0">Generation</Th><Th className="text-right!">Best badness</Th><Th className="text-right!">Mean badness</Th><Th className="w-1/2"><span className="sr-only">Best badness, relative</span></Th></tr></thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.generation}>
                      <Td className="num pl-0 text-ink-2">{h.generation}</Td>
                      <Td className="num text-right text-ink">{formatNumber(h.best)}</Td>
                      <Td className="num text-right text-ink-2">{formatNumber(h.mean)}</Td>
                      <Td className="align-middle!"><Bar frac={maxB > 0 ? h.best / maxB : 0} /></Td>
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
        const accepted = d.steps.filter((s) => s.accepted).length;
        return (
          <>
            <Lead
              kicker="Optimiser log"
              title={<>Optimised layout, worst case: badness <span className="num">{formatNumber(d.optimised.badness)}</span>, against <span className="num">{formatNumber(d.original.badness)}</span> for the original</>}
              aside={<>
                <Metric label="Budget" value={d.budget} source={`${src}, ${d.costTable}`} />
                <Metric label="Spent" value={d.spent} source={`${src}, ${d.costTable}`} />
              </>}
            >
              <p><span className="num text-ink">{accepted}</span> of <span className="num text-ink">{d.steps.length}</span> edits accepted. Code limits: {d.codeLimitsOk ? <Badge color="green" className="ml-0.5 align-middle">kept</Badge> : <Badge color="red" className="ml-0.5 align-middle">not kept</Badge>}</p>
              <p className="mt-1 text-[12px] text-ink-3">Costs from {d.costTable}.</p>
            </Lead>
            <Card title="Original vs optimised (worst case)">
              <OutcomeTable columns={[{ title: "original", outcome: d.original }, { title: "optimised", outcome: d.optimised }]} />
              <Note className="mt-3"><Seeds seeds={d.seeds} /> {ASSUMPTIONS}</Note>
            </Card>
            <Card title="Edits considered">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead><tr><Th className="pl-0">Edit</Th><Th className="text-right!">Cost</Th><Th>Feasible</Th><Th className="text-right!">Worst before</Th><Th className="text-right!">Worst after</Th><Th>Decision</Th></tr></thead>
                  <tbody>
                    {d.steps.map((s, i) => (
                      <tr key={i} className={s.accepted ? undefined : "text-ink-3"}>
                        <Td className="pl-0">
                          <div className={s.accepted ? "text-ink" : "text-ink-3"}>{s.label}</div>
                          <div className="num mt-0.5 text-[11px] text-ink-3">{s.edit.kind} {s.edit.target}{s.edit.amount !== undefined ? ` +${s.edit.amount}` : ""}{s.edit.protocol ? ` ${s.edit.protocol}` : ""}</div>
                          {s.tradeoffs.length ? (
                            <More summary={<span>Trade-offs (<span className="num">{s.tradeoffs.length}</span>)</span>} className="mt-1.5">
                              <ul className="space-y-1 text-[12px] leading-snug text-ink-2">{s.tradeoffs.map((t, j) => <li key={j}>{t}</li>)}</ul>
                            </More>
                          ) : null}
                        </Td>
                        <Td className="num text-right">{formatNumber(s.cost)}</Td>
                        <Td className="text-ink-2">{s.feasible ? "yes" : "no"}</Td>
                        <Td className="num text-right text-ink-2">{formatNumber(s.worstBefore)}</Td>
                        <Td className="num text-right">{formatNumber(s.worstAfter)}</Td>
                        <Td>{s.accepted ? <Badge color="green">accepted</Badge> : <Badge>rejected</Badge>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note className="mt-2">Worst before and after are badness values of the worst scenario found.</Note>
              <BadnessFormula />
            </Card>
          </>
        );
      }}
    </DesignResult>
  );
}

function RatingCellView({ c, onReplay }: { c: RatingCell | undefined; onReplay: Replay }) {
  if (!c) return <span className="text-ink-4">{"—"}</span>;
  const ok = c.survived === c.total;
  return (
    <div className="min-w-0">
      <div className={cx("num text-[15px] font-medium", ok ? "text-safe-ink" : "text-warn-ink")} title={`scenarios meeting the ${c.targetSec} s target`}>{c.survived}/{c.total} <span className="font-sans text-[12px] font-normal text-ink-2">meet target</span></div>
      <div className="mt-1"><Bar frac={c.total > 0 ? c.survived / c.total : 0} tone="safe" /></div>
      <div className="mt-1 text-[11px] text-ink-3">target <span className="num">{c.targetSec}</span> s</div>
      {c.breaking.length ? (
        <More summary={<span>Breaking scenarios (<span className="num">{c.breaking.length}</span>)</span>} className="mt-1.5">
          <ul className="space-y-1">
            {c.breaking.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-1 text-[11px] leading-snug">
                <span className="min-w-0 pt-1.5 text-ink-2">{b.label}</span>
                <ReplayButton refx={b} onReplay={onReplay} compact />
              </li>
            ))}
          </ul>
        </More>
      ) : null}
    </div>
  );
}

export function RatingTab({ onReplay }: { onReplay: Replay }) {
  return (
    <div className="space-y-4">
      <p className="flex gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-[13px] text-ink-2" data-testid="rating-disclaimer"><Info size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" /><span>{RATING_DISCLAIMER}</span></p>
      <DesignResult<RatingResult> name="rating" cli="rate">
        {(d) => {
          const hazards = [...new Set(d.cells.map((c) => c.hazard))];
          const profiles = [...new Set(d.cells.map((c) => c.profile))];
          return (
            <Card title={`Crash-test matrix, layout ${d.layout}`}>
              {d.criterion ? <p className="mb-3 max-w-[900px] text-[12px] leading-relaxed text-ink-2" data-testid="rating-criterion">{d.criterion}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed border-collapse">
                  <colgroup><col className="w-[136px]" />{profiles.map((p) => <col key={p} />)}</colgroup>
                  <thead><tr><Th className="pl-0">Hazard</Th>{profiles.map((p) => <Th key={p} className="first-letter:uppercase">{p}</Th>)}</tr></thead>
                  <tbody>
                    {hazards.map((h) => (
                      <tr key={h}>
                        <Td className="pl-0 pt-2.5"><HazardTag kind={h} className="whitespace-nowrap" /></Td>
                        {profiles.map((p) => <Td key={p} className="py-2.5"><RatingCellView c={d.cells.find((c) => c.hazard === h && c.profile === p)} onReplay={onReplay} /></Td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.disclaimer && d.disclaimer !== RATING_DISCLAIMER ? <Note className="mt-3 text-ink-2">{d.disclaimer}</Note> : null}
              <Note className="mt-2">{ASSUMPTIONS}</Note>
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
            <Note className="mb-3">Each row shows a situation, the badness of its verified plan against doing nothing (lower is better), and the protocol. Open a row for the rationale, zone instructions and outcome table.</Note>
            <div className="divide-y divide-line border-y border-line">
              {entries.map((e) => (
                <details key={e.id} className="group" data-testid="playbook-entry">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2.5 hover:bg-hover [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
                    <HazardTag kind={e.situation.hazard} />
                    <span className="text-ink">zone <span className="num font-medium">{e.situation.zone}</span></span>
                    <span className="text-ink-2">{e.situation.profile}, {words(e.situation.occupancy)}</span>
                    {e.situation.blocked.length ? <span className="text-[12px] text-danger-ink">blocked: <span className="num">{e.situation.blocked.join(", ")}</span></span> : null}
                    <span className="ml-auto flex items-center gap-3">
                      <span className="num text-[12px] text-ink-2"><span className="text-ink">{formatNumber(e.verified.badness)}</span> <span className="font-sans text-ink-3">vs</span> {formatNumber(e.doNothing.badness)} <span className="font-sans text-ink-3">do nothing</span></span>
                      <span title={e.protocol}><Badge>{sentence(e.protocol)}</Badge></span>
                    </span>
                  </summary>
                  <div className="space-y-3 pt-1 pr-1 pb-4 pl-[30px]">
                    <div className="num text-[11px] text-ink-3">{e.id}</div>
                    <p className="max-w-[860px] text-[13px] leading-relaxed text-ink-2">{e.rationale}</p>
                    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <div>
                        <div className="mb-1 text-[12px] text-ink-3">Zone instructions</div>
                        <table className="w-full border-collapse">
                          <thead><tr><Th className="pl-0">Zone</Th><Th>Instruction</Th><Th>Via</Th><Th className="text-right!">After</Th></tr></thead>
                          <tbody>
                            {e.policy.zones.map((z) => (
                              <tr key={z.zone}>
                                <Td className="num pl-0">{z.zone}</Td>
                                <Td className="text-ink-2">{words(z.instruction)}</Td>
                                <Td className="num text-ink-2">{z.via ?? <span className="text-ink-4">{"—"}</span>}</Td>
                                <Td className="num text-right text-ink-2">{z.delaySec ? `${z.delaySec} s` : <span className="text-ink-4">{"—"}</span>}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {e.policy.closedRoutes.length ? <div className="mt-2 text-[12px] text-ink-2">closed: <span className="num">{e.policy.closedRoutes.join(", ")}</span></div> : null}
                      </div>
                      <div>
                        <div className="mb-1 text-[12px] text-ink-3">Verified plan vs doing nothing</div>
                        <OutcomeTable columns={[{ title: "verified plan", outcome: e.verified }, { title: "do nothing", outcome: e.doNothing }]} />
                      </div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </Card>
        );
      }}
    </DesignResult>
  );
}
