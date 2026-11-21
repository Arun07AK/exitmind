import type { FrameMsg } from "../../../src/server/contract.ts";

export interface Interp {
  n: number;
  tick: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  floor: number[];
  state: number[];
  policy: number[];
}

let last: { a: FrameMsg | null; b: FrameMsg; alpha: number; out: Interp } | null = null;

export function interpolate(a: FrameMsg | null, b: FrameMsg | null, alpha: number): Interp | null {
  if (!b) return null;
  if (last && last.a === a && last.b === b && last.alpha === alpha) return last.out;
  const n = b.n;
  const reuse = last && last.out.n === n ? last.out : null;
  const x = reuse?.x ?? new Float32Array(n), y = reuse?.y ?? new Float32Array(n), z = reuse?.z ?? new Float32Array(n);
  const useA = a && a !== b && a.n === n;
  const t = Math.max(0, Math.min(1, alpha));
  for (let i = 0; i < n; i++) {
    const bx = b.x[i]! / 10, by = b.y[i]! / 10, bz = b.z[i]! / 10;
    if (useA) {
      x[i] = a.x[i]! / 10 + (bx - a.x[i]! / 10) * t;
      y[i] = a.y[i]! / 10 + (by - a.y[i]! / 10) * t;
      z[i] = a.z[i]! / 10 + (bz - a.z[i]! / 10) * t;
    } else {
      x[i] = bx; y[i] = by; z[i] = bz;
    }
  }
  const out: Interp = { n, tick: b.tick, x, y, z, floor: b.floor, state: b.state, policy: b.policy };
  last = { a, b, alpha, out };
  return out;
}
