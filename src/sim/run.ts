import { createHash } from "node:crypto";
import { loadParams, type Params } from "../shared/params.ts";
import { repoPath } from "../shared/paths.ts";
import { loadRuntime, type RuntimeConfig } from "../shared/runtime.ts";
import { loadTwin } from "../twin/build.ts";
import type { Twin } from "../twin/schema.ts";
import { RulePolicy } from "../policy/rule.ts";
import type { DecisionPolicy } from "../policy/types.ts";
import { buildModel, type Model } from "./model.ts";
import { loadProfiles, type Profiles } from "./population.ts";
import type { Scenario } from "./types.ts";
import { World, type RunMetrics, type WorldHooks } from "./world.ts";

export interface SimEnv {
  twin: Twin;
  model: Model;
  params: Params;
  hazardParams: Params;
  profiles: Profiles;
  runtime: RuntimeConfig;
}

const modelCache = new Map<string, Model>();

export function loadEnv(twin: Twin = loadTwin()): SimEnv {
  let model = modelCache.get(twin.hash);
  if (!model) { model = buildModel(twin); modelCache.set(twin.hash, model); }
  return { twin, model, params: loadParams(), hazardParams: loadParams(repoPath("config", "hazards.json")), profiles: loadProfiles(), runtime: loadRuntime() };
}

export interface MakeWorldOptions {
  distilled?: DecisionPolicy;
  llm?: DecisionPolicy;
  llmAgents?: number;
  bulkPolicy?: "rule" | "distilled";
  hooks?: WorldHooks;
  model?: Model;
  idle?: boolean;
}

export function makeWorld(env: SimEnv, sc: Scenario, o: MakeWorldOptions = {}): World {
  let w!: World;
  const rule = new RulePolicy(env.params, (a) => ({ speedMps: w.vFree[a]!, stress: w.stress[a]!, staff: w.isStaff(a), groupFollower: !!w.followGroup[a] }));
  w = new World(o.model ?? env.model, sc, env.params, env.hazardParams, env.profiles, {
    policies: { rule, ...(o.distilled ? { distilled: o.distilled } : {}), ...(o.llm ? { llm: o.llm } : {}) },
    ...(o.llmAgents ? { llmAgents: o.llmAgents } : {}),
    bulkPolicy: o.bulkPolicy ?? "rule",
    ...(o.hooks ? { hooks: o.hooks } : {}),
    ...(o.idle ? { idle: true } : {}),
    thinkTicks: [env.runtime.showcase.thinkingTicksMin, env.runtime.showcase.thinkingTicksMax],
  }, env.runtime.sim.dtSec);
  w.targetTick = Math.round(((sc.hazard.startSec ?? 0) + env.runtime.design.clearanceTargetSec) / env.runtime.sim.dtSec);
  return w;
}

export function runSync(w: World, onFrame?: (w: World) => void, every = 4): RunMetrics {
  while (!w.done) {
    if (w.dueUnresolved().length) throw new Error("runSync cannot wait for asynchronous decisions; use runAsync");
    w.step();
    if (onFrame && w.tick % every === 0) onFrame(w);
  }
  return w.summary();
}

export async function runAsync(w: World, deadlineMs: number, onFrame?: (w: World) => void | Promise<void>, every = 4): Promise<RunMetrics> {
  while (!w.done) {
    const due = w.dueUnresolved();
    if (due.length) {
      await Promise.race([
        Promise.allSettled(due.map((q) => q.promise)),
        new Promise((r) => setTimeout(r, deadlineMs)),
      ]);
      await new Promise((r) => setImmediate(r));
    }
    w.step();
    if (onFrame && w.tick % every === 0) await onFrame(w);
  }
  return w.summary();
}

export function stateHash(w: World): string {
  const h = createHash("sha256");
  h.update(`${w.tick}|${w.n}|`);
  for (const arr of [w.floor, w.cell, w.state, w.target, w.stairPos, w.stress, w.protectedAt]) h.update(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  for (const s of w.hz.smoke) h.update(new Uint8Array(s.buffer, s.byteOffset, s.byteLength));
  h.update(JSON.stringify(w.signs));
  return h.digest("hex");
}

export function badness(mt: RunMetrics, rt: RuntimeConfig): number {
  const { capSec, badness: b, clearanceTargetSec } = rt.design;
  const c95 = Math.min(mt.clearance95Sec ?? capSec, capSec);
  const remainingAtTarget = mt.remainingAtTarget ?? mt.remaining;
  void clearanceTargetSec;
  return Math.round((c95 + b.w1 * mt.densityDangerPS + b.w2 * mt.smokeExposurePS + b.w3 * remainingAtTarget) * 100) / 100;
}

export const BADNESS_FORMULA = "badness = min(clearance95, cap) + w1·densityDangerPS + w2·smokeExposurePS + w3·remainingAtTarget";
