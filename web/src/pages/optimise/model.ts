import type { RecommendAggregate, RecommendDangerFloor, RecommendEdit, Recommendation, RecommendResult } from "../../../../src/server/contract.ts";
import { centroid, type Geometry } from "../../geometry.ts";

export interface Rec extends Recommendation {
  letter: string;
  /** letters of the single changes a combination is made of */
  parts: string[];
}

/** One point on the plan in plan feet, with the floor index into twin.floors. */
export interface Spot { floor: number; x: number; y: number }
export interface Mark extends Spot { id: string; before: string; after: string }

const RANK = { validated: 0, no_effect: 1, worse: 2, untestable: 3 } as const;
const editKey = (e: RecommendEdit): string => JSON.stringify([e.kind, e.target, e.amount ?? null, e.protocol ?? null]);

/** Validated first by gain, untestable last; letters go to single changes in that order, and a combination takes the next letter once all its parts have one. */
export function letterRecs(list: readonly Recommendation[]): Rec[] {
  const ordered = [...list].sort((a, b) => RANK[a.status] - RANK[b.status] || (b.gain && a.gain ? b.gain.mean - a.gain.mean : 0));
  const isCombo = (r: Recommendation) => r.edits.length > 1;
  const letters = new Map<string, string>(), byEdit = new Map<string, string>();
  let n = 0;
  const give = (r: Recommendation) => { if (!letters.has(r.id)) letters.set(r.id, n < 26 ? String.fromCharCode(65 + n++) : String(++n)); };
  const combos = ordered.filter(isCombo);
  for (const r of ordered.filter((x) => !isCombo(x))) {
    give(r);
    if (r.edits.length === 1) byEdit.set(editKey(r.edits[0]!), letters.get(r.id)!);
    for (const c of combos) if (c.edits.every((e) => byEdit.has(editKey(e)))) give(c);
  }
  for (const c of combos) give(c);
  return ordered.map((r) => ({ ...r, letter: letters.get(r.id)!, parts: isCombo(r) ? r.edits.map((e) => byEdit.get(editKey(e))).filter((x): x is string => !!x) : [] }));
}

/** Where an element named in an edit or a problem sits: exit door or portal midpoint, stair or space centroid. */
export function elementSpot(geo: Geometry, id: string): Spot | null {
  const floors = geo.twin.floors;
  const portalId = geo.twin.exits.find((e) => e.id === id)?.portal ?? id;
  for (let i = 0; i < floors.length; i++) {
    const p = floors[i]!.portals.find((q) => q.id === portalId);
    if (p) return { floor: i, x: (p.a[0] + p.b[0]) / 2, y: (p.a[1] + p.b[1]) / 2 };
  }
  const stair = geo.twin.stairs.find((s) => s.id === id.split("@")[0]);
  for (let i = 0; i < floors.length; i++) {
    const sid = stair ? stair.spaces[floors[i]!.id] : id;
    const sp = sid ? floors[i]!.spaces.find((s) => s.id === sid) : undefined;
    if (sp) { const [x, y] = centroid(sp.polygon); return { floor: i, x, y }; }
  }
  return null;
}

const floorIndex = (geo: Geometry, id: string): number => Math.max(0, geo.twin.floors.findIndex((f) => f.id === id));

/** Rings for the edits that change the building, labelled with the widths before and after. */
export function changeMarks(geo: Geometry, rec: Recommendation, original: RecommendAggregate): Mark[] {
  const out: Mark[] = [];
  for (const e of rec.edits) {
    if (e.kind === "strategy") continue;
    const at = elementSpot(geo, e.target);
    if (!at) continue;
    const amt = e.amount ?? 0;
    let before = e.target, after = `${e.target} · ${e.kind.replace(/_/g, " ")}`;
    if (e.kind === "widen_exit") {
      const w0 = original.exitShares.find((x) => x.id === e.target)?.clearWidthIn, w1 = rec.variant?.exitShares.find((x) => x.id === e.target)?.clearWidthIn;
      if (w0 !== undefined) { before = `${e.target} ${fmtNum(w0)} in`; after = `${e.target} ${fmtNum(w1 ?? w0 + amt)} in (+${fmtNum(amt)})`; }
    } else if (e.kind === "widen_stair") {
      const w0 = geo.twin.stairs.find((s) => s.id === e.target)?.clearWidthIn;
      if (w0 !== undefined) { before = `${e.target} ${fmtNum(w0)} in`; after = `${e.target} ${fmtNum(w0 + amt)} in (+${fmtNum(amt)})`; }
    } else if (e.kind === "widen_corridor") {
      const w0 = geo.twin.floors.flatMap((f) => f.spaces).find((s) => s.id === e.target)?.clearWidthFt;
      if (w0 !== undefined) { before = `${e.target} ${fmtNum(w0)} ft`; after = `${e.target} ${fmtNum(w0 + amt)} ft (+${fmtNum(amt)})`; }
    }
    out.push({ ...at, id: e.target, before, after });
  }
  return out;
}

/** The plan focus for a recommendation: the changed element, else the density problem it addresses, else the floor with the most danger. */
export function focusFor(geo: Geometry, result: RecommendResult, rec: Recommendation | null): Spot {
  const marks = rec ? changeMarks(geo, rec, result.original) : [];
  if (marks[0]) return marks[0];
  const dens = result.problems.density.filter((p) => rec?.addresses.includes(p.id)).sort((a, b) => b.totalPS - a.totalPS)[0]
    ?? [...result.problems.density].sort((a, b) => b.totalPS - a.totalPS)[0];
  if (dens) return { floor: floorIndex(geo, dens.floor), x: dens.x, y: dens.y };
  const worst = [...result.original.danger].sort((a, b) => b.total - a.total)[0];
  const [x0, y0, x1, y1] = geo.bounds;
  return { floor: worst ? floorIndex(geo, worst.floor) : 0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** The exterior exit whose share the figure row follows: the edited exit, else the one named by the problems this change addresses. */
export function changedExit(result: RecommendResult, rec: Recommendation): string | null {
  const ids = new Set(result.original.exitShares.map((x) => x.id));
  const edited = rec.edits.find((e) => ids.has(e.target))?.target;
  if (edited) return edited;
  const share = result.problems.exitShares.find((p) => rec.addresses.includes(p.id))?.exit;
  if (share) return share;
  const dens = result.problems.density.find((p) => rec.addresses.includes(p.id) && p.exit)?.exit;
  return dens ?? result.problems.exitShares[0]?.exit ?? null;
}

export const dangerOn = (agg: RecommendAggregate | null | undefined, floorId: string): RecommendDangerFloor | null => agg?.danger.find((d) => d.floor === floorId) ?? null;

export function fmtNum(v: number, digits = 0): string {
  const r = Number(v.toFixed(digits));
  return r.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** One decimal, dropped when the value is whole: 464.5, 547, 511.8 */
export const fmt1 = (v: number): string => fmtNum(v, 1);
export const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;
export const fmtClock = (s: number): string => { const v = Math.max(0, Math.round(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };
export const signed = (v: number, digits = 0): string => `${v < 0 && Number(Math.abs(v).toFixed(digits)) > 0 ? "−" : "+"}${fmtNum(Math.abs(v), digits)}`;
export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function pctChange(before: number, after: number): string {
  if (before <= 0) return after > 0 ? "new" : "no change";
  const d = (after - before) / before;
  if (Math.abs(d) < 0.0005) return "no change";
  const p = Math.abs(d) * 100;
  return `${d < 0 ? "−" : "+"}${p >= 99.5 && p < 100 ? p.toFixed(1) : p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}
