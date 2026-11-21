import { useEffect, useState } from "react";
import type { GridInfo } from "../../src/server/contract.ts";
import type { Twin } from "../../src/twin/schema.ts";
import { getJSON } from "./api.ts";
import { b64ToBytes } from "./lib/decode.ts";

export interface Geometry {
  twin: Twin;
  grid: GridInfo;
  walk: Uint8Array[];
  win5: Float32Array[];
  bounds: [number, number, number, number];
}

export function boxSum(v: Float32Array, w: number, h: number, r: number, out: Float32Array): Float32Array {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = v[y * w + x]! + S[y * (w + 1) + x + 1]! + S[(y + 1) * (w + 1) + x]! - S[y * (w + 1) + x]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = S[y1 * (w + 1) + x1]! - S[y0 * (w + 1) + x1]! - S[y1 * (w + 1) + x0]! + S[y0 * (w + 1) + x0]!;
  }
  return out;
}

function boundsOf(twin: Twin): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of twin.floors) for (const p of [...f.outline, ...f.spaces.flatMap((s) => s.polygon)]) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 100, 100];
}

let pending: Promise<Geometry> | null = null;

export function loadGeometry(): Promise<Geometry> {
  pending ??= Promise.all([getJSON<Twin>("/api/twin"), getJSON<GridInfo>("/api/grid")]).then(([twin, grid]) => {
    const walk = grid.floors.map((f) => b64ToBytes(f.walkable));
    const win5 = grid.floors.map((f, i) => boxSum(Float32Array.from(walk[i]!), f.w, f.h, 2, new Float32Array(f.w * f.h)));
    return { twin, grid, walk, win5, bounds: boundsOf(twin) };
  }).catch((e: unknown) => {
    pending = null;
    throw e;
  });
  return pending;
}

export function useGeometry(): { geo: Geometry | null; error: string | null } {
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const attempt = () => loadGeometry().then((g) => { if (alive) { setGeo(g); setError(null); } }).catch((e: unknown) => {
      if (!alive) return;
      setError(e instanceof Error ? e.message : String(e));
      timer = window.setTimeout(attempt, 3000);
    });
    attempt();
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);
  return { geo, error };
}

export const centroid = (pts: readonly (readonly [number, number])[]): [number, number] => {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return pts.length ? [x / pts.length, y / pts.length] : [0, 0];
};
