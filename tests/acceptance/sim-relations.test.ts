import { describe, expect, it } from "vitest";
import { makeWorld, runSync, stateHash } from "../../src/sim/run.ts";
import { ST } from "../../src/sim/world.ts";
import { corridor, singleDoorRoom, twoFloorStair } from "../../src/twin/synthetic.ts";
import { envFor, scenario, steadyFlow } from "../helpers/sim.ts";

const UNIMPAIRED = { "profile.college.share.slow": 0, "profile.college.share.crutches": 0, "profile.college.share.wheelchair": 0, "premove.medianSec.college": 15 };

describe("simulator relations", () => {
  it("stair flow matches Fs_stair x We within 5%", () => {
    const env = envFor(twoFloorStair(44));
    const w = makeWorld(env, scenario({ zoneCounts: { Z2N: 150 }, behaviour: UNIMPAIRED }));
    const times: number[] = [];
    let last = 0;
    runSync(w, (ww) => {
      const s = ww.metrics.flightEntries[0]!;
      for (let k = last; k < s; k++) times.push(ww.tSec);
      last = s;
    }, 1);
    const fl = env.model.flights[0]!;
    const expected = env.params.get("flow.stair.FsMax") * (fl.widthM - 2 * env.params.get("flow.boundary.stair"));
    const measured = steadyFlow(times);
    console.log(`stair ${fl.widthM.toFixed(3)} m: expected ${expected.toFixed(3)} p/s, measured ${measured.toFixed(3)} p/s`);
    expect(w.summary().remaining).toBe(0);
    expect(Math.abs(measured - expected) / expected).toBeLessThanOrEqual(0.05);
  });

  it("a lone agent walks at its free speed (within 1 tick over the grid path)", () => {
    const env = envFor(corridor(100, 6));
    const w = makeWorld(env, scenario({ zoneCounts: { Z1N: 1 }, behaviour: UNIMPAIRED }));
    const start = w.cell[0]!;
    const dist = w.fields[0]![start]!;
    runSync(w);
    const walked = w.protectedAt[0]! - w.startedAt[0]!;
    const expected = dist / (w.vFree[0]! * w.dt);
    console.log(`lone walker: ${dist.toFixed(2)} m at ${w.vFree[0]!.toFixed(3)} m/s, expected ${expected.toFixed(2)} ticks, took ${walked}`);
    expect(Math.abs(walked - expected)).toBeLessThanOrEqual(1);
  });

  it("no deadlock: a full room and a stair both empty completely", () => {
    for (const twin of [singleDoorRoom(), twoFloorStair()]) {
      const env = envFor(twin);
      const zc: Record<string, number> = twin.floors.length > 1 ? { Z2N: 150, Z1N: 50 } : { Z1N: 300 };
      const w = makeWorld(env, scenario({ zoneCounts: zc }));
      const m = runSync(w);
      expect(m.gridlock).toBe(false);
      expect(m.remaining).toBe(0);
      for (let a = 0; a < w.n; a++) expect(w.state[a]).toBe(ST.PROTECTED);
    }
  });

  it("is deterministic: same scenario and seed give the same state hash; another seed differs", () => {
    const env = envFor(twoFloorStair());
    const run = (seed: number) => {
      const w = makeWorld(env, scenario({ zoneCounts: { Z2N: 120, Z1N: 40 }, seed }));
      runSync(w);
      return stateHash(w);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});
