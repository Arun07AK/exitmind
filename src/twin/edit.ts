import { finalizeTwin } from "./build.ts";
import type { Edit } from "../sim/types.ts";
import type { GeometryPatch, Portal, Pt, Twin, TwinSource } from "./schema.ts";

export const GEOMETRY_EDITS = new Set<Edit["kind"]>(["widen_corridor", "widen_stair", "widen_exit", "add_exit", "accessible_exit", "geometry"]);

export interface ExitCandidate {
  id: string;
  label: string;
  floor: Twin["floors"][number]["id"];
  portal: Portal;
}

function stretch(p: Portal, addIn: number): Portal {
  const [ax, ay] = p.a, [bx, by] = p.b;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ext = addIn / 12 / 2;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  return { ...p, a: [ax - ux * ext, ay - uy * ext], b: [bx + ux * ext, by + uy * ext], clearWidthIn: p.clearWidthIn + addIn };
}

export function applyEdits(twin: Twin, edits: readonly Edit[], candidates: readonly ExitCandidate[] = []): Twin {
  const src: TwinSource = structuredClone({ ...twin, zones: undefined, hash: undefined }) as unknown as TwinSource;
  for (const e of edits) {
    if (!GEOMETRY_EDITS.has(e.kind)) continue;
    if (e.kind === "geometry") {
      if (!e.patch) throw new Error(`geometry edit ${e.target} has no patch`);
      applyPatch(src, e.patch);
      continue;
    }
    if (e.kind === "widen_stair") {
      const st = src.stairs.find((s) => s.id === e.target);
      if (!st) throw new Error(`widen_stair: unknown stair ${e.target}`);
      st.clearWidthIn += e.amount ?? 6;
      continue;
    }
    if (e.kind === "add_exit") {
      const c = candidates.find((x) => x.id === e.target);
      if (!c) throw new Error(`add_exit: unknown candidate ${e.target}`);
      const f = src.floors.find((x) => x.id === c.floor)!;
      if (!f.portals.some((p) => p.id === c.portal.id)) f.portals.push(c.portal);
      if (!src.exits.some((x) => x.id === c.id)) src.exits.push({ id: c.id, name: c.label, floor: c.floor, kind: "exterior", portal: c.portal.id, src: c.portal.src });
      continue;
    }
    let done = false;
    for (const f of src.floors) {
      if (e.kind === "widen_corridor") {
        const s = f.spaces.find((x) => x.id === e.target);
        if (s?.clearWidthFt) { s.clearWidthFt += e.amount ?? 1; done = true; }
      } else {
        const ex = src.exits.find((x) => x.id === e.target && x.floor === f.id);
        if (!ex) continue;
        const k = f.portals.findIndex((p) => p.id === ex.portal);
        if (k < 0) continue;
        f.portals[k] = e.kind === "widen_exit" ? stretch(f.portals[k]!, e.amount ?? 6) : { ...f.portals[k]!, accessible: true };
        done = true;
      }
    }
    if (!done) throw new Error(`${e.kind}: target ${e.target} not found`);
  }
  return finalizeTwin(src);
}

/** Split rectangular wall voids where an opening is cut (walls of uploaded plans are 4-point rectangles). */
function cutVoid(voids: Pt[][], at: Pt, widthFt: number): Pt[][] {
  const out: Pt[][] = [];
  for (const v of voids) {
    if (v.length !== 4) { out.push(v); continue; }
    const [p0, p1, p2, p3] = v as [Pt, Pt, Pt, Pt];
    const a: Pt = [(p0[0] + p3[0]) / 2, (p0[1] + p3[1]) / 2], b: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), th = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    if (L < 0.5 || th > 4) { out.push(v); continue; }
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const t = (at[0] - a[0]) * ux + (at[1] - a[1]) * uy, d = Math.abs((at[0] - a[0]) * -uy + (at[1] - a[1]) * ux);
    if (d > 3 || t < -widthFt / 2 || t > L + widthFt / 2) { out.push(v); continue; }
    const nx = -uy * (th / 2), ny = ux * (th / 2);
    const piece = (t0: number, t1: number): Pt[] => {
      const s0: Pt = [a[0] + ux * t0, a[1] + uy * t0], s1: Pt = [a[0] + ux * t1, a[1] + uy * t1];
      return [[s0[0] + nx, s0[1] + ny], [s1[0] + nx, s1[1] + ny], [s1[0] - nx, s1[1] - ny], [s0[0] - nx, s0[1] - ny]];
    };
    if (t - widthFt / 2 > 0.75) out.push(piece(0, t - widthFt / 2));
    if (L - (t + widthFt / 2) > 0.75) out.push(piece(t + widthFt / 2, L));
  }
  return out;
}

export function applyPatch(src: TwinSource, p: GeometryPatch): void {
  const floor = (id: string) => { const f = src.floors.find((x) => x.id === id); if (!f) throw new Error(`patch: unknown floor ${id}`); return f; };
  for (const s of p.addSpaces ?? []) { const f = floor(s.floor); if (!f.spaces.some((x) => x.id === s.id)) f.spaces.push(s); }
  for (const id of p.removePortals ?? []) for (const f of src.floors) f.portals = f.portals.filter((x) => x.id !== id);
  for (const q of p.addPortals ?? []) { const f = floor(q.floor); if (!f.portals.some((x) => x.id === q.id)) f.portals.push(q); }
  for (const st of p.addStairs ?? []) if (!src.stairs.some((x) => x.id === st.id)) src.stairs.push(st);
  for (const e of p.addExits ?? []) if (!src.exits.some((x) => x.id === e.id)) src.exits.push(e);
  for (const u of p.updateSpaces ?? []) for (const f of src.floors) { const s = f.spaces.find((x) => x.id === u.id); if (s) Object.assign(s, Object.fromEntries(Object.entries(u).filter(([k, v]) => k !== "id" && v !== undefined))); }
  for (const u of p.updatePortals ?? []) for (const f of src.floors) { const q = f.portals.find((x) => x.id === u.id); if (q) Object.assign(q, Object.fromEntries(Object.entries(u).filter(([k, v]) => k !== "id" && v !== undefined))); }
  for (const c of p.cutVoids ?? []) { const f = floor(c.floor); f.voids = cutVoid(f.voids, c.at, c.widthFt); }
}
