import { Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArchitectReport } from "../../../../src/optimise/architect.ts";
import type { Diagnosis } from "../../../../src/optimise/diagnose.ts";
import type { Modification, Shape } from "../../../../src/optimise/generate.ts";
import type { Alternative } from "../../../../src/optimise/search.ts";
import { getJSON, postJSON } from "../../api.ts";
import { Button, cx, Segmented } from "../../components/ui.tsx";
import { loadGeometry, type Geometry } from "../../geometry.ts";

type Pt = [number, number];
interface Status { running: boolean; venue: string | null; log: string[]; error: string | null; finishedAt: string | null }
const COLOR: Record<Shape["kind"], string> = { construct: "#16a34a", remove: "#dc2626", modify: "#d97706" };
const fmt = (v: number, unit = "") => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v}${unit}` : "–");
const ci = (p: { mean: number; ci95: number }, unit = "") => Number.isFinite(p.mean) ? `${fmt(p.mean, unit)} ± ${Number.isFinite(p.ci95) ? p.ci95 : "–"}` : "–";

function decode(map: Diagnosis["maps"][number]): Float32Array {
  const b = atob(map.wait), u = new Uint16Array(b.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = b.charCodeAt(2 * i) | (b.charCodeAt(2 * i + 1) << 8);
  return Float32Array.from(u, (v) => v / 10);
}

function PlanView({ geo, report, mods, floor, layer }: { geo: Geometry; report: ArchitectReport; mods: Modification[]; floor: string; layer: "before" | "after" | "difference" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const f = geo.twin.floors.find((x) => x.id === floor) ?? geo.twin.floors[0]!;
  const extra = mods.flatMap((m) => m.viz.filter((v) => v.floor === f.id).flatMap((v) => v.polygon ?? v.segment ?? []));
  const pts = [...f.outline, ...f.spaces.flatMap((s) => s.polygon), ...extra];
  const [x0, y0, x1, y1] = [Math.min(...pts.map((p) => p[0])) - 6, Math.min(...pts.map((p) => p[1])) - 6, Math.max(...pts.map((p) => p[0])) + 6, Math.max(...pts.map((p) => p[1])) + 6];
  const W = 900, H = Math.round((W * (y1 - y0)) / (x1 - x0));
  const X = (x: number) => ((x - x0) / (x1 - x0)) * W, Y = (y: number) => ((y - y0) / (y1 - y0)) * H;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const before = report.diagnosis.maps.find((m) => m.floor === f.id), after = report.after?.diagnosis.maps.find((m) => m.floor === f.id);
    const mb = before ? decode(before) : null, ma = after ? decode(after) : null;
    const src = layer === "before" ? before : layer === "after" ? after ?? before : before;
    if (!src) return;
    const vals = layer === "before" ? mb : layer === "after" ? ma ?? mb : mb && ma ? Float32Array.from(mb, (v, i) => (ma[i] ?? 0) - v) : null;
    if (!vals) return;
    const max = Math.max(5, ...Array.from(vals, Math.abs));
    const s = (src.cellFt / (x1 - x0)) * W;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]!;
      if (Math.abs(v) < 1) continue;
      const cx = src.x0 + (i % src.w) * src.cellFt, cy = src.y0 + Math.floor(i / src.w) * src.cellFt;
      const a = Math.min(0.85, 0.15 + Math.abs(v) / max);
      ctx.fillStyle = layer === "difference" ? (v < 0 ? `rgba(22,163,74,${a})` : `rgba(220,38,38,${a})`) : `rgba(239,68,68,${a})`;
      ctx.fillRect(X(cx) - s / 2, Y(cy) - s / 2, s + 0.5, s + 0.5);
    }
  }, [report, f.id, layer, W, H, x0, x1, y0, y1]);
  const poly = (p: readonly (readonly [number, number])[]) => p.map((q) => `${X(q[0])},${Y(q[1])}`).join(" ");
  return (
    <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }} data-testid="arch-plan">
      <canvas ref={canvas} width={W} height={H} className="absolute inset-0 h-full w-full" />
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full">
        <polygon points={poly(f.outline)} fill="none" stroke="#1f2937" strokeWidth={2} />
        {f.spaces.map((s) => <polygon key={s.id} points={poly(s.polygon)} fill="none" stroke="#9ca3af" strokeWidth={0.8}><title>{`${s.name} ${s.id}`}</title></polygon>)}
        {f.voids.map((v, i) => <polygon key={`v${i}`} points={poly(v)} fill="#d1d5db" stroke="none" />)}
        {report.diagnosis.hotspots.filter((h) => h.floor === f.id).slice(0, 6).map((h) => (
          <g key={h.id}><circle cx={X(h.centroid[0])} cy={Y(h.centroid[1])} r={14} fill="none" stroke="#7c3aed" strokeWidth={2} strokeDasharray="4 3" /><text x={X(h.centroid[0]) + 16} y={Y(h.centroid[1]) - 10} fontSize={13} fill="#5b21b6" fontWeight={600}>{h.id}</text></g>
        ))}
        {mods.flatMap((m) => m.viz.filter((v) => v.floor === f.id).map((v, i) => v.segment
          ? <line key={`${m.id}${i}`} x1={X(v.segment[0][0])} y1={Y(v.segment[0][1])} x2={X(v.segment[1][0])} y2={Y(v.segment[1][1])} stroke={COLOR[v.kind]} strokeWidth={7} strokeLinecap="round" data-testid="arch-shape"><title>{`${v.kind}: ${v.label}`}</title></line>
          : <polygon key={`${m.id}${i}`} points={poly(v.polygon ?? [])} fill={COLOR[v.kind]} fillOpacity={0.35} stroke={COLOR[v.kind]} strokeWidth={2} data-testid="arch-shape"><title>{`${v.kind}: ${v.label}`}</title></polygon>))}
      </svg>
    </div>
  );
}

function Shape3D({ v, z }: { v: Shape; z: number }) {
  const c = COLOR[v.kind];
  if (v.segment) {
    const [a, b] = v.segment, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return <mesh position={[(a[0] + b[0]) / 2, z + 3.5, (a[1] + b[1]) / 2]} rotation={[0, -ang, 0]}><boxGeometry args={[Math.max(L, 1), 7, 1.2]} /><meshStandardMaterial color={c} /></mesh>;
  }
  const p = v.polygon ?? [];
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const [cx, cy, w, d] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  return <mesh position={[cx, z + (v.kind === "construct" ? 6 : 0.4), cy]}><boxGeometry args={[Math.max(w, 1), v.kind === "construct" ? 12 : 0.8, Math.max(d, 1)]} /><meshStandardMaterial color={c} transparent opacity={0.7} /></mesh>;
}

function View3D({ geo, mods }: { geo: Geometry; mods: Modification[] }) {
  const floors = geo.twin.floors;
  const all = floors.flatMap((f) => f.outline);
  const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2, cy = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2;
  const span = Math.max(...all.map((p) => Math.abs(p[0] - cx)), ...all.map((p) => Math.abs(p[1] - cy)));
  const zOf = (id: string) => floors.findIndex((f) => f.id === id) * 14;
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-line bg-[#f6f7f9]" data-testid="arch-3d">
      <Canvas camera={{ position: [cx + span * 1.1, span * 1.0, cy + span * 1.3], fov: 45, near: 1, far: span * 20 }}>
        <ambientLight intensity={0.8} /><directionalLight position={[cx, span, cy]} intensity={0.8} />
        {floors.map((f, i) => (
          <group key={f.id}>
            <Line points={[...f.outline, f.outline[0]!].map((p) => [p[0], i * 14, p[1]] as [number, number, number])} color="#1f2937" lineWidth={1.6} />
            {f.spaces.map((s) => <Line key={s.id} points={[...s.polygon, s.polygon[0]!].map((p) => [p[0], i * 14, p[1]] as [number, number, number])} color="#9ca3af" lineWidth={0.6} />)}
          </group>
        ))}
        {mods.flatMap((m) => m.viz.map((v, i) => <Shape3D key={`${m.id}${i}`} v={v} z={zOf(v.floor)} />))}
        <OrbitControls target={[cx, 10, cy]} />
      </Canvas>
    </div>
  );
}

export function Architect() {
  const [venues, setVenues] = useState<{ id: string; label: string }[]>([]);
  const [venue, setVenue] = useState("rinker-hall");
  const [report, setReport] = useState<ArchitectReport | null>(null);
  const [missing, setMissing] = useState(false);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [floor, setFloor] = useState("F1");
  const [layer, setLayer] = useState<"before" | "after" | "difference">("before");
  const load = (v: string) => getJSON<ArchitectReport>(`/api/architect/report?venue=${encodeURIComponent(v)}`).then((r) => { setReport(r); setMissing(false); }).catch(() => { setReport(null); setMissing(true); });
  useEffect(() => { void getJSON<{ id: string; label: string }[]>("/api/venues").then(setVenues).catch(() => {}); }, []);
  useEffect(() => { void load(venue); void loadGeometry(venue).then(setGeo).catch(() => setGeo(null)); setSelId(null); }, [venue]);
  useEffect(() => {
    if (!status?.running) return;
    const t = window.setInterval(() => { void getJSON<Status>("/api/architect/status").then((s) => { setStatus(s); if (!s.running) void load(venue); }); }, 2000);
    return () => window.clearInterval(t);
  }, [status?.running, venue]);
  const start = async () => { try { await postJSON("/api/architect/run", { venue }); setStatus({ running: true, venue, log: ["starting"], error: null, finishedAt: null }); } catch (e) { setStatus({ running: false, venue, log: [], error: e instanceof Error ? e.message : String(e), finishedAt: null }); } };
  const sim = useMemo(() => report?.search.alternatives.filter((a) => a.source === "simulated") ?? [], [report]);
  const sel: Alternative | null = sim.find((a) => a.id === selId) ?? sim[0] ?? null;
  const selMods = useMemo(() => (sel && report ? sel.mods.map((id) => report.modifications.find((m) => m.id === id)!).filter(Boolean) : []), [sel, report]);
  const cap = report?.search.safeCapacity;
  return (
    <section className="flex flex-col gap-4 px-4 pt-5 pb-10 min-[700px]:px-6" data-testid="architect">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-[820px]">
          <h1 className="text-[20px] font-medium">Architectural changes</h1>
          <p className="text-[13px] text-ink-2">Finds where and why people are delayed, proposes specific construction (new exits, external stairs, passages, removed partitions, ramps, wider doors), tests each one and their combinations in the simulator on the same scenarios and seeds, and ranks them by safety gain, effort and structural impact.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={venue} onChange={(e) => setVenue(e.target.value)} className="h-8 rounded-lg border border-line px-2 text-[13px]" data-testid="arch-venue">
            {(venues.length ? venues : [{ id: "rinker-hall", label: "Rinker Hall" }]).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <Button tone="primary" onClick={() => void start()} disabled={!!status?.running} data-testid="arch-run">{status?.running ? "Analysing…" : report ? "Re-run analysis" : "Run analysis"}</Button>
        </div>
      </header>
      {status?.running || status?.error ? <pre className={cx("max-h-40 overflow-auto rounded-lg border p-2 text-[12px]", status.error ? "border-red-300 bg-red-50 text-red-800" : "border-line bg-panel text-ink-2")} data-testid="arch-status">{status.error ?? status.log.join("\n")}</pre> : null}
      {!report ? <p className="text-[13px] text-ink-2">{missing ? <>No analysis for this venue yet. Run it here (about 2–3 minutes) or with <code className="num">npm run architect -- --venue {venue}</code>.</> : "Loading…"}</p> : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-4" data-testid="arch-numbers">
            <div className="rounded-lg border border-line p-3"><div className="text-[12px] text-ink-3">Safe capacity (everyone out by the target in all {cap?.runs} test runs)</div><div className="text-[20px] font-medium num">{cap?.baseline.people} → {cap?.best?.people ?? "–"}</div><div className="text-[13px] text-emerald-700">{cap?.extraPeople !== null && cap?.extraPeople !== undefined ? `${fmt(cap.extraPeople)} people` : ""} with {cap?.best?.alternative ?? "–"}</div></div>
            <div className="rounded-lg border border-line p-3"><div className="text-[12px] text-ink-3">Extra people out by the target, same crowd ({sel?.id})</div><div className="text-[20px] font-medium num">{sel ? ci(sel.dProtected) : "–"}</div><div className="text-[12px] text-ink-3">baseline {report.search.baseline.protectedByTarget} of {report.search.baseline.people}</div></div>
            <div className="rounded-lg border border-line p-3"><div className="text-[12px] text-ink-3">Time for 95% to get out ({sel?.id})</div><div className="text-[20px] font-medium num">{sel ? ci(sel.dClearance95, " s") : "–"}</div><div className="text-[12px] text-ink-3">baseline {report.search.baseline.clearance95Sec} s</div></div>
            <div className="rounded-lg border border-line p-3"><div className="text-[12px] text-ink-3">Evidence</div><div className="text-[13px]"><span className="num">{report.search.simulations}</span> simulations, each alternative on the same <span className="num">{report.search.runs}</span> scenario runs as the baseline (± is a 95% interval).</div></div>
          </div>
          <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_420px]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Floor" value={floor} onChange={setFloor} options={(geo?.twin.floors ?? []).map((f) => ({ value: f.id, label: f.id }))} size="sm" />
                <Segmented label="Waiting map" value={layer} onChange={setLayer} options={[{ value: "before", label: "Waiting now" }, { value: "after", label: `After ${report.after?.alternative ?? ""}` }, { value: "difference", label: "Difference" }]} size="sm" testId="arch-layer" />
                <span className="text-[12px] text-ink-3"><span className="text-emerald-700">■ build</span> · <span className="text-red-700">■ remove</span> · <span className="text-amber-700">■ modify</span> · <span className="text-violet-700">◌ hotspot</span></span>
              </div>
              {geo ? <PlanView geo={geo} report={report} mods={selMods} floor={floor} layer={layer} /> : null}
              {geo ? <View3D geo={geo} mods={selMods} /> : null}
            </div>
            <aside className="flex flex-col gap-3 text-[13px]">
              <div className="rounded-lg border border-line p-3" data-testid="arch-diagnosis">
                <h2 className="font-medium">Diagnosis</h2>
                {report.concepts.interpretation ? <p className="mt-1 text-ink-2"><span className="font-medium text-ink">Opus 5.5:</span> {report.concepts.interpretation}</p> : null}
                <ul className="mt-1 list-disc pl-4 text-ink-2">{report.diagnosis.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
              {sel ? (
                <div className="rounded-lg border border-line p-3" data-testid="arch-selected">
                  <h2 className="font-medium">{sel.id}: what to build</h2>
                  {selMods.map((m) => (
                    <div key={m.id} className="mt-2 border-t border-line pt-2">
                      <div className="font-medium">{m.title}{m.source === "opus" ? <span className="ml-1 rounded bg-sky-100 px-1 text-[11px] text-sky-800">Opus concept</span> : null}</div>
                      <p className="text-ink-2">{m.why}</p>
                      <p className="text-ink-3">{m.structural === "structural" ? "Structural change" : m.structural === "partition" ? "Partition (assumed non-structural)" : "No structural change"}{m.needsEngineer ? " · needs a structural engineer" : ""}{m.accessibility > 0 ? " · improves accessibility" : ""}</p>
                      <ul className="list-disc pl-4 text-[12px] text-ink-3">{m.regulations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </aside>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[13px]" data-testid="arch-alternatives">
              <thead className="bg-panel text-left text-[12px] text-ink-3"><tr><th className="p-2">#</th><th className="p-2">Change</th><th className="p-2">Extra people out by target</th><th className="p-2">95% out (s)</th><th className="p-2">Effort</th><th className="p-2">Structural</th><th className="p-2">Best trade-off</th></tr></thead>
              <tbody>
                {sim.slice(0, 15).map((a) => (
                  <tr key={a.id} onClick={() => setSelId(a.id)} className={cx("cursor-pointer border-t border-line", sel?.id === a.id ? "bg-sky-50" : "hover:bg-panel")} data-testid="arch-alt">
                    <td className="p-2 num">{a.id}</td><td className="p-2">{a.title}</td><td className="p-2 num">{ci(a.dProtected)}</td><td className="p-2 num">{ci(a.dClearance95)}</td><td className="p-2 num">{a.effort}</td>
                    <td className="p-2">{a.structuralChanges}{a.needsEngineer ? " · engineer" : ""}</td><td className="p-2">{a.pareto ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-ink-3" data-testid="arch-method">
            {report.search.surrogate.note} Opus 5.5 proposed {report.concepts.proposed} concepts: {report.concepts.built.length} built, {report.concepts.rejected.length} rejected{report.concepts.rejected.length ? ` (${report.concepts.rejected.map((r) => r.reason).join("; ")})` : ""}; {report.ablation.opusInTop3} of the top 3 include one. Effort is in relative units (config/architect.json), not money. {report.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}
