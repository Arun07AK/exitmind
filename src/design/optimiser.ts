import { readFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";
import type { SimEnv } from "../sim/run.ts";
import type { Edit, HazardKind, ProfileId, Protocol } from "../sim/types.ts";
import type { OptimiserResult, OptimiserStep } from "../server/contract.ts";
import { codeCheck } from "./codecheck.ts";
import { adversary, outcome } from "./adversary.ts";
import type { Evaluator } from "./pool.ts";
import { exitCandidates, modelFor } from "./prepare.ts";

interface CostTable { budget: number; maxSteps: number; costs: Record<Edit["kind"], number>; step: Partial<Record<Edit["kind"], number>>; maxRepeats: number }
export function loadCosts(): CostTable { return JSON.parse(readFileSync(repoPath("config", "optimiser.costs.json"), "utf8")) as CostTable; }

export function editLabel(e: Edit): string {
  switch (e.kind) {
    case "widen_corridor": return `widen corridor ${e.target} by ${e.amount} ft`;
    case "widen_stair": return `widen stair ${e.target} by ${e.amount} in`;
    case "widen_exit": return `widen exit ${e.target} by ${e.amount} in`;
    case "add_exit": return `add exit at candidate ${e.target}`;
    case "evac_chairs": return `${e.amount} evacuation chairs at ${e.target}`;
    case "refuge": return `area of refuge at ${e.target}`;
    case "accessible_exit": return `ramp / accessible route at ${e.target}`;
    case "strategy": return `strategy: ${e.protocol}`;
    default: return `${e.kind} ${e.target}`;
  }
}

export function candidateEdits(env: SimEnv, hazard: HazardKind, applied: Edit[], c: CostTable): Edit[] {
  const m = modelFor(env, { edits: applied });
  const twin = m.twin;
  const count = (e: Edit) => applied.filter((x) => x.kind === e.kind && x.target === e.target && x.protocol === e.protocol).length;
  const out: Edit[] = [];
  for (const f of twin.floors) for (const s of f.spaces) if (s.kind === "corridor" && s.axis && s.clearWidthFt) out.push({ kind: "widen_corridor", target: s.id, amount: c.step.widen_corridor ?? 1 });
  for (const st of twin.stairs) {
    out.push({ kind: "widen_stair", target: st.id, amount: c.step.widen_stair ?? 6 });
    out.push({ kind: "evac_chairs", target: st.id, amount: c.step.evac_chairs ?? 2 });
    for (const fl of Object.keys(st.spaces)) if (fl !== "F1") out.push({ kind: "refuge", target: `${st.id}@${fl}` });
  }
  for (const e of twin.exits.filter((x) => x.kind === "exterior")) {
    out.push({ kind: "widen_exit", target: e.id, amount: c.step.widen_exit ?? 6 });
    const p = twin.floors.find((f) => f.id === e.floor)!.portals.find((x) => x.id === e.portal);
    if (p && !p.accessible) out.push({ kind: "accessible_exit", target: e.id });
  }
  for (const x of exitCandidates()) out.push({ kind: "add_exit", target: x.id });
  const strategies: Protocol[] = hazard === "quake" ? ["PHASED_EVACUATION", "EVACUATE"] : ["PHASED_EVACUATION", "HOLD_THEN_EVACUATE"];
  for (const p of strategies) out.push({ kind: "strategy", target: "building", protocol: p });
  return out.filter((e) => count(e) < (e.kind === "strategy" || e.kind === "add_exit" || e.kind === "refuge" || e.kind === "accessible_exit" ? 1 : c.maxRepeats));
}

export function codeLimitsOk(env: SimEnv, edits: Edit[]): boolean {
  const geo = edits.filter((e) => e.kind !== "strategy" && e.kind !== "evac_chairs" && e.kind !== "refuge");
  if (!geo.length) return true;
  const before = codeCheck(env.twin, env.model).items.filter((i) => i.status === "does_not_pass_on_paper").map((i) => i.id);
  const m = modelFor(env, { edits: geo });
  const after = codeCheck(m.twin, m).items.filter((i) => i.status === "does_not_pass_on_paper").map((i) => i.id);
  return after.every((id) => before.includes(id));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length)); };

