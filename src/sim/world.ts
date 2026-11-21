import type { Params } from "../shared/params.ts";
import { Rng, deriveSeed } from "../shared/rng.ts";
import { M_PER_FT } from "../shared/units.ts";
import { STAFF_ROLES, AGES, MOBILITY, ROLES, buildPopulation, type Profiles } from "./population.ts";
import { distanceField } from "./fields.ts";
import { HazardState } from "./hazards.ts";
import { CELL_M, resolveElement, type Model } from "./model.ts";
import type { RoutePolicy, Scenario, SignState, ZoneInstruction } from "./types.ts";
import type { Decision, DecisionContext, DecisionPoint, DecisionPolicy } from "../policy/types.ts";
import { buildContext } from "../policy/context.ts";

import { INSTR, POLICY, ST, T_LOCK, compTarget } from "./constants.ts";
export { INSTR, POLICY, ST, ST_NAMES } from "./constants.ts";
const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export interface Policies {
  rule: DecisionPolicy;
  distilled?: DecisionPolicy;
  llm?: DecisionPolicy;
}

export interface WorldHooks {
  onDecision?(ctx: DecisionContext, d: Decision): void;
  onReject?(ctx: DecisionContext, raw: unknown, reason: string): void;
}

export interface WorldOptions {
  policies: Policies;
  llmAgents?: number;
  bulkPolicy?: "rule" | "distilled";
  hooks?: WorldHooks;
  thinkTicks?: [number, number];
  idle?: boolean;
}

interface Pending {
  agent: number;
  ctx: DecisionContext;
  due: number;
  promise: Promise<Decision> | null;
  result: Decision | null;
}

export interface RunMetrics {
  occupants: number;
  protected: number;
  sheltered: number;
  inRefuge: number;
  remaining: number;
  remainingAtTarget: number;
  clearance95Sec: number | null;
  clearanceAllSec: number | null;
  endSec: number;
  exitUsage: Record<string, number>;
  portalQueuePS: Record<string, number>;
  portalCrossings: Record<string, number>;
  flightEntries: Record<string, number>;
  densityDangerPS: number;
  smokeExposurePS: number;
  threatExposurePS: number;
  crushSec: number;
  gridlock: boolean;
  gridlockAtSec: number | null;
  meanPremoveSec: number;
  decisions: Record<string, number>;
  rejected: number;
}

export class World {
  readonly m: Model;
  readonly sc: Scenario;
  readonly p: Params;
  hz: HazardState;
  readonly #hp: Params;
  readonly premoveDur: Float32Array;
  readonly earlyLeaver: Uint8Array;
  alarmTick = -1;
  readonly dt: number;
  readonly opts: WorldOptions;
  tick = 0;
  readonly n: number;
  readonly floor: Int8Array;
  readonly cell: Int32Array;
  readonly state: Uint8Array;
  readonly credit: Float32Array;
  readonly vFree: Float32Array;
  readonly stress: Float32Array;
  readonly age: Uint8Array;
  readonly role: Uint8Array;
  readonly mobility: Uint8Array;
  readonly familiar: Uint8Array;
  readonly knownMask: Uint32Array;
  readonly familiarMask: Uint32Array;
  readonly closedMask: Uint32Array;
  readonly avoidMask: Uint32Array;
  readonly group: Int32Array;
  readonly groupLeader: Int32Array;
  readonly followGroup: Uint8Array;
  readonly target: Int32Array;
  readonly prevTarget: Int32Array;
  readonly targetSetZone: Int16Array;
  readonly policyKind: Uint8Array;
  readonly premoveEnd: Int32Array;
  readonly waitUntil: Int32Array;
  readonly blockedTicks: Int32Array;
  readonly instrKind: Uint8Array;
  readonly instrTarget: Int32Array;
  readonly instrUntil: Int32Array;
  readonly instrVersion: Int32Array;
  readonly flightOf: Int32Array;
  readonly stairPos: Float32Array;
  readonly assisted: Uint8Array;
  readonly protectedAt: Int32Array;
  readonly startedAt: Int32Array;
  readonly lastMissing: Int32Array;
  readonly decisionCount: Int32Array;
  readonly occ: Int32Array[];
  readonly rngs: { behaviour: Rng; decision: Rng; perception: Rng };
  readonly fields: Float32Array[];
  #fieldVersion = -1;
  readonly lockField: Float32Array[];
  readonly compField: Map<number, Float32Array> = new Map();
  readonly targetCount: Int32Array;
  readonly lastFlow: Int32Array;
  readonly tokens: Float64Array;
  readonly portalCap: Float64Array;
  readonly portalClosed: Uint8Array;
  readonly portalCrush: Uint8Array;
  readonly portalHighSince: Int32Array;
  readonly attemptStress: Float64Array;
  readonly attemptCount: Int32Array;
  readonly flightQ: number[][];
  readonly flightThrough: number[][];
  readonly flightTokens: Float64Array;
  readonly flightCap: Float64Array;
  readonly flightFloorTaken: Int32Array;
  readonly flightClosedExtra: Uint8Array;
  readonly chairsFree: Map<string, number> = new Map();
  readonly refugeAt: Set<string> = new Set();
  readonly signs: (SignState | null)[];
  readonly signVersion: Int32Array;
  readonly signDynamic: Uint8Array;
  readonly seen: Int32Array;
  readonly zoneInstr: (ZoneInstruction | null)[];
  zoneInstrVersion = 0;
  readonly zoneInstrAt: Int32Array;
  inflowClosed: Set<string> = new Set();
  readonly pending: Pending[] = [];
  readonly metrics = {
    queuePS: new Float64Array(0), crossings: new Int32Array(0), flightEntries: new Int32Array(0), exitUsage: new Int32Array(0),
    densityDangerPS: 0, smokeExposurePS: 0, threatExposurePS: 0, crushTicks: 0, gridlockAt: -1, lastProgress: 0,
    decisions: {} as Record<string, number>, rejected: 0, dangerCells: [] as Float32Array[], t95: -1, tAll: -1,
  };
  readonly #scratch: Float32Array[];
  #protectedCount = 0;
  #stableSince = -1;
  done = false;

