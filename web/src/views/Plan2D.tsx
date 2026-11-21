import { useEffect, useRef, useState } from "react";
import type { FrameMsg, HazardFrame, SignState } from "../../../src/server/contract.ts";
import type { Floor, Pt } from "../../../src/twin/schema.ts";
import { cx } from "../components/ui.tsx";
import { boxSum, useGeometry, type Geometry } from "../geometry.ts";
import { DENSE_SMOKE, IN_SMOKE, PERSONA_COLOR, PROTECTED, SIGN_COLORS, STATE_LABELS, densityRamp, elementColor, signGlyph, stateColor } from "../lib/colors.ts";
import { decodeHazard } from "../lib/decode.ts";
import { interpolate, type Interp } from "../lib/interp.ts";
import { useFrameAttrs } from "../lib/useFrameAttrs.ts";
import { exitStats, fmtTime, queueRates, smokeAt } from "../sim/derive.ts";
import { useView, type Layers } from "../sim/viewState.ts";
import { getRun, hazardAt, sampleRun, useStore, type Run } from "../store.ts";

export interface PlanPoint { floor: string; x: number; y: number }
export interface Plan2DProps {
  onPlanClick?: (p: PlanPoint) => void;
  marker?: PlanPoint | null;
  className?: string;
  /** draw this run at the shared playhead instead of the page's main run (Optimise compare) */
  channel?: string;
  floor?: number | "all";
  layers?: Partial<Layers>;
  /** initial framing in plan feet; zoom 1 fits the building */
  focus?: { x: number; y: number; zoom: number } | null;
  interactive?: boolean;
  showInspector?: boolean;
  testId?: string;
}

interface Cell { fi: number; x: number; y: number; w: number; h: number }
interface ViewXf { zoom: number; panX: number; panY: number }
interface Xf { scale: number; tx: number; ty: number }

const FILL: Record<string, string> = { room: "#ffffff", corridor: "#f6f7f9", lobby: "#f6f7f9", stair: "#eef0f3", elevator: "#eef0f3", service: "#f3f4f6" };
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const DANGER_DENSITY = 5;

function polyPath(ctx: CanvasRenderingContext2D | Path2D, poly: readonly Pt[]): void {
  poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function layout(nf: number, sel: number | "all", W: number, H: number): Cell[] {
  if (sel !== "all") return [{ fi: sel, x: 0, y: 0, w: W, h: H }];
  const order = Array.from({ length: nf }, (_, i) => nf - 1 - i);
  if (W / H > 1.5 && nf > 2) {
    const cols = 2, rows = Math.ceil(nf / cols);
    return order.map((fi, k) => ({ fi, x: ((k % cols) * W) / cols, y: (Math.floor(k / cols) * H) / rows, w: W / cols, h: H / rows }));
  }
  return order.map((fi, k) => ({ fi, x: 0, y: (k * H) / nf, w: W, h: H / nf }));
}

function transform(geo: Geometry, c: Cell, v: ViewXf, multi: boolean): Xf {
  const [x0, y0, x1, y1] = geo.bounds;
  const small = c.w < 640;
  const padX = small ? 12 : multi ? 40 : 72, padY = small ? 28 : multi ? 26 : 56;
  const fit = Math.max(1e-3, Math.min((c.w - 2 * padX) / Math.max(1, x1 - x0), (c.h - 2 * padY) / Math.max(1, y1 - y0)));
  const scale = fit * v.zoom;
  const cxw = (x0 + x1) / 2 + v.panX, cyw = (y0 + y1) / 2 + v.panY;
  return { scale, tx: c.x + c.w / 2 - cxw * scale, ty: c.y + c.h / 2 + (multi ? 6 : 0) - cyw * scale };
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: { align: "left" | "right" | "center"; vAlign?: "top" | "bottom" | "middle"; bg?: string; border?: string; color?: string; dot?: string; sub?: string; subColor?: string; mono?: boolean }): void {
  ctx.font = `500 11px ${o.mono ? MONO : FONT}`;
  const tw = ctx.measureText(text).width;
  ctx.font = `400 11px ${FONT}`;
  const sw = o.sub ? ctx.measureText(o.sub).width + 6 : 0;
  const w = tw + sw + (o.dot ? 13 : 0) + 14, h = 22;
  const k = ctx.getTransform().a || 1;
  const cw = ctx.canvas.width / k, ch = ctx.canvas.height / k;
  let bx = o.align === "left" ? x : o.align === "right" ? x - w : x - w / 2;
  if (bx + w > cw - 4) bx = o.align === "left" ? x - w - 32 : cw - 4 - w;
  if (bx < 4) bx = o.align === "right" ? x + 32 : 4;
  const by = Math.max(4, Math.min(ch - h - 4, o.vAlign === "top" ? y : o.vAlign === "bottom" ? y - h : y - h / 2));
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fillStyle = o.bg ?? "#ffffff";
  ctx.shadowColor = "rgba(16,24,40,0.08)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = o.border ?? "#d0d5dc"; ctx.lineWidth = 1; ctx.stroke();
  let cx0 = bx + 7;
  if (o.dot) { ctx.beginPath(); ctx.arc(cx0 + 3.5, by + h / 2, 3.5, 0, Math.PI * 2); ctx.fillStyle = o.dot; ctx.fill(); cx0 += 13; }
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.font = `500 11px ${o.mono ? MONO : FONT}`; ctx.fillStyle = o.color ?? "#14171c"; ctx.fillText(text, cx0, by + h / 2 + 0.5);
  if (o.sub) { ctx.font = `400 11px ${FONT}`; ctx.fillStyle = o.subColor ?? "#6a7280"; ctx.fillText(o.sub, cx0 + tw + 6, by + h / 2 + 0.5); }
}

/* ---------- trails: built incrementally per run in plan feet, one path per colour per floor ---------- */
interface TrailCache { upTo: number; floors: Map<string, Path2D>[]; px: Float32Array; py: Float32Array; pf: Int8Array; ok: Uint8Array }
const trailCaches = new WeakMap<Run, TrailCache>();
function trailsFor(run: Run, upTo: number, geo: Geometry): TrailCache {
  let c = trailCaches.get(run);
  const n = run.frames[0]?.n ?? 0;
  if (!c || upTo < c.upTo || c.px.length !== n) {
    c = { upTo: -1, floors: geo.grid.floors.map(() => new Map()), px: new Float32Array(n), py: new Float32Array(n), pf: new Int8Array(n), ok: new Uint8Array(n) };
    trailCaches.set(run, c);
  }
  for (let k = c.upTo + 1; k <= upTo && k < run.frames.length; k++) {
    const f = run.frames[k]!;
    for (let a = 0; a < f.n; a++) {
      const st = f.state[a]!;
      if (st === PROTECTED) { c.ok[a] = 0; continue; }
      const x = f.x[a]! / 10, y = f.y[a]! / 10, fl = f.floor[a]!;
      if (c.ok[a] && c.pf[a] === fl) {
        const d = Math.hypot(x - c.px[a]!, y - c.py[a]!);
        if (d > 0.05 && d < 14) {
          const id = geo.grid.elements[f.target?.[a] ?? -1]?.id;
          const col = elementColor(id);
          const m = c.floors[fl];
          if (m) {
            let p = m.get(col);
            if (!p) m.set(col, (p = new Path2D()));
            p.moveTo(c.px[a]!, c.py[a]!); p.lineTo(x, y);
          }
        }
      }
      c.px[a] = x; c.py[a] = y; c.pf[a] = fl; c.ok[a] = 1;
    }
  }
  c.upTo = Math.max(c.upTo, Math.min(upTo, run.frames.length - 1));
  return c;
}

/* ---------- hazard and density rasters at grid resolution ---------- */
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
      if (bl?.[i]) img.data.set([180, 35, 24, 150], o);
      else if (th?.[i]) img.data.set([229, 55, 43, 46], o);
      else if (sm?.[i]) img.data.set([62, 72, 86, Math.round(sm[i]! * 0.3)], o);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  hazardLayers.set(h, out);
  return out;
}

