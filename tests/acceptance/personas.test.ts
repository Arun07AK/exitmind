import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/log/eventlog.ts";
import { DistilledPolicy, distill, tvd } from "../../src/policy/distilled.ts";
import { personaRecords } from "../../src/policy/replay.ts";
import { runShowcase } from "../../src/policy/showcase.ts";
import { ACTIONS, signature } from "../../src/policy/types.ts";
import { Rng } from "../../src/shared/rng.ts";
import { makeWorld, runSync } from "../../src/sim/run.ts";
import { twoFloorStair } from "../../src/twin/synthetic.ts";
import { envFor, scenario } from "../helpers/sim.ts";
import { StubClaude, StubTypeSafe } from "../helpers/stubs.ts";

const env = envFor(twoFloorStair());
const sc = (seed = 3) => scenario({ zoneCounts: { Z2N: 80, Z1N: 30 }, seed });

describe("LLM persona agents (stubbed providers; no network)", () => {
  it("never applies an action outside the typed set; invalid output is rejected, logged, and falls back", async () => {
    const log = new EventLog();
    const claude = new StubClaude("invalid-sometimes");
    const r = await runShowcase(env, sc(), { backend: "haiku", livePersonas: 12, claude, log });
    expect(claude.calls).toBeGreaterThan(0);
    const rejected = log.query({ type: "persona.decision.rejected" });
    expect(rejected.length).toBeGreaterThan(0);
    for (const e of rejected) expect((e.payload as { allowed: string[] }).allowed).not.toContain((e.payload as { raw: { optionId: string } }).raw.optionId);
    for (const rec of r.records) {
      expect(rec.options.map((o) => o.id)).toContain(rec.optionId);
      expect(ACTIONS).toContain(rec.options.find((o) => o.id === rec.optionId)!.action);
    }
    expect(r.records.some((x) => x.source.startsWith("fallback"))).toBe(true);
    expect(r.metrics.remaining).toBe(0);
    expect(r.label).toBe("modelled behaviour, not validated against real evacuations");
  });

  it("keeps running when the persona LLM is down: every persona decision falls back", async () => {
    const r = await runShowcase(env, sc(), { backend: "haiku", livePersonas: 12, claude: new StubClaude("down") });
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records.every((x) => x.source.startsWith("fallback"))).toBe(true);
    expect(r.metrics.remaining).toBe(0);
  });

  it("a showcase run replays from its log to the identical final state with zero LLM calls", async () => {
    const log = new EventLog();
    const live = await runShowcase(env, sc(5), { backend: "haiku", livePersonas: 12, claude: new StubClaude("sensible"), log });
    const replay = await runShowcase(env, sc(5), { backend: "replay", livePersonas: 12, records: personaRecords(log) });
    expect(replay.llmCalls).toBe(0);
    expect(replay.hash).toBe(live.hash);
    expect(replay.records.map((x) => x.optionId)).toEqual(live.records.map((x) => x.optionId));
  });

  it("the Jev adapter maps typed choices with probabilities onto the option set", async () => {
    const ts = new StubTypeSafe();
    const r = await runShowcase(env, sc(), { backend: "jev", livePersonas: 6, typesafe: ts });
    expect(ts.calls).toBeGreaterThan(0);
    const jev = r.records.filter((x) => x.source === "llm:jev");
    expect(jev.length).toBeGreaterThan(0);
    for (const x of jev) expect(Object.values(x.probs!).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("the distilled policy reproduces logged choice frequencies per situation (TVD <= 0.05), and bulk runs make zero LLM calls", async () => {
    const records = [];
    for (const seed of [11, 12, 13, 14, 15, 16]) records.push(...(await runShowcase(env, sc(seed), { backend: "haiku", livePersonas: 40, claude: new StubClaude("sensible") })).records);
    const real = records.filter((r) => r.source === "llm:haiku");
    const table = distill(real.map((r) => ({ key: r.key, options: r.options, chosen: r.chosen })), { logs: ["test"], decisions: real.length, backend: "stub", createdFrom: "test" });
    const pol = new DistilledPolicy(table, 1);
    const groups = new Map<string, typeof real>();
    for (const r of real) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
    let checked = 0;
    for (const [key, rs] of groups) {
      if (rs.length < 20) continue;
      const logged = new Map<string, number>(), model = new Map<string, number>();
      for (const r of rs) {
        logged.set(r.chosen, (logged.get(r.chosen) ?? 0) + 1 / rs.length);
        const dist = pol.distribution({ key: r.key, options: r.options.map((o) => ({ ...o, target: -1, num: { distM: 0, queueSec: 0, hazard: 0, herd: 0, familiar: false, signed: false } })), agent: 0, tick: 0, point: r.point, persona: r.persona, situation: r.situation })!;
        for (const [id, p] of dist) { const o = r.options.find((x) => x.id === id)!; const s = signature(o); model.set(s, (model.get(s) ?? 0) + p / rs.length); }
      }
      const d = tvd(logged, model);
      console.log(`situation ${key}: n=${rs.length} TVD=${d.toFixed(4)}`);
      expect(d).toBeLessThanOrEqual(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    const claude = new StubClaude("sensible");
    const w = makeWorld(env, sc(21), { distilled: pol, bulkPolicy: "distilled" });
    runSync(w);
    expect(claude.calls).toBe(0);
    expect(w.metrics.decisions["distilled"] ?? 0).toBeGreaterThan(0);
    void Rng;
  });
});
