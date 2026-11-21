import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from "react";
import type { RecommendDangerFloor, RecommendResult } from "../../../../src/server/contract.ts";
import type { Floor, Pt } from "../../../../src/twin/schema.ts";
import { cx, Segmented } from "../../components/ui.tsx";
import type { Geometry } from "../../geometry.ts";
import { densityRamp, elementColor } from "../../lib/colors.ts";
import { changeMarks, dangerOn, fmtNum, focusFor, pctChange, type Mark, type Rec, type Spot } from "./model.ts";

interface Rect { x0: number; y0: number; x1: number; y1: number }
interface Xf { scale: number; tx: number; ty: number }

/** Colour scale for mean person-seconds above the danger density in one cell, log from 1 to 400+. */
export const DANGER_SCALE_MAX = 400;
const heat = (v: number): number => Math.max(0.03, Math.min(1, Math.log(Math.max(1, v)) / Math.log(DANGER_SCALE_MAX)));

const FILL: Record<string, string> = { room: "#ffffff", corridor: "#f6f7f9", lobby: "#f6f7f9", stair: "#eef0f3", elevator: "#eef0f3", service: "#f3f4f6" };
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const PAD_FT = 12;
const AREA_W = 84, AREA_H = 63;

const rasters = new WeakMap<RecommendDangerFloor, HTMLCanvasElement>();
function raster(d: RecommendDangerFloor): HTMLCanvasElement {
  let c = rasters.get(d);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = d.w; c.height = d.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(d.w, d.h);
  for (const [i, v] of d.cells) if (i >= 0 && i < d.w * d.h) img.data.set(densityRamp(heat(v)), i * 4);
  ctx.putImageData(img, 0, 0);
  rasters.set(d, c);
  return c;
}

