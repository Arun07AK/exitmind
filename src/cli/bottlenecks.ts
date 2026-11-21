import { bottlenecks } from "../design/bottleneck.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined);
const runs = Number(a.runs ?? env.runtime.design.bulkRuns);
const t0 = Date.now();
ledger("bottlenecks", { runs, status: "running" });
const r = await bottlenecks(env, ev, { runs });
const path = writeJson(["data", "design", "bottlenecks.json"], r);
const secs = (Date.now() - t0) / 1000;
ledger("bottlenecks", { runs, status: "done", output: path, seconds: secs });
console.log(`${r.runs} runs in ${secs.toFixed(1)} s (${(secs / r.runs * 1000).toFixed(0)} ms per run across ${ev.size} workers)`);
for (const h of r.hotspots.slice(0, 8)) console.log(`#${h.rank} ${h.label}: ${h.queuePS} queue person-s/run, ${h.dangerPS} danger person-s/run`);
for (const e of r.exits) console.log(`${e.id}: share ${(e.share * 100).toFixed(1)}% ${e.status} — ${e.label}`);
console.log(`wrote ${path}`);
await ev.close();