export async function optimise(env: SimEnv, ev: Evaluator, o: { hazard: HazardKind; profile: ProfileId; seed?: number; adversaryBudget?: { population: number; generations: number; seeds: number }; archiveSize?: number; log?: (s: string) => void }): Promise<OptimiserResult> {
  const c = loadCosts();
  const advB = o.adversaryBudget ?? { population: env.runtime.design.adversary.population, generations: env.runtime.design.adversary.generations, seeds: env.runtime.design.adversary.seeds };
  const log = o.log ?? (() => {});
  let applied: Edit[] = [];
  let spent = 0;
  const first = await adversary(env, ev, { hazard: o.hazard, profile: o.profile, ...advB, freshSeeds: 6, explain: false, seed: o.seed ?? 1 });
  let archive = first.archive.slice(0, o.archiveSize ?? 4);
  const steps: OptimiserStep[] = [];
  const seeds = [901, 902, 903];
  const scoreLayout = async (edits: Edit[]) => {
    const res = await ev.map(archive.flatMap((a) => seeds.map((s) => ({ scenario: { ...a.scenario, seed: s, edits, protocol: edits.filter((e) => e.kind === "strategy").at(-1)?.protocol ?? a.scenario.protocol } }))));
    return res.map((r) => r.badness);
  };
  for (let step = 0; step < c.maxSteps; step++) {
    const base = await scoreLayout(applied);
    const cands = candidateEdits(env, o.hazard, applied, c).filter((e) => spent + c.costs[e.kind] <= c.budget);
    if (!cands.length) break;
    const scored: { e: Edit; imp: number; se: number; perCost: number; feasible: boolean; after: number }[] = [];
    for (const e of cands) {
      const edits = [...applied, e];
      const feasible = codeLimitsOk(env, edits);
      if (!feasible) { scored.push({ e, imp: 0, se: 0, perCost: -Infinity, feasible, after: mean(base) }); continue; }
      const s = await scoreLayout(edits);
      const diffs = s.map((v, i) => base[i]! - v);
      scored.push({ e, imp: mean(diffs), se: se(diffs), perCost: mean(diffs) / c.costs[e.kind], feasible, after: mean(s) });
    }
    scored.sort((a, b) => b.perCost - a.perCost);
    const best = scored.find((x) => x.feasible && x.imp > 2 * x.se && x.imp > 0);
    if (!best) { log(`step ${step + 1}: no edit improves the worst cases by more than 2 standard errors`); break; }
    applied = [...applied, best.e];
    spent += c.costs[best.e.kind];
    const adv = await adversary(env, ev, { hazard: o.hazard, profile: o.profile, edits: applied, population: Math.max(6, Math.round(advB.population / 2)), generations: Math.max(2, advB.generations - 2), seeds: advB.seeds, freshSeeds: 4, explain: false, warm: archive.map((a) => a.point), seed: (o.seed ?? 1) + step + 1 });
    const worstBefore = Math.round(mean(base) * 10) / 10, worstAfter = Math.round(best.after * 10) / 10;
    const tradeoffs = [`cost ${c.costs[best.e.kind]} units (illustrative)`, `${best.imp.toFixed(1)} ± ${(2 * best.se).toFixed(1)} badness improvement on the archived worst cases`];
    if (best.e.kind === "widen_corridor") tradeoffs.push(`about ${best.e.amount} ft of room depth along ${best.e.target} given up to the corridor`);
    if (best.e.kind === "strategy") tradeoffs.push("changes the response plan, not the building; needs staff training and announcements");
    tradeoffs.push(`new adversary worst case on the edited layout: badness ${adv.result.worst.badness}`);
    steps.push({ edit: best.e, label: editLabel(best.e), cost: c.costs[best.e.kind], feasible: true, worstBefore, worstAfter, accepted: true, tradeoffs });
    log(`step ${step + 1}: ${editLabel(best.e)} (${worstBefore} -> ${worstAfter})`);
    archive = [...archive, ...adv.archive].sort((a, b) => b.score - a.score).slice(0, o.archiveSize ?? 4);
  }
  const fresh = Array.from({ length: 8 }, (_, k) => 88000 + k);
  const attack = async (edits: Edit[]) => adversary(env, ev, { hazard: o.hazard, profile: o.profile, ...(edits.length ? { edits } : {}), ...advB, freshSeeds: fresh.length, explain: false, seed: (o.seed ?? 1) + 77 });
  const [origAdv, optAdv] = [await attack([]), await attack(applied)];
  const pool = [...origAdv.archive.slice(0, 3), ...optAdv.archive.slice(0, 3)].map((a) => a.scenario);
  const strategy = applied.filter((e) => e.kind === "strategy").at(-1)?.protocol;
  const worstOf = async (edits: Edit[]) => {
    const res = await ev.map(pool.flatMap((sc0) => fresh.map((s) => ({ scenario: { ...sc0, seed: s, edits, protocol: (edits.length ? strategy : undefined) ?? sc0.protocol } }))));
    const groups = pool.map((_, i) => res.slice(i * fresh.length, (i + 1) * fresh.length));
    return groups.reduce((w, g) => (mean(g.map((r) => r.badness)) > mean(w.map((r) => r.badness)) ? g : w));
  };
  const origRes = await worstOf([]);
  const optRes = await worstOf(applied);
  return {
    budget: c.budget, spent, costTable: "config/optimiser.costs.json (illustrative units, not estimates)", steps,
    original: outcome(origRes, "original layout: worst of the fresh attack pool (top 3 scenarios from attacks on both layouts), 8 fresh seeds"), optimised: outcome(optRes, "optimised layout: worst of the same attack pool, same 8 fresh seeds"),
    seeds: fresh, codeLimitsOk: codeLimitsOk(env, applied),
  };
}
