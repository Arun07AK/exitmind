import { M_PER_FT } from "../shared/units.ts";
import { INSTR, ST, T_LOCK } from "../sim/constants.ts";
import { CELL_M } from "../sim/model.ts";
import { AGES, MOBILITY, ROLES } from "../sim/population.ts";
import type { World } from "../sim/world.ts";
import { situationKey, type DecisionContext, type DecisionOption, type DecisionPoint, type OptionNumbers, type Persona, type RoleTag, type Situation } from "./types.ts";

const LETTERS = "ABCDEFGH";
const STRESS = ["calm", "uneasy", "stressed", "panicked"] as const;

function routeHazard(w: World, a: number, ei: number): number {
  const fi = w.floor[a]!, fm = w.m.floors[fi]!, f = w.fields[ei]!;
  let c = w.cell[a]!, h = 0;
  for (let k = 0; k < 120; k++) {
    h = Math.max(h, w.hz.smoke[fi]![c]!, w.hz.threat[fi]![c]!, w.hz.keepClear[fi]![c]! * 0.5, w.hz.debris[fi]![c]! * 0.3);
    let best = -1, bv = f[c]!;
    for (let d = 0; d < 8; d++) {
      const j = fm.nbr[c * 8 + d]!;
      if (j >= 0 && f[j]! < bv) { bv = f[j]!; best = j; }
    }
    if (best < 0) break;
    c = best;
  }
  return Math.round(h * 100) / 100;
}

function herdShares(w: World, a: number): Map<number, number> {
  const fi = w.floor[a]!, fm = w.m.floors[fi]!, occ = w.occ[fi]!, c = w.cell[a]!;
  const r = Math.round(w.p.get("herding.radiusM") / CELL_M);
  const x = c % fm.w, y = (c - x) / fm.w, sp = fm.space[c];
  const counts = new Map<number, number>();
  let total = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= fm.w || yy >= fm.h) continue;
    const o = occ[yy * fm.w + xx]!;
    if (!o || o - 1 === a || fm.space[yy * fm.w + xx] !== sp) continue;
    const t = w.target[o - 1]!;
    if (t < 0) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    total++;
  }
  for (const [k, v] of counts) counts.set(k, total ? v / total : 0);
  return counts;
}

const distWord = (d: number) => (d < 20 ? "close" : d < 50 ? "a short walk" : "far");
const queueWord = (q: number) => (q < 10 ? "clear" : q < 40 ? "busy" : "very crowded");

