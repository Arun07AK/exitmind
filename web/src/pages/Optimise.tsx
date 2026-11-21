import { Download, Play, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { BottleneckResult, RecommendResult } from "../../../src/server/contract.ts";
import type { Pt } from "../../../src/twin/schema.ts";
import { ApiError, isNotFound, postJSON, useApi } from "../api.ts";
import { Button, cx, Empty, EvidenceChip, HazardTag, Segmented } from "../components/ui.tsx";
import { useGeometry, type Geometry } from "../geometry.ts";
import { Analyses } from "./optimise/Analyses.tsx";
import { Architect } from "./optimise/Architect.tsx";
import { CompareSheet } from "./optimise/CompareSheet.tsx";
import { DangerCompare } from "./optimise/DangerCompare.tsx";
import { DotPlot, FigureRow, VariantTable } from "./optimise/Figures.tsx";
import { capital, fmtClock, fmtNum, letterRecs, signed, type Rec } from "./optimise/model.ts";

const SOURCE: Record<string, string> = { optimiser: "found by the optimiser", bottlenecks: "from the bottleneck analysis", candidates: "from the candidate list" };
const POLICY: Record<string, string> = { rule: "rule-based crowd", distilled: "distilled crowd policy" };

function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function hazardPlace(geo: Geometry | null, r: RecommendResult): string | null {
  const hz = r.scenario.scenario.hazard;
  if (!geo || !hz.floor || !hz.at) return null;
  const f = geo.twin.floors.find((x) => x.id === hz.floor);
  const sp = f?.spaces.find((s) => inside(s.polygon, hz.at![0], hz.at![1]));
  return f ? `${sp?.name ?? "origin"}, ${f.name.toLowerCase()}` : null;
}

function download(r: RecommendResult): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([`${JSON.stringify(r, null, 1)}\n`], { type: "application/json" }));
  a.download = `exitmind-recommend-${r.scenario.id}-seeds-${r.seeds[0]}-${r.seeds.at(-1)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function ContextBar({ result, geo }: { result: RecommendResult; geo: Geometry | null }) {
  const nProblems = result.problems.exitShares.length + result.problems.density.length + 1;
  const tested = result.recommendations.filter((r) => r.variant).length;
  const place = hazardPlace(geo, result);
  const step = (n: number, text: string) => <span><span className="font-medium text-ink">{n}</span> {text}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-panel px-4 py-3.5 min-[700px]:px-6" data-testid="context-bar">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <HazardTag kind={result.hazard} />
        {place ? <span className="font-medium first-letter:uppercase">{place}</span> : null}
        <span className="text-ink-3">· {result.scenario.label} · <span className="num">{fmtNum(result.problems.insideAtTarget.occupants)}</span> occupants · target <span className="num">{fmtClock(result.targetSec)}</span></span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="num flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-ink-2" data-testid="pipeline">
          {step(nProblems, nProblems === 1 ? "problem" : "problems")}<span aria-hidden="true" className="text-idle">→</span>
          {step(result.recommendations.length, "changes proposed")}<span aria-hidden="true" className="text-idle">→</span>
          <span><span className="font-medium text-ink">{tested}</span> re-simulated on <span className="font-medium text-ink">{result.seeds.length}</span> seeds</span>
        </div>
        <Button onClick={() => download(result)} data-testid="download"><Download size={14} aria-hidden="true" />Download results</Button>
      </div>
    </div>
  );
}

function Problems({ result, sel }: { result: RecommendResult; sel: Rec | null }) {
  const p = result.problems;
  const items = [
    ...p.exitShares.map((x) => ({ id: x.id, head: `Exit use at ${x.exit}`, text: x.text })),
    ...p.density.map((x) => ({ id: x.id, head: `Dangerous density on ${x.floor}`, text: x.text })),
    { id: p.insideAtTarget.id, head: `Still inside at ${fmtClock(p.insideAtTarget.targetSec)}`, text: p.insideAtTarget.text },
  ];
  return (
    <section aria-labelledby="opt-problems">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 id="opt-problems" className="m-0 text-[12px] font-medium text-ink-2">Problems found</h2>
        {sel ? <span className="text-[11px] text-ink-3">dimmed: not targeted by {sel.letter}</span> : null}
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="problems">
        {items.map((it, i) => {
          const hit = !sel || sel.addresses.includes(it.id);
          return (
            <li key={it.id} className={cx("grid grid-cols-[20px_minmax(0,1fr)] gap-2 transition-opacity", !hit && "opacity-45")} data-problem={it.id}>
              <span className="num grid h-[18px] w-[18px] place-items-center rounded-full bg-danger-bg text-[11px] font-semibold text-danger-ink">{i + 1}</span>
              <div className="min-w-0"><div className="font-medium">{it.head}</div><div className="mt-0.5 leading-normal text-ink-2">{it.text}</div></div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RecList({ recs, sel, onSelect, targetSec }: { recs: Rec[]; sel: Rec | null; onSelect: (id: string) => void; targetSec: number }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + recs.length) % recs.length;
    onSelect(recs[j]!.id);
    refs.current[j]?.focus();
  };
  return (
    <section aria-labelledby="opt-recs">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 id="opt-recs" className="m-0 text-[12px] font-medium text-ink-2">Recommendations</h2>
        <span className="text-[11px] text-ink-3">more out by <span className="num">{fmtClock(targetSec)}</span></span>
      </div>
      <div role="radiogroup" aria-labelledby="opt-recs" className="flex flex-col gap-1.5" data-testid="rec-list">
        {recs.map((r, i) => {
          const on = r.id === sel?.id;
          return (
            <button key={r.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onSelect(r.id)} onKeyDown={(e) => onKey(e, i)} data-testid={`rec-${r.letter}`} data-status={r.status}
              className={cx("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[10px] border bg-panel p-3 text-left text-ink transition-colors", on ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line hover:border-line-strong")}>
              <span className="text-[13px] font-medium">{r.letter} · {capital(r.label)}</span>
              <span className={cx("num text-right text-[15px] font-medium", r.status === "validated" ? "text-safe-ink" : r.status === "worse" ? "text-danger-ink" : "text-ink-3")}>{r.gain ? signed(r.gain.mean) : "—"}</span>
              <span className="min-w-0 text-[12px] text-ink-3">{r.whatChanges}</span>
              <EvidenceChip kind={r.status} className="self-start justify-self-end" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function QuickRecommendations() {
  const api = useApi<RecommendResult>("/api/design/recommend");
  const [fresh, setFresh] = useState<RecommendResult | null>(null);
  const result = fresh ?? api.data;
  const { geo, error: geoError } = useGeometry();
  const bottlenecks = useApi<BottleneckResult>("/api/design/bottlenecks");
  const threshold = typeof bottlenecks.data?.densityThreshold === "number" ? bottlenecks.data.densityThreshold : null;
  const recs = useMemo(() => (result ? letterRecs(result.recommendations) : []), [result]);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = recs.find((r) => r.id === selId) ?? recs[0] ?? null;
  const [watch, setWatch] = useState(false);
  const [rerun, setRerun] = useState<{ seeds: number[] | null; error: string | null }>({ seeds: null, error: null });

  const runRecommend = async (seeds?: number[]) => {
    setRerun({ seeds: seeds ?? [], error: null });
    try {
      const r = await postJSON<RecommendResult>("/api/design/recommend", seeds ? { seeds } : {});
      setFresh(r);
      setRerun({ seeds: null, error: null });
    } catch (e) {
      setRerun({ seeds: null, error: e instanceof ApiError || e instanceof Error ? capital(e.message) : String(e) });
    }
  };
  const nextSeeds = (r: RecommendResult) => Array.from({ length: r.seeds.length }, (_, i) => Math.max(...r.seeds) + 1 + i);

  if (!result) {
    return (
      <div className="h-full overflow-y-auto p-6" data-testid="optimise-page">
        <div className="mx-auto max-w-[640px]">
          {api.error && isNotFound(api.error) ? (
            <Empty>
              <div className="flex flex-col items-start gap-3" data-testid="not-generated">
                <span>No recommendation run yet. Run <code className="num rounded bg-inset px-1.5 py-0.5 text-[12px] text-ink">npm run recommend</code>, or start one here.</span>
                <Button tone="primary" onClick={() => void runRecommend()} disabled={rerun.seeds !== null}>{rerun.seeds !== null ? "Running" : "Run recommendations"}</Button>
                {rerun.error ? <span className="text-danger-ink">{rerun.error}</span> : null}
              </div>
            </Empty>
          ) : api.error ? <Empty>Could not load /api/design/recommend: {api.error.message}</Empty> : <Empty>Loading /api/design/recommend</Empty>}
        </div>
      </div>
    );
  }

  const tested = !!sel?.variant;
  const busy = rerun.seeds !== null;
  const ns = nextSeeds(result);
  const kicker = sel ? [`Recommendation ${sel.letter}`, sel.kind, sel.parts.length ? `combines ${sel.parts.join(" and ")}` : SOURCE[sel.source]].filter(Boolean).join(" · ") : "";

  return (
    <div className="h-full overflow-y-auto" data-testid="optimise-page">
      <ContextBar result={result} geo={geo} />
      <div className="flex flex-col min-[1000px]:flex-row min-[1000px]:items-stretch">
        <aside className="border-b border-line bg-panel min-[1000px]:w-[400px] min-[1000px]:flex-none min-[1000px]:border-r min-[1000px]:border-b-0">
          <div className="flex flex-col gap-6 px-4 pt-5 pb-8 min-[700px]:px-6 min-[1000px]:pr-5">
            <Problems result={result} sel={sel} />
            <RecList recs={recs} sel={sel} onSelect={setSelId} targetSec={result.targetSec} />
          </div>
        </aside>

        <section aria-label="Selected recommendation" className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-8 min-[700px]:px-6" data-testid="rec-detail">
          {sel ? (
            <>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div className="min-w-0 flex-[1_1_420px]">
                  <div className="text-[12px] text-ink-3" data-testid="rec-kicker">{kicker}</div>
                  <h1 className="mt-1 mb-2 text-[22px] font-medium tracking-[-0.01em]" data-testid="rec-title">{capital(sel.label)}</h1>
                  <dl className="m-0 grid max-w-[760px] grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 leading-relaxed">
                    <dt className="text-ink-3">What changes</dt><dd className="m-0 text-ink">{sel.whatChanges}</dd>
                    <dt className="text-ink-3">Why</dt><dd className="m-0 text-ink-2">{sel.why}</dd>
                    {sel.codeLimitsOk !== null ? <><dt className="text-ink-3">Code check</dt><dd className={cx("m-0", sel.codeLimitsOk ? "text-ink-2" : "text-warn-ink")}>{sel.codeLimitsOk ? "no new failures on paper with this change" : "this change adds a failure on paper"}</dd></> : null}
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button tone="primary" className="h-[34px] px-3.5" onClick={() => setWatch(true)} disabled={!tested || !geo} title={tested ? undefined : "No variant run to watch"} data-testid="watch-both"><Play size={13} aria-hidden="true" fill="currentColor" />Watch both runs</Button>
                  <Button className="h-[34px] px-3.5" onClick={() => void runRecommend(ns)} disabled={busy} title={`Re-run the original and every change on seeds ${ns[0]}–${ns.at(-1)}`} data-testid="rerun">
                    <RefreshCw size={13} aria-hidden="true" className={busy ? "animate-spin" : undefined} />{busy ? "Re-running" : "Re-run on new seeds"}
                  </Button>
                </div>
              </div>
              {busy || rerun.error ? (
                <div role="status" className={cx("rounded-lg border px-3 py-2 text-[13px]", rerun.error ? "border-danger-line bg-danger-bg text-danger-ink" : "border-line bg-panel text-ink-2")} data-testid="rerun-status">
                  {rerun.error ?? <>Re-simulating the original and {result.recommendations.filter((r) => r.edits.length).length} changes on seeds <span className="num">{ns[0]}–{ns.at(-1)}</span>. The figures below stay on seeds <span className="num">{result.seeds[0]}–{result.seeds.at(-1)}</span> until it finishes.</>}
                </div>
              ) : null}

              {geo ? <DangerCompare geo={geo} result={result} rec={sel} threshold={threshold} /> : <Empty>{geoError ? `Could not load the building geometry: ${geoError}` : "Loading the building geometry"}</Empty>}

              {tested ? (
                <>
                  <FigureRow result={result} rec={sel} />
                  <DotPlot result={result} rec={sel} />
                </>
              ) : null}

              <VariantTable result={result} recs={recs} selected={sel.id} onSelect={setSelId} />

              <p className="m-0 max-w-[900px] text-[12px] leading-relaxed text-ink-3" data-testid="caveat">
                Validated means re-simulated on the same scenario ({result.scenario.label}) and the same <span className="num">{result.seeds.length}</span> seeds (<span className="num">{result.seeds[0]}–{result.seeds.at(-1)}</span>) as the original, with the {POLICY[result.policy] ?? result.policy}. Evidence rule: {result.evidenceRule}. These are model results under stated assumptions; the behaviour parameters are not yet checked against published sources. Decision support for professional safety review, not certification, and not a guarantee of real-world outcomes. Inputs: <span className="num">{result.sources.join("; ")}</span>.
              </p>
            </>
          ) : <Empty>The engine proposed no changes for this scenario.</Empty>}
        </section>
      </div>

      <div className="border-t border-line px-4 pt-6 pb-10 min-[700px]:px-6">
        <Analyses />
      </div>

      {sel && tested && geo && watch ? <CompareSheet open={watch} onOpenChange={setWatch} geo={geo} result={result} rec={sel} /> : null}
    </div>
  );
}

export default function Optimise() {
  const [mode, setMode] = useState<"architect" | "quick">("architect");
  return (
    <div className="h-full overflow-y-auto" data-testid="optimise-root">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2 min-[700px]:px-6">
        <Segmented label="Optimise mode" value={mode} onChange={setMode} options={[{ value: "architect", label: "Architectural changes" }, { value: "quick", label: "Quick recommendations" }]} size="sm" testId="optimise-mode" />
      </div>
      {mode === "architect" ? <Architect /> : <div className="h-[calc(100%-49px)]"><QuickRecommendations /></div>}
    </div>
  );
}
