import { readFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";
import type { Model } from "../sim/model.ts";
import { targetSec, type SimEnv } from "../sim/run.ts";
import type { Edit, Scenario } from "../sim/types.ts";
import type {
  AdversaryResult, BottleneckResult, EvidenceStatus, OptimiserResult, RecommendAggregate, RecommendDangerFloor, RecommendDensityProblem, RecommendExitShare,
  RecommendExitShareProblem, RecommendGain, RecommendInsideProblem, RecommendResult, RecommendSeed, RecommendStats, Recommendation, ScenarioRef,
} from "../server/contract.ts";
import type { EvalResult, EvalTask } from "./evaluate.ts";
import { codeLimitsOk, editLabel, loadCosts } from "./optimiser.ts";
import type { Evaluator } from "./pool.ts";
import { exitCandidates, modelFor } from "./prepare.ts";

export const NEAR_FT = 14;
export const EXIT_SHARE_RATIO = 1.5;
export const EVIDENCE_RULE = "gain = people out by the target, variant minus original on the same seed; validated if mean > 0.5 and mean > 2·SE, worse if mean < -0.5 and |mean| > 2·SE, otherwise no effect";

const readDesign = <T>(name: string): T => JSON.parse(readFileSync(repoPath("data", "design", `${name}.json`), "utf8")) as T;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length)); };
const stats = (xs: number[]): RecommendStats => ({ mean: r2(mean(xs)), min: Math.min(...xs), max: Math.max(...xs) });
const fmt = (v: number, d = 1) => v.toLocaleString("en-US", { maximumFractionDigits: d });
const pct = (v: number) => `${fmt(v * 100)}%`;

export function editId(e: Edit): string {
  return [e.kind, e.target, e.amount, e.protocol].filter((x) => x !== undefined).join(":");
}

export function classify(diffs: number[]): { status: EvidenceStatus; gain: RecommendGain } {
  const m = mean(diffs), s = se(diffs);
  const status: EvidenceStatus = m > 0.5 && m > 2 * s ? "validated" : m < -0.5 && Math.abs(m) > 2 * s ? "worse" : "no_effect";
  return { status, gain: { mean: r2(m), se: r2(s), perSeed: diffs } };
}

function seedMetrics(r: EvalResult): RecommendSeed {
  const m = r.metrics;
  return {
    seed: r.seed, occupants: m.occupants, remainingAtTarget: m.remainingAtTarget, outByTarget: m.occupants - m.remainingAtTarget, clearance95Sec: m.clearance95Sec,
    densityDangerPS: m.densityDangerPS, smokeExposurePS: m.smokeExposurePS, crushSec: m.crushSec, gridlock: m.gridlock, exitUsage: m.exitUsage, badness: r.badness, hash: r.hash,
  };
}

function meanDanger(m: Model, runs: EvalResult[]): Float64Array[] {
  return m.floors.map((f, fi) => {
    const acc = new Float64Array(f.n);
    for (const r of runs) { const d = r.dangerCells?.[fi]; if (d) for (let i = 0; i < f.n; i++) acc[i] = acc[i]! + d[i]! / runs.length; }
    return acc;
  });
}

function dangerMap(m: Model, means: Float64Array[]): RecommendDangerFloor[] {
  return m.floors.map((f, fi) => {
    const acc = means[fi]!, cells: [number, number][] = [];
    let total = 0;
    for (let i = 0; i < f.n; i++) { total += acc[i]!; if (acc[i]! > 0.5) cells.push([i, r2(acc[i]!)]); }
    return { floor: f.id, w: f.w, h: f.h, ox: f.ox, oy: f.oy, cellFt: m.raster.cellFt, total: r2(total), cells };
  });
}

function exteriorWidths(m: Model): { id: string; label: string; clearWidthIn: number; floor: string; portal: string }[] {
  return m.twin.exits.filter((e) => e.kind === "exterior").map((e) => {
    const p = m.twin.floors.find((f) => f.id === e.floor)!.portals.find((x) => x.id === e.portal)!;
    return { id: e.id, label: e.name, clearWidthIn: p.clearWidthIn, floor: e.floor, portal: e.portal };
  });
}