export default function Plan2D({ onPlanClick, marker, className, channel, floor: floorProp, layers: layersProp, focus, interactive = true, showInspector = true, testId = "plan2d-canvas" }: Plan2DProps) {
  const { geo, error } = useGeometry();
  const canvasRef = useFrameAttrs<HTMLCanvasElement>();
  const staticRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewFloor = useView((s) => s.floor);
  const viewLayers = useView((s) => s.layers);
  const inspect = useView((s) => s.inspect);
  const [picked, setPicked] = useState<{ id: string; label: string; floor: string } | null>(null);
  const floorSel = floorProp ?? viewFloor;
  const layers: Layers = { ...viewLayers, ...layersProp };
  const view = useRef<ViewXf>({ zoom: focus?.zoom ?? 1, panX: 0, panY: 0 });
  const live = useRef({ floorSel, layers, marker, onPlanClick, channel, inspect, picked, interactive, showInspector });
  live.current = { floorSel, layers, marker, onPlanClick, channel, inspect, picked, interactive, showInspector };

  useEffect(() => {
    if (!geo || !focus) return;
    const [x0, y0, x1, y1] = geo.bounds;
    view.current = { zoom: focus.zoom, panX: focus.x - (x0 + x1) / 2, panY: focus.y - (y0 + y1) / 2 };
  }, [geo, focus?.x, focus?.y, focus?.zoom]);

  useEffect(() => {
    if (!geo) return;
    const canvas = canvasRef.current, wrap = wrapRef.current, statics = staticRef.current, trailCanvas = trailRef.current;
    if (!canvas || !wrap || !statics || !trailCanvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let staticKey = "";
    let trailKey = "";
    let trailIdx = -1;
    const dens = geo.grid.floors.map((f) => { const c = document.createElement("canvas"); c.width = f.w; c.height = f.h; return { c, counts: new Float32Array(f.w * f.h), sums: new Float32Array(f.w * f.h), key: "", at: 0 }; });
    let lastCmd = useView.getState().cmd?.n ?? 0;
    let lastDirty = "";
    void document.fonts?.ready.then(() => { staticKey = ""; lastDirty = ""; });
    const nf = geo.twin.floors.length;
    const [bx0, by0, bx1, by1] = geo.bounds;
    const bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2;

    const source = (): { run: Run | null; frame: FrameMsg | null; ip: Interp | null; hz: HazardFrame | null; idx: number } => {
      const st = useStore.getState();
      const ch = live.current.channel;
      if (ch) {
        const run = getRun(ch);
        const smp = sampleRun(run, st.t);
        if (!run || !smp) return { run, frame: null, ip: null, hz: null, idx: -1 };
        return { run, frame: smp.a, ip: interpolate(smp.a, smp.b, smp.alpha), hz: hazardAt(run, smp.a.tick), idx: run.frames.indexOf(smp.a) };
      }
      const run = getRun(st.channel);
      return { run, frame: st.frame, ip: interpolate(st.frameA, st.frameB, st.alpha), hz: st.hazard, idx: run && st.frame ? run.frames.indexOf(st.frame) : -1 };
    };

    const drawStatic = (sctx: CanvasRenderingContext2D, floor: Floor, xf: Xf, dpr: number, damaged: Set<string>) => {
      const px = 1 / xf.scale;
      sctx.setTransform(dpr * xf.scale, 0, 0, dpr * xf.scale, dpr * xf.tx, dpr * xf.ty);
      for (const s of floor.spaces) { sctx.beginPath(); polyPath(sctx, s.polygon); sctx.fillStyle = FILL[s.kind] ?? "#ffffff"; sctx.fill(); }
      for (const v of floor.voids) { sctx.beginPath(); polyPath(sctx, v); sctx.fillStyle = "#e9ecf0"; sctx.fill(); sctx.setLineDash([3 * px, 3 * px]); sctx.strokeStyle = "#aeb6c1"; sctx.lineWidth = px; sctx.stroke(); sctx.setLineDash([]); }
      sctx.strokeStyle = "#cdd2d9"; sctx.lineWidth = 0.7 * px;
      for (const s of floor.spaces) {
        if (s.kind !== "stair" && s.kind !== "elevator") continue;
        const xs = s.polygon.map((p) => p[0]), ys = s.polygon.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        sctx.beginPath();
        if (s.kind === "elevator") { sctx.moveTo(x0 + 0.8, y0 + 0.8); sctx.lineTo(x1 - 0.8, y1 - 0.8); sctx.moveTo(x1 - 0.8, y0 + 0.8); sctx.lineTo(x0 + 0.8, y1 - 0.8); }
        else if (x1 - x0 > y1 - y0) for (let x = x0 + 0.9; x < x1 - 0.4; x += 0.9) { sctx.moveTo(x, y0 + 0.5); sctx.lineTo(x, y1 - 0.5); }
        else for (let y = y0 + 0.9; y < y1 - 0.4; y += 0.9) { sctx.moveTo(x0 + 0.5, y); sctx.lineTo(x1 - 0.5, y); }
        sctx.stroke();
      }
      sctx.lineJoin = "round";
      sctx.strokeStyle = "#c3c9d1"; sctx.lineWidth = 1 * px;
      for (const s of floor.spaces) { sctx.beginPath(); polyPath(sctx, s.polygon); sctx.stroke(); }
      if (floor.outline.length) { sctx.beginPath(); polyPath(sctx, floor.outline); sctx.strokeStyle = "#2b313a"; sctx.lineWidth = 1.9 * px; sctx.stroke(); }
      for (const p of floor.portals) {
        if (p.kind === "corridor_section") continue;
        const ext = p.connects.includes("OUTSIDE");
        sctx.beginPath(); sctx.moveTo(p.a[0], p.a[1]); sctx.lineTo(p.b[0], p.b[1]);
        sctx.strokeStyle = ext ? "#ffffff" : "#fafafb"; sctx.lineWidth = (ext ? 4.5 : 3) * px; sctx.stroke();
        if (ext) {
          const ex = geo.twin.exits.find((e) => e.portal === p.id);
          const dmg = ex ? damaged.has(ex.id) : false;
          sctx.beginPath(); sctx.moveTo(p.a[0], p.a[1]); sctx.lineTo(p.b[0], p.b[1]);
          sctx.strokeStyle = dmg ? "#d92d20" : elementColor(ex?.id); sctx.lineWidth = 3.2 * px; sctx.lineCap = "round"; sctx.stroke(); sctx.lineCap = "butt";
        } else if (p.kind === "door") {
          const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) || 1;
          const nx = (-(p.b[1] - p.a[1]) / L) * 2.4 * px, ny = ((p.b[0] - p.a[0]) / L) * 2.4 * px;
          sctx.beginPath();
          for (const q of [p.a, p.b]) { sctx.moveTo(q[0] - nx, q[1] - ny); sctx.lineTo(q[0] + nx, q[1] + ny); }
          sctx.strokeStyle = "#8a93a0"; sctx.lineWidth = 0.9 * px; sctx.stroke();
        }
      }
      if (xf.scale > 3.2) {
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sctx.font = `400 11px ${FONT}`; sctx.fillStyle = "#a0a8b4"; sctx.textAlign = "center"; sctx.textBaseline = "middle";
        for (const s of floor.spaces) {
          if (s.kind !== "room" && s.kind !== "lobby") continue;
          const xs = s.polygon.map((p) => p[0]), ys = s.polygon.map((p) => p[1]);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
          if (w * h < 650 || w * xf.scale < 70) continue;
          sctx.fillText(s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name, xf.tx + ((Math.min(...xs) + Math.max(...xs)) / 2) * xf.scale, xf.ty + ((Math.min(...ys) + Math.max(...ys)) / 2) * xf.scale);
        }
      }
    };

    const densityLayer = (fi: number, ip: Interp, key: string): HTMLCanvasElement => {
      const L = dens[fi]!, f = geo.grid.floors[fi]!;
      const now = performance.now();
      if (L.key === key || (now - L.at < 90 && L.key.split("|")[0] === key.split("|")[0])) return L.c;
      L.key = key; L.at = now;
      L.counts.fill(0);
      for (let a = 0; a < ip.n; a++) {
        if (ip.floor[a] !== fi || ip.state[a] === PROTECTED) continue;
        const cxi = Math.floor((ip.x[a]! - f.ox) / f.cellFt), cyi = Math.floor((ip.y[a]! - f.oy) / f.cellFt);
        if (cxi >= 0 && cyi >= 0 && cxi < f.w && cyi < f.h) L.counts[cyi * f.w + cxi]! += 1;
      }
      boxSum(L.counts, f.w, f.h, 2, L.sums);
      const area = geo.grid.cellM * geo.grid.cellM, win = geo.win5[fi]!, walk = geo.walk[fi]!;
      const c2 = L.c.getContext("2d")!;
      const img = c2.createImageData(f.w, f.h);
      for (let i = 0; i < f.w * f.h; i++) {
        if (!walk[i] || !L.sums[i]) continue;
        const d = L.sums[i]! / Math.max(1, win[i]!) / area;
        if (d < 0.9) continue;
        img.data.set(densityRamp(d / DANGER_DENSITY), i * 4);
      }
      c2.putImageData(img, 0, 0);
      return L.c;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = wrap.clientWidth, H = wrap.clientHeight;
      if (!W || !H) return;
      for (const c of [canvas, statics, trailCanvas]) if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const vs = useView.getState();
      if (vs.cmd && vs.cmd.n !== lastCmd) {
        lastCmd = vs.cmd.n;
        if (vs.cmd.kind === "zoomIn") view.current.zoom = Math.min(40, view.current.zoom * 1.35);
        else if (vs.cmd.kind === "zoomOut") view.current.zoom = Math.max(0.4, view.current.zoom / 1.35);
        else if (vs.cmd.kind === "reset") view.current = { zoom: 1, panX: 0, panY: 0 };
      }
      const { run, frame, ip, hz, idx } = source();
      const L = live.current;
      const st0 = useStore.getState();
      const dirty = `${W}x${H}@${dpr}|${st0.t}|${st0.alpha}|${idx}|${run?.channel}|${L.floorSel}|${JSON.stringify(L.layers)}|${L.inspect}|${vs.followAgent}|${L.picked?.id}|${L.marker?.x},${L.marker?.y}|${view.current.zoom},${view.current.panX},${view.current.panY}|${hz?.version}`;
      if (dirty === lastDirty) return;
      lastDirty = dirty;
      const multi = L.floorSel === "all";
      const cells = layout(nf, L.floorSel, W, H);
      const damaged = new Set(hz?.damaged ?? []);
      const ag = L.inspect !== null && ip && L.inspect < ip.n ? L.inspect : null;
      if (ag !== null && vs.followAgent && ip && !multi && ip.floor[ag] === L.floorSel) {
        const tx = ip.x[ag]! - bcx, ty = ip.y[ag]! - bcy;
        view.current.panX += (tx - view.current.panX) * 0.12; view.current.panY += (ty - view.current.panY) * 0.12;
      }
      const xfs = cells.map((c) => transform(geo, c, view.current, multi));
      const sKey = `${W}x${H}@${dpr}|${cells.map((c) => c.fi).join(",")}|${xfs.map((x) => `${x.scale.toFixed(4)},${x.tx.toFixed(1)},${x.ty.toFixed(1)}`).join(";")}|${[...damaged].join(",")}`;
      if (sKey !== staticKey) {
        staticKey = sKey;
        const sctx = statics.getContext("2d")!;
        sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, statics.width, statics.height);
        cells.forEach((c, k) => drawStatic(sctx, geo.twin.floors[c.fi]!, xfs[k]!, dpr, damaged));
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const tctx = trailCanvas.getContext("2d")!;
      const tKey = L.layers.trails && run && idx >= 0 ? `${sKey}|${run.channel}` : "";
      if (!tKey) {
        if (trailKey) { tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height); trailKey = ""; trailIdx = -1; }
      } else if (tKey !== trailKey || idx < trailIdx || idx - trailIdx > 40) {
        trailKey = tKey; trailIdx = idx;
        const tc = trailsFor(run!, idx, geo);
        tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
        cells.forEach((c, k) => {
          const xf = xfs[k]!;
          tctx.save();
          tctx.beginPath(); tctx.rect(c.x * dpr, c.y * dpr, c.w * dpr, c.h * dpr); tctx.clip();
          tctx.setTransform(dpr * xf.scale, 0, 0, dpr * xf.scale, dpr * xf.tx, dpr * xf.ty);
          tctx.lineWidth = 1.15 / xf.scale; tctx.lineCap = "round"; tctx.globalAlpha = 0.5;
          for (const [col, p] of tc.floors[c.fi] ?? []) { tctx.strokeStyle = col; tctx.stroke(p); }
          tctx.restore();
        });
      } else if (idx > trailIdx) {
        const from = trailIdx + 1;
        trailIdx = idx;
        cells.forEach((c, k) => {
          const xf = xfs[k]!;
          const groups = new Map<string, Path2D>();
          for (let f = Math.max(1, from); f <= idx; f++) {
            const prev = run!.frames[f - 1]!, cur = run!.frames[f]!;
            for (let a = 0; a < cur.n; a++) {
              if (cur.state[a] === PROTECTED || prev.state[a] === PROTECTED || cur.floor[a] !== c.fi || prev.floor[a] !== c.fi) continue;
              const x0 = prev.x[a]! / 10, y0 = prev.y[a]! / 10, x1 = cur.x[a]! / 10, y1 = cur.y[a]! / 10;
              const d = Math.hypot(x1 - x0, y1 - y0);
              if (d <= 0.05 || d >= 14) continue;
              const col = elementColor(geo.grid.elements[cur.target?.[a] ?? -1]?.id);
              let pth = groups.get(col);
              if (!pth) groups.set(col, (pth = new Path2D()));
              pth.moveTo(x0, y0); pth.lineTo(x1, y1);
            }
          }
          tctx.save();
          tctx.beginPath(); tctx.rect(c.x * dpr, c.y * dpr, c.w * dpr, c.h * dpr); tctx.clip();
          tctx.setTransform(dpr * xf.scale, 0, 0, dpr * xf.scale, dpr * xf.tx, dpr * xf.ty);
          tctx.lineWidth = 1.15 / xf.scale; tctx.lineCap = "round"; tctx.globalAlpha = 0.5;
          for (const [col, pth] of groups) { tctx.strokeStyle = col; tctx.stroke(pth); }
          tctx.restore();
        });
      }

      const queues = L.layers.bottlenecks ? queueRates(run, frame) : null;
      const exits = L.layers.exits ? exitStats(run, frame, geo) : [];
      const signs = new Map<string, { state: SignState | null; dynamic: boolean }>((frame?.signs ?? []).map((s) => [s.mount, s]));
      let cardPos: [number, number] | null = null;

      cells.forEach((cell, k) => {
        const floor = geo.twin.floors[cell.fi]!;
        const gf = geo.grid.floors[cell.fi];
        const xf = xfs[k]!;
        const px = 1 / xf.scale;
        const S = (x: number, y: number): [number, number] => [xf.tx + x * xf.scale, xf.ty + y * xf.scale];
        ctx.save();
        ctx.beginPath(); ctx.rect(cell.x * dpr, cell.y * dpr, cell.w * dpr, cell.h * dpr); ctx.clip();
        ctx.setTransform(dpr * xf.scale, 0, 0, dpr * xf.scale, dpr * xf.tx, dpr * xf.ty);
        ctx.imageSmoothingEnabled = true;
        if (gf && hz && L.layers.smoke) { const hc = hazardCanvases(geo, hz)[cell.fi]; if (hc) ctx.drawImage(hc, gf.ox, gf.oy, gf.w * gf.cellFt, gf.h * gf.cellFt); }
        if (gf && ip && L.layers.density) ctx.drawImage(densityLayer(cell.fi, ip, `${frame?.tick ?? -1}|${Math.round((useStore.getState().t) * 4)}`), gf.ox, gf.oy, gf.w * gf.cellFt, gf.h * gf.cellFt);

        if (hz?.fireOrigin?.floor === floor.id) {
          const { x, y } = hz.fireOrigin;
          ctx.beginPath(); ctx.arc(x, y, 14 * px, 0, Math.PI * 2); ctx.strokeStyle = "rgba(229,55,43,0.55)"; ctx.lineWidth = 1.5 * px; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 5 * px, 0, Math.PI * 2); ctx.fillStyle = "#e5372b"; ctx.fill();
        }
        if (hz?.threatPos?.floor === floor.id) {
          ctx.beginPath(); ctx.arc(hz.threatPos.x, hz.threatPos.y, 6 * px, 0, Math.PI * 2); ctx.fillStyle = "#b42318"; ctx.fill();
        }

        if (ip && L.layers.agents) {
          const r = Math.max(2.1 * px, 0.85);
          const groups = new Map<string, Path2D>();
          const rings = new Path2D();
          for (let a = 0; a < ip.n; a++) {
            const st = ip.state[a]!;
            if (ip.floor[a] !== cell.fi || st === PROTECTED) continue;
            const x = ip.x[a]!, y = ip.y[a]!;
            const col = smokeAt(geo, hz, cell.fi, x, y) >= DENSE_SMOKE ? IN_SMOKE : stateColor(st);
            let p = groups.get(col);
            if (!p) groups.set(col, (p = new Path2D()));
            p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2);
            if (ip.policy[a] === 2) { rings.moveTo(x + r * 2, y); rings.arc(x, y, r * 2, 0, Math.PI * 2); }
          }
          ctx.lineWidth = 1.4 * px; ctx.strokeStyle = "#ffffff";
          for (const p of groups.values()) ctx.stroke(p);
          for (const [col, p] of groups) { ctx.fillStyle = col; ctx.fill(p); }
          ctx.strokeStyle = PERSONA_COLOR; ctx.lineWidth = 1.2 * px; ctx.stroke(rings);
        }
        ctx.restore();

        ctx.save();
        ctx.beginPath(); ctx.rect(cell.x * dpr, cell.y * dpr, cell.w * dpr, cell.h * dpr); ctx.clip();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (multi) {
          const inside = ip ? Array.from({ length: ip.n }, (_, a) => a).filter((a) => ip.floor[a] === cell.fi && ip.state[a] !== PROTECTED).length : 0;
          label(ctx, `${floor.id}`, cell.x + 12, cell.y + 10, { align: "left", vAlign: "top", sub: `${floor.name} · ${inside} inside`, mono: true });
        }
        for (const id of damaged) {
          const el = geo.grid.elements.find((e) => e.id === id && e.floor === floor.id);
          if (!el) continue;
          const [sx, sy] = S(el.x, el.y);
          ctx.fillStyle = "rgba(217,45,32,0.12)"; ctx.strokeStyle = "#d92d20"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(sx - 13, sy - 13, 26, 26, 6); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(sx - 6, sy - 6); ctx.lineTo(sx + 6, sy + 6); ctx.moveTo(sx + 6, sy - 6); ctx.lineTo(sx - 6, sy + 6); ctx.stroke();
          label(ctx, `${id} no passage`, sx - 18, sy, { align: "right", bg: "#d92d20", border: "#d92d20", color: "#ffffff", mono: true });
        }
        if (hz?.fireOrigin?.floor === floor.id && !multi) {
          const [sx, sy] = S(hz.fireOrigin.x, hz.fireOrigin.y);
          label(ctx, "Fire origin", sx + 18, sy, { align: "left", bg: "#fdecea", border: "#f6c9c4", color: "#b42318" });
        }
        if (queues && queues.size) {
          const here = geo.grid.portals.filter((p) => p.floor === floor.id && (queues.get(p.id) ?? 0) >= 1).sort((a, b) => queues.get(b.id)! - queues.get(a.id)!).slice(0, 3);
          here.forEach((p, rank) => {
            const [sx, sy] = S(p.x, p.y);
            ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2); ctx.fillStyle = "rgba(245,158,11,0.10)"; ctx.fill(); ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(sx, sy - 27, 9, 0, Math.PI * 2); ctx.fillStyle = "#f59e0b"; ctx.fill();
            ctx.fillStyle = "#14171c"; ctx.font = `600 11px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(rank + 1), sx, sy - 26.5);
            if (!multi) label(ctx, `${Math.round(queues.get(p.id)!)} queuing`, sx + 13, sy - 27, { align: "left", bg: "#fff6e5", border: "#f3d08a", color: "#92400e", sub: p.label.length > 34 ? `${p.label.slice(0, 33)}…` : p.label, subColor: "#92400e" });
          });
        }
        if (L.layers.exits) {
          for (const e of exits) {
            if (e.floor !== floor.id) continue;
            const [sx, sy] = S(e.x, e.y);
            const dx = (e.x - bcx) / Math.max(1, bx1 - bx0), dy = (e.y - bcy) / Math.max(1, by1 - by0);
            const horiz = Math.abs(dx) > Math.abs(dy);
            const opts = { dot: damaged.has(e.id) ? "#d92d20" : elementColor(e.id), mono: true, ...(W >= 640 ? { sub: `${e.out} out · ${e.flow.toFixed(2)}/s` } : {}) };
            if (multi) continue;
            if (horiz) label(ctx, e.id, dx < 0 ? sx - 16 : sx + 16, sy, { ...opts, align: dx < 0 ? "right" : "left" });
            else label(ctx, e.id, sx, dy < 0 ? sy - 14 : sy + 14, { ...opts, align: "center", vAlign: dy < 0 ? "bottom" : "top" });
          }
          for (const el of geo.grid.elements) {
            if (el.kind !== "stair" || el.floor !== floor.id || damaged.has(el.id)) continue;
            const [sx, sy] = S(el.x, el.y);
            if (!multi) label(ctx, el.id.split("@")[0]!, sx, sy - 16, { align: "center", vAlign: "bottom", mono: true, dot: elementColor(el.id), color: "#3d4b6b" });
          }
          for (const mt of geo.grid.mounts) {
            if (mt.floor !== floor.id) continue;
            const s = signs.get(mt.id);
            if (!s?.state || s.state.kind === "STATIC_DEFAULT") continue;
            const [sx, sy] = S(mt.x, mt.y);
            ctx.fillStyle = SIGN_COLORS[s.state.kind]; ctx.beginPath(); ctx.roundRect(sx - 9, sy - 7, 18, 14, 3); ctx.fill();
            ctx.fillStyle = "#ffffff"; ctx.font = `700 10px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(signGlyph(s.state), sx, sy + 0.5);
          }
        }
        if (L.marker && L.marker.floor === floor.id) {
          const [sx, sy] = S(L.marker.x, L.marker.y);
          ctx.strokeStyle = "#d92d20"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.moveTo(sx - 16, sy); ctx.lineTo(sx + 16, sy); ctx.moveTo(sx, sy - 16); ctx.lineTo(sx, sy + 16); ctx.stroke();
        }
        if (ag !== null && ip && ip.floor[ag] === cell.fi && ip.state[ag] !== PROTECTED) {
          const [sx, sy] = S(ip.x[ag]!, ip.y[ag]!);
          ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.strokeStyle = "#14171c"; ctx.lineWidth = 2; ctx.stroke();
          cardPos = [sx, sy];
        }
        if (L.picked && L.picked.floor === floor.id) {
          const p = geo.grid.portals.find((q) => q.id === L.picked!.id);
          if (p) { const [sx, sy] = S(p.x, p.y); ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.strokeStyle = "#14171c"; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }
        }
        ctx.restore();
      });
      const card = cardRef.current;
      if (card) {
        if (cardPos && L.showInspector) {
          const [sx, sy] = cardPos as [number, number];
          const left = sx + 260 > W ? sx - 254 : sx + 16;
          const top = Math.min(H - 190, Math.max(8, sy + 12));
          card.style.transform = `translate(${left}px, ${top}px)`;
          card.style.visibility = "visible";
        } else card.style.visibility = "hidden";
      }
    };
    raf = requestAnimationFrame(draw);

    const cellAt = (sx: number, sy: number): Cell | null => layout(nf, live.current.floorSel, wrap.clientWidth, wrap.clientHeight).find((c) => sx >= c.x && sx < c.x + c.w && sy >= c.y && sy < c.y + c.h) ?? null;
    const xfOf = (c: Cell) => transform(geo, c, view.current, live.current.floorSel === "all");
    const toWorld = (c: Cell, sx: number, sy: number): [number, number] => { const xf = xfOf(c); return [(sx - xf.tx) / xf.scale, (sy - xf.ty) / xf.scale]; };
    const local = (e: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onWheel = (e: WheelEvent) => {
      if (!live.current.interactive) return;
      e.preventDefault();
      const [sx, sy] = local(e);
      const c = cellAt(sx, sy);
      if (!c) return;
      const before = toWorld(c, sx, sy);
      view.current.zoom = Math.max(0.4, Math.min(40, view.current.zoom * Math.exp(-e.deltaY * 0.0015)));
      const after = toWorld(c, sx, sy);
      view.current.panX += before[0] - after[0];
      view.current.panY += before[1] - after[1];
    };
    let drag: { x: number; y: number; moved: number; cell: Cell | null } | null = null;
    const onDown = (e: PointerEvent) => {
      if (!live.current.interactive) return;
      const [sx, sy] = local(e);
      drag = { x: sx, y: sy, moved: 0, cell: cellAt(sx, sy) };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || !drag.cell) return;
      const [sx, sy] = local(e);
      const { scale } = xfOf(drag.cell);
      if (Math.abs(sx - drag.x) + Math.abs(sy - drag.y) > 0) useView.getState().setFollowAgent(false);
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
      const xf = xfOf(d.cell);
      if (live.current.onPlanClick) { live.current.onPlanClick({ floor: floor.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); return; }
      const { ip } = source();
      let best = -1, bd = 12;
      if (ip) for (let a = 0; a < ip.n; a++) {
        if (ip.floor[a] !== d.cell.fi || ip.state[a] === PROTECTED) continue;
        const dd = Math.hypot((ip.x[a]! - x) * xf.scale, (ip.y[a]! - y) * xf.scale);
        if (dd < bd) { bd = dd; best = a; }
      }
      if (best >= 0) { useView.getState().setInspect(best); setPicked(null); return; }
      const tol = Math.max(1.5, 8 / xf.scale);
      const p = floor.portals.find((q) => q.kind !== "corridor_section" && segDist(x, y, q.a, q.b) < tol);
      const gp = p ? geo.grid.portals.find((q) => q.id === p.id) : undefined;
      setPicked(gp ? { id: gp.id, label: gp.label, floor: floor.id } : null);
      useView.getState().setInspect(null);
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

  return (
    <div ref={wrapRef} className={cx("relative h-full min-h-0 w-full overflow-hidden", className)} data-testid="plan2d">
      <canvas ref={staticRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={trailRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={canvasRef} data-testid={testId} data-tick="" data-state-hash="" aria-label="Floor plan with occupants" className={cx("absolute inset-0 h-full w-full touch-none", onPlanClick ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")} />
      {error && !geo ? <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-3">Waiting for the building geometry: {error}</div> : null}
      {showInspector ? <div ref={cardRef} className="pointer-events-auto absolute top-0 left-0 z-10" style={{ visibility: "hidden" }}>{inspect !== null ? <AgentCard agent={inspect} channel={channel} /> : null}</div> : null}
      {picked ? <PortalCard picked={picked} channel={channel} onClose={() => setPicked(null)} /> : null}
    </div>
  );
}

function useFrameFor(channel?: string): { frame: FrameMsg | null; hz: HazardFrame | null } {
  const frame = useStore((s) => s.frame);
  const hazard = useStore((s) => s.hazard);
  const t = useStore((s) => (channel ? Math.floor(s.t) : 0));
  if (!channel) return { frame, hz: hazard };
  const run = getRun(channel);
  const smp = sampleRun(run, t);
  return { frame: smp?.a ?? null, hz: run && smp ? hazardAt(run, smp.a.tick) : null };
}

function AgentCard({ agent, channel }: { agent: number; channel?: string }) {
  const { geo } = useGeometry();
  const { frame, hz } = useFrameFor(channel);
  const follow = useView((s) => s.followAgent);
  const setFollow = useView((s) => s.setFollowAgent);
  const setInspect = useView((s) => s.setInspect);
  if (!frame || !geo || agent >= frame.n) return null;
  const st = frame.state[agent]!;
  const fi = frame.floor[agent]!;
  const target = geo.grid.elements[frame.target?.[agent] ?? -1];
  const smoke = smokeAt(geo, hz, fi, frame.x[agent]! / 10, frame.y[agent]! / 10) / 255;
  const policy = ["Rule-based policy", "Distilled persona policy", "Live LLM persona (modelled)"][frame.policy[agent]!] ?? "—";
  return (
    <div role="dialog" aria-label={`Occupant ${agent}`} className="anim-pop w-[238px] rounded-[10px] border border-line bg-panel p-3 shadow-[0_12px_32px_rgba(16,24,40,0.14)]" data-testid="agent-card">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Occupant <span className="num">#{agent}</span></span>
        <button type="button" aria-label="Close" onClick={() => setInspect(null)} className="grid h-6 w-6 place-items-center rounded-md text-ink-2 hover:bg-inset">×</button>
      </div>
      <dl className="mt-2 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 text-[12px]">
        <dt className="text-ink-3">State</dt><dd>{st === PROTECTED ? "Out of the building" : STATE_LABELS[st] ?? st}</dd>
        <dt className="text-ink-3">Heading to</dt><dd className="flex items-center gap-1.5">{target ? <><span className="h-[7px] w-[7px] rounded-full" style={{ background: elementColor(target.id) }} />{target.id}</> : "—"}</dd>
        <dt className="text-ink-3">Floor</dt><dd className="num">{geo.twin.floors[fi]?.id ?? fi}</dd>
        <dt className="text-ink-3">Smoke here</dt><dd className={cx("num", smoke >= DENSE_SMOKE / 255 ? "font-medium text-danger-ink" : "")}>{smoke.toFixed(2)}</dd>
        <dt className="text-ink-3">Stress</dt><dd className="num">{frame.stress[agent]} / 100</dd>
        <dt className="text-ink-3">Decides by</dt><dd>{policy}</dd>
      </dl>
      {st !== PROTECTED ? <button type="button" onClick={() => setFollow(!follow)} aria-pressed={follow} className={cx("mt-2.5 h-7 w-full rounded-lg border text-[12px] font-medium", follow ? "border-ink bg-ink text-white" : "border-line-strong bg-panel text-ink hover:bg-hover")}>{follow ? "Following" : "Follow this occupant"}</button> : null}
    </div>
  );
}

function PortalCard({ picked, channel, onClose }: { picked: { id: string; label: string; floor: string }; channel?: string; onClose: () => void }) {
  const { frame } = useFrameFor(channel);
  const { geo } = useGeometry();
  const portal = geo?.twin.floors.find((f) => f.id === picked.floor)?.portals.find((p) => p.id === picked.id);
  return (
    <div className="anim-pop absolute top-3 left-1/2 z-10 w-[280px] -translate-x-1/2 rounded-[10px] border border-line bg-panel p-3 shadow-[0_12px_32px_rgba(16,24,40,0.14)]" data-testid="plan-picked">
      <div className="flex items-center justify-between"><span className="font-semibold">{portal?.kind === "door" ? "Door" : "Opening"} <span className="num">{picked.id}</span></span><button type="button" aria-label="Close" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md text-ink-2 hover:bg-inset">×</button></div>
      <div className="mt-1 text-[12px] text-ink-2">{picked.label}</div>
      <dl className="mt-2 grid grid-cols-[120px_1fr] gap-y-1 text-[12px]">
        <dt className="text-ink-3">Clear width</dt><dd className="num">{portal ? `${portal.clearWidthIn} in` : "—"}</dd>
        <dt className="text-ink-3">Queued so far</dt><dd className="num">{frame ? `${(frame.queues?.[picked.id] ?? 0).toFixed(1)} p·s at ${fmtTime(frame.t)}` : "—"}</dd>
      </dl>
    </div>
  );
}
