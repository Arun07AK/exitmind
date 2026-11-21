import type { Evaluator } from "../design/pool.ts";
import type { EvalResult } from "../design/evaluate.ts";
import type { Model } from "../sim/model.ts";
import type { HazardSpec, ProfileId, Protocol, RoutePolicy, Scenario } from "../sim/types.ts";
import type { RuntimeConfig } from "../shared/runtime.ts";
import type { Estimate, Outcome } from "../server/contract.ts";
import { stopwatch } from "../log/clock.ts";
import { targetSec } from "../sim/run.ts";
import { damagedFromEstimate } from "./sentinel.ts";

export const WORST_CASE_BEHAVIOUR = (profile: ProfileId): Record<string, number> => ({
  "sign.compliance.base": 0.5,
  [`profile.${profile}.familiarShare`]: 0,
  "announce.reachShare": 0.3,
  "stress.gain.hazard": 0.4,
});

export interface VerifyInput {
  model: Model;
  estimate: Estimate;
  profile: ProfileId;
  elapsedSinceHazardSec: number;
  protocol: Protocol;
  policy: RoutePolicy;
  seed: number;
  runtime: RuntimeConfig;
  baseBehaviour?: Record<string, number>;
}

export interface VerifyResult {
  verdict: "PASS" | "FAIL";
  predicted: Outcome;
  worstCase: Outcome & { scenario: string };
  doNothing: Outcome;
  reasons: string[];
  runs: number;
  ms: number;
  worstScenario: Scenario;
}

export function estimateHazard(m: Model, e: Estimate, elapsedSec: number): HazardSpec {
  if (e.hazard === "fire" && e.zone) {
    const z = m.zones[m.zoneIndex.get(e.zone)!]!;
    const fm = m.floors.find((f) => f.id === z.floor)!;
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.zone[i] === m.zoneIndex.get(e.zone)) { sx += fm.cx[i]!; sy += fm.cy[i]!; k++; }
    return { kind: "fire", floor: z.floor, at: [sx / Math.max(1, k), sy / Math.max(1, k)], startSec: -Math.round(elapsedSec) };
  }
  if (e.hazard === "quake") return { kind: "quake", damaged: damagedFromEstimate(e), startSec: -Math.round(elapsedSec) };
  return { kind: e.hazard };
}

export function outcomeOf(rs: EvalResult[], runtime: RuntimeConfig, ref: string): Outcome {
  const mean = (f: (r: EvalResult) => number) => Math.round((rs.reduce((a, r) => a + f(r), 0) / rs.length) * 10) / 10;
  const c95 = rs.map((r) => r.metrics.clearance95Sec);
  return {
    clearance95Sec: c95.every((c) => c !== null) ? mean((r) => r.metrics.clearance95Sec!) : null,
    remainingAtTarget: mean((r) => r.metrics.remainingAtTarget),
    densityDangerPS: mean((r) => r.metrics.densityDangerPS),
    smokeExposurePS: mean((r) => r.metrics.smokeExposurePS),
    gridlock: rs.some((r) => r.metrics.gridlock),
    badness: mean((r) => r.badness),
    ref,
  };
  void runtime;
}

export async function verify(ev: Evaluator, inp: VerifyInput, ref: string): Promise<VerifyResult> {
  const elapsedMs = stopwatch();
  const hazard = estimateHazard(inp.model, inp.estimate, inp.elapsedSinceHazardSec);
  const zoneCounts: Record<string, number> = {};
  for (const [z, c] of Object.entries(inp.estimate.countsByZone)) zoneCounts[z] = Math.max(0, Math.round(c.value));
  const horizon = inp.runtime.live.verifierHorizonSec;
  const base = (id: string, seed: number, extra: Partial<Scenario>): Scenario => ({
    id, profile: inp.profile, hazard, behaviour: { ...(inp.baseBehaviour ?? {}), [`premove.medianSec.${inp.profile}`]: 15 }, loadFactor: 1, occupancy: "uniform",
    protocol: inp.protocol, zoneCounts, seed, maxSec: horizon, ...extra,
  });
  const seeds = [inp.seed, inp.seed + 1, inp.seed + 2];
  const planTasks = seeds.map((s) => ({ scenario: base(`verify-plan-${s}`, s, { routePolicy: inp.policy }) }));
  const nothingTasks = seeds.map((s) => ({ scenario: base(`verify-nothing-${s}`, s, { protocol: "EVACUATE", routePolicy: { zones: [], closedRoutes: [], inflowClosed: [] } }) }));
  const worstTasks = seeds.map((s) => ({ scenario: base(`verify-worst-${s}`, s, { routePolicy: inp.policy, behaviour: { ...(inp.baseBehaviour ?? {}), [`premove.medianSec.${inp.profile}`]: 15, ...WORST_CASE_BEHAVIOUR(inp.profile) } }) }));
  const res = await ev.map([...planTasks, ...nothingTasks, ...worstTasks]);
  const plan = res.slice(0, 3), nothing = res.slice(3, 6), worst = res.slice(6, 9);
  const predicted = outcomeOf(plan, inp.runtime, `${ref}#plan`), doNothing = outcomeOf(nothing, inp.runtime, `${ref}#do-nothing`);
  const worstIdx = worst.reduce((bi, r, i) => (r.badness > worst[bi]!.badness ? i : bi), 0);
  const worstRun = worst[worstIdx]!;
  const worstCase = { ...outcomeOf([worstRun], inp.runtime, `${ref}#worst`), scenario: `${worstRun.id}: low sign compliance, nobody familiar, 30% announcement reach, high hazard stress` };
  const reasons: string[] = [];
  const holdProtocol = inp.protocol === "LOCKDOWN_SHELTER" || inp.protocol === "HORIZONTAL_EVACUATION";
  if (predicted.gridlock) reasons.push(`gridlock in ${plan.filter((r) => r.metrics.gridlock).length} of ${plan.length} roll-forwards: people remain and no exit passes anyone for 60 s`);
  if (worstCase.gridlock) reasons.push("gridlock in the adversarial worst case");
  const remainingPlan = predicted.remainingAtTarget;
  if (!holdProtocol && remainingPlan > 0) reasons.push(`${remainingPlan} people (mean of 3 seeds) not yet out at the ${targetSec(inp.runtime, hazard.kind)} s clearance target (${hazard.kind})`);
  const diffs = plan.map((r, i) => r.badness - nothing[i]!.badness);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const se = Math.sqrt(diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / Math.max(1, diffs.length - 1) / diffs.length);
  const worse = meanDiff > doNothing.badness * 0.05 + 1 && meanDiff > 2 * se;
  if (worse) reasons.push(`worse than doing nothing (badness ${predicted.badness} vs ${doNothing.badness}; paired difference ${meanDiff.toFixed(1)} ± ${(2 * se).toFixed(1)} over ${diffs.length} seeds)`);
  else if (meanDiff > 0) reasons.push(`not clearly better than doing nothing (badness ${predicted.badness} vs ${doNothing.badness}; the difference is within seed-to-seed noise)`);
  const verdict = predicted.gridlock || worstCase.gridlock || worse ? "FAIL" : "PASS";
  if (verdict === "PASS") reasons.unshift(`no gridlock in ${plan.length + worst.length} roll-forwards; badness ${predicted.badness} vs do-nothing ${doNothing.badness}`);
  return { verdict, predicted, worstCase, doNothing, reasons, runs: res.length, ms: elapsedMs(), worstScenario: worstTasks[worstIdx]!.scenario };
}
