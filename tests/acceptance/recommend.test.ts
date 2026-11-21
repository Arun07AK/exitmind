import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/design/evaluate.ts";
import { InlineEvaluator } from "../../src/design/pool.ts";
import { classify, recommend } from "../../src/design/recommend.ts";
import { scenarioPresets } from "../../src/server/presets.ts";
import { repoPath } from "../../src/shared/paths.ts";
import { loadEnv } from "../../src/sim/run.ts";
import { parseScenario } from "../../src/sim/scenario.ts";
import type { Scenario } from "../../src/sim/types.ts";

const env = loadEnv();

describe("optimise mode: recommendations re-simulated on the worst case", () => {
  it("the evidence classifier labels paired differences by mean and 2 standard errors", () => {
    expect(classify([10, 12, 11, 9]).status).toBe("validated");
    expect(classify([1, 1, 1]).status).toBe("validated");
    expect(classify([0.4, 0.4, 0.4]).status).toBe("no_effect");
    expect(classify([0, 0, 0]).status).toBe("no_effect");
    expect(classify([20, -18, 25, -20]).status).toBe("no_effect");
    expect(classify([-5, -6, -4]).status).toBe("worse");
    expect(classify([-1, -1]).status).toBe("worse");
    expect(classify([-0.4, -0.4]).status).toBe("no_effect");
    expect(classify([2, 4])).toEqual({ status: "validated", gain: { mean: 3, se: 1, perSeed: [2, 4] } });
    expect(classify([1, 3]).status).toBe("no_effect");
  });

  it("recommend's per-seed figures equal direct evaluate() runs for the same scenario, edits and seed", async () => {
    const seeds = [88000, 88001];
    const r = await recommend(env, new InlineEvaluator(env), { seeds });
    const base = (JSON.parse(readFileSync(repoPath("data", "design", "adversary.json"), "utf8")) as { worst: { scenario: { scenario: Scenario } } }).worst.scenario.scenario;
    const variants = [{ edits: [], agg: r.original }, ...r.recommendations.flatMap((x) => (x.variant ? [{ edits: x.edits, agg: x.variant }] : []))];
    expect(variants.length).toBeGreaterThanOrEqual(4);
    for (const v of variants) for (const [i, seed] of seeds.entries()) {
      const d = evaluate(env, { scenario: { ...base, seed, edits: v.edits }, mode: "rule" });
      const p = v.agg.perSeed[i]!;
      expect(p.seed).toBe(seed);
      expect(p.hash).toBe(d.hash);
      expect(p.remainingAtTarget).toBe(d.metrics.remainingAtTarget);
      expect(p.outByTarget).toBe(d.metrics.occupants - d.metrics.remainingAtTarget);
      expect(p.clearance95Sec).toBe(d.metrics.clearance95Sec);
      expect(p.densityDangerPS).toBe(d.metrics.densityDangerPS);
      expect(p.exitUsage).toEqual(d.metrics.exitUsage);
      expect(p.badness).toBe(d.badness);
    }
    for (const x of r.recommendations) if (x.gain) expect(x.gain.perSeed).toEqual(x.variant!.perSeed.map((p, i) => p.outByTarget - r.original.perSeed[i]!.outByTarget));
    expect(r.original.danger.reduce((a, f) => a + f.total, 0)).toBeCloseTo(r.original.densityDangerPS, 1);
    const add = r.recommendations.find((x) => x.id === "add_exit")!;
    expect(add.status).toBe("untestable");
    expect(add.variant).toBeNull();
    expect(add.reason).toMatch(/no candidate exit positions/i);
    console.log(r.recommendations.map((x) => `${x.label}: ${x.status}${x.gain ? ` ${x.gain.mean} ± ${2 * x.gain.se}` : ""}`).join(" | "));
  }, 180_000);

  it("scenario presets are ready to run", () => {
    const p = scenarioPresets();
    expect(p.map((x) => x.id)).toEqual(expect.arrayContaining(["fire-worst", "fire-baseline", "quake-worst", "quake-baseline"]));
    for (const x of p) expect(parseScenario(x.scenario).hazard.kind).toBe(x.hazard);
  });
});
