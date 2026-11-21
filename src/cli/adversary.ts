import { adversary } from "../design/adversary.ts";
import type { HazardKind, ProfileId } from "../sim/types.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined);
const hazard = (a.hazard ?? "fire") as HazardKind, profile = (a.profile ?? "college") as ProfileId;
const seeds = (a.seeds ?? "1").split(",").map(Number);
const t0 = Date.now();
const runs = [];
for (const seed of seeds) {
  ledger("adversary", { hazard, profile, seed, status: "running" });
  const r = await adversary(env, ev, { hazard, profile, seed });
  runs.push(r);
  console.log(`seed ${seed}: default crowd ${r.result.baseline.badness}, worst ${r.result.worst.badness} (${r.result.evaluations} runs)`);
}
const best = runs.reduce((x, y) => (y.result.worst.badness > x.result.worst.badness ? y : x));
const path = writeJson(["data", "design", "adversary.json"], { ...best.result, seedsRun: seeds, perSeed: runs.map((r, i) => ({ seed: seeds[i], baseline: r.result.baseline.badness, worst: r.result.worst.badness, baselineFresh: r.baselineFresh, worstFresh: r.worstFresh })) });
ledger("adversary", { hazard, profile, seeds, status: "done", output: path, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(best.result.explanation.join("\n"));
console.log(`wrote ${path} in ${Math.round((Date.now() - t0) / 1000)} s`);
await ev.close();
