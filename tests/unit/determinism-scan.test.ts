import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/shared/paths.ts";

const DETERMINISTIC_DIRS = ["src/shared", "src/sim", "src/policy", "src/design"];
const NONDETERMINISTIC = /\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b|\bnew Date\b|\bcrypto\.randomUUID\b|\bgetRandomValues\b/;
const ANYWHERE = /\bMath\.random\b/;
const ALLOWLIST: readonly string[] = [];

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) => {
    const rel = relative(REPO_ROOT, file);
    if (ALLOWLIST.includes(rel)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => (pattern.test(line) ? [`${rel}:${i + 1}: ${line.trim()}`] : []));
  });
}

describe("determinism scan", () => {
  it("the pattern catches each forbidden call", () => {
    for (const s of ["Math.random()", "Date.now()", "performance.now()", "new Date()", "crypto.randomUUID()", "crypto.getRandomValues(a)"]) {
      expect(NONDETERMINISTIC.test(s), s).toBe(true);
    }
    expect(NONDETERMINISTIC.test("rng.next()")).toBe(false);
  });

  it("no clock or unseeded randomness in shared, sim, policy or design code", () => {
    const files = DETERMINISTIC_DIRS.flatMap((d) => tsFiles(join(REPO_ROOT, d)));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, NONDETERMINISTIC)).toEqual([]);
  });

  it("no Math.random anywhere in src", () => {
    expect(offenders(tsFiles(join(REPO_ROOT, "src")), ANYWHERE)).toEqual([]);
  });
});
