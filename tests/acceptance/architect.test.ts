import { describe, expect, it } from "vitest";
import { diagnose } from "../../src/optimise/diagnose.ts";
import { generate } from "../../src/optimise/generate.ts";
import { applyEdits } from "../../src/twin/edit.ts";
import { validateTwin } from "../../src/twin/validate.ts";
import { loadEnv } from "../../src/sim/run.ts";
import type { Scenario } from "../../src/sim/types.ts";
import { hallTwin } from "../helpers/halls.ts";

const env = loadEnv(hallTwin());
export const hallScenario = (seed: number): Scenario => ({ id: `hall-${seed}`, profile: "college", crowd: { size: 600, ages: { adult: 1 }, roles: { visitor: 1 }, familiar: { visitor: 0 } }, hazard: { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed, maxSec: 900 });

describe("architectural optimisation: diagnosis", () => {
  it("names the narrow exit as the main bottleneck, with its capacity, saturation, catchment and spare capacity elsewhere", () => {
    const d = diagnose(env, [hallScenario(1), hallScenario(2)]);
    const h1 = d.hotspots[0]!;
    expect(h1.element?.id).toBe("EX-E1");
    expect(h1.share).toBeGreaterThan(0.4);
    expect(h1.capacityPps).toBeGreaterThan(0);
    expect(h1.saturatedSec).toBeGreaterThan(20);
    expect(h1.fedBy[0]!.space).toBe("FLOOR");
    expect(h1.spare[0]!.exit).toBe("EX-E2");
    expect(h1.why).toMatch(/queues behind Main: West door/);
    const west = d.exits.find((e) => e.id === "EX-E1")!;
    expect(west.usedShare).toBeGreaterThan(west.capacityShare * 1.3);
    expect(d.summary[0]).toMatch(/people out or protected/);
  });
});

describe("architectural optimisation: generators", () => {
  const rinker = loadEnv();
  const sc: Scenario = { id: "r1", profile: "college", hazard: { kind: "none" }, behaviour: {}, loadFactor: 1.2, occupancy: "classes_full", protocol: "EVACUATE", seed: 1, maxSec: 900 };
  const d = diagnose(rinker, [sc]);
  const mods = generate({ twin: rinker.twin, model: rinker.model, diagnosis: d });
  it("proposes concrete construction, not just wider doors: new exits, an external stair, connecting passages, a ramp", () => {
    const kinds = new Set(mods.map((m) => m.kind));
    for (const k of ["new_exit", "external_stair", "connecting_passage", "widen_door", "ramp"]) expect(kinds, k).toContain(k);
  });
  it("every proposal is valid geometry, names its hotspot, and states structural and regulatory implications", () => {
    for (const m of mods) {
      const t = applyEdits(rinker.twin, [m.edit]);
      expect(validateTwin(t).errors, m.title).toEqual([]);
      expect(m.regulations.length, m.title).toBeGreaterThan(0);
      if (m.structural === "structural") expect(m.needsEngineer, m.title).toBe(true);
      expect(m.viz.length).toBeGreaterThan(0);
    }
    const xs = mods.find((m) => m.kind === "external_stair")!;
    const t = applyEdits(rinker.twin, [xs.edit]);
    expect(t.stairs.length).toBe(rinker.twin.stairs.length + 1);
    expect(validateTwin(t).stats.walkableCells).toBeGreaterThan(validateTwin(rinker.twin).stats.walkableCells);
  }, 120_000);
});

import { InlineEvaluator } from "../../src/design/pool.ts";
import { compile, opusConcepts } from "../../src/optimise/concepts.ts";
import { search, loadArchitectConfig } from "../../src/optimise/search.ts";
import { StubClaude } from "../helpers/stubs.ts";

describe("architectural optimisation: evaluation, search and quantification", () => {
  it("on the test hall: proposals are simulated on paired runs, the best cuts evacuation time, and safe capacity rises", async () => {
    const sc = [hallScenario(1), hallScenario(2)];
    const d = diagnose(env, sc);
    const mods = generate({ twin: env.twin, model: env.model, diagnosis: d });
    expect(mods.some((m) => m.kind === "new_exit")).toBe(true);
    const cfg = { ...loadArchitectConfig(), search: { maxSingles: 4, screenRuns: 2, topSingles: 3, triplesSimulated: 1, validateSurrogate: true, safeCapacityRuns: 2 } };
    const r = await search(env, new InlineEvaluator(env), sc, mods, { config: cfg });
    const best = r.alternatives.filter((a) => a.source === "simulated").sort((a, b) => a.dClearance95.mean - b.dClearance95.mean)[0]!;
    expect(best.dClearance95.mean).toBeLessThan(-10);
    expect(best.runs).toBe(2);
    expect(r.alternatives.some((a) => a.pareto)).toBe(true);
    expect(r.safeCapacity.extraPeople!).toBeGreaterThan(0);
    expect(r.surrogate.triplesTotal).toBe(1);
    expect(r.simulations).toBeGreaterThan(10);
  }, 180_000);
});

describe("architectural optimisation: Opus concepts are rebuilt by code or rejected with a reason", () => {
  const rinker = loadEnv();
  const d = diagnose(rinker, [{ id: "r", profile: "college", hazard: { kind: "none" }, behaviour: {}, loadFactor: 1.2, occupancy: "classes_full", protocol: "EVACUATE", seed: 1, maxSec: 900 }]);
  const g = { twin: rinker.twin, model: rinker.model, diagnosis: d };
  const c = (over: Partial<Parameters<typeof compile>[0]>) => compile({ kind: "new_exit", hotspot: "H1", floor: "F1", spaces: [], element: null, rationale: "test", ...over }, g);
  it("builds valid concepts and refuses impossible ones", () => {
    const exit = c({ kind: "new_exit", spaces: ["C199A"] });
    expect(exit.mod?.source).toBe("opus");
    expect(validateTwin(applyEdits(rinker.twin, [exit.mod!.edit])).errors).toEqual([]);
    expect(c({ kind: "new_exit", spaces: ["NOPE"] }).reason).toMatch(/unknown space/);
    const men = rinker.twin.floors[0]!.spaces.find((s) => s.use === "restroom")!;
    const corridor = rinker.twin.floors[0]!.spaces.find((s) => s.kind === "corridor")!;
    expect(c({ kind: "connecting_passage", spaces: [corridor.id, men.id] }).reason).toMatch(/restroom/);
    expect(c({ kind: "widen_door", element: null }).reason).toMatch(/no element/);
  });
  it("an interpretation quoting numbers that are not in the diagnosis is dropped", async () => {
    const claude = new StubClaude("sensible", () => ({ interpretation: "People wait 98765 seconds at H1.", concepts: [{ kind: "new_exit", hotspot: "H1", floor: "F1", spaces: ["C199A"], element: null, rationale: "second way out" }] }));
    const r = await opusConcepts(d, g, claude);
    expect(r.interpretation).toBeNull();
    expect(r.note).toMatch(/98765/);
    expect(r.built).toHaveLength(1);
  });
});