function polyPath(ctx: CanvasRenderingContext2D, poly: readonly Pt[]): void {
  poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

const fitXf = (W: number, H: number, r: Rect): Xf => {
  const scale = Math.max(1e-3, Math.min(W / Math.max(1, r.x1 - r.x0), H / Math.max(1, r.y1 - r.y0)));
  return { scale, tx: W / 2 - ((r.x0 + r.x1) / 2) * scale, ty: H / 2 - ((r.y0 + r.y1) / 2) * scale };
};

function drawPlan(ctx: CanvasRenderingContext2D, geo: Geometry, floor: Floor, danger: RecommendDangerFloor | null, xf: Xf, dpr: number, W: number, skipLabels: Set<string>): void {
  const px = 1 / xf.scale;
  ctx.setTransform(dpr * xf.scale, 0, 0, dpr * xf.scale, dpr * xf.tx, dpr * xf.ty);
  for (const s of floor.spaces) { ctx.beginPath(); polyPath(ctx, s.polygon); ctx.fillStyle = FILL[s.kind] ?? "#ffffff"; ctx.fill(); }
  for (const v of floor.voids) { ctx.beginPath(); polyPath(ctx, v); ctx.fillStyle = "#e9ecf0"; ctx.fill(); ctx.setLineDash([3 * px, 3 * px]); ctx.strokeStyle = "#aeb6c1"; ctx.lineWidth = px; ctx.stroke(); ctx.setLineDash([]); }
  if (danger && danger.cells.length) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(raster(danger), danger.ox, danger.oy, danger.w * danger.cellFt, danger.h * danger.cellFt);
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#c3c9d1"; ctx.lineWidth = px;
  for (const s of floor.spaces) { ctx.beginPath(); polyPath(ctx, s.polygon); ctx.stroke(); }
  if (floor.outline.length) { ctx.beginPath(); polyPath(ctx, floor.outline); ctx.strokeStyle = "#2b313a"; ctx.lineWidth = 1.9 * px; ctx.stroke(); }
  const labels: { id: string; x: number; y: number; nx: number; ny: number }[] = [];
  const xs = floor.outline.map((p) => p[0]), ys = floor.outline.map((p) => p[1]);
  const fcx = (Math.min(...xs) + Math.max(...xs)) / 2, fcy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const p of floor.portals) {
    if (p.kind === "corridor_section") continue;
    const ext = p.connects.includes("OUTSIDE");
    ctx.beginPath(); ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
    ctx.strokeStyle = ext ? "#ffffff" : "#fafafb"; ctx.lineWidth = (ext ? 4.5 : 3) * px; ctx.stroke();
    if (ext) {
      const ex = geo.twin.exits.find((e) => e.portal === p.id);
      ctx.beginPath(); ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
      ctx.strokeStyle = elementColor(ex?.id); ctx.lineWidth = 3.4 * px; ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";
      if (ex) {
        const mx = (p.a[0] + p.b[0]) / 2, my = (p.a[1] + p.b[1]) / 2;
        const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) || 1;
        let nx = -(p.b[1] - p.a[1]) / L, ny = (p.b[0] - p.a[0]) / L;
        if (nx * (mx - fcx) + ny * (my - fcy) < 0) { nx = -nx; ny = -ny; }
        labels.push({ id: ex.id, x: mx, y: my, nx, ny });
      }
    } else if (p.kind === "door") {
      const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) || 1;
      const nx = (-(p.b[1] - p.a[1]) / L) * 2.4 * px, ny = ((p.b[0] - p.a[0]) / L) * 2.4 * px;
      ctx.beginPath();
      for (const q of [p.a, p.b]) { ctx.moveTo(q[0] - nx, q[1] - ny); ctx.lineTo(q[0] + nx, q[1] + ny); }
      ctx.strokeStyle = "#8a93a0"; ctx.lineWidth = 0.9 * px; ctx.stroke();
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (xf.scale > 3.2) {
    ctx.font = `400 11px ${FONT}`; ctx.fillStyle = "#a0a8b4"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const s of floor.spaces) {
      if (s.kind !== "room" && s.kind !== "lobby") continue;
      const sx = s.polygon.map((p) => p[0]), sy = s.polygon.map((p) => p[1]);
      const w = Math.max(...sx) - Math.min(...sx), h = Math.max(...sy) - Math.min(...sy);
      if (w * h < 650 || w * xf.scale < 70) continue;
      const text = s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name, tx = xf.tx + ((Math.min(...sx) + Math.max(...sx)) / 2) * xf.scale, half = ctx.measureText(text).width / 2;
      if (tx - half < 6 || tx + half > W - 6) continue;
      ctx.fillText(text, tx, xf.ty + ((Math.min(...sy) + Math.max(...sy)) / 2) * xf.scale);
    }
  }
  ctx.font = `500 10px ${MONO}`; ctx.textBaseline = "middle";
  for (const l of labels) {
    if (skipLabels.has(l.id)) continue;
    const sx = xf.tx + l.x * xf.scale + l.nx * 10, sy = xf.ty + l.y * xf.scale + l.ny * 10;
    ctx.textAlign = Math.abs(l.nx) > 0.5 ? (l.nx > 0 ? "left" : "right") : "center";
    ctx.fillStyle = elementColor(l.id);
    ctx.fillText(l.id, sx, sy);
  }
}

function useSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function useAnimatedRect(target: Rect): [Rect, (dx: number, dy: number) => void] {
  const [rect, setRect] = useState(target);
  const cur = useRef(rect);
  cur.current = rect;
  const key = `${target.x0.toFixed(2)},${target.y0.toFixed(2)},${target.x1.toFixed(2)},${target.y1.toFixed(2)}`;
  useEffect(() => {
    const from = cur.current, to = target;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) { setRect(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 400), e = 1 - (1 - u) ** 3;
      setRect({ x0: from.x0 + (to.x0 - from.x0) * e, y0: from.y0 + (to.y0 - from.y0) * e, x1: from.x1 + (to.x1 - from.x1) * e, y1: from.y1 + (to.y1 - from.y1) * e });
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  const pan = (dx: number, dy: number) => setRect((r) => ({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy }));
  return [rect, pan];
}

function PlanCanvas({ geo, floor, danger, rect, onPan, marks, after, label, corner, testId }: { geo: Geometry; floor: number; danger: RecommendDangerFloor | null; rect: Rect; onPan: (dx: number, dy: number) => void; marks: Mark[]; after: boolean; label: string; corner?: string | null; testId: string }) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const xf = fitXf(size.w || 1, size.h || 1, rect);
  const fl = geo.twin.floors[floor]!;
  const skip = useMemo(() => new Set(marks.filter((m) => m.floor === floor).map((m) => m.id)), [marks, floor]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    drawPlan(ctx, geo, fl, danger, fitXf(size.w, size.h, rect), dpr, size.w, skip);
  }, [geo, fl, danger, rect, size.w, size.h, skip]);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    onPan(-dx / xf.scale, -dy / xf.scale);
  };
  const onUp = () => { drag.current = null; };

  return (
    <div ref={wrapRef} className="absolute inset-0 cursor-grab touch-pan-y select-none active:cursor-grabbing" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid={testId}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label={`${label}: ${fl.name} plan with dangerous-density cells`} />
      {size.w > 0 ? marks.filter((m) => m.floor === floor).map((m, i) => {
        const x = xf.tx + m.x * xf.scale, y = xf.ty + m.y * xf.scale;
        const left = x > size.w / 2;
        return (
          <div key={i} className="pointer-events-none absolute h-0 w-0" style={{ left: x, top: y }} data-testid={after ? "mark-after" : "mark-before"}>
            {after
              ? <span className="absolute -top-[14px] -left-[14px] h-7 w-7 rounded-full border-2 border-ink shadow-[0_0_0_5px_rgba(20,23,28,0.08)]" />
              : <span className="absolute -top-[13px] -left-[13px] h-[26px] w-[26px] rounded-full border-[1.5px] border-dashed border-ink-3" />}
            <span className={cx("num absolute -top-[11px] rounded px-1.5 py-px text-[11px] whitespace-nowrap", left ? "right-5" : "left-5", after ? "bg-ink font-medium text-white" : "border border-line-strong bg-panel text-ink-2")}>{after ? m.after : m.before}</span>
          </div>
        );
      }) : null}
      <span className={cx("pointer-events-none absolute top-2.5 left-3 rounded bg-white/90 px-1.5 py-0.5 text-[12px] font-medium", after ? "text-ink" : "text-ink-2")}>{label}</span>
      {corner ? <span className="num pointer-events-none absolute top-2.5 right-3 rounded bg-ink px-1.5 py-0.5 text-[11px] font-medium text-white" data-testid="mark-operational">{corner}</span> : null}
    </div>
  );
}

const floorRect = (geo: Geometry): Rect => { const [x0, y0, x1, y1] = geo.bounds; return { x0: x0 - PAD_FT, y0: y0 - PAD_FT, x1: x1 + PAD_FT, y1: y1 + PAD_FT }; };
function areaRect(geo: Geometry, at: Spot): Rect {
  const b = floorRect(geo);
  const cx = Math.min(Math.max(at.x, b.x0 + AREA_W / 2), b.x1 - AREA_W / 2), cy = Math.min(Math.max(at.y, b.y0 + AREA_H / 2), b.y1 - AREA_H / 2);
  return { x0: cx - AREA_W / 2, y0: cy - AREA_H / 2, x1: cx + AREA_W / 2, y1: cy + AREA_H / 2 };
}

