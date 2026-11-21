import { describe, expect, it } from "vitest";
import { M_PER_FT } from "../../src/shared/units.ts";
import { singleDoorRoom } from "../../src/twin/synthetic.ts";
import { envFor, exitTimes, scenario, steadyFlow } from "../helpers/sim.ts";

const ROOM_FT = 10 / M_PER_FT;
const UNIMPAIRED = { "profile.college.share.slow": 0, "profile.college.share.crutches": 0, "profile.college.share.wheelchair": 0, "premove.medianSec.college": 15 };

describe("single-door flow matches the configured door-flow relation (Fs_max x We, +-5%)", () => {
  for (const doorM of [0.9, 1.2, 1.8]) {
    it(`10 m x 10 m room, 200 unimpaired agents, door ${doorM} m`, () => {
      const env = envFor(singleDoorRoom(ROOM_FT, (doorM / M_PER_FT) * 12));
      const { times, world } = exitTimes(env, scenario({ zoneCounts: { Z1N: 200 }, behaviour: UNIMPAIRED }));
      const expected = env.params.get("flow.door.FsMax") * (doorM - 2 * env.params.get("flow.boundary.door"));
      const measured = steadyFlow(times);
      console.log(`door ${doorM} m: expected ${expected.toFixed(3)} p/s, measured ${measured.toFixed(3)} p/s (10th-90th percentile), last out at ${times.at(-1)} s`);
      expect(world.summary().remaining).toBe(0);
      expect(Math.abs(measured - expected) / expected).toBeLessThanOrEqual(0.05);
    });
  }

  it("mobility-impaired occupants lower door flow through the modelled door delay", () => {
    const env = envFor(singleDoorRoom(ROOM_FT, (1.2 / M_PER_FT) * 12));
    const base = steadyFlow(exitTimes(env, scenario({ zoneCounts: { Z1N: 200 }, behaviour: UNIMPAIRED })).times);
    const mixed = steadyFlow(exitTimes(env, scenario({ zoneCounts: { Z1N: 200 }, behaviour: { ...UNIMPAIRED, "profile.college.share.wheelchair": 0.02, "profile.college.share.crutches": 0.02 } })).times);
    expect(mixed).toBeLessThan(base);
  });
});