function exitShares(m: Model, per: RecommendSeed[]): RecommendExitShare[] {
  const ext = exteriorWidths(m);
  const uses = ext.map((e) => mean(per.map((p) => p.exitUsage[e.id] ?? 0)));
  const totalUse = uses.reduce((a, b) => a + b, 0), totalW = ext.reduce((a, e) => a + e.clearWidthIn, 0);
  return ext.map((e, i) => ({ id: e.id, label: e.label, clearWidthIn: e.clearWidthIn, uses: r2(uses[i]!), share: r3(totalUse ? uses[i]! / totalUse : 0), widthShare: r3(e.clearWidthIn / totalW) }));
}

function aggregate(m: Model, runs: EvalResult[], targetAt: number): { agg: RecommendAggregate; means: Float64Array[] } {
  const per = runs.map(seedMetrics);
  const c95 = per.flatMap((p) => (p.clearance95Sec === null ? [] : [p.clearance95Sec]));
  const means = meanDanger(m, runs);
  return {
    means,
    agg: {
      perSeed: per, outByTarget: stats(per.map((p) => p.outByTarget)), remainingAtTarget: stats(per.map((p) => p.remainingAtTarget)),
      reached95: { seeds: c95.length, of: per.length, byTarget: c95.filter((v) => v <= targetAt).length, minSec: c95.length ? Math.min(...c95) : null, maxSec: c95.length ? Math.max(...c95) : null },
      densityDangerPS: r2(mean(per.map((p) => p.densityDangerPS))), smokeExposurePS: r2(mean(per.map((p) => p.smokeExposurePS))), crushSec: r2(mean(per.map((p) => p.crushSec))),
      gridlockSeeds: per.filter((p) => p.gridlock).length, badness: r2(mean(per.map((p) => p.badness))), exitShares: exitShares(m, per), danger: dangerMap(m, means),
    },
  };
}

function densityProblems(m: Model, means: Float64Array[]): RecommendDensityProblem[] {
  const out: RecommendDensityProblem[] = [];
  m.floors.forEach((f, fi) => {
    const acc = means[fi]!;
    let total = 0, sx = 0, sy = 0;
    for (let i = 0; i < f.n; i++) { total += acc[i]!; sx += acc[i]! * f.cx[i]!; sy += acc[i]! * f.cy[i]!; }
    if (total <= 0.5) return;
    const cx = sx / total, cy = sy / total;
    const tf = m.twin.floors.find((x) => x.id === f.id)!;
    const near = tf.portals.filter((p) => p.kind !== "corridor_section")
      .map((p) => ({ p, x: (p.a[0] + p.b[0]) / 2, y: (p.a[1] + p.b[1]) / 2 }))
      .map((q) => ({ ...q, d: Math.hypot(q.x - cx, q.y - cy) }))
      .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id))[0]!;
    let within = 0;
    for (let i = 0; i < f.n; i++) if (acc[i]! > 0 && Math.hypot(f.cx[i]! - near.x, f.cy[i]! - near.y) <= NEAR_FT) within += acc[i]!;
    const exit = m.twin.exits.find((e) => e.kind === "exterior" && e.floor === f.id && e.portal === near.p.id)?.id ?? null;
    const names = new Map(tf.spaces.map((s) => [s.id, s.name]));
    const portalLabel = exit ? `${exit} door` : `door ${near.p.id} (${near.p.connects.map((c) => (c === "OUTSIDE" ? "outside" : names.get(c) ?? c)).join(" / ")})`;
    const fraction = within / total;
    out.push({
      id: `density:${f.id}`, floor: f.id, totalPS: r2(total), centroid: [r2(cx), r2(cy)], portal: near.p.id, portalLabel, exit, x: r2(near.x), y: r2(near.y), radiusFt: NEAR_FT, fractionWithin: r3(fraction),
      text: `${fmt(total, 0)} person-s of dangerous density on ${f.id}, ${pct(fraction)} of it within ${NEAR_FT} ft of the ${portalLabel}`,
    });
  });
  return out.sort((a, b) => b.totalPS - a.totalPS);
}

