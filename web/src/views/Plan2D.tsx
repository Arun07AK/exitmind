import { useEffect, useRef, useState } from "react";
import type { BottleneckResult, HazardFrame, SignState } from "../../../src/server/contract.ts";
import type { Pt } from "../../../src/twin/schema.ts";
import { getJSON, isNotFound } from "../api.ts";
import { Metric } from "../components/Metric.tsx";
import { cx } from "../components/ui.tsx";
import { boxSum, useGeometry, type Geometry } from "../geometry.ts";
import { PERSONA_COLOR, PROTECTED, SIGN_COLORS, STATE_COLORS, STATE_LABELS, signGlyph, stateColor } from "../lib/colors.ts";
import { b64ToFloat32, decodeHazard } from "../lib/decode.ts";
import { interpolate, type Interp } from "../lib/interp.ts";
import { useFrameAttrs } from "../lib/useFrameAttrs.ts";
import { useStore } from "../store.ts";

type HeatMode = "off" | "live" | "cumulative";
export interface PlanPoint { floor: string; x: number; y: number }
interface Picked { kind: "portal" | "exit" | "stair"; id: string; label: string; floor: string; widthIn?: number; keys: string[] }
interface Cell { fi: number; x: number; y: number; w: number; h: number }
interface View { zoom: number; panX: number; panY: number }

const DENSITY_FALLBACK = 4.0;
const SPACE_FILL: Record<string, string> = { corridor: "#334155", lobby: "#3b4a61", room: "#1e293b", stair: "#2e2a4a", elevator: "#0b1120", service: "#182133" };

export interface Plan2DProps {
  onPlanClick?: (p: PlanPoint) => void;
  marker?: PlanPoint | null;
  className?: string;
}

function ramp(v: number): [number, number, number, number] {
  if (v <= 0) return [0, 0, 0, 0];
  if (v >= 1) return [220, 38, 38, 200];
  const t = v;
  return [Math.round(132 + (249 - 132) * t), Math.round(204 + (115 - 204) * t), Math.round(22 + (22 - 22) * t), Math.round(60 + 110 * t)];
}

