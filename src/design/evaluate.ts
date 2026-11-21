import { DistilledPolicy } from "../policy/distilled.ts";
import { badness, makeWorld, runSync, stateHash, type SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import type { RunMetrics } from "../sim/world.ts";
import { prepareScenario } from "./prepare.ts";
import { stopwatch } from "../log/clock.ts";

export interface EvalTask {
  scenario: Scenario;
  mode?: "rule" | "distilled";
  dangerCells?: boolean;
}
export interface EvalResult {
  id: string;
  seed: number;
  metrics: RunMetrics;
  badness: number;
  hash: string;
  ms: number;
  dangerCells?: number[][];
}

let distilled: DistilledPolicy | null | undefined;
function distilledPolicy(): DistilledPolicy | null {
  if (distilled === undefined) { try { distilled = DistilledPolicy.load(); } catch { distilled = null; } }
  return distilled;
}

export function evaluate(env: SimEnv, t: EvalTask): EvalResult {
  const elapsed = stopwatch();
  const { scenario, model } = prepareScenario(env, t.scenario);
  const d = t.mode === "distilled" ? distilledPolicy() : null;
  const w = makeWorld(env, scenario, { model, ...(d ? { distilled: d, bulkPolicy: "distilled" as const } : {}) });
  const metrics = runSync(w);
  const out: EvalResult = { id: scenario.id, seed: scenario.seed, metrics, badness: badness(metrics, env.runtime), hash: stateHash(w), ms: elapsed() };
  if (t.dangerCells) out.dangerCells = w.metrics.dangerCells.map((f) => Array.from(f, (v) => Math.round(v * 100) / 100));
  return out;
}
