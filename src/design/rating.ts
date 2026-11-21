import type { SimEnv } from "../sim/run.ts";
import type { Edit, HazardKind, ProfileId } from "../sim/types.ts";
import type { RatingCell, RatingResult } from "../server/contract.ts";
import { adversary } from "./adversary.ts";
import { samplePoint } from "./space.ts";
import { Rng } from "../shared/rng.ts";
import { targetSec } from "../sim/run.ts";
import type { Evaluator } from "./pool.ts";

export const RATING_DISCLAIMER = "Decision support for professional safety review, not certification.";
export const RATING_CRITERION = "A scenario is survived when everyone is out or protected by the clearance target (set by the reviewer; EXITMIND default), no doorway suffers a flow collapse (crush), and there is no gridlock. Scenarios are a spread across the adversary's search, from mild to worst.";
export const stars = (frac: number): number => (frac >= 0.95 ? 5 : frac >= 0.85 ? 4 : frac >= 0.7 ? 3 : frac >= 0.5 ? 2 : frac >= 0.25 ? 1 : 0);

export async function rating(env: SimEnv, ev: Evaluator, o: { hazards: HazardKind[]; profiles: ProfileId[]; scenarios: number; edits?: Edit[]; onCell?: (c: RatingCell) => void }): Promise<RatingResult> {
  const cells: RatingCell[] = [];
  for (const hazard of o.hazards) for (const profile of o.profiles) {
    const target = targetSec(env.runtime, hazard);
    const adv = await adversary(env, ev, { hazard, profile, ...(o.edits ? { edits: o.edits } : {}), population: Math.max(12, o.scenarios), generations: 3, seeds: 1, freshSeeds: 2, explain: false, label: "rating" });
    const ranked: typeof adv.evaluated = [];
    for (const x of [...adv.evaluated].sort((a, b) => b.score - a.score)) {
      if (!ranked.some((d) => JSON.stringify(d.point.c) === JSON.stringify(x.point.c) && d.point.u.every((v, i) => Math.abs(v - x.point.u[i]!) < 0.05))) ranked.push(x);
    }
    const distinct = ranked.length <= o.scenarios ? ranked : Array.from({ length: o.scenarios }, (_, i) => ranked[Math.round((i * (ranked.length - 1)) / (o.scenarios - 1))]!);
    const rng = Rng.stream(70, "rating", hazard, profile);
    while (distinct.length < o.scenarios) distinct.push({ point: samplePoint(adv.space, adv.final.mu, adv.final.sig, adv.final.probs, rng), score: 0, scenario: adv.evaluated[0]!.scenario });
    const picked = distinct.map((d, i) => adv.toScenario(d.point, 70000 + i, `rate-${hazard}-${profile}-${i}`));
    const res = await ev.map(picked.map((scenario) => ({ scenario })));
    const breaking = res.map((r, i) => ({ r, s: picked[i]! })).filter(({ r }) => r.metrics.remainingAtTarget > 0 || r.metrics.crushSec > 0 || r.metrics.gridlock);
    const cell: RatingCell = { hazard, profile, survived: res.length - breaking.length, total: res.length, targetSec: target, breaking: breaking.slice(0, 10).map(({ s, r }) => ({ id: s.id, label: `${r.metrics.remainingAtTarget} not out by ${target} s${r.metrics.gridlock ? ", gridlock" : ""}${r.metrics.crushSec > 0 ? `, flow collapse at a doorway for ${r.metrics.crushSec} s` : ""}${r.metrics.densityDangerPS > 0 ? `, ${r.metrics.densityDangerPS} person-s above ${env.params.get("density.danger")} p/m²` : ""}`, scenario: s })) };
    cells.push(cell);
    o.onCell?.(cell);
  }
  return { layout: o.edits?.length ? `edited (${o.edits.length} edits)` : "as drawn", cells, disclaimer: RATING_DISCLAIMER, criterion: RATING_CRITERION };
}
