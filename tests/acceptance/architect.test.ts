import { describe, expect, it } from "vitest";
import { diagnose } from "../../src/optimise/diagnose.ts";
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
