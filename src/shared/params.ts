import { readFileSync } from "node:fs";
import { z } from "zod";
import { repoPath } from "./paths.ts";

const ParamEntry = z.strictObject({
  value: z.number(),
  min: z.number(),
  max: z.number(),
  unit: z.string().min(1),
  cite: z.array(z.string().min(1)).min(1),
  locator: z.string().min(1),
  verified: z.boolean(),
});
export type ParamEntry = z.infer<typeof ParamEntry>;

const ParamFile = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/), ParamEntry);
const ReferenceFile = z.record(z.string(), z.object({ title: z.string().min(1) }).loose());

export class Params {
  readonly #entries: ReadonlyMap<string, ParamEntry>;
  readonly #referenceKeys: ReadonlySet<string>;

  constructor(entries: Record<string, ParamEntry>, referenceKeys: ReadonlySet<string>) {
    const errors: string[] = [];
    for (const [key, e] of Object.entries(entries)) {
      if (![e.value, e.min, e.max].every(Number.isFinite)) errors.push(`${key}: non-finite bound or value`);
      if (e.min > e.max) errors.push(`${key}: min ${e.min} > max ${e.max}`);
      if (e.value < e.min || e.value > e.max) errors.push(`${key}: value ${e.value} outside [${e.min}, ${e.max}]`);
      for (const c of e.cite) if (!referenceKeys.has(c)) errors.push(`${key}: cites unknown reference "${c}"`);
    }
    if (errors.length) throw new Error(`invalid behaviour parameters:\n${errors.join("\n")}`);
    this.#referenceKeys = referenceKeys;
    this.#entries = new Map(Object.entries(entries).map(([k, e]) => [k, Object.freeze({ ...e, cite: [...e.cite] })]));
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }

  entry(key: string): ParamEntry {
    const e = this.#entries.get(key);
    if (!e) throw new Error(`unknown behaviour parameter "${key}" (add it to config/behaviour.params.json with a citation)`);
    return e;
  }

  get(key: string): number {
    return this.entry(key).value;
  }

  clamp(key: string, v: number): number {
    const { min, max } = this.entry(key);
    if (!Number.isFinite(v)) throw new RangeError(`${key}: non-finite value ${v}`);
    return Math.min(max, Math.max(min, v));
  }

  withOverrides(overrides: Record<string, number>): Params {
    const next: Record<string, ParamEntry> = Object.fromEntries(this.#entries);
    for (const [key, v] of Object.entries(overrides)) {
      const e = this.entry(key);
      if (!Number.isFinite(v) || v < e.min || v > e.max) {
        throw new RangeError(`${key}: override ${v} outside [${e.min}, ${e.max}] (pass it through clamp first)`);
      }
      next[key] = { ...e, value: v };
    }
    return new Params(next, this.#referenceKeys);
  }

  unverified(): string[] {
    return this.keys().filter((k) => !this.entry(k).verified);
  }
}

export function readReferenceKeys(path = repoPath("config", "references.json")): Set<string> {
  return new Set(Object.keys(ReferenceFile.parse(JSON.parse(readFileSync(path, "utf8")))));
}

export function loadParams(
  path = repoPath("config", "behaviour.params.json"),
  referencesPath = repoPath("config", "references.json"),
): Params {
  const entries = ParamFile.parse(JSON.parse(readFileSync(path, "utf8")));
  return new Params(entries, readReferenceKeys(referencesPath));
}
