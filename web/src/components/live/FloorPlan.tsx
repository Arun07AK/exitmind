import { Eye, EyeOff } from "lucide-react";
import { useMemo } from "react";
import type { HazardFrame, SignState } from "../../../../src/server/contract.ts";
import type { Pt } from "../../../../src/twin/schema.ts";
import { centroid, type Geometry } from "../../geometry.ts";
import { elementColor, PROTECTED, SIGN_COLORS, stateColor } from "../../lib/colors.ts";
import { decodeHazard } from "../../lib/decode.ts";
import { useStore } from "../../store.ts";
import { cx, Segmented, Tip } from "../ui.tsx";
import { routeId, shortMount, signShort } from "./format.ts";

export interface PlanSign { mount: string; state: SignState; pending: boolean }

const PAD = 4;
const SPACE_FILL: Record<string, string> = { room: "#ffffff", corridor: "#f6f7f9", lobby: "#f6f7f9", stair: "#eceef1", elevator: "#e3e6ea", service: "#f6f7f9" };
const poly = (p: readonly Pt[]): string => (p.length ? `M${p.map((q) => `${q[0]} ${q[1]}`).join("L")}Z` : "");

const smokeCache = new WeakMap<HazardFrame, (string | null)[]>();
function smokeImages(geo: Geometry, h: HazardFrame): (string | null)[] {
  let out = smokeCache.get(h);
  if (out) return out;
  const d = decodeHazard(h);
  out = geo.grid.floors.map((f, fi) => {
    const sm = d.smoke[fi], th = d.threat[fi], bl = d.blocked[fi];
    let any = false;
    const c = document.createElement("canvas");
    c.width = f.w; c.height = f.h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(f.w, f.h);
    for (let i = 0; i < f.w * f.h; i++) {
      const o = i * 4;
      if (bl?.[i]) { img.data.set([217, 45, 32, 150], o); any = true; }
      else if (th?.[i]) { img.data.set([217, 45, 32, 60], o); any = true; }
      else if (sm?.[i]) { img.data.set([75, 83, 97, Math.round(sm[i]! * 0.55)], o); any = true; }
    }
    if (!any) return null;
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  });
  smokeCache.set(h, out);
  return out;
}