  constructor(m: Model, sc: Scenario, p: Params, hp: Params, profiles: Profiles, opts: WorldOptions, dtSec = 0.25) {
    this.m = m; this.sc = sc; this.dt = dtSec; this.opts = opts;
    const overrides: Record<string, number> = {};
    for (const [k, v] of Object.entries(sc.behaviour)) overrides[k] = p.clamp(k, v);
    this.p = Object.keys(overrides).length ? p.withOverrides(overrides) : p;
    this.hz = new HazardState(m, sc.hazard, hp);
    this.#hp = hp;
    this.rngs = {
      behaviour: Rng.stream(sc.seed, "behaviour"),
      decision: Rng.stream(sc.seed, "decision"),
      perception: Rng.stream(sc.seed, "perception"),
    };
    const profile = profiles[sc.profile];
    const people = buildPopulation(m, sc, profile, this.p, Rng.stream(sc.seed, "population"));
    const n = (this.n = people.length);
    const I8 = () => new Int8Array(n), U8 = () => new Uint8Array(n), I32 = (f = 0) => new Int32Array(n).fill(f), F32 = () => new Float32Array(n), U32 = () => new Uint32Array(n);
    this.floor = I8(); this.cell = I32(); this.state = U8(); this.credit = F32(); this.vFree = F32(); this.stress = F32();
    this.age = U8(); this.role = U8(); this.mobility = U8(); this.familiar = U8();
    this.knownMask = U32(); this.familiarMask = U32(); this.closedMask = U32(); this.avoidMask = U32();
    this.group = I32(-1); this.groupLeader = I32(-1); this.followGroup = U8(); this.target = I32(-1); this.prevTarget = I32(-1); this.targetSetZone = new Int16Array(n).fill(-1);
    this.policyKind = U8(); this.premoveEnd = I32(); this.waitUntil = I32(); this.blockedTicks = I32();
    this.instrKind = U8(); this.instrTarget = I32(-1); this.instrUntil = I32(); this.instrVersion = I32(-1);
    this.flightOf = I32(-1); this.stairPos = F32(); this.assisted = U8(); this.protectedAt = I32(-1); this.startedAt = I32(-1);
    this.lastMissing = I32(-100000); this.decisionCount = I32();
    this.occ = m.floors.map((f) => new Int32Array(f.n));
    this.#scratch = m.floors.map((f) => new Float32Array(f.n));
    const pr = Rng.stream(sc.seed, "persona-attrs");
    const median = this.p.get(`premove.medianSec.${sc.profile}`), sigma = this.p.get(`premove.sigma.${sc.profile}`);
    const staffF = this.p.get("premove.staffFactor");
    this.premoveDur = new Float32Array(n);
    this.earlyLeaver = new Uint8Array(n);
    const handling = this.p.get("assist.handlingSec");
    const staffCount = people.filter((q) => STAFF_ROLES.has(ROLES[q.role] as string)).length;
    let patientK = 0;
    people.forEach((q, a) => {
      this.floor[a] = q.floor; this.cell[a] = q.cell; this.age[a] = q.age; this.role[a] = q.role; this.mobility[a] = q.mobility;
      this.familiar[a] = q.familiar ? 1 : 0; this.group[a] = q.group;
      this.occ[q.floor]![q.cell] = a + 1;
      const base = pr.truncNormal(this.p.get("walk.freeSpeed.mean"), this.p.get("walk.freeSpeed.sd"), 0.6, 2.0);
      const mob = MOBILITY[q.mobility] as string;
      const mf = mob === "unimpaired" ? 1 : mob === "assisted_patient" ? this.p.get("assist.horizontalSpeed") / this.p.get("walk.freeSpeed.mean") : this.p.get(`mobility.speedFactor.${mob}`);
      this.vFree[a] = base * mf * (AGES[q.age] === "child" ? this.p.get("walk.child.speedFactor") : 1);
      const staff = STAFF_ROLES.has(ROLES[q.role] as string);
      let pre = pr.lognormal(median, sigma) * (staff ? staffF : 1);
      if (mob === "assisted_patient") pre += Math.floor(patientK++ / Math.max(1, staffCount)) * handling;
      this.premoveDur[a] = pre;
      this.earlyLeaver[a] = pr.bool(this.p.get("quake.earlyLeaverShare")) ? 1 : 0;
      this.premoveEnd[a] = 2 ** 31 - 1;
      this.state[a] = ST.PREMOVE;
      const fm = m.floors[q.floor]!;
      let known = 0, fam = 0;
      for (const ei of m.elementsByFloor[q.floor]!) {
        const e = m.elements[ei]!;
        if (e.spaces.has(q.space)) known |= 1 << ei;
        if (q.familiar || e.kind === "stair" || e.id === "EX-N1" || e.id === "EX-S1") fam |= 1 << ei;
      }
      if (q.familiar) known |= fam;
      this.knownMask[a] = known | fam; this.familiarMask[a] = q.familiar ? fam : 0;
      void fm;
    });
    for (let a = 0; a < n; a++) {
      const g = this.group[a]!;
      if (g < 0) continue;
      let leader = a;
      for (let b = 0; b < n; b++) if (this.group[b] === g) { leader = b; break; }
      this.groupLeader[a] = leader;
      this.followGroup[a] = leader !== a ? 1 : 0;
    }
    if (!opts.idle) this.soundAlarm(Math.round((sc.hazard.startSec ?? 0) / dtSec));
    const bulk = opts.bulkPolicy === "distilled" && opts.policies.distilled ? POLICY.DISTILLED : POLICY.RULE;
    this.policyKind.fill(bulk);
    if (opts.llmAgents && opts.policies.llm) {
      const sel = Rng.stream(sc.seed, "showcase-select").shuffled([...Array(n).keys()]).slice(0, opts.llmAgents).sort((x, y) => x - y);
      for (const a of sel) this.policyKind[a] = POLICY.LLM;
    }
    const P = m.portals.length;
    this.tokens = new Float64Array(P); this.portalCap = new Float64Array(P); this.portalClosed = new Uint8Array(P); this.portalCrush = new Uint8Array(P);
    this.portalHighSince = new Int32Array(P).fill(-1); this.attemptStress = new Float64Array(P); this.attemptCount = new Int32Array(P);
    m.portals.forEach((pt, i) => {
      const kind = pt.kind === "door" || pt.isExit ? "door" : "corridor";
      const we = Math.max(0.3, pt.widthM - 2 * this.p.get(`flow.boundary.${kind}`));
      this.portalCap[i] = this.p.get(`flow.${kind}.FsMax`) * we;
    });
    const F = m.flights.length;
    this.flightQ = m.flights.map(() => []); this.flightThrough = m.flights.map(() => []);
    this.flightTokens = new Float64Array(F); this.flightCap = new Float64Array(F); this.flightFloorTaken = new Int32Array(F); this.flightClosedExtra = new Uint8Array(F);
    m.flights.forEach((f, i) => (this.flightCap[i] = this.p.get("flow.stair.FsMax") * Math.max(0.3, f.widthM - 2 * this.p.get("flow.boundary.stair"))));
    for (const e of sc.edits ?? []) {
      if (e.kind === "evac_chairs") this.chairsFree.set(e.target, (this.chairsFree.get(e.target) ?? 0) + (e.amount ?? 1));
      if (e.kind === "refuge") this.refugeAt.add(e.target);
    }
    const E = m.elements.length;
    this.targetCount = new Int32Array(E);
    this.lastFlow = new Int32Array(E);
    this.fields = m.elements.map((e) => new Float32Array(m.floors[e.floor]!.n));
    this.lockField = m.floors.map((f) => new Float32Array(f.n).fill(Infinity));
    this.metrics.queuePS = new Float64Array(P); this.metrics.crossings = new Int32Array(P); this.metrics.flightEntries = new Int32Array(F); this.metrics.exitUsage = new Int32Array(E);
    this.metrics.dangerCells = m.floors.map((f) => new Float32Array(f.n));
    const M = m.mounts.length;
    this.signs = m.mounts.map(() => null);
    this.signVersion = new Int32Array(M);
    this.signDynamic = new Uint8Array(M);
    for (const id of sc.dynamicMounts ?? []) { const k = m.mounts.findIndex((x) => x.id === id); if (k >= 0) this.signDynamic[k] = 1; }
    this.seen = new Int32Array(n * M).fill(-1);
    this.zoneInstr = m.zones.map(() => null);
    this.zoneInstrAt = new Int32Array(m.zones.length).fill(-1);
    m.mounts.forEach((mt, k) => {
      const st = sc.signs?.[mt.id];
      if (st) this.setSign(k, st);
      else if (mt.staticTarget >= 0) this.setSign(k, { kind: "STATIC_DEFAULT", arrow: { dir: "AHEAD", toward: m.elements[mt.staticTarget]!.id, label: "EXIT" } });
    });
    if (sc.routePolicy) this.applyRoutePolicy(sc.routePolicy);
    this.#rebuildFields();
  }

  get tSec(): number { return this.tick * this.dt; }

  soundAlarm(atTick = this.tick): void {
    if (this.alarmTick >= 0) return;
    this.alarmTick = atTick;
    const quake = this.hz.spec.kind === "quake";
    const shakeEnd = quake ? Math.round(((this.hz.spec.startSec ?? 0) + this.hz.hp("quake.shakeSec") + this.p.get("quake.postShakeDelaySec")) / this.dt) : 0;
    for (let a = 0; a < this.n; a++) {
      if (this.state[a] !== ST.PREMOVE) continue;
      let end = atTick + Math.round(this.premoveDur[a]! / this.dt);
      if (quake && !this.earlyLeaver[a]) end = Math.max(end, shakeEnd);
      this.premoveEnd[a] = Math.max(0, end);
    }
  }

