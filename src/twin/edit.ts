import { finalizeTwin } from "./build.ts";
import type { Edit } from "../sim/types.ts";
import type { Portal, Twin, TwinSource } from "./schema.ts";

export const GEOMETRY_EDITS = new Set<Edit["kind"]>(["widen_corridor", "widen_stair", "widen_exit", "add_exit", "accessible_exit"]);

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