export function buildContext(w: World, a: number, point: DecisionPoint): DecisionContext {
  const m = w.m, fi = w.floor[a]!, fm = m.floors[fi]!, c = w.cell[a]!;
  const space = fm.space[c]!;
  let known = w.knownMask[a]!;
  const sightM = w.p.get("perception.openGroundSightM");
  for (const ei of m.elementsByFloor[fi]!) if (m.twin.venue ? w.fields[ei]![c]! <= sightM : m.elements[ei]!.spaces.has(space)) known |= 1 << ei;
  w.knownMask[a] = known;
  const herd = herdShares(w, a);
  const instr = w.instrKind[a]!;
  const it = w.instrTarget[a]!;
  const signedEl = (instr === INSTR.ROUTE || instr === INSTR.HOLD) && it >= 0 && m.elements[it]!.floor === fi ? it : -1;
  const reachable = m.elementsByFloor[fi]!.filter((ei) => w.fields[ei]![c]! < Infinity);
  let cand = reachable.filter((ei) => (known >> ei) & 1 && !((w.closedMask[a]! >> ei) & 1) && !((w.avoidMask[a]! >> ei) & 1));
  if (!cand.length) cand = reachable.filter((ei) => !((w.closedMask[a]! >> ei) & 1));
  if (!cand.length) cand = reachable;
  const nums = new Map<number, OptionNumbers>();
  for (const ei of cand) nums.set(ei, {
    distM: Math.round(w.fields[ei]![c]! * 10) / 10,
    queueSec: Math.round((w.targetCount[ei]! / Math.max(0.1, w.elementCapacity(ei))) * 10) / 10,
    hazard: routeHazard(w, a, ei),
    herd: Math.round((herd.get(ei) ?? 0) * 100) / 100,
    familiar: !!((w.familiarMask[a]! >> ei) & 1),
    signed: ei === signedEl,
  });
  const byDist = [...cand].sort((x, y) => nums.get(x)!.distM - nums.get(y)!.distM || x - y);
  const keep = new Set(byDist.slice(0, 4));
  for (const ei of cand) if (nums.get(ei)!.familiar && keep.size < 5) keep.add(ei);
  const moveEls = [...keep].filter((ei) => ei !== signedEl).sort((x, y) => nums.get(x)!.distM - nums.get(y)!.distM || x - y);
  const minDist = Math.min(...cand.map((ei) => nums.get(ei)!.distM));
  const minQueue = Math.min(...cand.map((ei) => nums.get(ei)!.queueSec));
  const maxHerd = Math.max(0, ...cand.map((ei) => nums.get(ei)!.herd));
  const rolesFor = (ei: number): RoleTag[] => {
    const nn = nums.get(ei)!, e = m.elements[ei]!, r: RoleTag[] = [];
    if (nn.distM === minDist) r.push("NEAREST");
    if (ei === w.entryEl[a]) r.push("ENTRY");
    if (nn.familiar) r.push("FAMILIAR");
    if (nn.signed) r.push("SIGNED");
    if (cand.length > 1 && nn.queueSec === minQueue) r.push("LEAST_CROWDED");
    if (maxHerd >= 0.3 && nn.herd === maxHerd) r.push("MAJORITY");
    if (nn.hazard >= 0.2) r.push("HAZARD_ON_ROUTE");
    r.push(e.kind === "stair" ? "STAIR" : "LEVEL");
    return r;
  };
  const describe = (ei: number, verb: string): string => {
    const nn = nums.get(ei)!;
    const bits = [distWord(nn.distM), queueWord(nn.queueSec)];
    if (ei === w.entryEl[a]) bits.push("the gate you came in through");
    else if (nn.familiar) bits.push("a way you know");
    if (nn.herd >= 0.3) bits.push("others nearby are heading there");
    if (nn.hazard >= 0.2) bits.push("hazard on the way");
    return `${verb} ${m.elements[ei]!.label} (${bits.join(", ")})`;
  };
  const options: DecisionOption[] = [];
  const add = (o: Omit<DecisionOption, "id">) => { if (options.length < 8) options.push({ ...o, id: LETTERS[options.length]! }); };
  const zero: OptionNumbers = { distM: 0, queueSec: 0, hazard: 0, herd: 0, familiar: false, signed: true };
  if (instr === INSTR.ROUTE && signedEl >= 0 && nums.has(signedEl)) add({ action: "FOLLOW_SIGN", target: signedEl, roles: rolesFor(signedEl), desc: describe(signedEl, "Follow the sign to"), num: nums.get(signedEl)! });
  else if (instr === INSTR.ROUTE && signedEl >= 0 && w.fields[signedEl]![c]! < Infinity) {
    nums.set(signedEl, { distM: Math.round(w.fields[signedEl]![c]! * 10) / 10, queueSec: 0, hazard: routeHazard(w, a, signedEl), herd: herd.get(signedEl) ?? 0, familiar: false, signed: true });
    add({ action: "FOLLOW_SIGN", target: signedEl, roles: ["SIGNED", m.elements[signedEl]!.kind === "stair" ? "STAIR" : "LEVEL"], desc: describe(signedEl, "Follow the sign to"), num: nums.get(signedEl)! });
  } else if (instr === INSTR.HOLD && w.instrUntil[a]! > w.tick) add({ action: "FOLLOW_SIGN", target: signedEl, roles: ["SIGNED"], desc: "Stay where you are, as the announcement says", num: zero });
  else if (instr === INSTR.LOCKDOWN) add({ action: "FOLLOW_SIGN", target: T_LOCK, roles: ["SIGNED"], desc: "Lock down: get into the nearest room that locks and stay out of sight", num: zero });
  else if (instr === INSTR.COMPARTMENT) add({ action: "FOLLOW_SIGN", target: w.instrTarget[a]!, roles: ["SIGNED"], desc: `Move to ${m.zones[-3 - w.instrTarget[a]!]?.name ?? "the next area"}, as instructed`, num: zero });
  for (const ei of moveEls) add({ action: "MOVE_TO", target: ei, roles: rolesFor(ei), desc: describe(ei, "Head for"), num: nums.get(ei)! });
  const leader = w.groupLeader[a]!;
  const groupActive = leader >= 0 && leader !== a && w.state[leader] !== ST.PROTECTED && w.state[leader] !== ST.REFUGE && w.floor[leader] === fi;
  if (groupActive) add({ action: "FOLLOW_GROUP", target: -1, roles: [], desc: "Stay with your group and go where they go", num: zero });
  const prev = w.prevTarget[a]!;
  if ((point === "BLOCKED" || prev >= 0) && prev !== w.target[a] && prev >= 0 && nums.has(prev) && m.elements[prev]!.floor === fi) {
    add({ action: "GO_BACK", target: prev, roles: rolesFor(prev), desc: describe(prev, "Turn back towards"), num: nums.get(prev)! });
  }
  if (w.isStaff(a)) {
    const r2 = (5 / CELL_M) ** 2, x = c % fm.w, y = (c - x) / fm.w;
    let best = -1, bd = Infinity;
    for (let b = 0; b < w.n; b++) {
      if (b === a || w.floor[b] !== fi || w.mobility[b] === 0 || w.assisted[b] || w.state[b] === ST.PROTECTED || w.state[b] === ST.ON_STAIR) continue;
      const cb = w.cell[b]!, bx = cb % fm.w, by = (cb - bx) / fm.w, d = (bx - x) ** 2 + (by - y) ** 2;
      if (d <= r2 && d < bd) { bd = d; best = b; }
    }
    if (best >= 0) add({ action: "HELP", target: best, roles: [], desc: `Help the person nearby who uses ${MOBILITY[w.mobility[best]!] === "wheelchair" ? "a wheelchair" : "a walking aid or moves slowly"}`, num: zero });
  }
  add({ action: "WAIT", target: -1, roles: [], desc: "Wait here and watch what others do", num: zero });
  const s = w.stress[a]!;
  const persona: Persona = {
    age: AGES[w.age[a]!]!, role: ROLES[w.role[a]!]!, mobility: MOBILITY[w.mobility[a]!]!, familiar: !!w.familiar[a],
    stress: STRESS[Math.min(3, Math.floor(s * 4))]!, inGroup: w.group[a]! >= 0,
  };
  let smokeNear = 0;
  const x = c % fm.w, y = (c - x) / fm.w;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < fm.w && yy < fm.h) smokeNear = Math.max(smokeNear, w.hz.smoke[fi]![yy * fm.w + xx]!);
  }
  const tp = w.hz.threatPos;
  const D = w.localDensity(fi, c);
  const situation: Situation = {
    hazard: w.sc.hazard.kind,
    smokeVisible: smokeNear > 0.05,
    shaking: w.hz.shaking,
    threatVisible: !!tp && tp.floor === fi && (fm.cx[c]! - tp.x) ** 2 + (fm.cy[c]! - tp.y) ** 2 <= (w.hz.hp("threat.noticeRadiusM") / M_PER_FT) ** 2,
    crowd: D < 1 ? "light" : D < 2.5 ? "busy" : "packed",
    instruction: (["none", "route", "hold", "lockdown", "compartment"] as const)[instr]!,
    groupMissing: point === "GROUP_MEMBER_MISSING",
  };
  return { agent: a, tick: w.tick, point, persona, situation, options, key: situationKey(point, persona, situation) };
}
