import type { Evaluator } from "../design/pool.ts";
import type { EvalResult } from "../design/evaluate.ts";
import type { Edit, Scenario } from "../sim/types.ts";

export interface Paired { mean: number; ci95: number; n: number }
export interface Outcome { people: number; protectedByTarget: number; clearance95Sec: number; clearanceReached: number; badness: number; gridlockShare: number; waitingPS?: number }

const r1 = (v: number) => Math.round(v * 10) / 10;
export const people = (r: EvalResult) => r.metrics.protected + r.metrics.remaining;
export const protectedBy = (r: EvalResult) => people(r) - r.metrics.remainingAtTarget;
const c95 = (r: EvalResult, cap: number) => r.metrics.clearance95Sec ?? cap;

export function outcome(rs: EvalResult[], cap: number): Outcome {
  const m = (f: (r: EvalResult) => number) => r1(rs.reduce((a, r) => a + f(r), 0) / rs.length);
  return { people: m(people), protectedByTarget: m(protectedBy), clearance95Sec: m((r) => c95(r, cap)), clearanceReached: rs.filter((r) => r.metrics.clearance95Sec !== null).length / rs.length, badness: m((r) => r.badness), gridlockShare: rs.filter((r) => r.metrics.gridlock).length / rs.length };
}

/** Paired difference (candidate minus baseline) on the same scenarios and seeds, with a 95% interval. */
export function paired(base: EvalResult[], cand: EvalResult[], f: (r: EvalResult) => number): Paired {
  const n = Math.min(base.length, cand.length);
  const d = Array.from({ length: n }, (_, i) => f(cand[i]!) - f(base[i]!));
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(d.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { mean: r1(mean), ci95: r1((1.96 * sd) / Math.sqrt(n)), n };
}

export async function run(ev: Evaluator, scenarios: Scenario[], edits: Edit[]): Promise<EvalResult[]> {
  return ev.map(scenarios.map((s) => ({ scenario: { ...s, edits: [...(s.edits ?? []), ...edits] } })));
}

/** Largest crowd (load factor, or crowd size) for which every scenario-run gets everyone out by the target with no gridlock. */
export async function safeCapacity(ev: Evaluator, scenarios: Scenario[], edits: Edit[], o: { lo?: number; hi?: number; iters?: number } = {}): Promise<{ factor: number; people: number }> {
  const scale = (s: Scenario, k: number): Scenario => (s.crowd ? { ...s, crowd: { ...s.crowd, size: Math.max(1, Math.round(s.crowd.size * k)) } } : { ...s, loadFactor: Math.min(3, Math.max(0.1, s.loadFactor * k)) });
  const ok = async (k: number) => { const rs = await run(ev, scenarios.map((s) => scale(s, k)), edits); return { safe: rs.every((r) => r.metrics.remainingAtTarget === 0 && !r.metrics.gridlock), people: rs.reduce((a, r) => a + people(r), 0) / rs.length }; };
  let lo = o.lo ?? 0.25, hi = o.hi ?? (scenarios[0]!.crowd ? 4 : 3 / Math.max(...scenarios.map((s) => s.loadFactor)));
  let best = await ok(lo);
  if (!best.safe) return { factor: 0, people: 0 };
  const top = await ok(hi);
  if (top.safe) return { factor: r1(hi * 100) / 100, people: Math.round(top.people) };
  for (let i = 0; i < (o.iters ?? 6); i++) {
    const mid = (lo + hi) / 2, r = await ok(mid);
    if (r.safe) { lo = mid; best = r; } else hi = mid;
  }
  return { factor: Math.round(lo * 100) / 100, people: Math.round(best.people) };
}

/** Ridge regression (closed form), used to predict combination effects from single-modification effects. */
export function ridge(X: number[][], y: number[], lambda = 1): number[] {
  const p = X[0]!.length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, x) => a + x[i]! * x[j]!, 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((a, x, k) => a + x[i]! * y[k]!, 0));
  for (let i = 0; i < p; i++) {
    let piv = i;
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[piv]![i]!)) piv = r;
    [A[i], A[piv]] = [A[piv]!, A[i]!]; [b[i], b[piv]] = [b[piv]!, b[i]!];
    const d = A[i]![i]! || 1e-9;
    for (let r = 0; r < p; r++) {
      if (r === i) continue;
      const f = A[r]![i]! / d;
      for (let c = i; c < p; c++) A[r]![c] = A[r]![c]! - f * A[i]![c]!;
      b[r] = b[r]! - f * b[i]!;
    }
  }
  return b.map((v, i) => v / (A[i]![i]! || 1e-9));
}

export function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array<number>(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  if (n < 3) return NaN;
  const d2 = ra.reduce((s, x, i) => s + (x - rb[i]!) ** 2, 0);
  return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 1000) / 1000;
}