  startHazard(spec: Scenario["hazard"]): void {
    this.hz = new HazardState(this.m, { ...spec, startSec: this.tSec }, this.#hp);
    this.#fieldVersion = -1;
    this.#floorBuilt = null;
    if (spec.kind === "quake" || spec.kind === "threat") this.soundAlarm();
  }
  targetTick = Number.MAX_SAFE_INTEGER;
  protectedBy(tick: number): number {
    let k = 0;
    for (let a = 0; a < this.n; a++) if (this.protectedAt[a]! >= 0 && this.protectedAt[a]! <= tick) k++;
    return k;
  }
  isStaff(a: number): boolean { return STAFF_ROLES.has(ROLES[this.role[a]!] as string); }

  setSign(k: number, s: SignState | null): void {
    this.signs[k] = s;
    this.signVersion[k] = this.signVersion[k]! + 1;
  }

  applyRoutePolicy(rp: RoutePolicy): void {
    this.zoneInstrVersion++;
    this.inflowClosed = new Set(rp.inflowClosed);
    for (const z of rp.zones) {
      const zi = this.m.zoneIndex.get(z.zone);
      if (zi === undefined) continue;
      this.zoneInstr[zi] = z;
      this.zoneInstrAt[zi] = this.tick;
    }
    const portals: number[] = [], flights: number[] = [];
    for (const id of rp.closedRoutes) {
      for (const [i, e] of this.m.elements.entries()) {
        if (e.id !== id && e.exitId !== id && e.stairId !== id) continue;
        if (e.portal >= 0) portals.push(e.portal);
        if (e.flight >= 0) flights.push(e.flight);
        void i;
      }
    }
    for (const p of portals) this.portalClosed[p] = 1;
    for (const f of flights) this.flightClosedExtra[f] = 1;
    this.#fieldVersion = -1;
    this.#floorBuilt = null;
    const reach = this.p.get("announce.reachShare");
    for (let a = 0; a < this.n; a++) {
      if (this.state[a] === ST.PROTECTED || this.state[a] === ST.ON_STAIR) continue;
      if (!this.rngs.perception.bool(reach)) continue;
      const zi = this.m.floors[this.floor[a]!]!.zone[this.cell[a]!]!;
      const z = zi >= 0 ? this.zoneInstr[zi] : null;
      if (z) this.#receiveInstruction(a, z);
    }
  }

  #receiveInstruction(a: number, z: ZoneInstruction): void {
    const fl = this.floor[a]!;
    if (z.instruction === "EVACUATE_VIA") {
      const e = z.via ? resolveElement(this.m, z.via, fl) : -1;
      if (e < 0) return;
      if (z.delaySec > 0) { this.instrKind[a] = INSTR.HOLD; this.instrUntil[a] = this.tick + Math.round(z.delaySec / this.dt); }
      else this.instrKind[a] = INSTR.ROUTE;
      this.instrTarget[a] = e;
    } else if (z.instruction === "HOLD") {
      this.instrKind[a] = INSTR.HOLD; this.instrUntil[a] = this.tick + Math.round(Math.max(1, z.delaySec) / this.dt); this.instrTarget[a] = -1;
    } else if (z.instruction === "LOCKDOWN") {
      this.instrKind[a] = INSTR.LOCKDOWN; this.instrTarget[a] = T_LOCK;
    } else {
      const zi = z.via ? this.m.zoneIndex.get(z.via) ?? -1 : -1;
      if (zi < 0) return;
      this.instrKind[a] = INSTR.COMPARTMENT; this.instrTarget[a] = compTarget(zi);
    }
    this.instrVersion[a] = this.zoneInstrVersion;
    if (this.state[a] === ST.MOVING || this.state[a] === ST.WAITING) this.raise(a, "SIGN_SEEN");
  }

  elementOpen(ei: number): boolean {
    const e = this.m.elements[ei]!;
    if (e.portal >= 0) return !this.portalClosed[e.portal] && !this.hz.closedPortal[e.portal];
    return !this.flightClosedExtra[e.flight] && !this.hz.closedFlight[e.flight];
  }

  elementCapacity(ei: number): number {
    const e = this.m.elements[ei]!;
    return e.portal >= 0 ? this.portalCap[e.portal]! : this.flightCap[e.flight]!;
  }

  #floorBuilt: Int32Array | null = null;
  #portalSig = "";

