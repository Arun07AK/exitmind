import { optimise } from "../design/optimiser.ts";
import type { HazardKind, ProfileId } from "../sim/types.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined);
const hazard = (a.hazard ?? "fire") as HazardKind, profile = (a.profile ?? "college") as ProfileId;
const seeds = (a.seeds ?? a.seed ?? "1").split(",").map(Number);
const t0 = Date.now();
const runs = [];
for (const seed of seeds) {
  ledger("optimise", { hazard, profile, seeds, status: "running", seed });
  const r = await optimise(env, ev, { hazard, profile, seed, log: (s) => console.log(`seed ${seed} ${s}`) });
  runs.push({ seed, ...r });
  console.log(`seed ${seed}: spent ${r.spent}/${r.budget}; worst case original ${r.original.badness} -> optimised ${r.optimised.badness}; code limits ok: ${r.codeLimitsOk}`);
}
const best = runs.reduce((x, y) => (y.original.badness - y.optimised.badness > x.original.badness - x.optimised.badness ? y : x));
const path = writeJson(["data", "design", "optimiser.json"], { hazard, profile, ...best, perSeed: runs.map((r) => ({ seed: r.seed, original: r.original.badness, optimised: r.optimised.badness, spent: r.spent, steps: r.steps.map((s) => s.label), codeLimitsOk: r.codeLimitsOk })) });
ledger("optimise", { hazard, profile, seeds, status: "done", output: path, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`wrote ${path}`);
await ev.close();
