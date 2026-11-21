import { Rng } from "../shared/rng.ts";
import type { RuntimeConfig } from "../shared/runtime.ts";
import type { SimEnv } from "../sim/run.ts";
import type { Edit, HazardKind, ProfileId, Scenario } from "../sim/types.ts";
import type { AdversaryResult, Outcome, ScenarioRef } from "../server/contract.ts";
import type { EvalResult } from "./evaluate.ts";
import type { Evaluator } from "./pool.ts";
import { modelFor } from "./prepare.ts";
import { buildSpace, defaultPoint, describePoint, protocolFor, samplePoint, toScenario, type Point, type Space } from "./space.ts";

export interface AdversaryOptions {
  hazard: HazardKind;
  profile: ProfileId;
  edits?: Edit[];
  population?: number;
  generations?: number;
  seeds?: number;
  freshSeeds?: number;
  seed?: number;
  warm?: Point[];
  explain?: boolean;
  label?: string;
}

export interface Archived { point: Point; score: number; scenario: Scenario }

export interface AdversaryRun {
  result: AdversaryResult;
  archive: Archived[];
  space: Space;
  baselineFresh: number[];
  worstFresh: number[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

export function outcome(rs: EvalResult[], ref: string): Outcome {
  const avg = (f: (r: EvalResult) => number) => Math.round(mean(rs.map(f)) * 10) / 10;
  return {
    clearance95Sec: rs.every((r) => r.metrics.clearance95Sec !== null) ? avg((r) => r.metrics.clearance95Sec!) : null,
    remainingAtTarget: avg((r) => r.metrics.remainingAtTarget), densityDangerPS: avg((r) => r.metrics.densityDangerPS), smokeExposurePS: avg((r) => r.metrics.smokeExposurePS),
    gridlock: rs.some((r) => r.metrics.gridlock), badness: avg((r) => r.badness), ref,
  };
}

export async function adversary(env: SimEnv, ev: Evaluator, o: AdversaryOptions): Promise<AdversaryRun> {
  const rt: RuntimeConfig = env.runtime;
  const model = modelFor(env, { edits: o.edits ?? [] });
  const space = buildSpace(model, env.params, o.hazard, o.profile);
  const protocol = protocolFor(o.hazard, o.profile, Object.fromEntries(Object.entries(env.profiles).map(([k, v]) => [k, v.defaultProtocol])) as never);
  const P = o.population ?? rt.design.adversary.population, G = o.generations ?? rt.design.adversary.generations, S = o.seeds ?? rt.design.adversary.seeds;
  const elites = Math.max(2, Math.round(P / 4));
  const rng = Rng.stream(o.seed ?? 1, "adversary", o.hazard, o.profile, o.label ?? "");
  const maxSec = rt.design.capSec;
  const sc = (pt: Point, seed: number, id: string): Scenario => ({ ...toScenario(model, space, pt, seed, id, protocol, maxSec), ...(o.edits?.length ? { edits: o.edits } : {}) });
  let mu = defaultPoint(space).u.map(() => 0.5), sig = space.cont.map(() => 0.35);
  let probs = space.cat.map((d) => d.options.map(() => 1 / d.options.length));
  const archive: Archived[] = [];
  const history: AdversaryResult["history"] = [];
  let evaluations = 0;
  for (let g = 0; g < G; g++) {
    const seeds = Array.from({ length: S }, (_, k) => 1000 + g * 31 + k * 7 + (o.seed ?? 1));
    const pts: Point[] = Array.from({ length: P }, (_, i) => (g === 0 && o.warm && i < o.warm.length ? o.warm[i]! : samplePoint(space, mu, sig, probs, rng)));
    const tasks = pts.flatMap((pt, i) => seeds.map((s) => ({ scenario: sc(pt, s, `adv-${o.hazard}-${g}-${i}`) })));
    const res = await ev.map(tasks);
    evaluations += res.length;
    const scores = pts.map((_, i) => mean(res.slice(i * S, i * S + S).map((r) => r.badness)));
    const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    history.push({ generation: g, best: Math.round(order[0]![0] * 10) / 10, mean: Math.round(mean(scores) * 10) / 10 });
    for (const [s, i] of order.slice(0, elites)) archive.push({ point: pts[i]!, score: s, scenario: sc(pts[i]!, seeds[0]!, `adv-${o.hazard}-${g}-${i}`) });
    const el = order.slice(0, elites).map(([, i]) => pts[i]!);
    const a = 0.7;
    mu = mu.map((m, d) => a * mean(el.map((p) => p.u[d]!)) + (1 - a) * m);
    sig = sig.map((s0, d) => Math.max(0.05, a * sd(el.map((p) => p.u[d]!)) + (1 - a) * s0));
    probs = probs.map((pr, d) => pr.map((q, k) => a * (el.filter((p) => p.c[d] === k).length / el.length) + (1 - a) * q).map((q) => Math.max(q, 0.02)));
  }
  archive.sort((x, y) => y.score - x.score);
  const distinct: Archived[] = [];
  for (const x of archive) if (!distinct.some((d) => JSON.stringify(d.point.c) === JSON.stringify(x.point.c) && d.point.u.every((v, i) => Math.abs(v - x.point.u[i]!) < 0.08))) distinct.push(x);
  const top = distinct.slice(0, 10);
  const F = o.freshSeeds ?? 10;
  const fresh = Array.from({ length: F }, (_, k) => 50000 + k * 13 + (o.seed ?? 1));
  const base = defaultPoint(space);
  const [baseRes, worstRes] = await Promise.all([
    ev.map(fresh.map((s) => ({ scenario: sc(base, s, `baseline-${o.hazard}`) }))),
    ev.map(fresh.map((s) => ({ scenario: sc(top[0]!.point, s, `worst-${o.hazard}`) }))),
  ]);
  evaluations += baseRes.length + worstRes.length;
  const baselineFresh = baseRes.map((r) => r.badness), worstFresh = worstRes.map((r) => r.badness);
  const ref = (pt: Point, label: string, id: string): ScenarioRef => ({ id, label, scenario: sc(pt, fresh[0]!, id) });
  const explanation: string[] = [
    `Worst scenario badness ${mean(worstFresh).toFixed(1)} ± ${sd(worstFresh).toFixed(1)} vs default crowd ${mean(baselineFresh).toFixed(1)} ± ${sd(baselineFresh).toFixed(1)} on ${F} fresh seeds (difference ${(mean(worstFresh) - mean(baselineFresh)).toFixed(1)}).`,
  ];
  if (o.explain !== false) {
    const worst = top[0]!.point;
    const factors = [...space.cont.map((d, i) => ({ label: d.label, pt: { u: worst.u.map((v, j) => (j === i ? base.u[i]! : v)), c: worst.c } })), ...space.cat.map((d, i) => ({ label: d.label, pt: { u: worst.u, c: worst.c.map((v, j) => (j === i ? base.c[i]! : v)) } }))];
    const seeds3 = fresh.slice(0, 3);
    const fr = await ev.map(factors.flatMap((f) => seeds3.map((s) => ({ scenario: sc(f.pt, s, "explain") }))));
    evaluations += fr.length;
    const w3 = mean(worstFresh.slice(0, 3));
    const effects = factors.map((f, i) => ({ label: f.label, drop: w3 - mean(fr.slice(i * 3, i * 3 + 3).map((r) => r.badness)) })).sort((a, b) => b.drop - a.drop);
    for (const e of effects.slice(0, 4)) explanation.push(`Resetting "${e.label}" to its default changes badness by ${(-e.drop).toFixed(1)} (mean of 3 seeds).`);
    const wr = worstRes[0]!.metrics;
    const q = Object.entries(wr.portalQueuePS).sort((a, b) => b[1] - a[1])[0];
    if (q) explanation.push(`Longest queue in the worst run: ${q[0]} with ${q[1]} person-seconds of waiting.`);
    const tot = Object.values(wr.exitUsage).reduce((a, b) => a + b, 0) || 1;
    explanation.push(`Exit shares in the worst run: ${Object.entries(wr.exitUsage).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join(", ")}.`);
    explanation.push(...describePoint(space, worst).map((s) => `Worst scenario: ${s}`));
  }
  return {
    result: {
      layout: o.edits?.length ? `edited (${o.edits.length} edits)` : "as drawn",
      baseline: { ...outcome(baseRes, "baseline"), scenario: ref(base, "default crowd", `baseline-${o.hazard}-${o.profile}`) },
      worst: { ...outcome(worstRes, "worst"), scenario: ref(top[0]!.point, "adversary worst case", `worst-${o.hazard}-${o.profile}`) },
      explanation, history, evaluations, seeds: fresh,
    },
    archive: top, space, baselineFresh, worstFresh,
  };
}
