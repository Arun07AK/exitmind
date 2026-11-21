import type { SimEnv } from "../sim/run.ts";
import type { Edit, HazardKind, ProfileId } from "../sim/types.ts";
import type { RatingCell, RatingResult } from "../server/contract.ts";
import { adversary } from "./adversary.ts";
import type { Evaluator } from "./pool.ts";

export const RATING_DISCLAIMER = "Decision support for professional safety review, not certification.";
export const stars = (frac: number): number => (frac >= 0.95 ? 5 : frac >= 0.85 ? 4 : frac >= 0.7 ? 3 : frac >= 0.5 ? 2 : frac >= 0.25 ? 1 : 0);

export async function rating(env: SimEnv, ev: Evaluator, o: { hazards: HazardKind[]; profiles: ProfileId[]; scenarios: number; edits?: Edit[]; onCell?: (c: RatingCell) => void }): Promise<RatingResult> {
  const cells: RatingCell[] = [];
  const target = env.runtime.design.clearanceTargetSec;
  for (const hazard of o.hazards) for (const profile of o.profiles) {
    const adv = await adversary(env, ev, { hazard, profile, ...(o.edits ? { edits: o.edits } : {}), population: Math.max(8, Math.ceil(o.scenarios / 2)), generations: 3, seeds: 1, freshSeeds: 2, explain: false, label: "rating" });
    const pool = adv.archive.length >= o.scenarios ? adv.archive : adv.archive;
    const picked = pool.slice(0, o.scenarios).map((a, i) => ({ ...a.scenario, id: `rate-${hazard}-${profile}-${i}`, seed: 70000 + i }));
    const extra = o.scenarios - picked.length;
    for (let k = 0; k < extra; k++) picked.push({ ...pool[k % pool.length]!.scenario, id: `rate-${hazard}-${profile}-${picked.length}`, seed: 71000 + k });
    const res = await ev.map(picked.map((scenario) => ({ scenario })));
    const breaking = res.map((r, i) => ({ r, s: picked[i]! })).filter(({ r }) => r.metrics.remainingAtTarget > 0 || r.metrics.densityDangerPS > 0 || r.metrics.gridlock || (hazard === "threat" && r.metrics.threatExposurePS > 0));
    const cell: RatingCell = { hazard, profile, survived: res.length - breaking.length, total: res.length, targetSec: target, breaking: breaking.slice(0, 10).map(({ s, r }) => ({ id: s.id, label: `${r.metrics.remainingAtTarget} not out by ${target} s${r.metrics.gridlock ? ", gridlock" : ""}${r.metrics.densityDangerPS > 0 ? `, ${r.metrics.densityDangerPS} person-s above ${env.params.get("density.danger")} p/m²` : ""}`, scenario: s })) };
    cells.push(cell);
    o.onCell?.(cell);
  }
  return { layout: o.edits?.length ? `edited (${o.edits.length} edits)` : "as drawn", cells, disclaimer: RATING_DISCLAIMER };
}
