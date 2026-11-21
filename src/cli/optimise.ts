import { optimise } from "../design/optimiser.ts";
import type { HazardKind, ProfileId } from "../sim/types.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined);
const hazard = (a.hazard ?? "fire") as HazardKind, profile = (a.profile ?? "college") as ProfileId;
const t0 = Date.now();
ledger("optimise", { hazard, profile, status: "running" });
const r = await optimise(env, ev, { hazard, profile, seed: Number(a.seed ?? 1), log: (s) => console.log(s) });
const path = writeJson(["data", "design", "optimiser.json"], { hazard, profile, ...r });
ledger("optimise", { hazard, profile, status: "done", output: path, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`spent ${r.spent}/${r.budget}; worst case original ${r.original.badness} -> optimised ${r.optimised.badness}; code limits ok: ${r.codeLimitsOk}`);
console.log(`wrote ${path}`);
await ev.close();
