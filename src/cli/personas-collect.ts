import { EventLog } from "../log/eventlog.ts";
import { runShowcase, type Backend } from "../policy/showcase.ts";
import { env as envVar } from "../shared/env.ts";
import { loadEnv } from "../sim/run.ts";
import { prepareScenario } from "../design/prepare.ts";
import type { HazardKind, Scenario } from "../sim/types.ts";
import { args, ledger } from "./common.ts";
import { repoPath } from "../shared/paths.ts";
import { mkdirSync } from "node:fs";

const a = args();
const backend = (a.backend ?? envVar("PERSONA_BACKEND") ?? "haiku") as Exclude<Backend, "replay">;
const keyName = backend === "jev" ? "TYPESAFE_API_KEY" : "ANTHROPIC_API_KEY";
if (!envVar(keyName) || envVar("EXITMIND_OFFLINE") === "1") {
  console.log(`personas:collect skipped: ${keyName} is not set in .env (or EXITMIND_OFFLINE=1). No persona decisions were collected.`);
  process.exit(2);
}
const simEnv = loadEnv();
if (a.table) {
  mkdirSync(repoPath("data", "fixtures"), { recursive: true });
  for (const seed of [1, 2, 3, 4, 5]) {
    const sc: Scenario = { id: `table-${seed}`, profile: "college", hazard: { kind: "fire", floor: "F2", at: [55, 20] }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed, maxSec: 900 };
    const log = new EventLog({ path: repoPath("data", "fixtures", `table_hybrid_${seed}.jsonl`) });
    const r = await runShowcase(simEnv, sc, { backend, livePersonas: simEnv.runtime.showcase.livePersonas, log });
    console.log(`hybrid seed ${seed}: ${r.records.length} persona decisions, ${r.llmCalls} LLM calls, ${r.fallbacks} fallbacks, ${r.rejected} rejected`);
  }
  process.exit(0);
}
if (a.instructed) {
  mkdirSync(repoPath("data", "fixtures"), { recursive: true });
  const cases: [string, Scenario["hazard"], Scenario["protocol"]][] = [
    ["fire-evacuate", { kind: "fire", floor: "F2", at: [55, 20] }, "PHASED_EVACUATION"],
    ["quake-hold", { kind: "quake", damaged: ["ST-B"] }, "HOLD_THEN_EVACUATE"],
    ["threat-lockdown", { kind: "threat", floor: "F2", at: [55, 20], path: [[55, 20], [95, 38], [150, 38]] }, "LOCKDOWN_SHELTER"],
    ["fire-f1-phased", { kind: "fire", floor: "F1", at: [140, 15] }, "PHASED_EVACUATION"],
  ];
  for (const [i, [name, hazard, protocol]] of cases.entries()) {
    const { scenario } = prepareScenario(simEnv, { id: `collect-${backend}-instructed-${name}`, profile: "college", hazard, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol, seed: 600 + i, maxSec: 600 });
    const log = new EventLog({ path: repoPath("data", "fixtures", `showcase_${backend}_instructed_${name}.jsonl`) });
    const r = await runShowcase(simEnv, scenario, { backend, livePersonas: Number(a.personas ?? 24), log });
    console.log(`${scenario.id}: ${r.records.length} persona decisions, ${r.llmCalls} LLM calls, ${r.fallbacks} fallbacks, ${r.rejected} rejected`);
  }
  process.exit(0);
}
const runs = Number(a.runs ?? 6), personas = Number(a.personas ?? 24);
mkdirSync(repoPath("data", "fixtures"), { recursive: true });
const hazards: HazardKind[] = ["fire", "quake", "none"];
for (let i = 0; i < runs; i++) {
  const hazard = hazards[i % hazards.length]!;
  const sc: Scenario = { id: `collect-${backend}-${i}`, profile: "college", hazard: hazard === "fire" ? { kind: "fire", floor: "F2", at: [55, 20] } : hazard === "quake" ? { kind: "quake", damaged: [] } : { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed: 500 + i, maxSec: 600 };
  const log = new EventLog({ path: repoPath("data", "fixtures", `showcase_${backend}_${i}.jsonl`) });
  const t0 = Date.now();
  const r = await runShowcase(simEnv, sc, { backend, livePersonas: personas, log });
  console.log(`${sc.id}: ${r.records.length} persona decisions, ${r.llmCalls} LLM calls, ${r.fallbacks} fallbacks, ${r.rejected} rejected, ${Math.round((Date.now() - t0) / 1000)} s`);
  ledger("personas-collect", { backend, done: i + 1, runs });
}
