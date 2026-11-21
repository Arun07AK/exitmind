import { describe, expect, it } from "vitest";
import { buildScenario } from "../../src/scenario/build.ts";
import { scenarioAgent } from "../../src/scenario/agent.ts";
import { venueInfo, type AgentReply } from "../../src/scenario/spec.ts";
import { loadEnv, makeWorld } from "../../src/sim/run.ts";
import { loadVenue } from "../../src/twin/build.ts";
import { StubClaude } from "../helpers/stubs.ts";

const fete = loadVenue("thapar-fete");
const venues = [venueInfo("rinker-hall", loadVenue("rinker-hall")), venueInfo("thapar-fete", fete)];
const SATURNALIA = "Simulate an evacuation during a Saturnalia concert at Thapar, with students aged 18–21 and the real venue mapped using Google Maps or OpenStreetMap.";
const reply = (over: Partial<AgentReply["spec"]>, status: AgentReply["status"] = "ready"): AgentReply => ({
  status, missing: [], questions: [], assumptions: ["Assumed a fire near the stage."], summary: "A concert evacuation.",
  spec: { eventType: "concert", eventLabel: "Saturnalia concert", venue: "thapar-fete", crowdSize: 3000, ages: { child: 0, young_adult: 1, adult: 0, older_adult: 0 }, ageText: "18-21", roles: null, familiarity: null, mobility: null, emergency: "fire", emergencyWhere: null, blockedExits: [], compliance: null, urgency: null, conditions: [], ...over },
});

describe("custom emergency scenario generator", () => {
  it("offline: the Saturnalia demo text is parsed, and the missing crowd size is asked for", async () => {
    const r = await scenarioAgent([{ role: "user", text: SATURNALIA }], venues, new StubClaude("down"));
    expect(r.source).toBe("lexicon");
    expect(r.status).toBe("needs_info");
    expect(r.missing).toEqual(["crowd_size"]);
    expect(r.questions.join(" ")).toMatch(/How many people/);
    expect(r.spec.venue).toBe("thapar-fete");
    expect(r.spec.eventType).toBe("concert");
    expect(r.spec.ages!.young_adult).toBeCloseTo(1, 5);
  });

  it("offline: answering the question completes the scenario", async () => {
    const r = await scenarioAgent([{ role: "user", text: SATURNALIA }, { role: "assistant", text: "How many people are at the event?" }, { role: "user", text: "3000 people" }], venues, new StubClaude("down"));
    expect(r.status).toBe("ready");
    expect(r.spec.crowdSize).toBe(3000);
  });

  it("the agent's reply cannot skip a required detail: code re-checks and asks", async () => {
    const claude = new StubClaude("sensible", () => reply({ crowdSize: null, ages: null }));
    const r = await scenarioAgent([{ role: "user", text: "A concert" }], venues, claude);
    expect(r.source).toBe("llm");
    expect(r.status).toBe("needs_info");
    expect(r.missing).toEqual(expect.arrayContaining(["crowd_size", "age_groups"]));
    expect(r.questions.length).toBeGreaterThanOrEqual(2);
  });

  it("a ready reply keeps its assumptions, drops unknown exits, caps the crowd, and builds a runnable scenario", async () => {
    const claude = new StubClaude("sensible", () => reply({ crowdSize: 20000, blockedExits: ["EX-G1", "EX-NOPE"] }));
    const r = await scenarioAgent([{ role: "user", text: SATURNALIA + " 20000 people, main gate blocked" }], venues, claude);
    expect(r.status).toBe("ready");
    expect(r.spec.crowdSize).toBe(8000);
    expect(r.spec.blockedExits).toEqual(["EX-G1"]);
    expect(r.assumptions.join(" ")).toMatch(/capped at 8,000/);
    expect(r.assumptions.join(" ")).toMatch(/EX-NOPE/);
    const env = loadEnv(fete);
    const b = buildScenario({ ...r.spec, crowdSize: 1500 }, env.model, env.params, env.profiles, 3);
    expect(b.scenario.crowd!.placement).toBe("stage_front");
    expect(b.scenario.blockedExits).toEqual(["EX-G1"]);
    expect(b.assumptions.length).toBeGreaterThan(2);
    const w = makeWorld(env, b.scenario);
    expect(w.n).toBe(1500);
  });
});
