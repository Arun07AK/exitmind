import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { DistilledPolicy } from "../policy/distilled.ts";
import { personaRecords } from "../policy/replay.ts";
import { runShowcase } from "../policy/showcase.ts";
import { repoPath } from "../shared/paths.ts";
import { badness, loadEnv, makeWorld, runSync } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import type { EventRecord } from "../log/eventlog.ts";

const simEnv = loadEnv();
const seeds = [1, 2, 3, 4, 5];
const sc = (seed: number): Scenario => ({ id: `table-${seed}`, profile: "college", hazard: { kind: "fire", floor: "F2", at: [55, 20] }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed, maxSec: 900 });
let distilled: DistilledPolicy | null = null;
try { distilled = DistilledPolicy.load(); } catch { /* none */ }
const row = (label: string, m: ReturnType<typeof runSync>) => `| ${label} | ${m.clearance95Sec ?? "not reached"} | ${m.remainingAtTarget} | ${m.densityDangerPS} | ${m.smokeExposurePS} | ${m.gridlock} | ${badness(m, simEnv.runtime)} |`;
const lines = ["# Results table: rule-only vs hybrid vs distilled", "", `Scenario: college profile, fire on F2 at (55, 20) ft, printed occupant load, seeds ${seeds.join(", ")}. Persona behaviour is modelled, not validated against real evacuations.`, "", "| Run | clearance95 (s) | not out at target | density-danger person-s | smoke exposure person-s | gridlock | badness |", "|---|---|---|---|---|---|---|"];
const logs = (() => { try { return readdirSync(repoPath("data", "fixtures")).filter((f) => f.startsWith("table_hybrid_") && f.endsWith(".jsonl")); } catch { return []; } })();
for (const seed of seeds) {
  const w = makeWorld(simEnv, sc(seed));
  lines.push(row(`rule-only, seed ${seed}`, runSync(w)));
  if (distilled) { const d = makeWorld(simEnv, sc(seed), { distilled, bulkPolicy: "distilled" }); lines.push(row(`distilled, seed ${seed}`, runSync(d))); }
  else lines.push(`| distilled, seed ${seed} | not run: no data/policy/distilled.policy.json (needs persona logs) | | | | | |`);
  const log = logs.find((f) => f === `table_hybrid_${seed}.jsonl`);
  if (log) {
    const recs = readFileSync(repoPath("data", "fixtures", log), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EventRecord);
    const r = await runShowcase(simEnv, sc(seed), { backend: "replay", livePersonas: simEnv.runtime.showcase.livePersonas, records: personaRecords(recs), ...(distilled ? { distilled } : {}) });
    lines.push(row(`hybrid (${simEnv.runtime.showcase.livePersonas} personas, replayed), seed ${seed}`, r.metrics));
  } else lines.push(`| hybrid, seed ${seed} | not run: no recorded showcase log data/fixtures/table_hybrid_${seed}.jsonl (needs an API key) | | | | | |`);
}
writeFileSync(repoPath("docs", "verification", "results-table.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
