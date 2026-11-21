import { polygonArea } from "../shared/geom.ts";
import { M_PER_FT } from "../shared/units.ts";
import { distanceField } from "../sim/fields.ts";
import { buildModel, type Model } from "../sim/model.ts";
import { PRINTED_LOADS } from "../sim/population.ts";
import { OUTSIDE } from "../twin/raster.ts";
import type { Twin } from "../twin/schema.ts";
import type { CodeCheckItem, CodeCheckResult } from "../server/contract.ts";

export const CODE_DISCLAIMER = "Recomputed from the traced twin under stated assumptions using the method printed on the egress sheets. \"Passes on paper\" describes the model, not the real building, and is not a code review.";

const round1 = (v: number) => Math.round(v * 10) / 10;

interface ExitSources { exitId: string; floor: number; cells: number[] }

function codeExitSources(m: Model): ExitSources[] {
  const out: ExitSources[] = [];
  for (const e of m.twin.exits) {
    const fi = m.floors.findIndex((f) => f.id === e.floor);
    const pi = m.portals.findIndex((p) => p.id === e.portal && p.floor === fi);
    if (pi < 0) continue;
    const p = m.portals[pi]!, fm = m.floors[fi]!;
    if (e.kind === "exterior") { out.push({ exitId: e.id, floor: fi, cells: p.cells.filter((c) => fm.exitPortal[c] === pi) }); continue; }
    const st = m.twin.stairs.find((s) => s.id === e.stair);
    if (!st?.countsAsCodeExit) continue;
    const stairSpace = st.spaces[e.floor as "F1"];
    const spaceIds = m.twin.floors[fi]!.spaces.map((s) => s.id);
    out.push({ exitId: e.id, floor: fi, cells: p.cells.filter((c) => spaceIds[fm.space[c]!] !== stairSpace) });
  }
  return out;
}

export function exitDistanceFields(m: Model): { exits: ExitSources[]; fields: Float32Array[] } {
  const exits = codeExitSources(m);
  const stairSpaces = new Set(m.twin.stairs.flatMap((s) => Object.values(s.spaces)));
  const fields = exits.map((x) => {
    const fm = m.floors[x.floor]!;
    const spaceIds = m.twin.floors[x.floor]!.spaces.map((s) => s.id);
    const blocked = new Uint8Array(fm.n);
    for (let i = 0; i < fm.n; i++) if (stairSpaces.has(spaceIds[fm.space[i]!] ?? "") && m.twin.floors[x.floor]!.id !== "F1") blocked[i] = 1;
    for (const c of x.cells) blocked[c] = 0;
    return distanceField(fm, x.cells, new Float32Array(fm.n), { blocked });
  });
  return { exits, fields };
}