function whatChanges(env: SimEnv, base: Scenario, edits: Edit[]): string {
  const before = modelFor(env, base).twin, after = modelFor(env, { edits: [...(base.edits ?? []), ...edits] }).twin;
  const portalW = (t: Model["twin"], exitId: string) => { const e = t.exits.find((x) => x.id === exitId)!; return t.floors.find((f) => f.id === e.floor)!.portals.find((p) => p.id === e.portal)!.clearWidthIn; };
  const space = (t: Model["twin"], id: string) => t.floors.flatMap((f) => f.spaces).find((s) => s.id === id);
  const protocol = (base.edits ?? []).filter((e) => e.kind === "strategy").at(-1)?.protocol ?? base.protocol;
  const parts = edits.map((e) => {
    switch (e.kind) {
      case "widen_exit": return `${e.target}: ${fmt(portalW(before, e.target))} → ${fmt(portalW(after, e.target))} in clear width`;
      case "widen_stair": return `stair ${e.target}: ${fmt(before.stairs.find((s) => s.id === e.target)!.clearWidthIn)} → ${fmt(after.stairs.find((s) => s.id === e.target)!.clearWidthIn)} in clear width`;
      case "widen_corridor": return `corridor ${e.target}: ${fmt(space(before, e.target)?.clearWidthFt ?? 0)} → ${fmt(space(after, e.target)?.clearWidthFt ?? 0)} ft clear width`;
      case "accessible_exit": return `${e.target}: accessible route added`;
      case "add_exit": return `new exterior exit at candidate ${e.target}`;
      case "strategy": return `response plan ${protocol} → ${e.protocol}; no building change`;
      case "evac_chairs": return `${e.amount ?? 2} evacuation chairs at stair ${e.target}`;
      case "refuge": return `area of refuge at ${e.target}`;
      default: return editLabel(e);
    }
  });
  return [...new Set(parts)].join(" + ");
}

const OPERATIONAL = new Set<Edit["kind"]>(["strategy", "evac_chairs"]);

