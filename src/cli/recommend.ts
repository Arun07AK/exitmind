import { recommend } from "../design/recommend.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const policy = a.policy === "distilled" ? "distilled" : "rule";
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined, policy);
const seeds = a.seeds ? a.seeds.split(",").map(Number) : undefined;
const t0 = Date.now();
ledger("recommend", { seeds: seeds ?? "optimiser.json seeds", policy, status: "running" });
const r = await recommend(env, ev, { ...(seeds ? { seeds } : {}), mode: policy, log: (s) => console.log(s) });
const path = writeJson(["data", "design", "recommend.json"], r);
const secs = Math.round((Date.now() - t0) / 100) / 10;
ledger("recommend", { seeds: r.seeds, policy, status: "done", output: path, runs: r.runs, seconds: secs });
const o = r.original;
console.log(`\n${r.scenario.label} (${r.scenario.id}), seeds ${r.seeds.join(",")}, target ${r.targetSec} s, ${r.runs} runs in ${secs} s`);
console.log(`original: out by target ${o.outByTarget.mean} of ${o.perSeed[0]!.occupants} (remaining ${o.perSeed.map((p) => p.remainingAtTarget).join(",")}), 95% clearance ${o.reached95.seeds}/${o.reached95.of}, danger ${o.densityDangerPS} person-s`);
for (const p of [...r.problems.exitShares, ...r.problems.density, r.problems.insideAtTarget]) console.log(`problem ${p.id}: ${p.text}`);
for (const x of r.recommendations) {
  if (!x.variant || !x.gain) { console.log(`${x.status.padEnd(10)} ${x.label}: ${x.reason}`); continue; }
  const v = x.variant;
  console.log(`${x.status.padEnd(10)} ${x.label}: out ${v.outByTarget.mean} (remaining ${v.perSeed.map((p) => p.remainingAtTarget).join(",")}), gain ${x.gain.mean} ± ${Math.round(2 * x.gain.se * 100) / 100}, 95% clearance ${v.reached95.seeds}/${v.reached95.of}${v.reached95.minSec !== null ? ` (${v.reached95.minSec}–${v.reached95.maxSec} s)` : ""}, danger ${v.densityDangerPS}; ${x.whatChanges}`);
}
console.log(`wrote ${path}`);
await ev.close();
