import { z } from "zod";
import { ClaudeClient } from "../llm/claude.ts";
import { TypeSafeAdapter } from "../llm/typesafe.ts";
import { env, isOffline } from "../shared/env.ts";

if (isOffline()) { console.log("EXITMIND_OFFLINE=1 in .env: all LLM calls are disabled. Set it to 0 to check keys."); process.exit(2); }
let failed = 0;
const claude = new ClaudeClient();
if (!claude.available()) console.log("Anthropic: no ANTHROPIC_API_KEY in .env");
else for (const [role, name] of [["persona", env("PERSONA_HAIKU_MODEL") ?? "claude-haiku-5-5"], ["planner", env("PLANNER_MODEL") ?? "claude-sonnet-5-5"], ["liaison", env("LIAISON_MODEL") ?? "claude-haiku-5-5"]] as const) {
  try {
    const r = await claude.json({ role, model: name, system: "Reply with ok=true.", user: "ping", maxTokens: 20, timeoutMs: 20000, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, parse: z.object({ ok: z.boolean() }) });
    console.log(`Anthropic ${role} model ${name}: OK (${r.ok})`);
  } catch (e) { failed++; console.log(`Anthropic ${role} model ${name}: FAILED - ${String(e).slice(0, 200)}`); }
}
const ts = new TypeSafeAdapter();
if (!ts.available()) console.log("TypeSafe: no TYPESAFE_API_KEY in .env (optional; only needed for the Jev side of the bake-off)");
else {
  try {
    const r = await ts.choose({ model: env("JEV_MODEL") ?? "jev-1.14.0", state: { text: "A fire alarm sounds." }, instructions: "Does this describe an alarm?", criteria: { yes: "yes", no: "no" }, timeoutMs: 15000 });
    console.log(`TypeSafe ${env("JEV_MODEL") ?? "jev-1.14.0"}: OK (choice ${r.choice})`);
  } catch (e) { failed++; console.log(`TypeSafe: FAILED - ${String(e).slice(0, 200)}`); }
}
process.exit(failed ? 1 : 0);