export async function recommend(env: SimEnv, ev: Evaluator, opts: { scenario?: Scenario; seeds?: number[]; mode?: "rule" | "distilled"; log?: (s: string) => void } = {}): Promise<RecommendResult> {
  const log = opts.log ?? (() => {});
  const adv = opts.scenario ? null : readDesign<AdversaryResult>("adversary");
  const opt = readDesign<OptimiserResult>("optimiser");
  const bn = readDesign<BottleneckResult>("bottlenecks");
  const ref: ScenarioRef = adv ? adv.worst.scenario : { id: opts.scenario!.id, label: "scenario supplied by the caller", scenario: opts.scenario! };
  const base = ref.scenario, seeds = opts.seeds ?? opt.seeds, mode = opts.mode ?? "rule";
  const target = targetSec(env.runtime, base.hazard.kind), targetAt = (base.hazard.startSec ?? 0) + target;
  const costs = loadCosts();

  const singles: { edit: Edit; source: Recommendation["source"] }[] = [];
  const push = (edit: Edit, source: Recommendation["source"]) => { if (!singles.some((s) => editId(s.edit) === editId(edit))) singles.push({ edit, source }); };
  for (const s of opt.steps.filter((x) => x.accepted)) push(s.edit as Edit, "optimiser");
  for (const e of bn.exits.filter((x) => x.status === "overloaded")) if (!singles.some((s) => s.edit.kind === "widen_exit" && s.edit.target === e.id)) push({ kind: "widen_exit", target: e.id, amount: costs.step.widen_exit ?? 6 }, "bottlenecks");
  for (const c of exitCandidates()) push({ kind: "add_exit", target: c.id }, "candidates");

  let runs = 0;
  const runAll = async (variants: Edit[][]) => {
    const tasks: EvalTask[] = variants.flatMap((edits) => seeds.map((seed) => ({ scenario: { ...base, seed, edits: [...(base.edits ?? []), ...edits] }, mode, dangerCells: true })));
    const res = await ev.map(tasks);
    runs += res.length;
    return variants.map((_, i) => res.slice(i * seeds.length, (i + 1) * seeds.length));
  };

  log(`running original + ${singles.length} single changes on ${seeds.length} seeds (${(singles.length + 1) * seeds.length} runs, ${mode} policy)`);
  const [origRuns, ...singleRuns] = await runAll([[], ...singles.map((s) => [s.edit])]);
  const baseModel = modelFor(env, base);
  const { agg: original, means } = aggregate(baseModel, origRuns!, targetAt);

  const ws = exitShares(baseModel, original.perSeed);
  const exitProblems: RecommendExitShareProblem[] = ws.filter((e) => e.share > EXIT_SHARE_RATIO * e.widthShare).map((e) => ({
    id: `exit_share:${e.id}`, exit: e.id, label: e.label, share: e.share, widthShare: e.widthShare, clearWidthIn: e.clearWidthIn, ratio: r2(e.share / e.widthShare),
    text: `${e.id} carries ${pct(e.share)} of exterior exit use with ${pct(e.widthShare)} of the exterior clear width (${fmt(e.clearWidthIn)} in)`,
  }));
  const density = densityProblems(baseModel, means);
  const r = original.remainingAtTarget, occupants = original.perSeed[0]!.occupants;
  const inside: RecommendInsideProblem = {
    id: "inside_at_target", targetSec: target, occupants, remainingAtTarget: r, reached95: original.reached95.seeds, of: original.reached95.of,
    text: `${fmt(r.mean)} of ${occupants} people still inside at ${target} s (mean of ${seeds.length} seeds, ${r.min}–${r.max}); 95% clearance reached in ${original.reached95.seeds} of ${original.reached95.of}`,
  };
  const problemText = new Map<string, string>([...exitProblems, ...density, inside].map((p) => [p.id, p.text]));

  const addresses = (edits: Edit[]): string[] => {
    const ids = new Set<string>();
    for (const e of edits) {
      if (e.kind === "widen_exit" || e.kind === "accessible_exit" || e.kind === "add_exit") {
        for (const p of exitProblems) if (p.exit === e.target || e.kind === "add_exit") ids.add(p.id);
        for (const p of density) if (p.exit && (p.exit === e.target || e.kind === "add_exit")) ids.add(p.id);
      }
      if (e.kind === "strategy" && density[0]) ids.add(density[0].id);
    }
    ids.add(inside.id);
    return [...ids];
  };

  const build = (edits: Edit[], source: Recommendation["source"], vr: EvalResult[]): Recommendation => {
    const { agg } = aggregate(modelFor(env, { edits: [...(base.edits ?? []), ...edits] }), vr, targetAt);
    const { status, gain } = classify(agg.perSeed.map((p, i) => p.outByTarget - original.perSeed[i]!.outByTarget));
    const ids = addresses(edits);
    return {
      id: edits.map(editId).join("+"), edits, label: edits.map(editLabel).join(" + "), kind: edits.every((e) => OPERATIONAL.has(e.kind)) ? "operational" : "architectural", source,
      whatChanges: whatChanges(env, base, edits), why: ids.map((id) => problemText.get(id)!).join("; "), addresses: ids, status, gain,
      codeLimitsOk: codeLimitsOk(env, [...(base.edits ?? []), ...edits]), variant: agg,
    };
  };

  const recs = singles.map((s, i) => build([s.edit], s.source, singleRuns[i]!));
  for (const x of recs) log(`${x.label}: ${x.variant!.outByTarget.mean} out by ${target} s (gain ${x.gain!.mean} ± ${r2(2 * x.gain!.se)}) ${x.status}`);
  const best = recs.filter((x) => x.status === "validated").sort((a, b) => b.gain!.mean - a.gain!.mean || a.id.localeCompare(b.id)).slice(0, 2);
  if (best.length === 2) {
    const edits = [...best[0]!.edits, ...best[1]!.edits];
    log(`running the combination ${edits.map(editLabel).join(" + ")} on ${seeds.length} seeds`);
    const [vr] = await runAll([edits]);
    const combo = build(edits, "combination", vr!);
    log(`${combo.label}: ${combo.variant!.outByTarget.mean} out by ${target} s (gain ${combo.gain!.mean} ± ${r2(2 * combo.gain!.se)}) ${combo.status}`);
    recs.push(combo);
  }
  if (!exitCandidates().length) {
    const ids = [...exitProblems.map((p) => p.id), inside.id];
    recs.push({
      id: "add_exit", edits: [], label: "add an exterior exit", kind: "architectural", source: "candidates", whatChanges: "new exterior exit (no position defined to test)",
      why: ids.map((id) => problemText.get(id)!).join("; "), addresses: ids, status: "untestable",
      reason: "No candidate exit positions are defined for this building, so an added exit cannot be simulated.", gain: null, codeLimitsOk: null, variant: null,
    });
  }
  const order = { validated: 0, no_effect: 1, worse: 2, untestable: 3 } as const;
  recs.sort((a, b) => order[a.status] - order[b.status] || (b.gain?.mean ?? 0) - (a.gain?.mean ?? 0) || a.id.localeCompare(b.id));

  return {
    scenario: ref, hazard: base.hazard.kind, profile: base.profile, seeds, targetSec: target, policy: mode, runs, evidenceRule: EVIDENCE_RULE,
    sources: [adv ? "data/design/adversary.json (worst.scenario)" : "scenario supplied by the caller", "data/design/optimiser.json (accepted steps)", "data/design/bottlenecks.json (overloaded exits)"],
    original, problems: { exitShares: exitProblems, density, insideAtTarget: inside }, recommendations: recs,
  };
}
