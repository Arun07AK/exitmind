import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/log/eventlog.ts";
import { personaRecords } from "../../src/policy/replay.ts";
import { runShowcase } from "../../src/policy/showcase.ts";
import { loadEnv } from "../../src/sim/run.ts";
import { loadVenue } from "../../src/twin/build.ts";
import { StubClaude } from "../helpers/stubs.ts";
import { scenario } from "../helpers/sim.ts";

const twin = loadVenue("thapar-fete");
const env = loadEnv(twin);
const crowd = { size: 600, ages: { young_adult: 1 }, roles: { student: 0.4, visitor: 0.4, staff: 0.2 }, familiar: { student: 0.8, visitor: 0, staff: 1 }, placement: "stage_front" as const };
const sc = (seed: number) => scenario({ crowd, seed, hazard: { kind: "none" } });

function brainStub() {
  return new StubClaude("sensible", (u) => {
    const opts = (u.options ?? []) as { id: string; option: string }[];
    const role = (u.person as { role: string }).role;
    const entry = opts.find((o) => o.option.includes("came in through"));
    const other = opts.find((o) => o.option.startsWith("Head for") && !o.option.includes("came in through"));
    const probs: Record<string, number> = Object.fromEntries(opts.map((o) => [o.id, 1]));
    if (role === "visitor" && entry) probs[entry.id] = 90;
    if (role === "staff" && other) probs[other.id] = 90;
    return { probabilities: probs, reason: "stub" };
  });
}

describe("Haiku crowd brain (stubbed provider)", () => {
  it("drives the whole crowd with group decisions: far fewer calls than people, staff take other gates, first-time visitors head for their entry gate", async () => {
    const claude = brainStub();
    const log = new EventLog();
    const r = await runShowcase(env, sc(4), { backend: "crowd", livePersonas: 600, claude, log });
    expect(r.metrics.remaining).toBe(0);
    expect(r.llmCalls).toBeGreaterThan(0);
    expect(r.llmCalls).toBeLessThan(r.records.length / 3);
    const first = new Map<number, (typeof r.records)[number]>();
    for (const rec of r.records) if (rec.point === "ALARM_NOTICED" && !first.has(rec.agent)) first.set(rec.agent, rec);
    const share = (role: string) => {
      const rs = [...first.values()].filter((x) => x.persona.role === role && x.source === "llm:haiku");
      return rs.filter((x) => x.options.find((o) => o.id === x.optionId)!.desc.includes("came in through")).length / Math.max(1, rs.length);
    };
    console.log(`first decision heads to own entry gate: visitors ${(share("visitor") * 100).toFixed(0)}%, staff ${(share("staff") * 100).toFixed(0)}%; ${r.llmCalls} Haiku calls for ${r.records.length} decisions`);
    expect(share("visitor")).toBeGreaterThan(0.6);
    expect(share("staff")).toBeLessThan(share("visitor"));
  }, 120_000);

  it("replays from its log to the identical final state with zero LLM calls", async () => {
    const log = new EventLog();
    const live = await runShowcase(env, sc(5), { backend: "crowd", livePersonas: 600, claude: brainStub(), log });
    const replay = await runShowcase(env, sc(5), { backend: "replay", livePersonas: 600, records: personaRecords(log) });
    expect(replay.llmCalls).toBe(0);
    expect(replay.hash).toBe(live.hash);
  }, 120_000);

  it("keeps running when Haiku is down: everyone falls back", async () => {
    const r = await runShowcase(env, sc(6), { backend: "crowd", livePersonas: 600, claude: new StubClaude("down") });
    expect(r.metrics.remaining).toBe(0);
    expect(r.records.every((x) => x.source.startsWith("fallback"))).toBe(true);
  }, 120_000);
});
