import { readdirSync, readFileSync } from "node:fs";
import { chosenSignature, distill } from "../policy/distilled.ts";
import type { PersonaDecisionRecord } from "../policy/replay.ts";
import { repoPath } from "../shared/paths.ts";
import { writeJson } from "./common.ts";

const dir = repoPath("data", "fixtures");
let files: string[] = [];
try { files = readdirSync(dir).filter((f) => f.startsWith("showcase_") && f.endsWith(".jsonl")); } catch { /* none */ }
const recs: PersonaDecisionRecord[] = [];
for (const f of files) for (const line of readFileSync(`${dir}/${f}`, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as { type: string; payload: PersonaDecisionRecord };
  if (r.type === "persona.decision" && r.payload.source.startsWith("llm:")) recs.push(r.payload);
}
if (!recs.length) {
  console.log("distill: no LLM persona decisions found in data/fixtures/showcase_*.jsonl; run `npm run personas:collect` first (needs an API key). No policy written.");
  process.exit(2);
}
const backends = [...new Set(recs.map((r) => r.source))].join(",");
const table = distill(recs.map((r) => ({ key: r.key, options: r.options, chosen: chosenSignature(r) })), { logs: files, decisions: recs.length, backend: backends, createdFrom: new Date().toISOString().slice(0, 10) });
const p = writeJson(["data", "policy", "distilled.policy.json"], table);
console.log(`distilled ${recs.length} decisions from ${files.length} logs (${backends}) into ${Object.keys(table.table).length} situation rows -> ${p}`);
