import type * as THREE from "three";
import type { Geometry } from "../../geometry.ts";
import { floorY, levelsOf, type Levels } from "./model.ts";
import { sunMask, SUN_MASKING } from "./sun.ts";

/** Mutable per-frame state shared by the scene parts (never React state, so nothing re-renders per frame). */
export interface Anim {
  lv: Levels;
  explode: number;
  ys: number[];
  /** floor opacity (1 = shown, ~0.3 = dimmed, 0 = hidden) */
  op: number[];
  /** materials of each floor that follow its opacity */
  mats: Set<THREE.Material>[];
  /** world positions of drawn agents (x, y, z per agent id) and whether each is drawn, for picking */
  pick: { pos: Float32Array; vis: Uint8Array; n: number };
  /** world offset of the building group (the plan is centred on the origin) */
  cx: number;
  cz: number;
  /** one sun per floor (shadow quality) or a single sun */
  perFloorSun: boolean;
  mask: (fi: number | null) => number[];
}

export function makeAnim(geo: Geometry, explode: boolean, shadows: boolean): Anim {
  const lv = levelsOf(geo.twin);
  const n = geo.twin.floors.length;
  const e = explode ? 1 : 0;
  const [x0, y0, x1, y1] = geo.bounds;
  return {
    lv,
    explode: e,
    ys: floorY(lv, e, new Array<number>(n)),
    op: new Array<number>(n).fill(1),
    mats: Array.from({ length: n }, () => new Set<THREE.Material>()),
    pick: { pos: new Float32Array(3 * 1024), vis: new Uint8Array(1024), n: 0 },
    cx: (x0 + x1) / 2,
    cz: (y0 + y1) / 2,
    perFloorSun: shadows && SUN_MASKING,
    mask: (fi) => sunMask(n, shadows && SUN_MASKING, fi),
  };
}

export const DIM = 0.3;

export function applyOpacity(m: THREE.Material, op: number): void {
  const t = op < 0.995;
  if (m.opacity === op && m.transparent === t) return;
  if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
  m.opacity = op;
}