export function codeCheck(twin: Twin, model?: Model): CodeCheckResult {
  const m = model ?? buildModel(twin);
  const cb = twin.codeBasis;
  const items: CodeCheckItem[] = [];
  const doorF = cb.egressInPerPerson.corridorsDoors, stairF = cb.egressInPerPerson.stairs;
  const toFt = 1 / M_PER_FT;

  for (const f of twin.floors) {
    const area = polygonArea(f.outline) - f.voids.reduce((a, v) => a + polygonArea(v), 0);
    const printedGsf = cb.grossAreaSqft[f.id];
    const fromTwin = area / cb.occupantLoadSqftPerPerson;
    const fromPrinted = printedGsf / cb.occupantLoadSqftPerPerson;
    const printedLoad = PRINTED_LOADS[f.id] ?? null;
    items.push({
      id: `load-${f.id}`, group: "occupant_load", label: `${f.name}: occupant load at ${cb.occupantLoadSqftPerPerson} gross sq ft/person`,
      required: null, provided: { value: round1(fromTwin), source: `twin outline ${round1(area)} sq ft minus voids` }, unit: "persons",
      status: "info", method: `floor area / ${cb.occupantLoadSqftPerPerson}; printed GSF ${printedGsf} / ${cb.occupantLoadSqftPerPerson} = ${round1(fromPrinted)}`,
      printed: printedLoad, sheet: f.id === "F1" ? "A107" : "A108",
      note: `twin area differs from printed GSF by ${round1(((area - printedGsf) / printedGsf) * 100)}%; printed load ${printedLoad} differs from GSF/100 by ${printedLoad === null ? "n/a" : round1(printedLoad - fromPrinted)} persons (the sheet does not explain the gap)`,
    });
  }

  for (const e of twin.exits) {
    if (!e.printed) continue;
    const isStair = e.kind === "stair";
    const factor = isStair ? stairF : doorF;
    const required = round1(e.printed.occupants * factor);
    const portal = twin.floors.find((f) => f.id === e.floor)!.portals.find((p) => p.id === e.portal)!;
    const stair = isStair ? twin.stairs.find((s) => s.id === e.stair) : undefined;
    const provided = isStair && stair ? stair.clearWidthIn : portal.clearWidthIn;
    items.push({
      id: `width-${e.id}`, group: "egress_width", label: `${e.name}: required vs provided egress width`,
      required: { value: required, source: `${e.printed.occupants} printed occupants x ${factor} in/person` },
      provided: { value: provided, source: isStair ? `twin: stair clear width (${stair?.src.basis})` : `twin: door clear width (${portal.src.basis})` },
      unit: "in", status: provided >= required ? "passes_on_paper" : "does_not_pass_on_paper",
      method: `${e.printed.occupants} x ${factor} = ${required}" (printed REQ'D ${e.printed.requiredIn}", PROVIDED ${e.printed.providedIn}")`,
      printed: e.printed.requiredIn, sheet: e.src.sheet,
      ...(required !== e.printed.requiredIn ? { note: `recomputed ${required}" differs from printed ${e.printed.requiredIn}"` } : {}),
    });
    if (isStair) {
      const dreq = round1(e.printed.occupants * doorF);
      const assumed = portal.src.basis === "assumed";
      items.push({
        id: `door-${e.id}`, group: "egress_width", label: `${e.name}: door into the stair at ${doorF} in/person`,
        required: { value: dreq, source: `${e.printed.occupants} printed occupants x ${doorF} in/person` }, provided: { value: portal.clearWidthIn, source: `twin: door clear width (${portal.src.basis})` },
        unit: "in", status: assumed ? "info" : portal.clearWidthIn >= dreq ? "passes_on_paper" : "does_not_pass_on_paper",
        method: `${e.printed.occupants} x ${doorF} = ${dreq}"`, printed: null, sheet: e.src.sheet,
        ...(assumed ? { note: "door width is an assumption (not on the permitted sheets), so this row is not determinable from the sheets" } : {}),
      });
    }
  }

  for (const st of twin.stairs.filter((s) => s.countsAsCodeExit)) {
    const served = twin.exits.filter((e) => e.kind === "stair" && e.stair === st.id && e.printed);
    if (!served.length) continue;
    const gov = served.reduce((a, b) => (b.printed!.occupants > a.printed!.occupants ? b : a));
    const req = round1(gov.printed!.occupants * stairF);
    items.push({
      id: `stair-cap-${st.id}`, group: "egress_width", label: `${st.name}: stair capacity set by the most loaded floor (SBC 1003.3.2)`,
      required: { value: req, source: `${gov.floor} printed load ${gov.printed!.occupants} x ${stairF}` }, provided: { value: st.clearWidthIn, source: `twin stair clear width (${st.src.basis})` },
      unit: "in", status: st.clearWidthIn >= req ? "passes_on_paper" : "does_not_pass_on_paper", method: `max floor load served x ${stairF}; not the building total`, printed: gov.printed!.requiredIn, sheet: st.src.sheet,
    });
  }

  const narrowDoors: string[] = [], unknownDoors: string[] = [];
  let doorsChecked = 0;
  for (const f of twin.floors) for (const p of f.portals) {
    if (p.kind !== "door") continue;
    if (p.src.basis === "assumed") { unknownDoors.push(p.id); continue; }
    doorsChecked++;
    if (p.clearWidthIn < cb.minDoorClearIn) narrowDoors.push(`${p.id} (${p.clearWidthIn}")`);
  }
  items.push({
    id: "min-door", group: "egress_width", label: `Door clear openings at least ${cb.minDoorClearIn}"`,
    required: { value: cb.minDoorClearIn, source: "code summary on A107" }, provided: { value: doorsChecked - narrowDoors.length, source: `doors with a width read from the sheets (${doorsChecked})` },
    unit: "doors", status: narrowDoors.length ? "does_not_pass_on_paper" : "passes_on_paper", method: "each door with a dimensioned or printed width",
    printed: null, sheet: "A107", note: `${unknownDoors.length} interior doors use the assumed 34" leaf and are not determinable from the permitted sheets${narrowDoors.length ? `; narrow: ${narrowDoors.join(", ")}` : ""}`,
  });
  for (const f of twin.floors) for (const s of f.spaces) {
    if (s.kind !== "corridor" || !s.clearWidthFt) continue;
    const w = round1(s.clearWidthFt * 12);
    items.push({
      id: `corridor-${s.id}`, group: "egress_width", label: `${s.name} (${f.id}) corridor width at least ${cb.minCorridorIn}"`,
      required: { value: cb.minCorridorIn, source: "code summary on A107" }, provided: { value: w, source: `twin corridor clear width (${s.src.basis})` }, unit: "in",
      status: w >= cb.minCorridorIn ? "passes_on_paper" : s.src.basis === "assumed" ? "info" : "does_not_pass_on_paper", method: "traced clear width between wall faces", printed: null, sheet: s.src.sheet,
    });
  }

  const { exits, fields } = exitDistanceFields(m);
  m.floors.forEach((fm, fi) => {
    const fid = fm.id;
    const own = exits.map((x, k) => ({ x, k })).filter(({ x }) => x.floor === fi);
    const ids = own.map(({ x }) => x.exitId);
    items.push({
      id: `exits-${fid}`, group: "exits", label: `${twin.floors[fi]!.name}: at least ${cb.minExits} exits`,
      required: { value: cb.minExits, source: "SBC 1004.2 / NFPA 101 2-8" }, provided: { value: own.length, source: `twin code exits: ${ids.join(", ")}` }, unit: "exits",
      status: own.length >= cb.minExits ? "passes_on_paper" : "does_not_pass_on_paper", method: fi === 0 ? "exterior exit doors" : "doors into enclosed exit stairs", printed: null, sheet: fid === "F1" ? "A107" : "A108",
    });
    if (own.length >= 2) {
      let sep = 0;
      for (const a of own) for (const b of own) {
        if (a.k >= b.k) continue;
        const ca = a.x.cells[0]!;
        sep = Math.max(sep, fields[b.k]![ca]!);
      }
      items.push({
        id: `separation-${fid}`, group: "exits", label: `${twin.floors[fi]!.name}: largest walking distance between exits (remoteness, information only)`,
        required: null, provided: { value: round1(sep * toFt), source: "walking distance between exit sources on the simulation grid" }, unit: "ft", status: "info",
        method: "no numeric remoteness rule is printed (only 'per section 5-5'), so no pass/fail is given", printed: null, sheet: fid === "F1" ? "A107" : "A108",
      });
    }
    const spaces = twin.floors[fi]!.spaces;
    let worst = 0, worstCell = -1, worstCommon = 0, worstDead = 0, deadCell = -1;
    for (let i = 0; i < fm.n; i++) {
      if (!fm.walkable[i]) continue;
      const s = spaces[fm.space[i]!];
      if (!s || !s.occupiable) continue;
      const ds = own.map(({ k }) => fields[k]![i]!).filter((d) => d < Infinity).sort((a, b) => a - b);
      if (!ds.length) continue;
      if (ds[0]! > worst) { worst = ds[0]!; worstCell = i; }
      if (own.length >= 2) {
        let best = Infinity;
        for (const a of own) for (const b of own) {
          if (a.k >= b.k) continue;
          const da = fields[a.k]![i]!, db = fields[b.k]![i]!, dab = fields[b.k]![a.x.cells[0]!]!;
          if (da === Infinity || db === Infinity) continue;
          best = Math.min(best, Math.max(0, (da + db - dab) / 2));
        }
        if (best < Infinity) {
          worstCommon = Math.max(worstCommon, best);
          if (s.kind === "corridor" && best > worstDead) { worstDead = best; deadCell = i; }
        }
      }
    }
    const wft = round1(worst * toFt);
    const where = worstCell >= 0 ? ` at (${round1(fm.cx[worstCell]!)}, ${round1(fm.cy[worstCell]!)}) ft in ${spaces[fm.space[worstCell]!]?.name}` : "";
    for (const [lim, code] of [[cb.travelDistanceFt.nfpa101, "NFPA 101 26-2.6"], [cb.travelDistanceFt.sbc, "SBC 1997"]] as const) {
      items.push({
        id: `travel-${fid}-${lim}`, group: "travel", label: `${twin.floors[fi]!.name}: longest travel distance to the nearest exit (${code}, ${lim} ft)`,
        required: { value: lim, source: code }, provided: { value: wft, source: `longest shortest walking path on the 0.4 m grid${where}` }, unit: "ft",
        status: wft <= lim ? "passes_on_paper" : "does_not_pass_on_paper", method: "max over occupiable cells of the shortest walking path to the nearest exit (8-connected grid, so paths can be slightly longer than straight lines)",
        printed: null, sheet: fid === "F1" ? "A107" : "A108",
      });
    }
    if (own.length >= 2) {
      const cft = round1(worstCommon * toFt), dft = round1(worstDead * toFt);
      items.push({
        id: `common-${fid}`, group: "common_path", label: `${twin.floors[fi]!.name}: common path of travel (NFPA 101 26-2.4, ${cb.commonPathFt} ft)`,
        required: { value: cb.commonPathFt, source: "NFPA 101 26-2.4" }, provided: { value: cft, source: "max over occupiable cells of the shared length of the paths to the two nearest exits" }, unit: "ft",
        status: cft <= cb.commonPathFt ? "passes_on_paper" : "does_not_pass_on_paper", method: "shared length = (d1 + d2 - d12) / 2 for the best pair of exits (exact on tree-like plans, an approximation elsewhere)", printed: null, sheet: fid === "F1" ? "A107" : "A108",
      });
      items.push({
        id: `deadend-${fid}`, group: "dead_end", label: `${twin.floors[fi]!.name}: dead-end corridor length (${cb.deadEndFt} ft)`,
        required: { value: cb.deadEndFt, source: "SBC / NFPA 101" }, provided: { value: dft, source: "max over corridor cells of the one-direction-only path length" }, unit: "ft",
        status: dft <= cb.deadEndFt ? "passes_on_paper" : "does_not_pass_on_paper", method: "same shared-length measure restricted to corridor cells (approximation on the 0.4 m grid, measured from cell centres; a reviewer should measure this stub on the sheet)", printed: null, sheet: fid === "F1" ? "A107" : "A108",
        ...(deadCell >= 0 ? { note: `longest one-way corridor stretch ends at (${round1(fm.cx[deadCell]!)}, ${round1(fm.cy[deadCell]!)}) ft in ${spaces[fm.space[deadCell]!]?.name ?? ""} ${spaces[fm.space[deadCell]!]?.id ?? ""}` } : {}),
      });
    }
    for (const [si, s] of spaces.entries()) {
      if (!s.occupiable || s.kind !== "room") continue;
      const info = m.spaceInfo[fi]![si]!;
      const load = s.fixedSeats ?? Math.floor(info.areaSqft / cb.occupantLoadSqftPerPerson);
      if (load < cb.twoDoorRoomLoad) continue;
      const doors = twin.floors[fi]!.portals.filter((p) => p.kind === "door" && p.connects.includes(s.id) && !p.connects.includes(OUTSIDE) || p.connects.includes(s.id) && p.connects.includes(OUTSIDE));
      items.push({
        id: `room-doors-${s.id}`, group: "exits", label: `${s.name}: ${load} occupants, egress doors`,
        required: { value: 2, source: `SBC 1004.1.2 (${cb.twoDoorRoomLoad}+ occupants)` }, provided: { value: doors.length, source: "twin doors of the room" }, unit: "doors",
        status: doors.length >= 2 ? "passes_on_paper" : "does_not_pass_on_paper", method: s.fixedSeats ? "fixed seats" : `room area / ${cb.occupantLoadSqftPerPerson}`, printed: null, sheet: s.src.sheet,
      });
    }
  });
  return { basis: "1997 Standard Building Code and 1994 NFPA 101, as printed in the CODE SUMMARY on sheet A107", items, disclaimer: CODE_DISCLAIMER };
}

