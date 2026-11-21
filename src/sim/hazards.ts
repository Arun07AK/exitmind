import { pointInPolygon } from "../shared/geom.ts";
import type { Params } from "../shared/params.ts";
import { M_PER_FT } from "../shared/units.ts";
import { MinHeap } from "./fields.ts";
import { CELL_FT, CELL_M, resolveElement, type Model } from "./model.ts";
import type { HazardSpec } from "./types.ts";

const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class HazardState {
  readonly spec: HazardSpec;
  readonly smoke: Float32Array[];
  readonly #cap: Float32Array[];
  readonly arrival: Float32Array[];
  readonly blocked: Uint8Array[];
  readonly debris: Uint8Array[];
  readonly threat: Uint8Array[];
  readonly keepClear: Uint8Array[];
  readonly closedPortal: Uint8Array;
  readonly closedFlight: Uint8Array;
  readonly damagedElements: Set<number> = new Set();
  shaking = false;
  threatPos: { floor: number; x: number; y: number } | null = null;
  version = 0;
  readonly floorVersion: Int32Array;
  readonly #m: Model;
  #order: Int32Array = new Int32Array(0);
  #orderFloor: Int8Array = new Int8Array(0);
  #ptr = 0;
  #active: number[] = [];
  #core: Int32Array = new Int32Array(0);
  #coreD: Float32Array = new Float32Array(0);
  #corePtr = 0;
  #lastUpdate = -1;
  readonly #dirty: Uint8Array;
  readonly #hp: Params;
  readonly #origin: { floor: number; x: number; y: number } | null;
  #lastSmokeChange = -1;

  constructor(m: Model, spec: HazardSpec, hp: Params) {
    this.#m = m;
    this.#hp = hp;
    this.spec = spec;
    const mk = <T>(f: (n: number) => T) => m.floors.map((fm) => f(fm.n));
    this.smoke = mk((n) => new Float32Array(n));
    this.#cap = mk((n) => new Float32Array(n).fill(1));
    this.arrival = mk((n) => new Float32Array(n).fill(Infinity));
    this.blocked = mk((n) => new Uint8Array(n));
    this.debris = mk((n) => new Uint8Array(n));
    this.threat = mk((n) => new Uint8Array(n));
    this.keepClear = mk((n) => new Uint8Array(n));
    this.closedPortal = new Uint8Array(m.portals.length);
    this.closedFlight = new Uint8Array(m.flights.length);
    this.floorVersion = new Int32Array(m.floors.length);
    this.#dirty = new Uint8Array(m.floors.length);
    const fi = spec.floor ? m.floors.findIndex((f) => f.id === spec.floor) : -1;
    this.#origin = fi >= 0 && spec.at ? { floor: fi, x: spec.at[0], y: spec.at[1] } : null;
    if (spec.kind === "fire" && this.#origin) this.#computeArrival();
    if (spec.kind === "quake") this.#applyDamage(spec.damaged ?? []);
    if (spec.kind === "medical" && this.#origin) this.#markDisc(this.keepClear, this.#origin, hp.get("medical.radiusM"));
  }

  hp(key: string): number {
    const o = this.spec.overrides?.[key];
    return o === undefined ? this.#hp.get(key) : this.#hp.clamp(key, o);
  }

  #nearestCell(floor: number, x: number, y: number): number {
    const fm = this.#m.floors[floor]!;
    let best = -1, bd = Infinity;
    for (let i = 0; i < fm.n; i++) {
      if (!fm.walkable[i]) continue;
      const d = (fm.cx[i]! - x) ** 2 + (fm.cy[i]! - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  #computeArrival(): void {
    const m = this.#m, o = this.#origin!;
    const speed = this.hp("fire.smokeFrontSpeed"), doorDelay = this.hp("fire.doorDelaySec"), rise = this.hp("fire.riseDelaySec");
    const offsets: number[] = [];
    let total = 0;
    for (const fm of m.floors) { offsets.push(total); total += fm.n; }
    const dist = new Float64Array(total).fill(Infinity);
    const vertical = new Map<number, number[]>();
    m.twin.floors.forEach((floor, fi) => {
      if (fi === 0) return;
      const up = m.floors[fi]!, low = m.floors[fi - 1]!;
      for (const v of floor.voids) {
        const lowCells: number[] = [], ring: number[] = [];
        for (let i = 0; i < low.n; i++) if (low.walkable[i] && pointInPolygon(low.cx[i]!, low.cy[i]!, v)) lowCells.push(i);
        for (let i = 0; i < up.n; i++) {
          if (!up.walkable[i]) continue;
          for (let d = 0; d < 8 && ring[ring.length - 1] !== i; d++) {
            const dx = [1, 0, -1, 0, 1, -1, -1, 1][d]!, dy = [0, 1, 0, -1, 1, 1, -1, -1][d]!;
            const x = up.cx[i]! + dx * CELL_FT, y = up.cy[i]! + dy * CELL_FT;
            if (pointInPolygon(x, y, v)) ring.push(i);
          }
        }
        for (const c of lowCells) vertical.set(offsets[fi - 1]! + c, [...(vertical.get(offsets[fi - 1]! + c) ?? []), ...ring.map((r) => offsets[fi]! + r)]);
      }
    });
    const heap = new MinHeap();
    const start = offsets[o.floor]! + this.#nearestCell(o.floor, o.x, o.y);
    dist[start] = 0;
    heap.push(0, start);
    while (heap.size) {
      const d = heap.topKey();
      const g = heap.pop();
      if (d > dist[g]!) continue;
      let fi = 0;
      while (fi + 1 < offsets.length && offsets[fi + 1]! <= g) fi++;
      const fm = m.floors[fi]!, i = g - offsets[fi]!;
      for (let dir = 0; dir < 8; dir++) {
        const j = fm.nbr[i * 8 + dir]!;
        if (j < 0) continue;
        const p = fm.nbrPortal[i * 8 + dir]!;
        const nd = d + (STEP[dir]! * CELL_M) / speed + (p >= 0 && m.portals[p]!.kind === "door" ? doorDelay : 0);
        if (nd < dist[offsets[fi]! + j]!) { dist[offsets[fi]! + j] = nd; heap.push(nd, offsets[fi]! + j); }
      }
      for (const u of vertical.get(g) ?? []) if (d + rise < dist[u]!) { dist[u] = d + rise; heap.push(d + rise, u); }
    }
    const plumeFt = m.twin.venue?.kind === "outdoor" ? this.hp("fire.outdoorPlumeM") / 0.3048 : Infinity;
    m.floors.forEach((fm, fi) => {
      const a = this.arrival[fi]!, cap = this.#cap[fi]!;
      for (let i = 0; i < fm.n; i++) {
        const r = Math.hypot(fm.cx[i]! - o.x, fm.cy[i]! - o.y);
        cap[i] = plumeFt === Infinity ? 1 : Math.max(0, 1 - r / plumeFt);
        if (cap[i] === 0) dist[offsets[fi]! + i] = Infinity;
        a[i] = dist[offsets[fi]! + i]!;
      }
    });
    const fin: number[] = [];
    for (let g = 0; g < total; g++) if (dist[g]! < Infinity) fin.push(g);
    fin.sort((x, y) => dist[x]! - dist[y]! || x - y);
    this.#order = new Int32Array(fin.length);
    this.#orderFloor = new Int8Array(fin.length);
    fin.forEach((g, k) => {
      let fi = 0;
      while (fi + 1 < offsets.length && offsets[fi + 1]! <= g) fi++;
      this.#order[k] = g - offsets[fi]!;
      this.#orderFloor[k] = fi;
    });
    const ofm = m.floors[o.floor]!;
    const core: number[] = [];
    for (let i = 0; i < ofm.n; i++) if (ofm.walkable[i]) core.push(i);
    const d2 = (i: number) => (ofm.cx[i]! - o.x) ** 2 + (ofm.cy[i]! - o.y) ** 2;
    core.sort((x, y) => d2(x) - d2(y) || x - y);
    this.#core = Int32Array.from(core);
    this.#coreD = Float32Array.from(core, d2);
  }

  #markDisc(target: Uint8Array[], at: { floor: number; x: number; y: number }, radiusM: number): void {
    target.forEach((t) => t.fill(0));
    const fm = this.#m.floors[at.floor]!, r2 = (radiusM / M_PER_FT) ** 2, t = target[at.floor]!;
    for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && (fm.cx[i]! - at.x) ** 2 + (fm.cy[i]! - at.y) ** 2 <= r2) t[i] = 1;
  }

  #applyDamage(ids: string[]): void {
    const m = this.#m, r2 = (this.hp("quake.debrisRadiusM") / M_PER_FT) ** 2;
    for (const id of ids) {
      const stairFlights = m.flights.flatMap((f, k) => (f.stairId === id || `${f.stairId}@${m.floors[f.from]!.id}` === id ? [k] : []));
      for (const k of stairFlights) this.closedFlight[k] = 1;
      const elements = stairFlights.length
        ? stairFlights.map((k) => m.elements.findIndex((e) => e.flight === k))
        : [resolveElement(m, id, 0)].filter((e) => e >= 0);
      for (const ei of elements) {
        const e = m.elements[ei];
        if (!e) continue;
        this.damagedElements.add(ei);
        if (e.portal >= 0) this.closedPortal[e.portal] = 1;
        const fm = m.floors[e.floor]!, deb = this.debris[e.floor]!;
        for (const c of e.cells) for (let i = 0; i < fm.n; i++) {
          if (fm.walkable[i] && (fm.cx[i]! - fm.cx[c]!) ** 2 + (fm.cy[i]! - fm.cy[c]!) ** 2 <= r2) deb[i] = 1;
        }
      }
    }
    this.version++;
    this.floorVersion.forEach((_, i) => this.floorVersion[i]!++);
  }

  closeExternally(portals: number[], flights: number[]): void {
    for (const p of portals) this.closedPortal[p] = 1;
    for (const f of flights) this.closedFlight[f] = 1;
    this.version++;
    this.floorVersion.forEach((_, i) => this.floorVersion[i]!++);
  }

  update(tSec: number): void {
    const t = tSec - (this.spec.startSec ?? 0);
    if (t < 0) return;
    const kind = this.spec.kind;
    if (kind === "quake") {
      const shaking = t < this.hp("quake.shakeSec");
      if (shaking !== this.shaking) { this.shaking = shaking; this.version++; this.floorVersion.forEach((_, i) => this.floorVersion[i]!++); }
    } else if (kind === "fire" && this.#origin) {
      if (this.#lastUpdate >= 0 && t - this.#lastUpdate < 1 - 1e-9) return;
      this.#lastUpdate = t;
      const ramp = this.hp("fire.rampSec");
      while (this.#ptr < this.#order.length) {
        const fi = this.#orderFloor[this.#ptr]!, c = this.#order[this.#ptr]!;
        if (this.arrival[fi]![c]! > t) break;
        this.#active.push(fi * 0x1000000 + c);
        this.#ptr++;
      }
      const next: number[] = [];
      for (const key of this.#active) {
        const fi = Math.floor(key / 0x1000000), c = key - fi * 0x1000000;
        const lv = Math.min(this.#cap[fi]![c]!, (t - this.arrival[fi]![c]!) / ramp);
        if (lv !== this.smoke[fi]![c]) { this.smoke[fi]![c] = lv; this.#dirty[fi] = 1; }
        if (lv < this.#cap[fi]![c]!) next.push(key);
      }
      this.#active = next;
      const r2 = (Math.min(this.hp("fire.coreMaxM"), this.hp("fire.coreGrowth") * t) / M_PER_FT) ** 2;
      const of = this.#origin.floor;
      while (this.#corePtr < this.#core.length && this.#coreD[this.#corePtr]! <= r2) {
        const c = this.#core[this.#corePtr++]!;
        if (!this.blocked[of]![c]) { this.blocked[of]![c] = 1; this.#dirty[of] = 1; }
      }
      if (this.#dirty.some((x) => x) && (this.#lastSmokeChange < 0 || t - this.#lastSmokeChange >= 5)) {
        this.#lastSmokeChange = t;
        this.version++;
        this.#dirty.forEach((d, fi) => { if (d) { this.floorVersion[fi]!++; this.#dirty[fi] = 0; } });
      }
    } else if (kind === "threat" && this.#origin) {
      const path = this.spec.path && this.spec.path.length > 1 ? this.spec.path : [this.spec.at!];
      let remaining = (this.hp("threat.speed") * t) / M_PER_FT;
      let pos = path[0]!;
      for (let k = 1; k < path.length; k++) {
        const seg = Math.hypot(path[k]![0] - path[k - 1]![0], path[k]![1] - path[k - 1]![1]);
        if (remaining <= seg) { const f = seg > 0 ? remaining / seg : 0; pos = [path[k - 1]![0] + f * (path[k]![0] - path[k - 1]![0]), path[k - 1]![1] + f * (path[k]![1] - path[k - 1]![1])]; remaining = -1; break; }
        remaining -= seg; pos = path[k]!;
      }
      const next = { floor: this.#origin.floor, x: pos[0], y: pos[1] };
      if (!this.threatPos || Math.hypot(next.x - this.threatPos.x, next.y - this.threatPos.y) > 2) {
        this.threatPos = next;
        this.#markDisc(this.threat, next, this.hp("threat.radiusM"));
        this.version++;
        this.floorVersion[next.floor]!++;
      }
    }
  }

  routeCost(floor: number, out: Float32Array): Float32Array {
    const s = this.smoke[floor]!, th = this.threat[floor]!, kc = this.keepClear[floor]!, deb = this.debris[floor]!;
    const smokeCost = this.hp("fire.smokeCostM"), imp = this.hp("fire.impassableLevel");
    for (let i = 0; i < out.length; i++) out[i] = s[i]! * smokeCost * (s[i]! >= imp ? 10 : 1) + th[i]! * 1000 + kc[i]! * 50 + deb[i]! * CELL_M;
    return out;
  }
}