function Crowd({ floorIdx }: { floorIdx: number }) {
  const frame = useStore((s) => s.frame);
  const paths = useMemo(() => {
    const by = new Map<number, string[]>();
    if (!frame) return by;
    const r = 0.8;
    for (let a = 0; a < frame.n; a++) {
      const s = frame.state[a]!;
      if (frame.floor[a] !== floorIdx || s === PROTECTED) continue;
      const x = frame.x[a]! / 10, y = frame.y[a]! / 10;
      let p = by.get(s);
      if (!p) by.set(s, (p = []));
      p.push(`M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
    }
    return by;
  }, [frame, floorIdx]);
  return (
    <g data-testid="plan-crowd" data-tick={frame?.tick ?? ""}>
      {[...paths].map(([s, p]) => <path key={s} d={p.join("")} fill={stateColor(s)} opacity={0.85} />)}
    </g>
  );
}

function chipClass(s: SignState, pending: boolean): { cls: string; style?: { background: string } } {
  if (pending) return { cls: "border border-warn-line bg-panel text-warn-ink" };
  if (s.kind === "STATIC_DEFAULT") return { cls: "border border-line-strong bg-panel text-safe-ink" };
  if (s.kind === "HOLD") return { cls: "text-ink", style: { background: SIGN_COLORS.HOLD } };
  return { cls: "text-white", style: { background: SIGN_COLORS[s.kind] } };
}

export function FloorPlan({ geo, floorIdx, hazard, signs, counts, closedRoutes, crowd }: {
  geo: Geometry;
  floorIdx: number;
  hazard: HazardFrame | null;
  signs: ReadonlyMap<string, PlanSign>;
  counts: Record<string, number | undefined>;
  closedRoutes: readonly string[];
  crowd: boolean;
}) {
  const floor = geo.twin.floors[floorIdx]!;
  const gf = geo.grid.floors[floorIdx];
  const [bx0, by0, bx1, by1] = geo.bounds;
  const vx = bx0 - PAD, vy = by0 - PAD, vw = bx1 - bx0 + 2 * PAD, vh = by1 - by0 + 2 * PAD;
  const px = (x: number) => `${((x - vx) / vw) * 100}%`;
  const py = (y: number) => `${((y - vy) / vh) * 100}%`;
  const damaged = new Set(hazard?.damaged ?? []);
  const smoke = hazard ? smokeImages(geo, hazard)[floorIdx] ?? null : null;
  const zones = geo.twin.zones.filter((z) => z.floor === floor.id).sort((a, b) => a.xRangeFt[0] - b.xRangeFt[0]);
  const dividers = zones.slice(0, -1).map((z) => z.xRangeFt[1]).filter((x) => x > bx0 && x < bx1);
  const exits = geo.twin.exits.filter((e) => e.floor === floor.id).map((e) => ({ e, p: floor.portals.find((q) => q.id === e.portal) })).filter((x) => !!x.p);
  const stairs = geo.twin.stairs.map((s) => {
    const sp = s.spaces[floor.id] ? floor.spaces.find((q) => q.id === s.spaces[floor.id]) : undefined;
    const head = s.flights.find((f) => f.from === floor.id)?.head;
    const at = sp ? centroid(sp.polygon) : head ? centroid(head) : null;
    return { s, at, head: sp ? undefined : head };
  }).filter((x) => !!x.at);
  const markers = geo.grid.elements.filter((el) => el.floor === floor.id).map((el) => {
    const dmg = damaged.has(el.id) || damaged.has(routeId(el.id));
    const closed = closedRoutes.includes(el.id) || closedRoutes.includes(routeId(el.id));
    return dmg || closed ? { el, dmg } : null;
  }).filter((m): m is NonNullable<typeof m> => !!m);
  const fire = hazard?.fireOrigin?.floor === floor.id ? hazard.fireOrigin : null;
  const threat = hazard?.threatPos?.floor === floor.id ? hazard.threatPos : null;
  const mounts = geo.grid.mounts.filter((m) => m.floor === floor.id);
  const mid = centroid(floor.outline);
  return (
    <div className="relative pt-5">
      {zones.map((z) => {
        const a = Math.max(z.xRangeFt[0], bx0), b = Math.min(z.xRangeFt[1], bx1);
        return <span key={z.id} className="num absolute top-0 -translate-x-1/2 text-[11px] whitespace-nowrap text-ink-2" style={{ left: px((a + b) / 2) }}>{z.id} · {counts[z.id] ?? "–"}</span>;
      })}
      <div className="relative w-full" style={{ aspectRatio: `${vw} / ${vh}` }} data-testid="floor-plan" data-floor={floor.id}>
        <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`${floor.name} plan`}>
          <defs>
            <pattern id="live-void-hatch" patternUnits="userSpaceOnUse" width="2.5" height="2.5" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="2.5" stroke="#d0d5dc" strokeWidth="0.5" />
            </pattern>
          </defs>
          {floor.spaces.map((s) => (SPACE_FILL[s.kind] ? <path key={s.id} d={poly(s.polygon)} fill={SPACE_FILL[s.kind]} /> : null))}
          {smoke && gf ? <image href={smoke} x={gf.ox} y={gf.oy} width={gf.w * gf.cellFt} height={gf.h * gf.cellFt} preserveAspectRatio="none" style={{ imageRendering: "pixelated" }} data-testid="plan-smoke" /> : null}
          {floor.voids.map((v, i) => <path key={i} d={poly(v)} fill="url(#live-void-hatch)" stroke="#9aa2ae" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
          {floor.spaces.map((s) => (s.kind === "exterior" ? null : <path key={s.id} d={poly(s.polygon)} fill="none" stroke="#c3c9d1" strokeWidth={0.9} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />))}
          {stairs.map(({ s, head }) => (head ? <path key={s.id} d={poly(head)} fill="#eceef1" stroke="#8a93a0" strokeWidth={0.9} vectorEffect="non-scaling-stroke" /> : null))}
          <path d={poly(floor.outline)} fill="none" stroke="#2b313a" strokeWidth={1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {floor.portals.filter((p) => p.kind !== "corridor_section").map((p) => (
            <line key={p.id} x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke="#ffffff" strokeWidth={2.2} vectorEffect="non-scaling-stroke" />
          ))}
          {exits.map(({ e, p }) => {
            const shut = damaged.has(e.id) || closedRoutes.includes(e.id) || (e.stair ? damaged.has(`${e.stair}@${floor.id}`) || closedRoutes.includes(e.stair) : false);
            return <line key={e.id} x1={p!.a[0]} y1={p!.a[1]} x2={p!.b[0]} y2={p!.b[1]} stroke={shut ? "#d92d20" : elementColor(e.stair ?? e.id)} strokeWidth={e.kind === "exterior" ? 6 : 4} strokeLinecap="butt" vectorEffect="non-scaling-stroke" data-exit={e.id} />;
          })}
          {fire ? (
            <g data-testid="plan-fire">
              <circle cx={fire.x} cy={fire.y} r={4} fill="#d92d20" opacity={0.18} />
              <circle cx={fire.x} cy={fire.y} r={1.6} fill="#d92d20" stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </g>
          ) : null}
          {threat ? <circle cx={threat.x} cy={threat.y} r={1.6} fill="#b42318" stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
          {crowd ? <Crowd floorIdx={floorIdx} /> : null}
        </svg>
        {dividers.map((x) => <span key={x} aria-hidden="true" className="absolute top-[3%] bottom-[3%] border-l border-dashed border-[#9aa2ae]" style={{ left: px(x) }} />)}
        {stairs.filter(({ s }) => !markers.some((m) => routeId(m.el.id) === s.id)).map(({ s, at }) => (
          <span key={s.id} className="num pointer-events-none absolute hidden -translate-x-1/2 -translate-y-1/2 text-[10px] font-medium text-stair sm:block" style={{ left: px(at![0]), top: py(at![1]) }}>{s.id}</span>
        ))}
        {exits.filter(({ e }) => e.kind === "exterior").map(({ e, p }) => {
          const mx = (p!.a[0] + p!.b[0]) / 2, my = (p!.a[1] + p!.b[1]) / 2;
          let nx = -(p!.b[1] - p!.a[1]), ny = p!.b[0] - p!.a[0];
          const len = Math.hypot(nx, ny) || 1;
          nx /= len; ny /= len;
          if (nx * (mx - mid[0]) + ny * (my - mid[1]) < 0) { nx = -nx; ny = -ny; }
          return (
            <Tip key={e.id} label={e.name}>
              <span className="num absolute rounded px-1 text-[10px] leading-4 font-semibold whitespace-nowrap text-white" style={{ left: px(mx), top: py(my), background: elementColor(e.id), transform: `translate(calc(-50% + ${Math.round(nx * 22)}px), calc(-50% + ${Math.round(ny * 12)}px))` }}>{e.id}</span>
            </Tip>
          );
        })}
        {fire ? <span className="absolute -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded bg-panel px-1 text-[10px] font-semibold whitespace-nowrap text-danger-ink shadow-sm" style={{ left: px(fire.x), top: py(fire.y) }}>fire origin</span> : null}
        {mounts.map((m) => {
          const s = signs.get(m.id);
          if (!s) return null;
          const c = chipClass(s.state, s.pending);
          return (
            <Tip key={m.id} label={`${m.id}: ${s.pending ? "preview of the pending plan" : "published state"}`}>
              <div className={cx("absolute flex h-5 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded px-1.5 text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,0.12)]", c.cls)} style={{ left: px(m.x), top: py(m.y), ...c.style }} data-testid="plan-sign" data-mount={m.id} data-kind={s.state.kind} data-pending={String(s.pending)}>
                <span className="num hidden font-normal opacity-80 sm:inline">{shortMount(m.id)}</span>{signShort(s.state)}
              </div>
            </Tip>
          );
        })}
        {markers.map(({ el, dmg }) => {
          const right = el.x > (bx0 + bx1) / 2;
          return (
            <div key={el.id} className="absolute h-0 w-0" style={{ left: px(el.x), top: py(el.y) }} data-testid="plan-no-passage" data-element={el.id}>
              <span className="absolute -top-3.5 -left-3.5 grid h-7 w-7 place-items-center rounded-lg border-2 border-danger-strong bg-[rgba(217,45,32,0.12)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d92d20" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </span>
              <span className={cx("absolute bottom-[18px] rounded bg-danger-strong px-1.5 py-px text-[11px] font-semibold whitespace-nowrap text-white", right ? "right-[-14px]" : "left-[-14px]")}>{routeId(el.id)} {dmg ? "no passage" : "closed"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlanCard({ geo, floorIdx, onFloor, hazard, signs, counts, closedRoutes, crowd, onCrowd, mode }: {
  geo: Geometry;
  floorIdx: number;
  onFloor: (i: number) => void;
  hazard: HazardFrame | null;
  signs: ReadonlyMap<string, PlanSign>;
  counts: Record<string, number | undefined>;
  closedRoutes: readonly string[];
  crowd: boolean;
  onCrowd: (on: boolean) => void;
  mode: "preview" | "published" | "static";
}) {
  const floors = geo.twin.floors.map((f, i) => ({ value: String(i), label: f.id, testId: `plan-floor-${f.id}` })).reverse();
  const floor = geo.twin.floors[floorIdx]!;
  return (
    <section aria-labelledby="plan-h" className="overflow-hidden rounded-xl border border-line bg-panel" data-testid="plan-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3 sm:px-4">
        <h2 id="plan-h" className="m-0 text-[14px] font-semibold">{floor.name}</h2>
        <span className="text-[12px] text-ink-3">{mode === "preview" ? "sign previews show the proposed plan" : mode === "published" ? "signs show the published state" : "signs show their static default; nothing published"}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-pressed={crowd} onClick={() => onCrowd(!crowd)} data-testid="crowd-toggle"
            className={cx("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium", crowd ? "border-warn-line bg-warn-bg text-warn-ink" : "border-line-strong bg-panel text-ink-2 hover:bg-hover")}>
            {crowd ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}Simulated crowd (demo only)
          </button>
          <Segmented label="Floor" size="sm" value={String(floorIdx)} onChange={(v) => onFloor(Number(v))} options={floors} testId="plan-floors" />
        </div>
      </div>
      <div className="bg-hover px-3 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-7">
        <FloorPlan geo={geo} floorIdx={floorIdx} hazard={hazard} signs={signs} counts={counts} closedRoutes={closedRoutes} crowd={crowd} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-3 py-2 text-[11px] text-ink-3 sm:px-4">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-sm" style={{ background: elementColor("EX-N") }} />exit</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-line-strong bg-stage" />stair</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-danger-strong" />no passage or closed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[rgba(75,83,97,0.35)]" />smoke (simulated)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-warn-line bg-panel" />sign preview</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: SIGN_COLORS.ARROW }} />sign published</span>
        {crowd ? <span className="inline-flex items-center gap-1.5 text-warn-ink"><span className="h-2 w-2 rounded-full bg-moving" />simulated people: demo ground truth, not seen by EXITMIND's agents</span> : null}
      </div>
    </section>
  );
}
