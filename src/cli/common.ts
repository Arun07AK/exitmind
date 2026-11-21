import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { makeEvaluator, type Evaluator } from "../design/pool.ts";
import { setExitCandidates } from "../design/prepare.ts";
import { repoPath } from "../shared/paths.ts";
import { loadEnv, type SimEnv } from "../sim/run.ts";
import { loadCandidates } from "../twin/candidates.ts";

export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i]!;
    if (!k.startsWith("--")) continue;
    const v = a[i + 1] && !a[i + 1]!.startsWith("--") ? a[++i]! : "true";
    out[k.slice(2)] = v;
  }
  return out;
}

export function writeJson(rel: string[], data: unknown): string {
  const p = repoPath(...rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(data, null, 1)}\n`);
  return p;
}

export function ledger(name: string, data: Record<string, unknown>): void {
  writeJson(["runs", name, "ledger.json"], { name, updated: new Date().toISOString(), ...data });
}

export function setup(workers?: number): { env: SimEnv; ev: Evaluator } {
  const env = loadEnv();
  const cands = loadCandidates();
  setExitCandidates(cands);
  const ev = makeEvaluator({ workers: workers ?? env.runtime.design.workers });
  return { env, ev };
}
