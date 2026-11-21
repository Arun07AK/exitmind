import { EventLog } from "../log/eventlog.ts";
import { runShowcase, type Backend } from "../policy/showcase.ts";
import { env as envVar } from "../shared/env.ts";
import { loadEnv } from "../sim/run.ts";
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
