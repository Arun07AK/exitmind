import type { FloorModel } from "./model.ts";
import { CELL_M } from "./model.ts";

const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class MinHeap {
  #keys = new Float64Array(1024);
  #vals = new Int32Array(1024);
  size = 0;
  clear(): void { this.size = 0; }
  push(key: number, val: number): void {
    if (this.size === this.#keys.length) {
      const k = new Float64Array(this.size * 2); k.set(this.#keys); this.#keys = k;
      const v = new Int32Array(this.size * 2); v.set(this.#vals); this.#vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.#keys[p] as number) <= key) break;
      this.#keys[i] = this.#keys[p] as number; this.#vals[i] = this.#vals[p] as number; i = p;
    }
    this.#keys[i] = key; this.#vals[i] = val;
  }
  topKey(): number { return this.#keys[0] as number; }
  pop(): number {
    const top = this.#vals[0] as number;
    const k = this.#keys[--this.size] as number, v = this.#vals[this.size] as number;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && (this.#keys[c + 1] as number) < (this.#keys[c] as number)) c++;
      if ((this.#keys[c] as number) >= k) break;
      this.#keys[i] = this.#keys[c] as number; this.#vals[i] = this.#vals[c] as number; i = c;
    }
    this.#keys[i] = k; this.#vals[i] = v;
    return top;
  }
}

const heap = new MinHeap();

export interface FieldCosts {
  extraCost?: Float32Array | null;
  blocked?: Uint8Array | null;
  closedPortal?: Uint8Array | null;
}

export function distanceField(fm: FloorModel, sources: ArrayLike<number>, out: Float32Array, costs: FieldCosts = {}): Float32Array {
  out.fill(Infinity);
  heap.clear();
  const { extraCost, blocked, closedPortal } = costs;
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k] as number;
    if (blocked?.[s]) continue;
    out[s] = 0;
    heap.push(0, s);
  }
  while (heap.size) {
    const d = heap.topKey();
    const i = heap.pop();
    if (d > (out[i] as number)) continue;
    for (let dir = 0; dir < 8; dir++) {
      const j = fm.nbr[i * 8 + dir] as number;
      if (j < 0 || blocked?.[j]) continue;
      const p = fm.nbrPortal[i * 8 + dir] as number;
      if (p >= 0 && closedPortal?.[p]) continue;
      const nd = Math.fround(d + (STEP[dir] as number) * CELL_M + (extraCost ? (extraCost[j] as number) : 0));
      if (nd < (out[j] as number)) { out[j] = nd; heap.push(nd, j); }
    }
  }
  return out;
}
