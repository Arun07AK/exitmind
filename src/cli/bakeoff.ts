import { writeFileSync } from "node:fs";
import { ClaudeClient } from "../llm/claude.ts";
import { TypeSafeAdapter } from "../llm/typesafe.ts";
import { HaikuPersona, JevPersona } from "../policy/personas.ts";
import { signature, type DecisionContext } from "../policy/types.ts";
import { env as envVar } from "../shared/env.ts";
import { repoPath } from "../shared/paths.ts";
import { Rng } from "../shared/rng.ts";
import { loadEnv, makeWorld, runSync } from "../sim/run.ts";
import { args, writeJson } from "./common.ts";

const a = args();
const simEnv = loadEnv();
const n = Number(a.points ?? 40);
const ctxs: DecisionContext[] = [];
const seen = new Map<string, number>();
for (const [i, hazard] of (["fire", "quake", "none"] as const).entries()) {
  const w = makeWorld(simEnv, { id: `bakeoff-${hazard}`, profile: "college", hazard: hazard === "fire" ? { kind: "fire", floor: "F2", at: [55, 20] } : hazard === "quake" ? { kind: "quake", damaged: [] } : { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed: 900 + i, maxSec: 600 }, {
    hooks: { onDecision: (ctx) => { const k = `${ctx.key}#${ctx.options.length}`; if ((seen.get(k) ?? 0) < 2 && ctx.options.length > 2) { seen.set(k, (seen.get(k) ?? 0) + 1); ctxs.push(JSON.parse(JSON.stringify(ctx)) as DecisionContext); } } },
  });
  runSync(w);
}
const points = Rng.stream(1, "bakeoff").shuffled(ctxs).slice(0, n);
writeJson(["data", "fixtures", "decision_points.json"], points);
const rt = simEnv.runtime;
const haiku = new ClaudeClient(), jev = new TypeSafeAdapter();
const lines = [`# Persona backend bake-off (O3)`, "", `Decision points: ${points.length} (from rule-based runs on Rinker Hall: fire, earthquake, drill), saved to data/fixtures/decision_points.json.`, ""];
const status = { haiku: haiku.available() ? "run" : `not run (${envVar("EXITMIND_OFFLINE") === "1" ? "offline" : "ANTHROPIC_API_KEY missing"})`, jev: jev.available() ? "run" : `not run (${envVar("EXITMIND_OFFLINE") === "1" ? "offline" : "TYPESAFE_API_KEY missing"})` };
lines.push(`| Backend | Status |`, `|---|---|`, `| Claude Haiku (${envVar("PERSONA_HAIKU_MODEL") ?? "claude-haiku-5-5"}) | ${status.haiku} |`, `| TypeSafe Jev (${envVar("JEV_MODEL") ?? "jev-1.14.0"}) | ${status.jev} |`, "");
type R = { sig: string; ms: number; valid: boolean } | null;
const results: Record<string, R[]> = {};
for (const [name, pol] of [["haiku", haiku.available() ? new HaikuPersona(haiku, envVar("PERSONA_HAIKU_MODEL") ?? "claude-haiku-5-5", rt.persona.deadlineMs * 2, 4) : null], ["jev", jev.available() ? new JevPersona(jev, envVar("JEV_MODEL") ?? "jev-1.14.0", rt.persona.jevTimeoutMs * 2, 4) : null]] as const) {
  if (!pol) continue;
  results[name] = await Promise.all(points.map(async (ctx, i) => {
    try {
      const d = await pol.decide(ctx, Rng.stream(i, "bakeoff-decide"));
      const o = ctx.options.find((x) => x.id === d.optionId);
      return { sig: o ? signature(o) : "INVALID", ms: d.latencyMs ?? 0, valid: !!o };
    } catch { return null; }
  }));
}
for (const [name, rs] of Object.entries(results)) {
  const ok = rs.filter((r): r is NonNullable<R> => !!r);
  const ms = ok.map((r) => r.ms).sort((x, y) => x - y);
  lines.push(`## ${name}`, "", `- answered: ${ok.length}/${rs.length}; valid option ids: ${ok.filter((r) => r.valid).length}`, `- latency median ${ms[Math.floor(ms.length / 2)] ?? "n/a"} ms, p90 ${ms[Math.floor(ms.length * 0.9)] ?? "n/a"} ms`, "");
}
if (results.haiku && results.jev) {
  const agree = points.filter((_, i) => results.haiku![i] && results.jev![i] && results.haiku![i]!.sig === results.jev![i]!.sig).length;
  lines.push(`Agreement on the chosen option role: ${agree}/${points.length}.`, "", "Decision for O3 is Arun's; this table is the evidence.");
} else lines.push("The side-by-side comparison could not run because at least one provider key is missing. The adapters are tested against stubs in tests/acceptance/personas.test.ts.");
writeFileSync(repoPath("docs", "verification", "bakeoff.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
