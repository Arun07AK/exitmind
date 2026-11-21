import { readFileSync } from "node:fs";
import type { EventRecord } from "../log/eventlog.ts";
import { verifyRecords } from "../log/eventlog.ts";
import { personaRecords } from "../policy/replay.ts";
import { runShowcase } from "../policy/showcase.ts";
import { loadEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import { loadDemoConfig, replayTruth } from "../live/session.ts";

const file = process.argv[2];
if (!file) { console.log("usage: npm run replay -- <log.jsonl>"); process.exit(2); }
const recs = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EventRecord);
const chain = verifyRecords(recs);
console.log(`hash chain: ${chain.ok ? `ok (${chain.count} records)` : `BROKEN at seq ${chain.seq}: ${chain.reason}`}`);
const simEnv = loadEnv();
const started = recs.find((r) => r.type === "session.started")?.payload as { mode: string; sessionId: string } | undefined;
const checkpoints = recs.filter((r) => r.type === "world.checkpoint");
if (started?.mode === "live") {
  const cfg = loadDemoConfig();
  let ok = 0, bad = 0;
  for (const cp of checkpoints) {
    const r = replayTruth(simEnv, recs, cfg, started.sessionId, cp.tick);
    if (r.hash === (cp.payload as { hash: string }).hash) ok++; else { bad++; console.log(`checkpoint at tick ${cp.tick}: MISMATCH`); }
  }
  console.log(`live session ${started.sessionId}: ${ok} checkpoints identical, ${bad} mismatched`);
  process.exit(bad ? 1 : 0);
}
const fin = checkpoints.find((r) => (r.payload as { final?: boolean }).final)?.payload as { hash: string; scenario: Scenario; livePersonas: number } | undefined;
if (!fin) { console.log("no final checkpoint in this log"); process.exit(2); }
const r = await runShowcase(simEnv, fin.scenario, { backend: "replay", livePersonas: fin.livePersonas, records: personaRecords(recs) });
console.log(`showcase replay: ${r.hash === fin.hash ? "IDENTICAL final state" : "MISMATCH"} (${r.llmCalls} LLM calls, ${r.records.length} persona decisions replayed)`);
process.exit(r.hash === fin.hash ? 0 : 1);