  #rebuildFields(): void {
    if (this.#fieldVersion === this.hz.version) return;
    this.#fieldVersion = this.hz.version;
    const closed = new Uint8Array(this.m.portals.length);
    for (let i = 0; i < closed.length; i++) closed[i] = this.portalClosed[i]! | this.hz.closedPortal[i]!;
    const sig = `${Array.from(closed).join("")}|${Array.from(this.flightClosedExtra).join("")}|${Array.from(this.hz.closedFlight).join("")}`;
    const all = sig !== this.#portalSig || !this.#floorBuilt;
    this.#portalSig = sig;
    const built = this.#floorBuilt ?? new Int32Array(this.m.floors.length).fill(-1);
    const changed = this.m.floors.map((_, fi) => all || built[fi] !== this.hz.floorVersion[fi]);
    const costs = this.m.floors.map((_, fi) => (changed[fi] ? this.hz.routeCost(fi, this.#scratch[fi]!) : null));
    this.m.elements.forEach((e, ei) => {
      if (!changed[e.floor]) return;
      const fm = this.m.floors[e.floor]!;
      distanceField(fm, this.elementOpen(ei) ? e.cells : [], this.fields[ei]!, { extraCost: costs[e.floor], blocked: this.hz.blocked[e.floor], closedPortal: closed });
    });
    const lockNeeded = this.zoneInstr.some((z) => z?.instruction === "LOCKDOWN");
    if (lockNeeded) this.m.floors.forEach((fm, fi) => {
      if (!changed[fi]) return;
      const src: number[] = [];
      for (let i = 0; i < fm.n; i++) if (fm.lockable[i] && !this.hz.threat[fi]![i]) src.push(i);
      distanceField(fm, src, this.lockField[fi]!, { extraCost: costs[fi] ?? this.hz.routeCost(fi, this.#scratch[fi]!), blocked: this.hz.blocked[fi], closedPortal: closed });
    });
    this.m.floors.forEach((_, fi) => (built[fi] = this.hz.floorVersion[fi]!));
    this.#floorBuilt = built;
    this.compField.clear();
  }

  fieldFor(a: number): Float32Array | null {
    const t = this.target[a]!;
    if (t >= 0) return this.fields[t]!;
    if (t === T_LOCK) return this.lockField[this.floor[a]!]!;
    if (t <= -3) {
      const zi = -3 - t, fi = this.floor[a]!;
      const key = zi * 16 + fi;
      let f = this.compField.get(key);
      if (!f) {
        const fm = this.m.floors[fi]!;
        const src: number[] = [];
        for (let i = 0; i < fm.n; i++) if (fm.zone[i] === zi && fm.walkable[i]) src.push(i);
        f = distanceField(fm, src, new Float32Array(fm.n), { extraCost: this.hz.routeCost(fi, new Float32Array(fm.n)), blocked: this.hz.blocked[fi], closedPortal: this.hz.closedPortal });
        this.compField.set(key, f);
      }
      return f;
    }
    return null;
  }

  localDensity(fi: number, c: number): number {
    const fm = this.m.floors[fi]!, occ = this.occ[fi]!;
    const x = c % fm.w, y = (c - x) / fm.w;
    let k = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= fm.h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < fm.w && occ[yy * fm.w + xx]) k++;
      }
    }
    const area = fm.winArea5[c]!;
    return area > 0 ? k / area : 0;
  }

  #personalSpaceOk(fi: number, j: number, self: number): boolean {
    const fm = this.m.floors[fi]!, occ = this.occ[fi]!;
    const s = this.stress[self]!;
    const tol = this.p.get("density.calmTolerance") + (this.p.get("density.pushTolerance") - this.p.get("density.calmTolerance")) * s;
    const from = this.cell[self]!;
    const jx = j % fm.w, jy = (j - jx) / fm.w;
    for (let qy = jy - 1; qy <= jy + 1; qy++) {
      if (qy < 0 || qy >= fm.h) continue;
      for (let qx = jx - 1; qx <= jx + 1; qx++) {
        if (qx < 0 || qx >= fm.w) continue;
        const q = qy * fm.w + qx;
        if (!fm.walkable[q]) continue;
        let k = 1;
        for (let y = qy - 1; y <= qy + 1; y++) {
          if (y < 0 || y >= fm.h) continue;
          for (let x = qx - 1; x <= qx + 1; x++) {
            if (x < 0 || x >= fm.w) continue;
            const i = y * fm.w + x;
            if (occ[i] && i !== from) k++;
          }
        }
        if (k > tol * fm.winArea3[q]! + 1e-6) return false;
      }
    }
    return true;
  }

  setTarget(a: number, t: number): void {
    const old = this.target[a]!;
    if (old === t) return;
    if (old >= 0) this.targetCount[old] = this.targetCount[old]! - 1;
    if (t >= 0) this.targetCount[t] = this.targetCount[t]! + 1;
    this.prevTarget[a] = old;
    this.target[a] = t;
    this.targetSetZone[a] = this.m.floors[this.floor[a]!]!.zone[this.cell[a]!]!;
  }

  #policyFor(a: number): DecisionPolicy {
    const k = this.policyKind[a];
    const pol = this.opts.policies;
    if (k === POLICY.LLM && pol.llm) return pol.llm;
    if (k === POLICY.DISTILLED && pol.distilled) return pol.distilled;
    return pol.rule;
  }

  raise(a: number, point: DecisionPoint): void {
    if (this.state[a] === ST.PROTECTED || this.state[a] === ST.ON_STAIR) return;
    if (this.pending.some((q) => q.agent === a)) return;
    const ctx = buildContext(this, a, point);
    if (!ctx.options.length) return;
    this.decisionCount[a] = this.decisionCount[a]! + 1;
    const pol = this.#policyFor(a);
    const rng = Rng.stream(deriveSeed(this.sc.seed, "decide", String(a), String(this.tick), point));
    const out = pol.decide(ctx, rng);
    const isAsync = out instanceof Promise;
    if (isAsync || pol.delayed) {
      const [lo, hi] = this.opts.thinkTicks ?? [4, 12];
      const due = this.tick + lo + Rng.stream(deriveSeed(this.sc.seed, "think", String(a), String(this.tick), point)).int(hi - lo + 1);
      const pend: Pending = { agent: a, ctx, due, promise: isAsync ? out : null, result: isAsync ? null : out };
      if (isAsync) out.then((d) => (pend.result = d), () => (pend.result = null));
      this.pending.push(pend);
      if (this.state[a] === ST.MOVING || this.state[a] === ST.WAITING) this.state[a] = ST.DECIDING;
      return;
    }
    this.#apply(a, ctx, out.optionId === "" ? this.fallbackDecision(ctx, out.note ?? "policy returned no decision") : out);
  }

  fallbackDecision(ctx: DecisionContext, reason: string): Decision {
    const rng = Rng.stream(deriveSeed(this.sc.seed, "fallback", String(ctx.agent), String(ctx.tick)));
    const d = this.opts.policies.distilled?.decide(ctx, rng);
    if (d && !(d instanceof Promise) && ctx.options.some((o) => o.id === d.optionId)) return { ...d, source: "fallback:distilled", note: reason };
    const r = this.opts.policies.rule.decide(ctx, rng) as Decision;
    return { ...r, source: "fallback:rule", note: reason };
  }

  #apply(a: number, ctx: DecisionContext, dIn: Decision): void {
    let d = dIn;
    const valid = ctx.options.find((o) => o.id === d.optionId);
    if (!valid) {
      this.metrics.rejected++;
      this.opts.hooks?.onReject?.(ctx, d, "option not in typed action set");
      d = this.fallbackDecision(ctx, "invalid option");
    }
    this.metrics.decisions[d.source] = (this.metrics.decisions[d.source] ?? 0) + 1;
    this.opts.hooks?.onDecision?.(ctx, d);
    const o = ctx.options.find((x) => x.id === d.optionId)!;
    if (this.state[a] === ST.PREMOVE || this.state[a] === ST.DECIDING || this.state[a] === ST.WAITING) this.state[a] = ST.MOVING;
    if (this.startedAt[a] < 0) this.startedAt[a] = this.tick;
    switch (o.action) {
      case "MOVE_TO":
        this.followGroup[a] = 0;
        this.setTarget(a, o.target);
        break;
      case "GO_BACK":
        if (this.target[a]! >= 0) this.avoidMask[a] = this.avoidMask[a]! | (1 << this.target[a]!);
        this.followGroup[a] = 0;
        this.setTarget(a, o.target);
        break;
      case "FOLLOW_SIGN": {
        const k = this.instrKind[a];
        if (k === INSTR.HOLD && this.instrUntil[a]! > this.tick) {
          this.state[a] = ST.WAITING; this.waitUntil[a] = this.instrUntil[a]!;
          if (this.instrTarget[a]! >= 0) this.setTarget(a, this.instrTarget[a]!);
        } else this.setTarget(a, o.target);
        this.followGroup[a] = 0;
        break;
      }
      case "FOLLOW_GROUP": {
        this.followGroup[a] = 1;
        const lt = this.target[this.groupLeader[a]!]!;
        if (lt !== -1 && (lt < 0 || this.m.elements[lt]!.floor === this.floor[a])) this.setTarget(a, lt);
        else { this.state[a] = ST.WAITING; this.waitUntil[a] = this.tick + Math.round(5 / this.dt); }
        break;
      }
      case "WAIT":
        this.state[a] = ST.WAITING; this.waitUntil[a] = this.tick + Math.round(10 / this.dt);
        break;
      case "HELP": {
        const b = o.target;
        if (b >= 0 && b < this.n) {
          this.assisted[b] = 1;
          this.vFree[b] = Math.max(this.vFree[b]!, this.p.get("assist.horizontalSpeed"));
          this.state[a] = ST.WAITING; this.waitUntil[a] = this.tick + Math.round(15 / this.dt);
          if (this.target[b]! >= 0) this.setTarget(a, this.target[b]!);
        }
        break;
      }
    }
    if (this.target[a] === -1 && this.state[a] === ST.MOVING) {
      const best = this.nearestOpenElement(a);
      if (best >= 0) this.setTarget(a, best);
    }
    if (!this.followGroup[a]) for (let b = 0; b < this.n; b++) {
      if (b !== a && this.groupLeader[b] === a && this.followGroup[b] && this.target[a]! >= 0 && this.floor[b] === this.floor[a] && this.state[b] !== ST.PROTECTED && this.state[b] !== ST.ON_STAIR) this.setTarget(b, this.target[a]!);
    }
  }

  nearestOpenElement(a: number): number {
    const fi = this.floor[a]!, c = this.cell[a]!;
    let best = -1, bd = Infinity;
    for (const ei of this.m.elementsByFloor[fi]!) {
      const d = this.fields[ei]![c]!;
      if (d < bd) { bd = d; best = ei; }
    }
    return best;
  }

