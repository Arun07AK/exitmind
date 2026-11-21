import { loadEnv, makeWorld, runSync, type SimEnv } from "../../src/sim/run.ts";
import type { Scenario } from "../../src/sim/types.ts";
import type { Twin } from "../../src/twin/schema.ts";

export function scenario(over: Partial<Scenario> = {}): Scenario {
  return { id: "test", profile: "college", hazard: { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed: 1, maxSec: 900, ...over };
}

export function envFor(twin: Twin): SimEnv {
  return loadEnv(twin);
}

export function exitTimes(env: SimEnv, sc: Scenario): { times: number[]; world: ReturnType<typeof makeWorld> } {
  const w = makeWorld(env, sc);
  const times: number[] = [];
  let last = 0;
  runSync(w, (ww) => {
    const s = ww.metrics.exitUsage.reduce((a, b) => a + b, 0);
    for (let k = last; k < s; k++) times.push(ww.tSec);
    last = s;
  }, 1);
  return { times, world: w };
}

export function steadyFlow(times: number[]): number {
  const s = [...times].sort((a, b) => a - b);
  const i10 = Math.floor(s.length * 0.1), i90 = Math.floor(s.length * 0.9);
  return (i90 - i10) / (s[i90]! - s[i10]!);
}
