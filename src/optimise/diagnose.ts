import type { Model } from "../sim/model.ts";
import { makeWorld, runSync, targetSec, type SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import { ST } from "../sim/constants.ts";
import { MOBILITY } from "../sim/population.ts";
import type { Pt } from "../twin/schema.ts";

export type Mechanism = "queue" | "travel" | "late_start" | "no_step_free_route" | "smoke" | "sealed";

export interface Hotspot {
  id: string;
  floor: string;
  cells: number;
  waitPS: number;
  share: number;
  centroid: Pt;
  bbox: [number, number, number, number];
  element: { id: string; kind: "exit" | "door" | "stair"; name: string } | null;
  capacityPps: number | null;
  demandPeakPps: number | null;
  saturatedSec: number;
  fedBy: { space: string; name: string; people: number }[];
  heading: { exit: string; people: number }[];
  spare: { exit: string; name: string; usedShare: number; capacityShare: number; distFt: number }[];
  why: string;
}

export interface Failure { mechanism: Mechanism; people: number; where: string; detail: string }

export interface Diagnosis {
  venue: string;
  runs: number;
  scenarios: string[];
  people: number;
  targetSec: number;
  outByTarget: number;
  clearance95Sec: number | null;
  waitPS: number;
  hotspots: Hotspot[];
  failures: Failure[];
  exits: { id: string; name: string; usedShare: number; capacityShare: number; verdict: "overloaded" | "balanced" | "under_used" }[];
  detours: { space: string; name: string; floor: string; walkFt: number; straightFt: number; ratio: number }[];
  maps: { floor: string; w: number; h: number; x0: number; y0: number; cellFt: number; wait: string }[];
  summary: string[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const FT = 1 / 0.3048;

/** Run the scenarios, record where and why people wait, and turn that into hotspots and failure mechanisms. */
export function diagnose(env: SimEnv, scenarios: Scenario[], o: { model?: Model; minHotspotCells?: number } = {}): Diagnosis {
  const m = o.model ?? env.model;
  const F = m.floors.length;
  const wait = m.floors.map((fm) => new Float64Array(fm.n));
  const portalFlow: Map<number, number[]>[] = [];
  const spaceName = new Map(m.twin.floors.flatMap((f) => f.spaces.map((s) => [s.id, m.twin.floors.length > 1 ? `${s.name} ${s.id} (${f.id})` : s.name] as const)));
  const agentRecs: { fi: number; cell: number; spawnSpace: string; wait: number; waitCells: Map<number, number>; target: string | null; mech: Mechanism | null; out: boolean }[] = [];
  let people = 0, out = 0, totalWait = 0;
  const c95: number[] = [];
  const exitUse = new Map<string, number>();
  let dt = 0.25, tgt = 0;
  for (const sc of scenarios) {
    const w = makeWorld(env, sc, { model: m });
    dt = w.dt; tgt = targetSec(env.runtime, sc.hazard.kind);
    const last = new Int32Array(w.n).fill(-1), lastF = new Int8Array(w.n);
    const spawn = Array.from({ length: w.n }, (_, a) => m.twin.floors[w.floor[a]!]!.spaces[m.floors[w.floor[a]!]!.space[w.cell[a]!]!]?.id ?? "?");
    const aw = new Float64Array(w.n), awCells = Array.from({ length: w.n }, () => new Map<number, number>());
    const flow = new Map<number, number[]>();
    let prevCross = Float64Array.from(w.metrics.crossings);
    const mech: (Mechanism | null)[] = new Array(w.n).fill(null);
    runSync(w, (ww) => {
      for (let a = 0; a < ww.n; a++) {
        if (ww.protectedAt[a]! >= 0) continue;
        const s = ww.state[a], f = ww.floor[a]!, c = ww.cell[a]!;
        if ((s === ST.MOVING || s === ST.DECIDING) && last[a] === c && lastF[a] === f) {
          wait[f]![c] = wait[f]![c]! + dt; aw[a] = aw[a]! + dt; totalWait += dt;
          const key = f * 1e7 + c; awCells[a]!.set(key, (awCells[a]!.get(key) ?? 0) + dt);
        }
        last[a] = c; lastF[a] = f;
      }
      if (ww.tick % 40 === 0) {
        for (let i = 0; i < ww.metrics.crossings.length; i++) {
          const d = ww.metrics.crossings[i]! - prevCross[i]!;
          if (d > 0) { const l = flow.get(i) ?? []; l.push(d / (40 * dt)); flow.set(i, l); }
        }
        prevCross = Float64Array.from(ww.metrics.crossings);
      }
      if (ww.tick === ww.targetTick) for (let a = 0; a < ww.n; a++) {
        if (ww.protectedAt[a]! >= 0) continue;
        const s = ww.state[a], f = ww.floor[a]!, c = ww.cell[a]!;
        const reach = m.elementsByFloor[f]!.some((ei) => ww.fields[ei]![c]! < Infinity);
        mech[a] = !reach ? "sealed" : s === ST.PREMOVE ? "late_start" : s === ST.REFUGE ? "no_step_free_route" : (ww.hz.smoke[f]?.[c] ?? 0) > 0.6 ? "smoke" : ww.blockedTicks[a]! * dt > 10 || aw[a]! > 30 ? "queue" : "travel";
      }
    }, 1);
    const mt = w.summary();
    if (mt.clearance95Sec !== null) c95.push(mt.clearance95Sec);
    for (const [k, v] of Object.entries(mt.exitUsage)) exitUse.set(k, (exitUse.get(k) ?? 0) + v);
    portalFlow.push(flow);
    people += w.n;
    for (let a = 0; a < w.n; a++) {
      const ok = w.protectedAt[a]! >= 0 && w.protectedAt[a]! <= w.targetTick;
      if (ok) out++;
      const t = w.target[a]!;
      agentRecs.push({ fi: w.floor[a]!, cell: w.cell[a]!, spawnSpace: spawn[a]!, wait: aw[a]!, waitCells: awCells[a]!, target: t >= 0 ? m.elements[t]!.exitId ?? m.elements[t]!.id : null, mech: ok ? null : mech[a] ?? "travel", out: ok });
    }
    void MOBILITY;
  }
  const runs = scenarios.length;
  // hotspots: connected cells whose mean wait per run is above a threshold
  const hotspots: Hotspot[] = [];
  const minCells = o.minHotspotCells ?? 4;
  const capRef = makeWorld(env, scenarios[0]!, { model: m });
  m.floors.forEach((fm, fi) => {
    const wf = wait[fi]!;
    let max = 0;
    for (let i = 0; i < fm.n; i++) max = Math.max(max, wf[i]! / runs);
    const thr = Math.max(2, max * 0.08);
    const seen = new Uint8Array(fm.n);
    for (let i = 0; i < fm.n; i++) {
      if (seen[i] || wf[i]! / runs < thr) continue;
      const comp: number[] = [i]; seen[i] = 1;
      for (let h = 0; h < comp.length; h++) for (let d = 0; d < 8; d++) { const j = fm.nbr[comp[h]! * 8 + d]!; if (j >= 0 && !seen[j] && wf[j]! / runs >= thr) { seen[j] = 1; comp.push(j); } }
      if (comp.length < minCells) continue;
      let sw = 0, sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of comp) { const v = wf[c]! / runs; sw += v; sx += fm.cx[c]! * v; sy += fm.cy[c]! * v; x0 = Math.min(x0, fm.cx[c]!); y0 = Math.min(y0, fm.cy[c]!); x1 = Math.max(x1, fm.cx[c]!); y1 = Math.max(y1, fm.cy[c]!); }
      const cen: Pt = [sx / sw, sy / sw];
      // the constriction it queues behind: nearest portal or stair head within 20 ft of the hotspot
      let best: { d: number; pi: number; flight: number } | null = null;
      m.portals.forEach((pt, pi) => { if (pt.floor !== fi) return; for (const c of pt.cells) { const d = Math.hypot(fm.cx[c]! - cen[0], fm.cy[c]! - cen[1]); if (!best || d < best.d) best = { d, pi, flight: -1 }; } });
      for (let c = 0; c < fm.n; c++) if (fm.headFlight[c]! >= 0) { const d = Math.hypot(fm.cx[c]! - cen[0], fm.cy[c]! - cen[1]); if (!best || d < best.d - 4) best = { d, pi: -1, flight: fm.headFlight[c]! }; }
      const b = best as { d: number; pi: number; flight: number } | null;
      let element: Hotspot["element"] = null, cap: number | null = null, peak: number | null = null, satSec = 0;
      if (b && b.d < 25) {
        if (b.pi >= 0) {
          const pt = m.portals[b.pi]!;
          element = { id: pt.exitId ?? pt.id, kind: pt.isExit ? "exit" : "door", name: pt.exitId ? m.twin.exits.find((e) => e.id === pt.exitId)?.name ?? pt.id : `door ${pt.id} (${pt.spaces.map((s) => spaceName.get(s) ?? s).join(" / ")})` };
          cap = Math.round(capRef.portalCap[b.pi]! * 100) / 100;
          const flows = portalFlow.flatMap((pf) => pf.get(b.pi) ?? []);
          peak = flows.length ? Math.round(Math.max(...flows) * 100) / 100 : null;
          satSec = flows.filter((f) => cap !== null && f >= cap * 0.85).length * 40 * dt / runs;
        } else {
          const fl = m.flights[b.flight]!;
          element = { id: fl.stairId, kind: "stair", name: `${m.twin.stairs.find((s) => s.id === fl.stairId)?.name ?? fl.stairId} (${m.twin.floors[fl.from]?.id ?? fl.from} to ${m.twin.floors[fl.to]?.id ?? fl.to})` };
          cap = Math.round(capRef.flightCap[b.flight]! * 100) / 100;
        }
      }
      const set = new Set(comp.map((c) => fi * 1e7 + c));
      const fed = new Map<string, number>(), head = new Map<string, number>();
      let waiters = 0;
      for (const ar of agentRecs) {
        let inH = 0;
        for (const [k, v] of ar.waitCells) if (set.has(k)) inH += v;
        if (inH < 2) continue;
        waiters++;
        fed.set(ar.spawnSpace, (fed.get(ar.spawnSpace) ?? 0) + 1);
        if (ar.target) head.set(ar.target, (head.get(ar.target) ?? 0) + 1);
      }
      hotspots.push({
        id: `H${hotspots.length + 1}`, floor: m.twin.floors[fi]!.id, cells: comp.length, waitPS: r1(sw), share: 0, centroid: [r1(cen[0]), r1(cen[1])], bbox: [r1(x0), r1(y0), r1(x1), r1(y1)],
        element, capacityPps: cap, demandPeakPps: peak, saturatedSec: r1(satSec),
        fedBy: [...fed].sort((a, b2) => b2[1] - a[1]).slice(0, 6).map(([space, n]) => ({ space, name: spaceName.get(space) ?? space, people: r1(n / runs) })),
        heading: [...head].sort((a, b2) => b2[1] - a[1]).slice(0, 4).map(([exit, n]) => ({ exit, people: r1(n / runs) })),
        spare: [], why: "",
      });
      void waiters;
    }
  });
  const totalUse = [...exitUse.values()].reduce((a, b) => a + b, 0) || 1;
  const extExits = m.elements.filter((e) => e.kind === "exit" && e.portal >= 0 && m.portals[e.portal]!.isExit);
  const capTotal = extExits.reduce((a, e) => a + capRef.portalCap[e.portal]!, 0) || 1;
  const exits = extExits.map((e) => {
    const used = (exitUse.get(e.id) ?? 0) / totalUse, capShare = capRef.portalCap[e.portal]! / capTotal;
    return { id: e.exitId ?? e.id, name: m.twin.exits.find((x) => x.id === (e.exitId ?? e.id))?.name ?? e.id, usedShare: Math.round(used * 1000) / 1000, capacityShare: Math.round(capShare * 1000) / 1000, verdict: (used > capShare * 1.5 ? "overloaded" : used < capShare * 0.5 ? "under_used" : "balanced") as "overloaded" | "balanced" | "under_used" };
  });
  const sumW = hotspots.reduce((a, h) => a + h.waitPS, 0) || 1;
  hotspots.sort((a, b) => b.waitPS - a.waitPS);
  hotspots.forEach((h, i) => {
    h.id = `H${i + 1}`;
    h.share = Math.round((h.waitPS / sumW) * 1000) / 1000;
    const fi = m.twin.floors.findIndex((f) => f.id === h.floor);
    h.spare = exits.filter((e) => e.verdict !== "overloaded" && e.id !== h.element?.id).map((e) => {
      const el = m.elements.find((x) => (x.exitId ?? x.id) === e.id)!;
      const fm = m.floors[el.floor]!;
      const c0 = el.cells[0]!;
      const dist = el.floor === fi ? Math.hypot(fm.cx[c0]! - h.centroid[0], fm.cy[c0]! - h.centroid[1]) : Infinity;
      return { exit: e.id, name: e.name, usedShare: e.usedShare, capacityShare: e.capacityShare, distFt: r1(dist) };
    }).filter((s) => Number.isFinite(s.distFt)).sort((a, b) => a.distFt - b.distFt).slice(0, 3);
    const over = h.capacityPps && h.demandPeakPps ? h.demandPeakPps / h.capacityPps : null;
    h.why = `${(h.share * 100).toFixed(0)}% of all waiting (${h.waitPS} person-s per run) queues ${h.element ? `behind ${h.element.name}` : "in an open area"}`
      + (h.capacityPps ? `; it passes at most ${h.capacityPps} people/s${over ? ` and runs at ${(over * 100).toFixed(0)}% of that at peak${h.saturatedSec ? `, saturated for ${h.saturatedSec} s` : ""}` : ""}` : "")
      + (h.fedBy.length ? `; fed mainly by ${h.fedBy.slice(0, 3).map((f) => `${f.name} (${f.people})`).join(", ")}` : "")
      + (h.spare.length ? `; spare capacity at ${h.spare[0]!.name} ${h.spare[0]!.distFt} ft away (${(h.spare[0]!.usedShare * 100).toFixed(0)}% of people for ${(h.spare[0]!.capacityShare * 100).toFixed(0)}% of exit capacity)` : "");
  });
  // failures by mechanism and place
  const fail = new Map<string, Failure>();
  for (const ar of agentRecs) {
    if (ar.out || !ar.mech) continue;
    const where = `${m.twin.floors[ar.fi]!.id} ${spaceName.get(m.twin.floors[ar.fi]!.spaces[m.floors[ar.fi]!.space[ar.cell]!]?.id ?? "") ?? "?"}`;
    const k = `${ar.mech}|${where}`;
    const f = fail.get(k) ?? { mechanism: ar.mech, people: 0, where, detail: "" };
    f.people++;
    fail.set(k, f);
  }
  const DETAIL: Record<Mechanism, string> = {
    queue: "still queuing at the target time", travel: "still walking: the route is long or slow", late_start: "had not started moving (long pre-movement)",
    no_step_free_route: "cannot use stairs and was waiting for assistance", smoke: "slowed or stopped by smoke", sealed: "no route to any exit from where they were",
  };
  const failures = [...fail.values()].map((f) => ({ ...f, people: r1(f.people / runs), detail: DETAIL[f.mechanism] })).sort((a, b) => b.people - a.people).slice(0, 12);
  // detours: rooms whose walking distance to the nearest exit is much longer than the straight line
  const base = makeWorld(env, { ...scenarios[0]!, hazard: { kind: "none" } }, { model: m });
  const detours: Diagnosis["detours"] = [];
  m.floors.forEach((fm, fi) => {
    const sp = m.twin.floors[fi]!.spaces;
    const sum = new Map<number, { x: number; y: number; n: number }>();
    for (let i = 0; i < fm.n; i++) { if (!fm.walkable[i]) continue; const s = fm.space[i]!; if (s < 0 || !m.spaceInfo[fi]![s]!.occupiable) continue; const v = sum.get(s) ?? { x: 0, y: 0, n: 0 }; v.x += fm.cx[i]!; v.y += fm.cy[i]!; v.n++; sum.set(s, v); }
    for (const [s, v] of sum) {
      const cx = v.x / v.n, cy = v.y / v.n;
      let c = -1, cd = Infinity;
      for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.space[i] === s) { const d = Math.hypot(fm.cx[i]! - cx, fm.cy[i]! - cy); if (d < cd) { cd = d; c = i; } }
      if (c < 0) continue;
      let walk = Infinity, straight = Infinity;
      for (const ei of m.elementsByFloor[fi]!) {
        const e = m.elements[ei]!, f = base.fields[ei]![c]!;
        if (f < walk) { walk = f; const c0 = e.cells[0]!; straight = Math.hypot(fm.cx[c0]! - fm.cx[c]!, fm.cy[c0]! - fm.cy[c]!); }
      }
      if (!Number.isFinite(walk)) continue;
      const walkFt = walk * FT;
      if (straight > 15 && walkFt / straight > 1.5) detours.push({ space: sp[s]!.id, name: sp[s]!.name, floor: m.twin.floors[fi]!.id, walkFt: r1(walkFt), straightFt: r1(straight), ratio: Math.round((walkFt / straight) * 100) / 100 });
    }
  });
  detours.sort((a, b) => b.ratio - a.ratio);
  const maps = m.floors.map((fm, fi) => {
    const q = new Uint16Array(fm.n);
    for (let i = 0; i < fm.n; i++) q[i] = Math.min(65535, Math.round((wait[fi]![i]! / runs) * 10));
    return { floor: m.twin.floors[fi]!.id, w: fm.w, h: fm.h, x0: fm.cx[0]!, y0: fm.cy[0]!, cellFt: r1((fm.cx[1]! - fm.cx[0]!) * 1000) / 1000, wait: Buffer.from(q.buffer).toString("base64") };
  });
  const c95m = c95.length === runs ? r1(c95.reduce((a, b) => a + b, 0) / runs) : null;
  const summary = [
    `${r1(out / runs)} of ${r1(people / runs)} people out or protected by the ${tgt} s target (mean of ${runs} runs); 95% out ${c95m !== null ? `in ${c95m} s` : "not reached in every run"}.`,
    ...hotspots.slice(0, 3).map((h) => `${h.id} (${h.floor}): ${h.why}.`),
    ...exits.filter((e) => e.verdict !== "balanced").map((e) => `${e.name}: ${e.verdict.replace("_", "-")} (${(e.usedShare * 100).toFixed(0)}% of people, ${(e.capacityShare * 100).toFixed(0)}% of exit capacity).`),
    ...failures.slice(0, 3).map((f) => `${f.people} people per run not out by the target in ${f.where}: ${f.detail}.`),
    ...detours.slice(0, 2).map((d) => `${d.name} (${d.floor}): ${d.walkFt} ft walk to the nearest exit for ${d.straightFt} ft straight-line (${d.ratio}x).`),
  ];
  void F;
  return { venue: m.twin.id, runs, scenarios: scenarios.map((s) => s.id), people: r1(people / runs), targetSec: tgt, outByTarget: r1(out / runs), clearance95Sec: c95m, waitPS: r1(totalWait / runs), hotspots: hotspots.slice(0, 12), failures, exits, detours: detours.slice(0, 10), maps, summary };
}
