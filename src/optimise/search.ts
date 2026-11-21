import { readFileSync } from "node:fs";
import type { Evaluator } from "../design/pool.ts";
import type { EvalResult } from "../design/evaluate.ts";
import { repoPath } from "../shared/paths.ts";
import type { SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import type { Diagnosis } from "./diagnose.ts";
import { outcome, paired, people, protectedBy, ridge, run, safeCapacity, spearman, type Outcome, type Paired } from "./evaluate.ts";
import type { Modification, Quantities } from "./generate.ts";

export interface ArchitectConfig {
  effort: Record<keyof Quantities, number>;
  structuralMultiplier: number;
  rankWeights: { safety: number; effort: number; structural: number };
  search: { maxSingles: number; screenRuns: number; topSingles: number; triplesSimulated: number; validateSurrogate: boolean; safeCapacityRuns: number };
}
export const loadArchitectConfig = (): ArchitectConfig => JSON.parse(readFileSync(repoPath("config", "architect.json"), "utf8")) as ArchitectConfig;

export interface Alternative {
  id: string;
  mods: string[];
  title: string;
  outcome: Outcome;
  dProtected: Paired;
  dClearance95: Paired;
  dBadness: Paired;
  effort: number;
  structuralChanges: number;
  needsEngineer: boolean;
  accessibility: number;
  pareto: boolean;
  score: number;
  runs: number;
  source: "simulated" | "screened";
}

export interface SearchReport {
  baseline: Outcome;
  runs: number;
  simulations: number;
  alternatives: Alternative[];
  surrogate: { kind: "ridge" | "additive" | "none"; spearmanRidge: number | null; spearmanAdditive: number | null; triplesTotal: number; triplesSimulated: number; simulationsSaved: number; bestTripleFound: boolean | null; note: string };
  safeCapacity: { baseline: { factor: number; people: number }; best: { alternative: string; factor: number; people: number } | null; extraPeople: number | null; checked: { alternative: string; factor: number; people: number }[]; runs: number };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function effortOf(mods: Modification[], c: ArchitectConfig): number {
  let e = 0;
  for (const m of mods) {
    let x = 0;
    for (const [k, v] of Object.entries(m.quantities)) x += (c.effort[k as keyof Quantities] ?? 0) * (v ?? 0);
    e += m.structural === "structural" ? x * c.structuralMultiplier : x;
  }
  return r1(e);
}

function combos<T>(xs: T[], k: number): T[][] {
  if (k === 1) return xs.map((x) => [x]);
  const out: T[][] = [];
  xs.forEach((x, i) => { for (const rest of combos(xs.slice(i + 1), k - 1)) out.push([x, ...rest]); });
  return out;
}

export async function search(env: SimEnv, ev: Evaluator, scenarios: Scenario[], mods: Modification[], o: { config?: ArchitectConfig; log?: (s: string) => void } = {}): Promise<SearchReport> {
  const c = o.config ?? loadArchitectConfig();
  const log = o.log ?? (() => {});
  const cap = Math.max(...scenarios.map((s) => s.maxSec));
  let sims = 0;
  const go = async (sc: Scenario[], m: Modification[]) => { sims += sc.length; return run(ev, sc, m.map((x) => x.edit)); };
  const base = await go(scenarios, []);
  const screenSc = scenarios.slice(0, Math.min(c.search.screenRuns, scenarios.length));
  const baseScreen = base.slice(0, screenSc.length);
  const byId = new Map(mods.map((m) => [m.id, m]));
  const results = new Map<string, EvalResult[]>();
  const key = (ms: Modification[]) => ms.map((m) => m.id).sort().join("+");
  // 1. screen every single modification on a few runs, then re-run the best on the full set (successive halving)
  const singles = mods.slice(0, c.search.maxSingles);
  const screened: { m: Modification; d: number }[] = [];
  for (const m of singles) {
    const rs = await go(screenSc, [m]);
    screened.push({ m, d: paired(baseScreen, rs, (r) => r.badness).mean });
    log(`screen ${m.id}: badness ${paired(baseScreen, rs, (r) => r.badness).mean}`);
  }
  screened.sort((a, b) => a.d - b.d);
  const top = screened.slice(0, c.search.topSingles).map((x) => x.m);
  for (const m of top) results.set(key([m]), await go(scenarios, [m]));
  // 2. pairs among the top singles, simulated
  for (const pair of combos(top, 2)) results.set(key(pair), await go(scenarios, pair));
  // 3. triples: predicted from singles and pairs, the most promising simulated
  const single = (m: Modification) => paired(base, results.get(key([m]))!, (r) => r.badness).mean;
  const feats = (ms: Modification[]) => {
    const s = ms.map(single);
    const sameHot = combos(ms, 2).filter(([a, b]) => a!.hotspot && a!.hotspot === b!.hotspot).length;
    const sameKind = combos(ms, 2).filter(([a, b]) => a!.kind === b!.kind).length;
    return [1, s.reduce((a, b) => a + b, 0), Math.min(...s), sameHot, sameKind];
  };
  const pairs = combos(top, 2);
  const w = ridge(pairs.map(feats), pairs.map((p) => paired(base, results.get(key(p))!, (r) => r.badness).mean), 5);
  const predict = (ms: Modification[]) => feats(ms).reduce((a, x, i) => a + x * w[i]!, 0);
  const additive = (ms: Modification[]) => ms.map(single).reduce((a, b) => a + b, 0);
  const triples = combos(top, 3);
  const ranked = [...triples].sort((a, b) => predict(a) - predict(b));
  const chosen = ranked.slice(0, c.search.triplesSimulated);
  for (const t of chosen) results.set(key(t), await go(scenarios, t));
  let surrogate: SearchReport["surrogate"] = { kind: "none", spearmanRidge: null, spearmanAdditive: null, triplesTotal: triples.length, triplesSimulated: chosen.length, simulationsSaved: 0, bestTripleFound: null, note: "" };
  if (triples.length) {
    if (c.search.validateSurrogate) {
      const truth: number[] = [];
      for (const t of triples) { if (!results.has(key(t))) results.set(key(t), await go(scenarios, t)); truth.push(paired(base, results.get(key(t))!, (r) => r.badness).mean); }
      const sr = spearman(triples.map(predict), truth), sa = spearman(triples.map(additive), truth);
      const bestIdx = truth.indexOf(Math.min(...truth));
      const found = chosen.includes(triples[bestIdx]!);
      const reliable = Math.max(sr, sa) >= 0.7 && found;
      const kind = !reliable ? "none" : sr > sa + 0.05 ? "ridge" : "additive";
      surrogate = { kind, spearmanRidge: sr, spearmanAdditive: sa, triplesTotal: triples.length, triplesSimulated: reliable ? chosen.length : triples.length, simulationsSaved: reliable ? (triples.length - chosen.length) * scenarios.length : 0, bestTripleFound: found,
        note: `All ${triples.length} triples were also simulated to check the predictor. Rank correlation with simulation: ridge ${sr}, sum of single effects ${sa}; the best triple was ${found ? "" : "NOT "}among the predicted top ${chosen.length}. ${!reliable ? "Neither predictor is reliable enough here (needs a rank correlation of at least 0.7 and the best triple in its top picks), so every triple is simulated and no simulations are saved." : kind === "ridge" ? `The learned model ranks better than simple addition; it would save ${(triples.length - chosen.length) * scenarios.length} simulations.` : `Simple addition of single effects is as good as the learned model, so the simpler rule is used; it would save ${(triples.length - chosen.length) * scenarios.length} simulations.`}` };
    } else surrogate = { ...surrogate, kind: "ridge", simulationsSaved: (triples.length - chosen.length) * scenarios.length, note: "Triples chosen by the ridge predictor; not validated in this run." };
  }
  // 4. alternatives, objectives, Pareto front, weighted score
  const alts: Alternative[] = [];
  for (const [k, rs] of results) {
    const ms = k.split("+").map((id) => byId.get(id)!);
    alts.push({
      id: `A${alts.length + 1}`, mods: ms.map((m) => m.id), title: ms.map((m) => m.title).join(" + "), outcome: outcome(rs, cap),
      dProtected: paired(base, rs, protectedBy), dClearance95: paired(base, rs, (r) => r.metrics.clearance95Sec ?? cap), dBadness: paired(base, rs, (r) => r.badness),
      effort: effortOf(ms, c), structuralChanges: ms.filter((m) => m.structural === "structural").length, needsEngineer: ms.some((m) => m.needsEngineer),
      accessibility: ms.reduce((a, m) => a + m.accessibility, 0), pareto: false, score: 0, runs: rs.length, source: "simulated",
    });
  }
  for (const s of screened.slice(c.search.topSingles)) alts.push({
    id: `A${alts.length + 1}`, mods: [s.m.id], title: s.m.title, outcome: outcome(await Promise.resolve(baseScreen), cap), dProtected: { mean: NaN, ci95: NaN, n: screenSc.length }, dClearance95: { mean: NaN, ci95: NaN, n: screenSc.length },
    dBadness: { mean: s.d, ci95: NaN, n: screenSc.length }, effort: effortOf([s.m], c), structuralChanges: s.m.structural === "structural" ? 1 : 0, needsEngineer: s.m.needsEngineer, accessibility: s.m.accessibility, pareto: false, score: -Infinity, runs: screenSc.length, source: "screened",
  });
  const sim = alts.filter((a) => a.source === "simulated");
  const benefit = (a: Alternative) => -a.dBadness.mean;
  for (const a of sim) a.pareto = !sim.some((b) => b !== a && benefit(b) >= benefit(a) && b.effort <= a.effort && b.structuralChanges <= a.structuralChanges && (benefit(b) > benefit(a) || b.effort < a.effort || b.structuralChanges < a.structuralChanges));
  const maxB = Math.max(...sim.map(benefit), 1e-9), maxE = Math.max(...sim.map((a) => a.effort), 1e-9), maxS = Math.max(...sim.map((a) => a.structuralChanges), 1);
  for (const a of sim) a.score = Math.round((c.rankWeights.safety * (benefit(a) / maxB) - c.rankWeights.effort * (a.effort / maxE) - c.rankWeights.structural * (a.structuralChanges / maxS)) * 1000) / 1000;
  alts.sort((a, b) => b.score - a.score);
  alts.forEach((a, i) => (a.id = `A${i + 1}`));
  // 5. safe capacity: baseline vs the three alternatives with the largest safety gain
  const capSc = scenarios.slice(0, c.search.safeCapacityRuns);
  const baseCap = await safeCapacity(ev, capSc, [], { iters: 7 });
  const bySafety = sim.filter((a) => a.dBadness.mean < 0).sort((a, b) => a.dBadness.mean - b.dBadness.mean).slice(0, 3);
  const caps: { alternative: string; factor: number; people: number }[] = [];
  for (const a of bySafety) caps.push({ alternative: a.id, ...(await safeCapacity(ev, capSc, a.mods.map((id) => byId.get(id)!.edit), { iters: 7 })) });
  const bestCap = caps.sort((a, b) => b.people - a.people)[0] ?? null;
  log(`safe capacity: baseline ${baseCap.people} people; ${caps.map((x) => `${x.alternative} ${x.people}`).join(", ")}`);
  void people;
  return {
    baseline: outcome(base, cap), runs: scenarios.length, simulations: sims, alternatives: alts, surrogate,
    safeCapacity: { baseline: baseCap, best: bestCap, extraPeople: bestCap ? bestCap.people - baseCap.people : null, checked: caps, runs: capSc.length },
  };
}
