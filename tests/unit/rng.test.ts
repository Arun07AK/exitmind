import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { Rng, deriveSeed } from "../../src/shared/rng.ts";

const draw = (r: Rng, n: number) => Array.from({ length: n }, () => r.nextU32());

describe("Rng (sfc32 seeded through splitmix32)", () => {
  it("matches the pinned golden outputs for seed 42", () => {
    expect(draw(new Rng(42), 4)).toEqual([3825871779, 1851418855, 1383259262, 890322987]);
    expect([deriveSeed(42, "population"), deriveSeed(42, "hazards")]).toEqual([890092986, 755634575]);
  });

  it("repeats exactly for the same seed and differs across seeds", () => {
    expect(draw(new Rng(7), 1000)).toEqual(draw(new Rng(7), 1000));
    expect(draw(new Rng(7), 50)).not.toEqual(draw(new Rng(8), 50));
  });

  it("derives independent, order-sensitive named streams", () => {
    expect(draw(Rng.stream(1, "population"), 100)).toEqual(draw(Rng.stream(1, "population"), 100));
    expect(draw(Rng.stream(1, "population"), 20)).not.toEqual(draw(Rng.stream(1, "hazards"), 20));
    expect(deriveSeed(1, "a", "b")).not.toBe(deriveSeed(1, "b", "a"));
    expect(deriveSeed(1, "agent", "12")).not.toBe(deriveSeed(1, "agent", "13"));
  });

  it("restores from a saved state", () => {
    const r = new Rng(99);
    draw(r, 10);
    const saved = r.state();
    const expected = draw(r, 25);
    expect(draw(Rng.fromState(saved), 25)).toEqual(expected);
  });

  it("gives identical sequences in a worker thread", async () => {
    const fromWorker = await new Promise<number[]>((resolve, reject) => {
      const w = new Worker(new URL("./fixtures/rng-worker.ts", import.meta.url), { workerData: { seed: 2026, name: "bulk" } });
      w.once("message", resolve);
      w.once("error", reject);
    });
    expect(fromWorker).toEqual(draw(Rng.stream(2026, "bulk"), 1000));
  });

  it("produces uniform values in [0, 1)", () => {
    const r = new Rng(3);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
      sum += x;
    }
    expect(Math.abs(sum / 100_000 - 0.5)).toBeLessThan(0.005);
  });

  it("int covers every value with roughly equal frequency", () => {
    const r = new Rng(4);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[r.int(6)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
    expect(() => r.int(0)).toThrow(RangeError);
    expect(() => r.int(2.5)).toThrow(RangeError);
  });

  it("normal, truncNormal and lognormal have the requested shape", () => {
    const r = new Rng(5);
    const xs = Array.from({ length: 100_000 }, () => r.normal(1.34, 0.26));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean - 1.34)).toBeLessThan(0.005);
    expect(Math.abs(sd - 0.26)).toBeLessThan(0.005);
    for (let i = 0; i < 10_000; i++) {
      const t = r.truncNormal(1.34, 0.26, 1.0, 1.6);
      expect(t >= 1.0 && t <= 1.6).toBe(true);
    }
    const logs = Array.from({ length: 20_001 }, () => r.lognormal(45, 0.6)).sort((a, b) => a - b);
    expect(Math.abs((logs[10_000] as number) - 45) / 45).toBeLessThan(0.03);
  });

  it("shuffled is a permutation and leaves the input untouched", () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Rng(6).shuffled(input);
    expect([...out].sort()).toEqual([...input]);
    expect(out).not.toEqual([...input]);
  });

  it("weightedIndex follows the weights and never picks a zero weight", () => {
    const r = new Rng(8);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[r.weightedIndex([1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(Math.abs((counts[2] as number) / 30_000 - 0.75)).toBeLessThan(0.01);
    expect(() => r.weightedIndex([0, 0])).toThrow(RangeError);
    expect(() => r.weightedIndex([1, Number.NaN])).toThrow(RangeError);
  });
});
