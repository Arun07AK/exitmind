import { describe, expect, it } from "vitest";
import { diagnose } from "../../src/optimise/diagnose.ts";
import { generate } from "../../src/optimise/generate.ts";
import { applyEdits } from "../../src/twin/edit.ts";
import { validateTwin } from "../../src/twin/validate.ts";
import { loadEnv } from "../../src/sim/run.ts";
import type { Scenario } from "../../src/sim/types.ts";
import { hallTwin } from "../helpers/halls.ts";

const env = loadEnv(hallTwin());
export const hallScenario = (seed: number): Scenario => ({ id: `hall-${seed}`, profile: "college", crowd: { size: 300, ages: { adult: 1 }, roles: { visitor: 1 }, familiar: { visitor: 0 } }, hazard: { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed, maxSec: 900 });

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
    expect(d.exits.find((e) => e.id === "EX-E1")!.verdict).toBe("overloaded");
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
  });
});
