import { prepareScenario } from "../design/prepare.ts";
import { badness, BADNESS_FORMULA, loadEnv, makeWorld, runSync } from "../sim/run.ts";
import type { HazardKind, ProfileId, Protocol, Scenario } from "../sim/types.ts";
import { args } from "./common.ts";

const a = args();
const env = loadEnv();
const hazard = (a.hazard ?? "none") as HazardKind;
const sc: Scenario = {
  id: "cli", profile: (a.profile ?? "college") as ProfileId, protocol: (a.protocol ?? "EVACUATE") as Protocol, behaviour: {}, loadFactor: Number(a.load ?? 1), occupancy: (a.occupancy ?? "uniform") as Scenario["occupancy"],
  hazard: hazard === "fire" ? { kind: "fire", floor: (a.floor ?? "F2") as "F2", at: [Number(a.x ?? 55), Number(a.y ?? 20)] } : hazard === "quake" ? { kind: "quake", damaged: a.damaged ? a.damaged.split(",") : [] } : { kind: hazard },
  seed: Number(a.seed ?? 1), maxSec: Number(a.max ?? 900),
};
const { scenario, model } = prepareScenario(env, sc);
const t0 = performance.now();
const w = makeWorld(env, scenario, { model });
const m = runSync(w);
const ms = performance.now() - t0;
console.log(JSON.stringify({ occupants: m.occupants, clearance95Sec: m.clearance95Sec, clearanceAllSec: m.clearanceAllSec, remaining: m.remaining, remainingAtTarget: m.remainingAtTarget, gridlock: m.gridlock, exitUsage: m.exitUsage, flightEntries: m.flightEntries, densityDangerPS: m.densityDangerPS, smokeExposurePS: m.smokeExposurePS, decisions: m.decisions }, null, 1));
console.log(`badness ${badness(m, env.runtime)} (${BADNESS_FORMULA}); ${m.endSec} s simulated in ${ms.toFixed(0)} ms (${(m.endSec / (ms / 1000)).toFixed(0)}x real time)`);
