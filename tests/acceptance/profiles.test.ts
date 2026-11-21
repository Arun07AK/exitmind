import { describe, expect, it } from "vitest";
import { prepareScenario } from "../../src/design/prepare.ts";
import { AGES, MOBILITY, ROLES } from "../../src/sim/population.ts";
import { makeWorld, runSync } from "../../src/sim/run.ts";
import { miniBuilding } from "../../src/twin/synthetic.ts";
import { envFor, scenario } from "../helpers/sim.ts";

const env = envFor(miniBuilding());

function mix(w: ReturnType<typeof makeWorld>) {
  const c = (arr: Uint8Array, names: readonly string[]) => { const o: Record<string, number> = {}; for (const v of arr) o[names[v]!] = (o[names[v]!] ?? 0) + 1; return o; };
  return { ages: c(w.age, AGES), roles: c(w.role, ROLES), mobility: c(w.mobility, MOBILITY), familiar: Array.from(w.familiar).filter(Boolean).length / w.n };
}

describe("occupancy profiles", () => {
  it("switching college -> hospital changes the occupant mix, the default protocol, and the results", () => {
    const run = (profile: "college" | "hospital") => {
      const sc = scenario({ profile, protocol: env.profiles[profile].defaultProtocol, hazard: { kind: "fire", floor: "F2", at: [30, 10] }, seed: 3 });
      const { scenario: prepared, model } = prepareScenario(env, sc);
      const w = makeWorld(env, prepared, { model });
      const m0 = mix(w);
      return { m0, prepared, metrics: runSync(w) };
    };
    const c = run("college"), h = run("hospital");
    console.log("college", JSON.stringify(c.m0), c.prepared.protocol, c.metrics.clearance95Sec, "| hospital", JSON.stringify(h.m0), h.prepared.protocol, h.metrics.clearance95Sec);
    expect(c.prepared.protocol).toBe("EVACUATE");
    expect(h.prepared.protocol).toBe("HORIZONTAL_EVACUATION");
    expect(h.prepared.routePolicy?.zones.some((z) => z.instruction === "MOVE_TO_COMPARTMENT")).toBe(true);
    expect(h.m0.roles.patient ?? 0).toBeGreaterThan(0);
    expect(c.m0.roles.patient ?? 0).toBe(0);
    expect(h.m0.mobility.assisted_patient ?? 0).toBeGreaterThan(0);
    expect(h.m0.ages.older_adult ?? 0).toBeGreaterThan(c.m0.ages.older_adult ?? 0);
    expect(JSON.stringify(h.metrics)).not.toBe(JSON.stringify(c.metrics));
  });

  it("every profile can be applied to the same plan and runs to completion", () => {
    for (const profile of ["college", "school", "mall", "hospital"] as const) {
      const w = makeWorld(env, scenario({ profile, seed: 2 }));
      const m = runSync(w);
      expect(m.occupants, profile).toBeGreaterThan(0);
      expect(m.gridlock, profile).toBe(false);
    }
  });
});