function pip(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function polyPath(ctx: CanvasRenderingContext2D, poly: readonly Pt[]): void {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

function layout(n: number, multi: boolean, fi: number, W: number, H: number): Cell[] {
  if (!multi) return [{ fi, x: 0, y: 0, w: W, h: H }];
  const horiz = W / H > 1.2;
  return Array.from({ length: n }, (_, i) => (horiz ? { fi: i, x: (i * W) / n, y: 0, w: W / n, h: H } : { fi: i, x: 0, y: (i * H) / n, w: W, h: H / n }));
}

function transform(geo: Geometry, c: Cell, v: View): { scale: number; tx: number; ty: number } {
  const [x0, y0, x1, y1] = geo.bounds;
  const pad = 14;
  const fit = Math.max(1e-3, Math.min((c.w - 2 * pad) / Math.max(1, x1 - x0), (c.h - 2 * pad - 14) / Math.max(1, y1 - y0)));
  const scale = fit * v.zoom;
  const cxw = (x0 + x1) / 2 + v.panX, cyw = (y0 + y1) / 2 + v.panY;
  return { scale, tx: c.x + c.w / 2 - cxw * scale, ty: c.y + c.h / 2 + 7 - cyw * scale };
}

const hazardLayers = new WeakMap<HazardFrame, HTMLCanvasElement[]>();
function hazardCanvases(geo: Geometry, h: HazardFrame): HTMLCanvasElement[] {
  let out = hazardLayers.get(h);
  if (out) return out;
  const d = decodeHazard(h);
  out = geo.grid.floors.map((f, fi) => {
    const c = document.createElement("canvas");
    c.width = f.w; c.height = f.h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(f.w, f.h);
    const sm = d.smoke[fi], th = d.threat[fi], bl = d.blocked[fi];
    for (let i = 0; i < f.w * f.h; i++) {
      const o = i * 4;
      if (bl?.[i]) { img.data[o] = 127; img.data[o + 1] = 29; img.data[o + 2] = 29; img.data[o + 3] = 220; }
      else if (th?.[i]) { img.data[o] = 239; img.data[o + 1] = 68; img.data[o + 2] = 68; img.data[o + 3] = 120; }
      else if (sm?.[i]) { img.data[o] = 170; img.data[o + 1] = 170; img.data[o + 2] = 175; img.data[o + 3] = Math.round(sm[i]! * 0.75); }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  hazardLayers.set(h, out);
  return out;
}

interface HeatLayer { canvas: HTMLCanvasElement; counts: Float32Array; sums: Float32Array; at: number; key: string }

export default function Plan2D({ onPlanClick, marker, className }: Plan2DProps) {
  const { geo, error } = useGeometry();
  const canvasRef = useFrameAttrs<HTMLCanvasElement>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [floorIdx, setFloorIdx] = useState(0);
  const [multi, setMulti] = useState(false);
  const [heat, setHeat] = useState<HeatMode>("off");
  const [bottle, setBottle] = useState<BottleneckResult | null>(null);
  const [bottleMissing, setBottleMissing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const summary = useStore((s) => s.summary);
  const view = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const live = useRef({ floorIdx, multi, heat, bottle, marker, onPlanClick, picked });
  live.current = { floorIdx, multi, heat, bottle, marker, onPlanClick, picked };
  const heatLayers = useRef(new Map<number, HeatLayer>());

  useEffect(() => {
    if (heat === "off" || bottle || bottleMissing) return;
    getJSON<BottleneckResult>("/api/design/bottlenecks").then(setBottle).catch((e: unknown) => setBottleMissing(isNotFound(e) ? "404" : String(e)));
  }, [heat, bottle, bottleMissing]);

  useEffect(() => {
    if (!geo) return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const threshold = () => live.current.bottle?.densityThreshold ?? DENSITY_FALLBACK;

    const liveHeat = (fi: number, ip: Interp | null): HTMLCanvasElement => {
      const f = geo.grid.floors[fi]!;
      let L = heatLayers.current.get(fi);
      if (!L) {
        const c = document.createElement("canvas");
        c.width = f.w; c.height = f.h;
        L = { canvas: c, counts: new Float32Array(f.w * f.h), sums: new Float32Array(f.w * f.h), at: 0, key: "" };
        heatLayers.current.set(fi, L);
      }
      const now = performance.now();
      const key = `live:${ip?.tick ?? -1}`;
      if (now - L.at < 120 && L.key.startsWith("live")) return L.canvas;
      L.at = now; L.key = key;
      L.counts.fill(0);
      if (ip) for (let a = 0; a < ip.n; a++) {
        if (ip.floor[a] !== fi || ip.state[a] === PROTECTED) continue;
        const cxi = Math.floor((ip.x[a]! - f.ox) / f.cellFt), cyi = Math.floor((ip.y[a]! - f.oy) / f.cellFt);
        if (cxi >= 0 && cyi >= 0 && cxi < f.w && cyi < f.h) L.counts[cyi * f.w + cxi]! += 1;
      }
      boxSum(L.counts, f.w, f.h, 2, L.sums);
      const area = geo.grid.cellM * geo.grid.cellM, thr = threshold(), win = geo.win5[fi]!, walk = geo.walk[fi]!;
      const c2 = L.canvas.getContext("2d")!;
      const img = c2.createImageData(f.w, f.h);
      for (let i = 0; i < f.w * f.h; i++) {
        if (!walk[i] || !L.sums[i]) continue;
        const d = L.sums[i]! / Math.max(1, win[i]!) / area;
        const [r, g, b, al] = ramp(d / thr);
        img.data.set([r, g, b, al], i * 4);
      }
      c2.putImageData(img, 0, 0);
      return L.canvas;
    };

    const cumHeat = (fi: number): HTMLCanvasElement | null => {
      const b = live.current.bottle;
      const src = b?.dangerHeat[fi];
      if (!b || !src) return null;
      const f = geo.grid.floors[fi]!;
      const key = `cum:${fi}`;
      let L = heatLayers.current.get(100 + fi);
      if (L && L.key === key) return L.canvas;
      const c = document.createElement("canvas");
      c.width = f.w; c.height = f.h;
      const v = b64ToFloat32(src);
      let max = 0;
      for (const arr of b.dangerHeat) for (const x of b64ToFloat32(arr)) max = Math.max(max, x);
      const c2 = c.getContext("2d")!;
      const img = c2.createImageData(f.w, f.h);
      for (let i = 0; i < Math.min(v.length, f.w * f.h); i++) if (v[i]! > 0 && max > 0) img.data.set(ramp(Math.min(0.999, v[i]! / max)), i * 4);
      c2.putImageData(img, 0, 0);
      L = { canvas: c, counts: v, sums: v, at: 0, key };
      heatLayers.current.set(100 + fi, L);
      return c;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth, H = wrap.clientHeight;
      if (!W || !H) return;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      }
      const st = useStore.getState();
      const ip = interpolate(st.frameA, st.frameB, st.alpha);
      const signs = new Map<string, SignState | null>((st.frameB?.signs ?? []).map((s) => [s.mount, s.state]));
      const hz = st.hazard;
      const hzLayers = hz ? hazardCanvases(geo, hz) : null;
      const damaged = new Set(hz?.damaged ?? []);
      const { floorIdx: fsel, multi: m, heat: hm, marker: mk, picked: pk } = live.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const cell of layout(geo.twin.floors.length, m, Math.min(fsel, geo.twin.floors.length - 1), W, H)) {
        const floor = geo.twin.floors[cell.fi]!;
        const gf = geo.grid.floors[cell.fi];
        const { scale, tx, ty } = transform(geo, cell, view.current);
        const px = 1 / scale;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.rect(cell.x, cell.y, cell.w, cell.h);
        ctx.clip();
        ctx.fillStyle = "#94a3b8";
        ctx.font = "600 11px ui-sans-serif, system-ui";
        ctx.fillText(`${floor.id}  ${floor.name}`, cell.x + 8, cell.y + 14);
        if (m && cell.fi !== 0) { ctx.strokeStyle = "#1e293b"; ctx.strokeRect(cell.x, cell.y, cell.w, cell.h); }
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
        for (const s of floor.spaces) {
          const fill = SPACE_FILL[s.kind];
          if (!fill) continue;
          polyPath(ctx, s.polygon);
          ctx.fillStyle = fill;
          ctx.fill();
        }
        ctx.imageSmoothingEnabled = true;
        if (gf && hm !== "off") {
          const layer = hm === "live" ? liveHeat(cell.fi, ip) : cumHeat(cell.fi);
          if (layer) ctx.drawImage(layer, gf.ox, gf.oy, gf.w * gf.cellFt, gf.h * gf.cellFt);
        }
        if (gf && hzLayers?.[cell.fi]) ctx.drawImage(hzLayers[cell.fi]!, gf.ox, gf.oy, gf.w * gf.cellFt, gf.h * gf.cellFt);
        for (const v of floor.voids) {
          ctx.save();
          polyPath(ctx, v);
          ctx.fillStyle = "#020617";
          ctx.fill();
          ctx.clip();
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = px;
          const xs = v.map((p) => p[0]), ys = v.map((p) => p[1]);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          ctx.beginPath();
          for (let k = x0 - (y1 - y0); k < x1; k += 2) { ctx.moveTo(k, y0); ctx.lineTo(k + (y1 - y0), y1); }
          ctx.stroke();
          ctx.restore();
          polyPath(ctx, v);
          ctx.strokeStyle = "#64748b";
          ctx.lineWidth = px;
          ctx.stroke();
        }
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.2 * px;
        for (const s of floor.spaces) { if (s.kind === "exterior") continue; polyPath(ctx, s.polygon); ctx.stroke(); }
        if (floor.outline.length) { polyPath(ctx, floor.outline); ctx.lineWidth = 2.2 * px; ctx.strokeStyle = "#cbd5e1"; ctx.stroke(); }
        for (const p of floor.portals) {
          if (p.kind === "corridor_section") continue;
          ctx.beginPath(); ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
          ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3.5 * px; ctx.setLineDash([]); ctx.stroke();
          ctx.strokeStyle = p.kind === "door" ? "#f59e0b" : "#38bdf8"; ctx.lineWidth = 1.5 * px;
          ctx.setLineDash(p.kind === "opening" ? [3 * px, 2 * px] : []);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const stair of geo.twin.stairs) for (const fl of stair.flights) {
          if (fl.from !== floor.id) continue;
          const dmg = damaged.has(stair.id) || damaged.has(`${stair.id}@${floor.id}`);
          polyPath(ctx, fl.head);
          ctx.fillStyle = dmg ? "rgba(220,38,38,0.35)" : "rgba(167,139,250,0.30)";
          ctx.fill();
          ctx.strokeStyle = dmg ? "#ef4444" : "#a78bfa"; ctx.lineWidth = (dmg ? 2.5 : 1.2) * px; ctx.stroke();
          const [hx, hy] = fl.head.reduce<[number, number]>((s, q) => [s[0] + q[0] / fl.head.length, s[1] + q[1] / fl.head.length], [0, 0]);
          ctx.fillStyle = "#ddd6fe"; ctx.font = `${10 * px}px ui-sans-serif`; ctx.textAlign = "center";
          ctx.fillText(`${stair.name} \u2193${fl.to}`, hx, hy);
        }
        for (const ex of geo.twin.exits) {
          if (ex.floor !== floor.id) continue;
          const p = floor.portals.find((q) => q.id === ex.portal);
          if (!p) continue;
          const dmg = damaged.has(ex.id) || (ex.stair ? damaged.has(ex.stair) || damaged.has(`${ex.stair}@${floor.id}`) : false);
          ctx.beginPath(); ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
          ctx.strokeStyle = dmg ? "#ef4444" : "#22c55e"; ctx.lineWidth = (ex.kind === "exterior" ? 5 : 3) * px; ctx.stroke();
          if (ex.kind === "exterior") {
            ctx.fillStyle = dmg ? "#fca5a5" : "#4ade80"; ctx.font = `700 ${10 * px}px ui-sans-serif`; ctx.textAlign = "center";
            ctx.fillText(dmg ? "EXIT (damaged)" : "EXIT", (p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2 - 6 * px);
          }
        }
        for (const el of geo.grid.elements) {
          if (el.floor !== floor.id || !damaged.has(el.id)) continue;
          ctx.beginPath(); ctx.arc(el.x, el.y, 6, 0, Math.PI * 2);
          ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2.5 * px; ctx.stroke();
        }
        if (hz?.fireOrigin?.floor === floor.id) {
          ctx.beginPath(); ctx.arc(hz.fireOrigin.x, hz.fireOrigin.y, Math.max(2, 6 * px), 0, Math.PI * 2);
          ctx.fillStyle = "#f97316"; ctx.fill(); ctx.strokeStyle = "#fed7aa"; ctx.lineWidth = 1.5 * px; ctx.stroke();
        }
        if (hz?.threatPos?.floor === floor.id) {
          ctx.beginPath(); ctx.arc(hz.threatPos.x, hz.threatPos.y, Math.max(2, 6 * px), 0, Math.PI * 2);
          ctx.fillStyle = "#dc2626"; ctx.fill();
        }
        const sz = Math.max(2.4, 11 * px);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const mt of geo.grid.mounts) {
          if (mt.floor !== floor.id) continue;
          const s = signs.get(mt.id) ?? null;
          ctx.fillStyle = s ? SIGN_COLORS[s.kind] : "#334155";
          ctx.fillRect(mt.x - sz * 0.7, mt.y - sz * 0.5, sz * 1.4, sz);
          ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.8 * px; ctx.strokeRect(mt.x - sz * 0.7, mt.y - sz * 0.5, sz * 1.4, sz);
          ctx.fillStyle = "#fff"; ctx.font = `700 ${sz * 0.75}px ui-sans-serif`;
          ctx.fillText(signGlyph(s), mt.x, mt.y + sz * 0.05);
        }
        ctx.textBaseline = "alphabetic";
        if (ip) {
          const r = Math.max(0.9, 1.7 * px);
          const paths = new Map<number, Path2D>();
          const ring = new Path2D();
          for (let a = 0; a < ip.n; a++) {
            const s = ip.state[a]!;
            if (ip.floor[a] !== cell.fi || s === PROTECTED) continue;
            let p = paths.get(s);
            if (!p) paths.set(s, (p = new Path2D()));
            const x = ip.x[a]!, y = ip.y[a]!;
            p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2);
            if (ip.policy[a] === 2) { ring.moveTo(x + r * 2.2, y); ring.arc(x, y, r * 2.2, 0, Math.PI * 2); }
          }
          for (const [s, p] of paths) { ctx.fillStyle = stateColor(s); ctx.fill(p); }
          ctx.strokeStyle = PERSONA_COLOR; ctx.lineWidth = 1.2 * px; ctx.stroke(ring);
        }
        if (mk && mk.floor === floor.id) {
          ctx.strokeStyle = "#f472b6"; ctx.lineWidth = 2 * px;
          ctx.beginPath(); ctx.arc(mk.x, mk.y, 8 * px, 0, Math.PI * 2);
          ctx.moveTo(mk.x - 12 * px, mk.y); ctx.lineTo(mk.x + 12 * px, mk.y); ctx.moveTo(mk.x, mk.y - 12 * px); ctx.lineTo(mk.x, mk.y + 12 * px);
          ctx.stroke();
        }
        if (pk && pk.floor === floor.id) {
          const p = floor.portals.find((q) => q.id === pk.id || pk.keys.includes(q.id));
          if (p) { ctx.beginPath(); ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]); ctx.strokeStyle = "#f0abfc"; ctx.lineWidth = 6 * px; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1; }
        }
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);

    const cellAt = (sx: number, sy: number): Cell | null => {
      const { multi: m, floorIdx: fsel } = live.current;
      return layout(geo.twin.floors.length, m, Math.min(fsel, geo.twin.floors.length - 1), wrap.clientWidth, wrap.clientHeight).find((c) => sx >= c.x && sx < c.x + c.w && sy >= c.y && sy < c.y + c.h) ?? null;
    };
    const toWorld = (c: Cell, sx: number, sy: number): [number, number] => {
      const { scale, tx, ty } = transform(geo, c, view.current);
      return [(sx - tx) / scale, (sy - ty) / scale];
    };
    const local = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      const c = cellAt(sx, sy);
      if (!c) return;
      const before = toWorld(c, sx, sy);
      view.current.zoom = Math.max(0.3, Math.min(40, view.current.zoom * Math.exp(-e.deltaY * 0.0015)));
      const after = toWorld(c, sx, sy);
      view.current.panX += before[0] - after[0];
      view.current.panY += before[1] - after[1];
    };
    let drag: { x: number; y: number; moved: number; cell: Cell | null } | null = null;
    const onDown = (e: PointerEvent) => {
      const [sx, sy] = local(e);
      drag = { x: sx, y: sy, moved: 0, cell: cellAt(sx, sy) };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || !drag.cell) return;
      const [sx, sy] = local(e);
      const { scale } = transform(geo, drag.cell, view.current);
      view.current.panX -= (sx - drag.x) / scale;
      view.current.panY -= (sy - drag.y) / scale;
      drag.moved += Math.abs(sx - drag.x) + Math.abs(sy - drag.y);
      drag.x = sx; drag.y = sy;
    };
    const onUp = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!d || d.moved > 4 || !d.cell) return;
      const [sx, sy] = local(e);
      const [x, y] = toWorld(d.cell, sx, sy);
      const floor = geo.twin.floors[d.cell.fi]!;
      const { scale } = transform(geo, d.cell, view.current);
      const tol = Math.max(1.5, 7 / scale);
      let hit: Picked | null = null;
      for (const ex of geo.twin.exits) {
        if (ex.floor !== floor.id) continue;
        const p = floor.portals.find((q) => q.id === ex.portal);
        if (p && segDist(x, y, p.a, p.b) < tol) { hit = { kind: "exit", id: ex.id, label: ex.name, floor: floor.id, widthIn: p.clearWidthIn, keys: [ex.id, p.id, ...(ex.stair ? [`${ex.stair}@${floor.id}`] : [])] }; break; }
      }
      if (!hit) for (const p of floor.portals) {
        if (segDist(x, y, p.a, p.b) < tol) { hit = { kind: "portal", id: p.id, label: `${p.kind} ${p.connects.join(" / ")}`, floor: floor.id, widthIn: p.clearWidthIn, keys: [p.id] }; break; }
      }
      if (!hit) for (const st of geo.twin.stairs) for (const fl of st.flights) {
        if (!hit && fl.from === floor.id && pip(x, y, fl.head)) hit = { kind: "stair", id: `${st.id}@${floor.id}`, label: st.name, floor: floor.id, widthIn: st.clearWidthIn, keys: [`${st.id}@${floor.id}`, `${st.id}:${fl.from}>${fl.to}`] };
      }
      setPicked(hit);
      live.current.onPlanClick?.({ floor: floor.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    };
    const onDbl = () => { view.current = { zoom: 1, panX: 0, panY: 0 }; };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDbl);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, [geo, canvasRef]);

  const floors = geo?.twin.floors ?? [];
  const thr = bottle?.densityThreshold;
  const runSrc = summary ? `run summary, channel ${summary.channel}` : "";
  const fig = (rec: Record<string, number> | undefined, keys: string[]) => {
    for (const k of keys) if (rec && rec[k] !== undefined) return rec[k];
    return undefined;
  };

  return (
    <div className={cx("flex h-full min-h-0 flex-col", className)} data-testid="plan2d">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-2 py-1 text-xs">
        {floors.map((f, i) => (
          <button key={f.id} type="button" data-testid={`floor-${f.id}`} onClick={() => { setFloorIdx(i); setMulti(false); }} className={cx("rounded px-2 py-0.5", !multi && floorIdx === i ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700")}>
            {f.id}
          </button>
        ))}
        <button type="button" onClick={() => setMulti((v) => !v)} className={cx("rounded px-2 py-0.5", multi ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700")}>small multiples</button>
        <span className="ml-2 text-slate-500">heatmap</span>
        <select value={heat} onChange={(e) => setHeat(e.target.value as HeatMode)} className="rounded bg-slate-800 px-1 py-0.5 text-slate-200" data-testid="heat-mode">
          <option value="off">off</option>
          <option value="live">live density</option>
          <option value="cumulative">time above threshold</option>
        </select>
        <span className="ml-auto text-slate-500">wheel: zoom, drag: pan, double-click: reset</span>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas ref={canvasRef} data-testid="plan2d-canvas" data-tick="" data-state-hash="" className="absolute inset-0 h-full w-full cursor-crosshair touch-none" />
        {error && !geo ? <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Waiting for /api/twin and /api/grid: {error}</div> : null}
        <div className="pointer-events-none absolute bottom-1 left-1 flex flex-wrap gap-x-2 gap-y-0.5 rounded bg-slate-950/80 px-2 py-1 text-[10px] text-slate-300">
          {Object.entries(STATE_LABELS).filter(([k]) => Number(k) !== PROTECTED).map(([k, l]) => (
            <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLORS[Number(k)] }} />{l}</span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border border-white" />live persona</span>
          <span>protected: hidden</span>
        </div>
        {heat !== "off" ? (
          <div className="absolute top-6 left-1 max-w-[18rem] rounded bg-slate-950/85 px-2 py-1 text-[10px] text-slate-300" data-testid="heat-legend">
            <div className="h-2 w-40 rounded" style={{ background: "linear-gradient(90deg, rgba(132,204,22,.4), rgba(249,115,22,.7), rgb(220,38,38))" }} />
            {heat === "live" ? (
              <div>density in a 5x5-cell window, red at {thr ?? DENSITY_FALLBACK} p/m² ({thr !== undefined ? `densityThreshold from bottleneck result, ${bottle!.runs} runs` : "density.danger from config"})</div>
            ) : bottle ? (
              <div>mean person-seconds above {bottle.densityThreshold} p/m² per run, scaled to the maximum cell (bottleneck result, {bottle.runs} runs)</div>
            ) : bottleMissing === "404" ? (
              <div>not generated yet — run <code>npm run bottlenecks</code></div>
            ) : (
              <div>{bottleMissing ?? "loading bottleneck result"}</div>
            )}
          </div>
        ) : null}
        {picked ? (
          <div className="absolute top-1 right-1 w-64 rounded border border-slate-700 bg-slate-950/95 p-2 text-xs" data-testid="plan-picked">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-slate-200">{picked.kind} {picked.id}</span>
              <button type="button" className="text-slate-400 hover:text-white" onClick={() => setPicked(null)}>close</button>
            </div>
            <div className="mb-1 text-slate-400">{picked.label}{picked.widthIn !== undefined ? ` · clear width ${picked.widthIn} in (twin)` : ""}</div>
            {summary ? (
              <div className="grid grid-cols-2 gap-1">
                <Metric label="queue" value={fig(summary.metrics.portalQueuePS, picked.keys)} unit="p·s" source={runSrc} />
                <Metric label="crossings" value={fig(summary.metrics.portalCrossings, picked.keys)} source={runSrc} digits={0} />
                <Metric label="exit usage" value={fig(summary.metrics.exitUsage, picked.keys)} source={runSrc} digits={0} />
                <Metric label="flight entries" value={fig(summary.metrics.flightEntries, picked.keys)} source={runSrc} digits={0} />
              </div>
            ) : (
              <div className="text-slate-500">No run summary on this channel yet.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