  resolvePending(): void {
    for (let k = 0; k < this.pending.length;) {
      const q = this.pending[k]!;
      if (q.due > this.tick) { k++; continue; }
      this.pending.splice(k, 1);
      const d = q.result ?? this.fallbackDecision(q.ctx, "llm unavailable or missed deadline");
      if (this.state[q.agent] === ST.PROTECTED || this.state[q.agent] === ST.ON_STAIR) continue;
      this.#apply(q.agent, q.ctx, d);
    }
  }

  dueUnresolved(): Pending[] {
    return this.pending.filter((q) => q.due <= this.tick && !q.result && q.promise);
  }

  #protect(a: number, how: "exit" | "shelter" | "refuge" | "compartment"): void {
    const fi = this.floor[a]!, c = this.cell[a]!;
    if (how === "exit" || how === "compartment") {
      if (this.occ[fi]![c] === a + 1) this.occ[fi]![c] = 0;
      this.state[a] = ST.PROTECTED;
    } else this.state[a] = how === "shelter" ? ST.SHELTERING : ST.REFUGE;
    if (this.protectedAt[a] < 0) {
      this.protectedAt[a] = this.tick;
      this.#protectedCount++;
    }
    if (this.target[a]! >= 0) this.targetCount[this.target[a]!] = this.targetCount[this.target[a]!]! - 1;
    this.target[a] = -1;
    this.metrics.lastProgress = this.tick;
  }

  #perceive(): void {
    const m = this.m, rng = this.rngs.perception;
    const radius = this.p.get("perception.signRadiusM") / CELL_M;
    const pDyn = this.p.get("sign.detect.dynamic"), pStat = this.p.get("sign.detect.static");
    m.mounts.forEach((mt, k) => {
      const s = this.signs[k];
      if (!s || mt.cell < 0) return;
      const fm = m.floors[mt.floor]!, mx = mt.cell % fm.w, my = (mt.cell - mx) / fm.w;
      const v = this.signVersion[k]!;
      for (let a = 0; a < this.n; a++) {
        if (this.floor[a] !== mt.floor) continue;
        const st = this.state[a];
        if (st !== ST.MOVING && st !== ST.WAITING) continue;
        if (this.seen[a * m.mounts.length + k] === v) continue;
        const c = this.cell[a]!, x = c % fm.w, y = (c - x) / fm.w;
        if ((x - mx) ** 2 + (y - my) ** 2 > radius * radius) continue;
        if (!mt.visibleSpaces.has(fm.space[c]!)) continue;
        this.seen[a * m.mounts.length + k] = v;
        const dynamic = this.signDynamic[k] && s.kind !== "STATIC_DEFAULT";
        if (!rng.bool(dynamic ? pDyn : pStat)) continue;
        this.#readSign(a, s, mt.floor);
      }
    });
  }

  #readSign(a: number, s: SignState, fi: number): void {
    const m = this.m;
    if (s.kind === "HOLD") { this.instrKind[a] = INSTR.HOLD; this.instrUntil[a] = this.tick + Math.round(30 / this.dt); this.instrTarget[a] = -1; }
    else if (s.kind === "LOCKDOWN") { this.instrKind[a] = INSTR.LOCKDOWN; this.instrTarget[a] = T_LOCK; }
    else {
      const arrow = s.kind === "X_ALT" ? s.alt : s.arrow;
      if (s.kind === "X_ALT") {
        const b = resolveElement(m, s.blocked, fi);
        if (b >= 0) this.closedMask[a] = this.closedMask[a]! | (1 << b);
      }
      const e = resolveElement(m, arrow.toward, fi);
      if (e < 0) return;
      this.knownMask[a] = this.knownMask[a]! | (1 << e);
      if (s.kind === "STATIC_DEFAULT" && this.target[a]! >= 0) return;
      this.instrKind[a] = INSTR.ROUTE; this.instrTarget[a] = e;
    }
    this.raise(a, "SIGN_SEEN");
  }

  step(): void {
    if (this.done) return;
    const m = this.m, dt = this.dt, p = this.p, t = this.tick;
    this.hz.update(this.tSec);
    if (this.hz.version !== this.#fieldVersion) this.#rebuildFields();
    this.resolvePending();
    const shaking = this.hz.shaking;
    const noticeR2 = (this.hz.hp("threat.noticeRadiusM") / M_PER_FT) ** 2;
    for (let a = 0; a < this.n; a++) {
      const st = this.state[a];
      if (st === ST.PREMOVE) {
        const fi = this.floor[a]!, c = this.cell[a]!;
        let cue = this.hz.smoke[fi]![c]! > 0.05;
        const tp = this.hz.threatPos;
        if (tp && tp.floor === fi) {
          const fm = m.floors[fi]!;
          if ((fm.cx[c]! - tp.x) ** 2 + (fm.cy[c]! - tp.y) ** 2 < noticeR2) cue = true;
        }
        if (shaking && this.premoveEnd[a]! > t) cue = false;
        if (cue || this.premoveEnd[a]! <= t) {
          this.state[a] = ST.MOVING;
          this.startedAt[a] = t;
          if (this.instrKind[a] === INSTR.HOLD && this.instrUntil[a]! > t && this.zoneInstr[m.floors[fi]!.zone[c]!]?.instruction === "HOLD") {
            this.state[a] = ST.WAITING; this.waitUntil[a] = this.instrUntil[a]!;
          }
          this.raise(a, "ALARM_NOTICED");
        }
      } else if (st === ST.WAITING && this.waitUntil[a]! <= t) {
        this.state[a] = ST.MOVING;
        if (this.instrKind[a] === INSTR.HOLD && this.instrTarget[a]! >= 0) { this.instrKind[a] = INSTR.ROUTE; this.setTarget(a, this.instrTarget[a]!); }
        else this.raise(a, "JUNCTION");
      }
    }
    if (t % 4 === 0) this.#perceive();
    if (t % 4 === 0) this.#groupCheck();
    this.#stressAndExposure();
    this.#refill();
    this.#moveAgents();
    this.#advanceStairs();
    this.#crush();
    this.#checkEnd();
    this.tick++;
  }

  #groupCheck(): void {
    const sep2 = (this.p.get("group.separationDistM") / CELL_M) ** 2;
    for (let a = 0; a < this.n; a++) {
      if (this.groupLeader[a] !== a || this.state[a] !== ST.MOVING) continue;
      if (this.tick - this.lastMissing[a]! < 80) continue;
      const fi = this.floor[a]!, fm = this.m.floors[fi]!, c = this.cell[a]!;
      const ax = c % fm.w, ay = (c - ax) / fm.w;
      for (let b = 0; b < this.n; b++) {
        if (b === a || this.groupLeader[b] !== a) continue;
        const sb = this.state[b];
        if (sb === ST.PROTECTED || sb === ST.ON_STAIR || this.floor[b] !== fi) continue;
        const cb = this.cell[b]!, bx = cb % fm.w, by = (cb - bx) / fm.w;
        if ((bx - ax) ** 2 + (by - ay) ** 2 > sep2) {
          this.lastMissing[a] = this.tick;
          this.raise(a, "GROUP_MEMBER_MISSING");
          break;
        }
      }
    }
  }

  #stressAndExposure(): void {
    const p = this.p, dt = this.dt;
    const gH = p.get("stress.gain.hazard"), gD = p.get("stress.gain.density"), gB = p.get("stress.gain.blocked"), gC = p.get("stress.gain.contagion"), decay = p.get("stress.decayPerSec");
    const push = p.get("density.pushTolerance"), danger = p.get("density.danger");
    const alarm = this.sc.hazard.kind !== "none";
    const stuck = Math.round(p.get("blocked.timeoutSec") / dt);
    for (let a = 0; a < this.n; a++) {
      const st = this.state[a];
      if (st === ST.PROTECTED || st === ST.ON_STAIR) continue;
      const fi = this.floor[a]!, c = this.cell[a]!;
      const sm = this.hz.smoke[fi]![c]!, th = this.hz.threat[fi]![c]!;
      const D = this.localDensity(fi, c);
      if (D > danger) { this.metrics.densityDangerPS += dt; this.metrics.dangerCells[fi]![c] = this.metrics.dangerCells[fi]![c]! + dt; }
      if (st === ST.SHELTERING || st === ST.REFUGE) continue;
      this.metrics.smokeExposurePS += sm * dt;
      if (th) this.metrics.threatExposurePS += dt;
      const cue = Math.max(sm > 0.05 ? 1 : 0, this.hz.shaking ? 1 : 0, th ? 1 : 0, alarm ? 0.2 : 0);
      const fm = this.m.floors[fi]!, occ = this.occ[fi]!, x = c % fm.w, y = (c - x) / fm.w;
      let ns = 0, nk = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= fm.w || yy >= fm.h) continue;
        const o = occ[yy * fm.w + xx]!;
        if (o && o - 1 !== a) { ns += this.stress[o - 1]!; nk++; }
      }
      const s = this.stress[a]!;
      const tg = this.target[a]!;
      const routeStalled = this.blockedTicks[a]! >= stuck && (tg < 0 || this.tick - this.lastFlow[tg]! >= stuck || !this.elementOpen(tg));
      const dS = gH * cue + gD * Math.max(0, (D - danger) / (push - danger)) + gB * (routeStalled ? 1 : 0) + gC * Math.max(0, nk ? ns / nk - s : 0) - decay;
      this.stress[a] = Math.max(0, Math.min(1, s + dS * dt));
    }
  }

  #refill(): void {
    const dt = this.dt, gamma = this.p.get("stress.doorGamma"), collapse = this.p.get("crush.collapseFactor");
    for (let i = 0; i < this.tokens.length; i++) {
      const ms = this.attemptCount[i]! ? this.attemptStress[i]! / this.attemptCount[i]! : 0;
      const cap = this.portalCap[i]! * (1 - gamma * ms) * (this.portalCrush[i] ? collapse : 1);
      this.tokens[i] = Math.min(Math.max(1, cap * dt) + cap * dt, this.tokens[i]! + cap * dt);
      this.attemptStress[i] = 0; this.attemptCount[i] = 0;
    }
    for (let k = 0; k < this.flightTokens.length; k++) {
      const cap = this.flightCap[k]! * dt;
      this.flightTokens[k] = Math.min(Math.max(1, cap) + cap, this.flightTokens[k]! + cap);
      this.flightFloorTaken[k] = 0;
    }
  }

  #speed(a: number): number {
    const fi = this.floor[a]!, c = this.cell[a]!, p = this.p;
    const D = this.localDensity(fi, c);
    const aa = p.get("flow.a"), d0 = p.get("flow.freeDensityMax");
    const dd = Math.min(Math.max(D, d0), 1.9);
    const fD = (1 - aa * dd) / (1 - aa * d0);
    const sm = this.hz.smoke[fi]![c]!;
    const fS = 1 - (1 - p.get("smoke.speedFactor.min")) * sm;
    const fDeb = this.hz.debris[fi]![c] ? this.hz.hp("quake.debrisSpeedFactor") : 1;
    const fShake = this.hz.shaking ? 0.5 : 1;
    const fStress = 1 + (p.get("stress.speedCap") - 1) * this.stress[a]!;
    let v = this.vFree[a]! * fD * fS * fDeb * fShake * fStress;
    const g = this.groupLeader[a]!;
    if (g >= 0 && this.followGroup[a]) v = Math.min(v, this.vFree[g]! * fStress * fD);
    return v;
  }

  #moveAgents(): void {
    const m = this.m;
    const movers: number[] = [];
    for (let a = 0; a < this.n; a++) if (this.state[a] === ST.MOVING) movers.push(a);
    const key = new Float64Array(this.n);
    for (const a of movers) {
      const f = this.fieldFor(a);
      key[a] = f ? f[this.cell[a]!]! : Infinity;
    }
    movers.sort((x, y) => key[x]! - key[y]! || x - y);
    const blockedLimit = Math.round(this.p.get("blocked.timeoutSec") / this.dt);
    for (const a of movers) {
      if (this.state[a] !== ST.MOVING) continue;
      const fi = this.floor[a]!, fm = m.floors[fi]!, occ = this.occ[fi]!;
      const t = this.target[a]!;
      if (t === -1) {
        const best = this.nearestOpenElement(a);
        if (best < 0) { this.blockedTicks[a]++; continue; }
        this.setTarget(a, best);
      }
      const field = this.fieldFor(a)!;
      let c = this.cell[a]!;
      if (this.#tryArrive(a, c)) continue;
      if (field[c] === Infinity) {
        this.blockedTicks[a]++;
        if (this.#blockedDue(a, blockedLimit)) this.#blocked(a);
        continue;
      }
      this.credit[a] = this.credit[a]! + this.#speed(a) * this.dt;
      let moved = false;
      while (this.credit[a]! >= CELL_M) {
        let best = -1, bestDir = -1, bv = field[c]!;
        for (let d = 0; d < 8; d++) {
          const j = fm.nbr[c * 8 + d]!;
          if (j < 0 || occ[j] || this.hz.blocked[fi]![j]) continue;
          const v = field[j]!;
          if (v >= bv) continue;
          const pi = fm.nbrPortal[c * 8 + d]!;
          if (pi >= 0 && (this.portalClosed[pi] || this.hz.closedPortal[pi])) continue;
          best = j; bestDir = d; bv = v;
        }
        if (best < 0) {
          if (this.blockedTicks[a]! >= 4 && this.#trySwap(a, fi, c, field)) { moved = true; c = this.cell[a]!; }
          break;
        }
        const pi = fm.nbrPortal[c * 8 + bestDir]!;
        if (pi >= 0) {
          this.attemptStress[pi] = this.attemptStress[pi]! + this.stress[a]!; this.attemptCount[pi]++;
          if (this.tokens[pi]! < 1) { this.metrics.queuePS[pi] = this.metrics.queuePS[pi]! + this.dt; break; }
        }
        if (!this.#personalSpaceOk(fi, best, a)) { if (pi >= 0) this.metrics.queuePS[pi] = this.metrics.queuePS[pi]! + this.dt; break; }
        if (pi >= 0) {
          const doorDelay = this.mobility[a]! >= 2 && m.portals[pi]!.kind === "door" ? this.p.get("mobility.door.delaySec") * this.portalCap[pi]! : 0;
          this.tokens[pi] = this.tokens[pi]! - 1 - doorDelay;
          this.metrics.crossings[pi]++;
          this.metrics.lastProgress = this.tick;
        }
        occ[c] = 0; occ[best] = a + 1; this.cell[a] = best; c = best;
        this.credit[a] = this.credit[a]! - CELL_M * STEP[bestDir]!;
        moved = true;
        if (this.#tryArrive(a, c)) break;
      }
      if (this.state[a] !== ST.MOVING) continue;
      if (this.credit[a]! > CELL_M * 1.5) this.credit[a] = CELL_M * 1.5;
      if (moved) this.blockedTicks[a] = 0;
      else {
        this.blockedTicks[a]++;
        if (this.#blockedDue(a, blockedLimit)) this.#blocked(a);
      }
    }
  }

  #trySwap(a: number, fi: number, c: number, field: Float32Array): boolean {
    const fm = this.m.floors[fi]!, occ = this.occ[fi]!;
    for (let d = 0; d < 4; d++) {
      const j = fm.nbr[c * 8 + d]!;
      if (j < 0 || !occ[j] || field[j]! >= field[c]!) continue;
      const pi = fm.nbrPortal[c * 8 + d]!;
      if (pi >= 0 && (this.portalClosed[pi] || this.hz.closedPortal[pi])) continue;
      const b = occ[j]! - 1;
      if (this.state[b] !== ST.MOVING || this.floor[b] !== fi) continue;
      const fb = this.fieldFor(b);
      if (!fb || !(fb[c]! < fb[j]!) || this.blockedTicks[b]! < 4) continue;
      if (pi >= 0) {
        if (this.tokens[pi]! < 1) continue;
        this.tokens[pi] = this.tokens[pi]! - 2;
        this.metrics.crossings[pi] = this.metrics.crossings[pi]! + 2;
      }
      occ[c] = b + 1; occ[j] = a + 1;
      this.cell[a] = j; this.cell[b] = c;
      this.blockedTicks[b] = 0;
      this.credit[a] = 0; this.credit[b] = 0;
      return true;
    }
    return false;
  }

  #blockedDue(a: number, limit: number): boolean {
    const b = this.blockedTicks[a]!;
    return b === limit || (b > limit && (b - limit) % (limit * 4) === 0);
  }

  #blocked(a: number): void {
    const t = this.target[a]!;
    if (t >= 0 && !this.elementOpen(t)) this.closedMask[a] = this.closedMask[a]! | (1 << t);
    this.raise(a, "BLOCKED");
  }

  #tryArrive(a: number, c: number): boolean {
    const fi = this.floor[a]!, fm = this.m.floors[fi]!, t = this.target[a]!;
    if (t === T_LOCK) {
      if (fm.lockable[c] && !this.hz.threat[fi]![c]) { this.#protect(a, "shelter"); return true; }
      return false;
    }
    if (t <= -3) {
      if (fm.zone[c] === -3 - t) { this.#protect(a, this.targetSetZone[a] === -3 - t ? "shelter" : "compartment"); return true; }
      return false;
    }
    if (t < 0) return false;
    const e = this.m.elements[t]!;
    if (e.portal >= 0) {
      if (fm.exitPortal[c] !== e.portal) return false;
      const lvl = this.mobility[a]! >= 3;
      if (!this.elementOpen(t) || (lvl && !this.m.portals[e.portal]!.accessible)) { this.closedMask[a] = this.closedMask[a]! | (1 << t); this.raise(a, "BLOCKED"); return false; }
      if (this.tokens[e.portal]! < 1) { this.metrics.queuePS[e.portal] = this.metrics.queuePS[e.portal]! + this.dt; return false; }
      const doorDelay = this.mobility[a]! >= 2 ? this.p.get("mobility.door.delaySec") * this.portalCap[e.portal]! : 0;
      this.tokens[e.portal] = this.tokens[e.portal]! - 1 - doorDelay;
      this.metrics.crossings[e.portal]++;
      this.metrics.exitUsage[t]++;
      this.lastFlow[t] = this.tick;
      this.#protect(a, "exit");
      return true;
    }
    if (fm.headFlight[c] !== e.flight) return false;
    const k = e.flight;
    if (!this.elementOpen(t)) { this.closedMask[a] = this.closedMask[a]! | (1 << t); this.raise(a, "BLOCKED"); return false; }
    const mob = MOBILITY[this.mobility[a]!];
    const stairId = e.stairId!;
    const chairKey = stairId;
    const needsChair = mob === "wheelchair" || mob === "assisted_patient";
    if (needsChair) {
      const free = this.chairsFree.get(chairKey) ?? 0;
      if (free <= 0) {
        this.#stepAside(a);
        if (this.refugeAt.has(`${stairId}@${fm.id}`)) { this.#protect(a, "refuge"); return true; }
        this.state[a] = ST.REFUGE;
        return true;
      }
      this.chairsFree.set(chairKey, free - 1);
    }
    if (!this.#canEnter(k, true)) {
      if (needsChair) this.chairsFree.set(chairKey, (this.chairsFree.get(chairKey) ?? 0) + 1);
      return false;
    }
    this.#enterFlight(a, k);
    return true;
  }

  #stepAside(a: number): void {
    const fi = this.floor[a]!, fm = this.m.floors[fi]!, occ = this.occ[fi]!, c0 = this.cell[a]!;
    const x0 = c0 % fm.w, y0 = (c0 - x0) / fm.w;
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 8 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= fm.w || y >= fm.h) continue;
      const j = y * fm.w + x;
      if (!fm.walkable[j] || occ[j] || fm.headFlight[j] >= 0 || fm.exitPortal[j] >= 0 || this.hz.blocked[fi]![j]) continue;
      let nearPortal = false;
      for (let d = 0; d < 4; d++) {
        if (fm.nbrPortal[j * 8 + d]! >= 0 && this.m.portals[fm.nbrPortal[j * 8 + d]!]!.kind !== "corridor_section") nearPortal = true;
        const k = fm.nbr[j * 8 + d]!;
        if (k >= 0 && fm.headFlight[k] >= 0) nearPortal = true;
      }
      if (nearPortal) continue;
      const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = j; }
    }
    if (best < 0) return;
    occ[c0] = 0; occ[best] = a + 1; this.cell[a] = best;
  }

  #canEnter(k: number, fromFloor: boolean): boolean {
    if (this.flightTokens[k]! < 1) return false;
    const q = this.flightQ[k]!;
    if (q.length && this.stairPos[q[q.length - 1]!]! < 0.6) return false;
    if (fromFloor && this.flightThrough[k]!.length) {
      const merge = this.p.get("stair.mergeRatio");
      const avail = this.flightCap[k]! * this.dt;
      if (this.flightFloorTaken[k]! >= Math.max(1, Math.ceil(avail * (1 - merge)))) return false;
    }
    return true;
  }

  #enterFlight(a: number, k: number): void {
    const fi = this.floor[a]!;
    if (this.occ[fi]![this.cell[a]!] === a + 1) this.occ[fi]![this.cell[a]!] = 0;
    this.flightTokens[k] = this.flightTokens[k]! - 1;
    this.flightFloorTaken[k]++;
    this.flightQ[k]!.push(a);
    this.flightOf[a] = k;
    this.stairPos[a] = 0;
    this.state[a] = ST.ON_STAIR;
    this.metrics.flightEntries[k]++;
    this.metrics.lastProgress = this.tick;
    const t = this.target[a]!;
    if (t >= 0) { this.targetCount[t] = this.targetCount[t]! - 1; this.lastFlow[t] = this.tick; }
    this.target[a] = -1;
  }

  #advanceStairs(): void {
    const m = this.m, p = this.p, dt = this.dt, kS = p.get("flow.stair.k"), aa = p.get("flow.a");
    m.flights.forEach((fl, k) => {
      const through = this.flightThrough[k]!;
      while (through.length && this.#canEnter(k, false)) {
        const a = through.shift()!;
        this.flightTokens[k] = this.flightTokens[k]! - 1;
        this.flightQ[k]!.push(a); this.flightOf[a] = k; this.stairPos[a] = 0;
        this.metrics.flightEntries[k]++;
      }
      const q = this.flightQ[k]!;
      if (!q.length) return;
      const D = q.length / Math.max(0.5, fl.lengthM * fl.widthM);
      const vs = Math.max(0.1, kS * (1 - aa * Math.min(Math.max(D, 0.54), 1.9)));
      const chairV = p.get("assist.evacChair.stairSpeed");
      let ahead = Infinity;
      for (let idx = 0; idx < q.length; idx++) {
        const a = q[idx]!;
        const mob = MOBILITY[this.mobility[a]!];
        const ownV = mob === "wheelchair" || mob === "assisted_patient" ? chairV : mob === "unimpaired" ? vs : vs * p.get(`mobility.speedFactor.${mob}`);
        this.stairPos[a] = Math.min(this.stairPos[a]! + ownV * dt, ahead - 0.6, fl.lengthM);
        ahead = this.stairPos[a]!;
      }
      while (q.length && this.stairPos[q[0]!]! >= fl.lengthM - 1e-6) {
        const a = q[0]!;
        if (fl.next >= 0 && !this.flightClosedExtra[fl.next] && !this.hz.closedFlight[fl.next]) {
          q.shift();
          this.flightThrough[fl.next]!.push(a);
          this.flightOf[a] = fl.next;
          this.stairPos[a] = 0;
          continue;
        }
        const occ = this.occ[fl.to]!;
        let spot = -1;
        for (const c of fl.landingCells) if (!occ[c]) { spot = c; break; }
        if (spot < 0) break;
        q.shift();
        occ[spot] = a + 1;
        this.floor[a] = fl.to; this.cell[a] = spot; this.flightOf[a] = -1; this.state[a] = ST.MOVING; this.credit[a] = 0;
        if (this.instrTarget[a]! >= 0 && this.m.elements[this.instrTarget[a]!]!.floor !== fl.to) { this.instrKind[a] = INSTR.NONE; this.instrTarget[a] = -1; }
        if (this.target[a]! >= 0) { this.targetCount[this.target[a]!] = this.targetCount[this.target[a]!]! - 1; this.target[a] = -1; }
        const mob = MOBILITY[this.mobility[a]!];
        if (mob === "wheelchair" || mob === "assisted_patient") this.chairsFree.set(fl.stairId, (this.chairsFree.get(fl.stairId) ?? 0) + 1);
        this.metrics.lastProgress = this.tick;
        const fam = this.m.elementsByFloor[fl.to]!;
        let known = this.knownMask[a]!;
        for (const ei of fam) if (this.m.elements[ei]!.spaces.has(this.m.floors[fl.to]!.space[spot]!)) known |= 1 << ei;
        if (this.familiar[a]) for (const ei of fam) known |= 1 << ei;
        this.knownMask[a] = known;
        this.raise(a, "JUNCTION");
      }
    });
  }

  #crush(): void {
    const p = this.p, thr = p.get("crush.density"), rec = p.get("crush.recoverDensity"), sustain = Math.round(p.get("crush.sustainSec") / this.dt);
    let any = false;
    if (this.tick % 2) return;
    this.m.portals.forEach((pt, i) => {
      if (!pt.cells.length) return;
      let D = 0;
      for (const c of pt.cells) D = Math.max(D, this.localDensity(pt.floor, c));
      if (this.portalCrush[i]) {
        any = true;
        if (D < rec) { this.portalCrush[i] = 0; this.portalHighSince[i] = -1; }
      } else if (D > thr) {
        if (this.portalHighSince[i]! < 0) this.portalHighSince[i] = this.tick;
        else if (this.tick - this.portalHighSince[i]! >= sustain) this.portalCrush[i] = 1;
      } else this.portalHighSince[i] = -1;
    });
    if (any) this.metrics.crushTicks += 2;
  }

  #checkEnd(): void {
    const n = this.n, t = this.tick;
    if (this.metrics.t95 < 0 && this.#protectedCount >= Math.ceil(0.95 * n)) this.metrics.t95 = t;
    if (this.metrics.tAll < 0 && this.#protectedCount >= n) this.metrics.tAll = t;
    let active = 0, waiting = 0;
    for (let a = 0; a < n; a++) {
      const s = this.state[a];
      if (s === ST.MOVING || s === ST.ON_STAIR || s === ST.DECIDING || s === ST.PREMOVE) active++;
      else if (s === ST.WAITING || s === ST.HOLDING) waiting++;
    }
    for (const q of this.flightThrough) active += q.length;
    const gridlockTicks = Math.round(60 / this.dt);
    if (active > 0 && this.metrics.gridlockAt < 0 && t - this.metrics.lastProgress > gridlockTicks) {
      let stuck = false;
      for (let a = 0; a < n; a++) if ((this.state[a] === ST.MOVING || this.state[a] === ST.DECIDING) && this.blockedTicks[a]! >= gridlockTicks) { stuck = true; break; }
      if (stuck) this.metrics.gridlockAt = t;
    }
    if (this.opts.idle) { if (this.tSec >= this.sc.maxSec) this.done = true; return; }
    if (active === 0 && waiting === 0 && !this.pending.length) {
      if (this.#stableSince < 0) this.#stableSince = t;
      if (t - this.#stableSince >= Math.round(10 / this.dt) || this.#protectedCount >= n) this.done = true;
    } else this.#stableSince = -1;
    if (this.metrics.gridlockAt >= 0 && t - this.metrics.gridlockAt > gridlockTicks) this.done = true;
    if (this.tSec >= this.sc.maxSec) this.done = true;
  }

  summary(): RunMetrics {
    const m = this.m, dt = this.dt, M = this.metrics;
    let prot = 0, shel = 0, ref = 0, pre = 0, preN = 0;
    for (let a = 0; a < this.n; a++) {
      const s = this.state[a];
      if (s === ST.PROTECTED) prot++;
      else if (s === ST.SHELTERING) shel++;
      else if (s === ST.REFUGE && this.protectedAt[a]! >= 0) ref++;
      if (this.startedAt[a]! >= 0) { pre += this.startedAt[a]! * dt - (this.sc.hazard.startSec ?? 0); preN++; }
    }
    const rec = <T>(ids: string[], arr: ArrayLike<number>, f: (v: number) => T) => Object.fromEntries(ids.map((id, i) => [id, f(arr[i] as number)]));
    return {
      occupants: this.n, protected: prot, sheltered: shel, inRefuge: ref, remaining: this.n - prot - shel - ref, remainingAtTarget: this.n - this.protectedBy(this.targetTick),
      clearance95Sec: M.t95 >= 0 ? M.t95 * dt : null, clearanceAllSec: M.tAll >= 0 ? M.tAll * dt : null, endSec: this.tick * dt,
      exitUsage: rec(m.elements.map((e) => e.id), M.exitUsage, (v) => v),
      portalQueuePS: rec(m.portals.map((p) => p.id), M.queuePS, (v) => Math.round(v * 100) / 100),
      portalCrossings: rec(m.portals.map((p) => p.id), M.crossings, (v) => v),
      flightEntries: rec(m.flights.map((f) => `${f.stairId}:${m.floors[f.from]!.id}>${m.floors[f.to]!.id}`), M.flightEntries, (v) => v),
      densityDangerPS: Math.round(M.densityDangerPS * 100) / 100, smokeExposurePS: Math.round(M.smokeExposurePS * 100) / 100,
      threatExposurePS: Math.round(M.threatExposurePS * 100) / 100, crushSec: M.crushTicks * dt,
      gridlock: M.gridlockAt >= 0, gridlockAtSec: M.gridlockAt >= 0 ? M.gridlockAt * dt : null,
      meanPremoveSec: preN ? Math.round((pre / preN) * 100) / 100 : 0, decisions: { ...M.decisions }, rejected: M.rejected,
    };
  }

  agentPosition(a: number): [number, number, number] {
    const m = this.m;
    if (this.state[a] === ST.ON_STAIR || this.flightOf[a]! >= 0) {
      const k = this.flightOf[a]!;
      if (k >= 0) {
        const fl = m.flights[k]!, st = m.twin.stairs.find((s) => s.id === fl.stairId)!;
        const f = st.flights.find((x) => x.from === m.floors[fl.from]!.id && x.to === m.floors[fl.to]!.id) ?? st.flights[0]!;
        const c = (pts: [number, number][]) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
        const [hx, hy] = c(f.head), [lx, ly] = c(f.landing);
        const r = Math.min(1, this.stairPos[a]! / fl.lengthM);
        const z = m.floors[fl.from]!.elevationFt + r * (m.floors[fl.to]!.elevationFt - m.floors[fl.from]!.elevationFt);
        return [hx! + r * (lx! - hx!), hy! + r * (ly! - hy!), z];
      }
    }
    const fm = m.floors[this.floor[a]!]!, c = this.cell[a]!;
    return [fm.cx[c]!, fm.cy[c]!, fm.elevationFt];
  }
}