/** `threshold` is the danger density in p/m² as served by /api/design/bottlenecks; without it the header names no number. */
export function DangerCompare({ geo, result, rec, threshold }: { geo: Geometry; result: RecommendResult; rec: Rec; threshold: number | null }) {
  const focus = useMemo(() => focusFor(geo, result, rec), [geo, result, rec]);
  const marks = useMemo(() => changeMarks(geo, rec, result.original), [geo, rec, result]);
  const [zoom, setZoom] = useState<"area" | "floor">("area");
  const [floor, setFloor] = useState(focus.floor);
  useEffect(() => setFloor(focus.floor), [focus.floor, rec.id]);
  const onFocusFloor = floor === focus.floor;
  const target = zoom === "area" && onFocusFloor ? areaRect(geo, focus) : floorRect(geo);
  const [rect, pan] = useAnimatedRect(target);
  const fb = floorRect(geo);
  const aspect = zoom === "area" && onFocusFloor ? `${AREA_W} / ${AREA_H}` : `${(fb.x1 - fb.x0).toFixed(1)} / ${(fb.y1 - fb.y0).toFixed(1)}`;
  const fl = geo.twin.floors[floor]!;
  const before = dangerOn(result.original, fl.id), after = dangerOn(rec.variant, fl.id);
  const tested = !!rec.variant;
  const strategy = rec.edits.filter((e) => e.kind === "strategy");
  const corner = !strategy.length ? null : rec.kind === "operational" ? "no building change" : `+ response plan ${strategy.map((e) => e.protocol).join(", ")}`;
  const title = threshold !== null ? `Where density passed ${fmtNum(threshold, 1)} p/m²` : "Where density passed the danger level";
  const floorOpts = geo.twin.floors.map((f, i) => ({ value: String(i), label: <span className="num">{f.id}</span>, title: f.name }));

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel" aria-label={title} data-testid="danger-compare">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3.5 py-2.5">
        <span className="font-medium" title={threshold !== null ? "danger density threshold from /api/design/bottlenecks" : undefined} data-testid="danger-title">{title}</span>
        <span className="text-[12px] text-ink-3">whole run, mean of <span className="num">{result.seeds.length}</span> seeds</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-ink-3" title="mean person-seconds above the danger density per cell, log scale" aria-label={`Colour scale: 1 to ${DANGER_SCALE_MAX} or more person-seconds per cell, log scale`}>
          <span className="num">1</span><span className="h-1.5 w-14 rounded-[3px] bg-[linear-gradient(90deg,#facc15,#f97316,#ef4444,#be185d)]" /><span className="num">{DANGER_SCALE_MAX}+ p·s per cell</span>
        </span>
        <Segmented size="sm" label="Floor" value={String(floor)} onChange={(v) => { const f = Number(v); setFloor(f); if (f !== focus.floor) setZoom("floor"); }} options={floorOpts} testId="danger-floor" />
        <Segmented size="sm" label="Zoom" value={onFocusFloor ? zoom : "floor"} onChange={(v) => { setZoom(v); if (v === "area") setFloor(focus.floor); }} options={[{ value: "area", label: "Change area", testId: "zoom-area" }, { value: "floor", label: "Whole floor", testId: "zoom-floor" }] as const} testId="danger-zoom" />
      </div>
      <div className="grid grid-cols-1 min-[700px]:grid-cols-2">
        <div className="min-w-0 border-b border-line min-[700px]:border-r min-[700px]:border-b-0">
          <div className="relative overflow-hidden bg-hover" style={{ aspectRatio: aspect }}>
            <PlanCanvas geo={geo} floor={floor} danger={before} rect={rect} onPan={pan} marks={marks} after={false} label="Original" testId="plan-before" />
          </div>
          <div className="flex items-baseline gap-2 border-t border-line px-3.5 py-2.5">
            <span className="num text-[16px]" data-testid="danger-before">{fmtNum(before?.total ?? 0)}</span><span className="text-[12px] text-ink-3">person-s of dangerous density on {fl.id} · {fl.name.toLowerCase()}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="relative overflow-hidden bg-hover" style={{ aspectRatio: aspect }}>
            {tested ? (
              <PlanCanvas geo={geo} floor={floor} danger={after} rect={rect} onPan={pan} marks={marks} after label="With change" corner={corner} testId="plan-after" />
            ) : (
              <>
                <div className="absolute inset-3 flex flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-line-strong bg-panel p-6 text-center" data-testid="untestable">
                  <span className="font-medium">Not simulated</span>
                  <span className="max-w-[320px] leading-normal text-ink-2">{rec.reason ?? "This change has no variant run."}</span>
                </div>
                <span className="absolute top-2.5 left-3 rounded bg-white/90 px-1.5 py-0.5 text-[12px] font-medium text-ink">With change</span>
              </>
            )}
          </div>
          {tested ? (
            <div className="flex items-baseline gap-2 border-t border-line px-3.5 py-2.5">
              <span className="num text-[16px]" data-testid="danger-after">{fmtNum(after?.total ?? 0)}</span><span className="text-[12px] text-ink-3">person-s on {fl.id} · <span className="num">{pctChange(before?.total ?? 0, after?.total ?? 0)}</span></span>
            </div>
          ) : <div className="border-t border-line px-3.5 py-2.5 text-[12px] text-ink-3">no figures</div>}
        </div>
      </div>
    </section>
  );
}
