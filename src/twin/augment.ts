import type { Portal, Twin } from "./schema.ts";

export function withCorridorSections(twin: Twin): Twin {
  return {
    ...twin,
    floors: twin.floors.map((f) => {
      const extra: Portal[] = [];
      for (const s of f.spaces) {
        if (!s.axis || !s.clearWidthFt) continue;
        const [[x0, y0], [x1, y1]] = s.axis;
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 4) continue;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        const half = s.clearWidthFt / 2 + 1;
        extra.push({
          id: `CS-${s.id}`, floor: f.id, kind: "corridor_section",
          a: [mx - nx * half, my - ny * half], b: [mx + nx * half, my + ny * half],
          clearWidthIn: s.clearWidthFt * 12, connects: [s.id, s.id], accessible: true,
          src: { ...s.src, note: "generated at corridor midpoint; width = traced corridor clear width" },
        });
      }
      return extra.length ? { ...f, portals: [...f.portals, ...extra] } : f;
    }),
  };
}
