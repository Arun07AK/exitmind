import { afterAll, describe, expect, it } from "vitest";
import { adversary } from "../../src/design/adversary.ts";
import { Pool } from "../../src/design/pool.ts";
import { optimise } from "../../src/design/optimiser.ts";
import { loadEnv } from "../../src/sim/run.ts";
import { miniBuilding } from "../../src/twin/synthetic.ts";

const twin = miniBuilding();
const env = loadEnv(twin);
const pool = new Pool({ size: 6, twin });
afterAll(() => pool.close());

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("design mode mechanics on the mini test building (Rinker results are produced by the CLIs and recorded in docs/verification)", () => {
  it("bulk runs in workers match inline runs exactly (determinism across threads)", async () => {
    const sc = { id: "x", profile: "college" as const, hazard: { kind: "fire" as const, floor: "F2" as const, at: [30, 10] as [number, number] }, behaviour: {}, loadFactor: 1, occupancy: "uniform" as const, protocol: "EVACUATE" as const, seed: 4, maxSec: 600 };
    const [a, b] = await pool.map([{ scenario: sc }, { scenario: sc }]);
    const { evaluate } = await import("../../src/design/evaluate.ts");
    expect(a!.hash).toBe(b!.hash);
    expect(evaluate(env, { scenario: sc }).hash).toBe(a!.hash);
  });

  it("the adversary finds a scenario measurably worse than the default crowd, on fresh seeds, for 3 search seeds", async () => {
    for (const seed of [1, 2, 3]) {
      const r = await adversary(env, pool, { hazard: "fire", profile: "college", population: 8, generations: 2, seeds: 1, freshSeeds: 6, explain: seed === 1, seed });
      const diff = mean(r.worstFresh) - mean(r.baselineFresh);
      const sdb = Math.sqrt(r.baselineFresh.reduce((a, v) => a + (v - mean(r.baselineFresh)) ** 2, 0) / (r.baselineFresh.length - 1));
      console.log(`adversary seed ${seed}: default ${mean(r.baselineFresh).toFixed(1)} ± ${sdb.toFixed(1)}, worst ${mean(r.worstFresh).toFixed(1)}`);
      expect(diff).toBeGreaterThan(2 * sdb);
      if (seed === 1) expect(r.result.explanation.length).toBeGreaterThan(3);
    }
  }, 240_000);

  it("the optimiser improves the worst case within budget and code limits", async () => {
    const r = await optimise(env, pool, { hazard: "quake", profile: "college", seed: 5, adversaryBudget: { population: 6, generations: 2, seeds: 1 }, archiveSize: 2 });
    console.log(`optimiser: ${r.steps.map((s) => s.label).join("; ")} | original ${r.original.badness} -> optimised ${r.optimised.badness}, spent ${r.spent}/${r.budget}`);
    expect(r.spent).toBeLessThanOrEqual(r.budget);
    expect(r.codeLimitsOk).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.optimised.badness).toBeLessThan(r.original.badness);
  }, 400_000);
});
