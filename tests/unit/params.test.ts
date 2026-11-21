import { describe, expect, it } from "vitest";
import { Params, loadParams, readReferenceKeys, type ParamEntry } from "../../src/shared/params.ts";
import { loadRuntime } from "../../src/shared/runtime.ts";

const entry = (over: Partial<ParamEntry> = {}): ParamEntry => ({
  value: 1, min: 0, max: 2, unit: "m/s", cite: ["weidmann1993"], locator: "test", verified: false, ...over,
});

describe("behaviour.params.json", () => {
  const params = loadParams();
  const refs = readReferenceKeys();

  it("loads, and every value sits inside its bounds", () => {
    expect(params.keys().length).toBeGreaterThan(0);
    for (const key of params.keys()) {
      const e = params.entry(key);
      expect(e.min, key).toBeLessThanOrEqual(e.value);
      expect(e.value, key).toBeLessThanOrEqual(e.max);
    }
  });

  it("gives every entry a citation that resolves to config/references.json", () => {
    for (const key of params.keys()) {
      const { cite, locator, unit } = params.entry(key);
      expect(cite.length, key).toBeGreaterThan(0);
      for (const c of cite) expect(refs.has(c), `${key} -> ${c}`).toBe(true);
      expect(locator.length, key).toBeGreaterThan(0);
      expect(unit.length, key).toBeGreaterThan(0);
    }
  });

  it("reports unverified parameters instead of hiding them", () => {
    const expected = params.keys().filter((k) => !params.entry(k).verified);
    expect(params.unverified()).toEqual(expected);
  });

  it("refuses to read a parameter that is not in the file", () => {
    expect(() => params.get("walk.teleportSpeed")).toThrow(/unknown behaviour parameter/);
  });

  it("clamps into bounds and rejects non-finite input", () => {
    expect(params.clamp("walk.freeSpeed.mean", 9)).toBe(params.entry("walk.freeSpeed.mean").max);
    expect(params.clamp("walk.freeSpeed.mean", -1)).toBe(params.entry("walk.freeSpeed.mean").min);
    expect(params.clamp("walk.freeSpeed.mean", 1.2)).toBe(1.2);
    expect(() => params.clamp("walk.freeSpeed.mean", Number.NaN)).toThrow(RangeError);
  });

  it("refuses out-of-range overrides and leaves the original untouched", () => {
    expect(() => params.withOverrides({ "walk.freeSpeed.mean": 3 })).toThrow(/outside/);
    const faster = params.withOverrides({ "walk.freeSpeed.mean": 1.5 });
    expect(faster.get("walk.freeSpeed.mean")).toBe(1.5);
    expect(params.get("walk.freeSpeed.mean")).toBe(1.34);
  });
});

describe("Params validation", () => {
  const refs = new Set(["weidmann1993"]);
  it("rejects a value outside its bounds", () => {
    expect(() => new Params({ "a.b": entry({ value: 3 }) }, refs)).toThrow(/outside/);
  });
  it("rejects inverted bounds", () => {
    expect(() => new Params({ "a.b": entry({ min: 2, max: 1, value: 1.5 }) }, refs)).toThrow(/min 2 > max 1/);
  });
  it("rejects a citation that does not exist", () => {
    expect(() => new Params({ "a.b": entry({ cite: ["madeup2099"] }) }, refs)).toThrow(/unknown reference/);
  });
});

describe("runtime.json", () => {
  it("loads with the decision-register values", () => {
    const rt = loadRuntime();
    expect(rt.showcase.livePersonas).toBe(12);
    expect(["block_with_override", "warn"]).toContain(rt.gate.failMode);
    expect(rt.sim.dtSec).toBe(0.25);
    expect(rt.sim.cellM).toBe(0.4);
  });
});
