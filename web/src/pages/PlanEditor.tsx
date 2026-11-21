import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { PlanDraft, PlanMeta } from "../../../src/plans/draft.ts";
import { getJSON, postJSON } from "../api.ts";
import { Button, cx, Segmented } from "../components/ui.tsx";
import { navigate } from "../router.ts";

type Pt = [number, number];
type Tool = "select" | "wall" | "door" | "exit" | "obstacle" | "outline" | "scale";
type Sel = { kind: "outline"; i: number } | { kind: "walls" | "doors" | "exits"; i: number; end: "a" | "b" | null } | { kind: "obstacles"; i: number; v: number | null } | null;
interface Check { errors: string[]; warnings: string[]; stats: Record<string, number> }
interface TraceReply { draft: PlanDraft; notes: string[]; checks: string[]; model: string; passes: number }

export const PREFERRED_VENUE_KEY = "exitmind:preferred-venue";
const TOOLS: { value: Tool; label: string }[] = [
  { value: "select", label: "Select / drag" }, { value: "wall", label: "Wall" }, { value: "door", label: "Door" }, { value: "exit", label: "Exit" },
  { value: "obstacle", label: "Obstacle" }, { value: "outline", label: "Outline point" }, { value: "scale", label: "Scale" },
];
const blank = (m: PlanMeta): PlanDraft => ({
  outline: [[m.width * 0.1, m.height * 0.1], [m.width * 0.9, m.height * 0.1], [m.width * 0.9, m.height * 0.9], [m.width * 0.1, m.height * 0.9]],
  walls: [], doors: [], exits: [], obstacles: [], labels: [], stage: null, scale: { ftPerPx: null, evidence: "not set" }, edited: true,
});

export default function PlanEditor() {
  const [meta, setMeta] = useState<PlanMeta | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<Sel>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scalePts, setScalePts] = useState<Pt[]>([]);
  const [scaleLen, setScaleLen] = useState("10");
  const [scaleUnit, setScaleUnit] = useState<"m" | "ft">("m");
  const [drawing, setDrawing] = useState<{ a: Pt; b: Pt } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Sel>(null);

  useEffect(() => {
    const id = location.pathname.split("/")[2];
    if (id) void getJSON<PlanMeta & { draft: PlanDraft | null }>(`/api/plans/${id}`).then((r) => { setMeta(r); setName(r.name); setDraft(r.draft); }).catch(() => {});
  }, []);

  const edit = useCallback((f: (d: PlanDraft) => PlanDraft) => { setDraft((d) => (d ? { ...f(d), edited: true } : d)); setSaved(null); }, []);

  useEffect(() => {
    if (!meta || !draft) return;
    const t = window.setTimeout(() => { void postJSON<Check>(`/api/plans/${meta.id}/check`, { draft }).then(setCheck).catch((e: unknown) => setCheck({ errors: [String(e)], warnings: [], stats: {} })); }, 500);
    return () => window.clearTimeout(t);
  }, [meta, draft]);

  const upload = async (file: File) => {
    setBusy("Uploading…"); setError(null);
    try {
      const res = await fetch(`/api/plans?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      const r = (await res.json()) as PlanMeta & { draft: PlanDraft | null; error?: string };
      if (!res.ok) throw new Error(r.error ?? res.statusText);
      setMeta(r); setName(r.name); setDraft(r.draft); setNotes([]); history.replaceState(null, "", `/plans/${r.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const trace = async () => {
    if (!meta) return;
    setBusy("Claude Opus 5.5 is tracing the plan (this can take a minute or two)…"); setError(null);
    try {
      const r = await postJSON<TraceReply>(`/api/plans/${meta.id}/trace`, { ftPerPx: draft?.scale.ftPerPx ?? null });
      setDraft(r.draft); setNotes([...r.notes, ...r.checks.map((c) => `check: ${c}`)]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!meta || !draft) return;
    setBusy("Saving…"); setError(null);
    try {
      const r = await postJSON<{ venue: string }>(`/api/plans/${meta.id}/save`, { draft, name });
      localStorage.setItem(PREFERRED_VENUE_KEY, JSON.stringify({ id: r.venue, label: name || meta.name }));
      setSaved(r.venue);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const toImg = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!, r = svg.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * meta!.width * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * meta!.height * 10) / 10];
  };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (!draft || !meta) return;
    const p = toImg(e);
    if (tool === "scale") { setScalePts((s) => (s.length >= 2 ? [p] : [...s, p])); return; }
    if (tool === "outline") {
      let best = 0, bd = Infinity;
      draft.outline.forEach((a, i) => { const b = draft.outline[(i + 1) % draft.outline.length]!; const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const d = Math.hypot(m[0] - p[0], m[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      edit((d) => ({ ...d, outline: [...d.outline.slice(0, best + 1), p, ...d.outline.slice(best + 1)] }));
      return;
    }
    if (tool !== "select") { setDrawing({ a: p, b: p }); (e.target as Element).setPointerCapture?.(e.pointerId); }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!meta) return;
    const p = toImg(e);
    if (drawing) { setDrawing({ ...drawing, b: p }); return; }
    const s = dragRef.current;
    if (!s) return;
    edit((d) => {
      if (s.kind === "outline") return { ...d, outline: d.outline.map((q, i) => (i === s.i ? p : q)) };
      if (s.kind === "obstacles") return { ...d, obstacles: d.obstacles.map((o, i) => (i === s.i && s.v !== null ? { ...o, polygon: o.polygon.map((q, k) => (k === s.v ? p : q)) } : o)) };
      const list = d[s.kind] as { a: Pt; b: Pt }[];
      return { ...d, [s.kind]: list.map((x, i) => (i === s.i && s.end ? { ...x, [s.end]: p } : x)) };
    });
  };
  const onUp = () => {
    dragRef.current = null;
    if (!drawing || !draft) return;
    const { a, b } = drawing;
    setDrawing(null);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return;
    if (tool === "wall") edit((d) => ({ ...d, walls: [...d.walls, { a, b }] }));
    if (tool === "door") edit((d) => ({ ...d, doors: [...d.doors, { a, b }] }));
    if (tool === "exit") edit((d) => ({ ...d, exits: [...d.exits, { a, b, name: `Exit ${d.exits.length + 1}`, main: d.exits.length === 0 }] }));
    if (tool === "obstacle") edit((d) => ({ ...d, obstacles: [...d.obstacles, { name: `Obstacle ${d.obstacles.length + 1}`, polygon: [a, [b[0], a[1]], b, [a[0], b[1]]] }] }));
  };
  const del = useCallback(() => {
    if (!sel) return;
    edit((d) => sel.kind === "outline" ? (d.outline.length > 3 ? { ...d, outline: d.outline.filter((_, i) => i !== sel.i) } : d) : { ...d, [sel.kind]: (d[sel.kind] as unknown[]).filter((_, i) => i !== sel.i) });
    setSel(null);
  }, [sel, edit]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.key === "Delete" || e.key === "Backspace") && !(e.target instanceof HTMLInputElement)) del(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [del]);

  const applyScale = () => {
    if (scalePts.length !== 2) return;
    const px = Math.hypot(scalePts[1]![0] - scalePts[0]![0], scalePts[1]![1] - scalePts[0]![1]);
    const ft = Number(scaleLen) * (scaleUnit === "m" ? 1 / 0.3048 : 1);
    if (!(px > 0 && ft > 0)) return;
    edit((d) => ({ ...d, scale: { ftPerPx: Math.round((ft / px) * 1e5) / 1e5, evidence: `two points ${Math.round(px)} px apart = ${scaleLen} ${scaleUnit} (set by the user)` } }));
    setScalePts([]);
  };
  const suggest = async () => {
    if (!meta || !draft) return;
    setBusy("Looking for sealed rooms…");
    try {
      const r2 = await postJSON<{ doors: { a: Pt; b: Pt }[] }>(`/api/plans/${meta.id}/suggest-doors`, { draft });
      if (r2.doors.length) edit((d) => ({ ...d, doors: [...d.doors, ...r2.doors] }));
      setNotes((n) => [...n, r2.doors.length ? `Added ${r2.doors.length} door(s) where an area was sealed off; check each one against the plan.` : "No sealed areas found."]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const r = meta ? Math.max(meta.width, meta.height) / 260 : 3;
  const selExit = sel?.kind === "exits" ? draft?.exits[sel.i] : undefined;
  const status = useMemo(() => !check ? null : check.errors.length ? "error" : check.warnings.length ? "warn" : "ok", [check]);

  const handle = (p: Pt, s: Sel, color: string) => (
    <circle cx={p[0]} cy={p[1]} r={r * 1.4} fill="white" stroke={color} strokeWidth={r * 0.5} style={{ cursor: "grab" }}
      onPointerDown={(e) => { if (tool !== "select") return; e.stopPropagation(); dragRef.current = s; setSel(s); }} />
  );
  const seg = (kind: "walls" | "doors" | "exits", x: { a: Pt; b: Pt }, i: number, color: string, w: number) => (
    <g key={`${kind}${i}`} data-testid={`plan-${kind.slice(0, -1)}`}>
      <line x1={x.a[0]} y1={x.a[1]} x2={x.b[0]} y2={x.b[1]} stroke={color} strokeWidth={w * (sel?.kind === kind && sel.i === i ? 1.8 : 1)} strokeLinecap="round"
        onPointerDown={(e) => { if (tool !== "select") return; e.stopPropagation(); setSel({ kind, i, end: null }); }} />
      {tool === "select" ? <>{handle(x.a, { kind, i, end: "a" }, color)}{handle(x.b, { kind, i, end: "b" }, color)}</> : null}
    </g>
  );

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3 p-4" data-testid="plan-editor">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold">Your own plan</h1>
          <p className="text-[13px] text-ink-2">Upload an architectural floor plan (PDF, PNG or JPEG). Claude Opus 5.5 traces it; you check and correct the draft, set the scale, and save it as a venue. The plan stays on this computer and is sent only to the Claude API for tracing.</p>
        </div>
        <Button onClick={() => navigate("/")}>Back to Simulate</Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line px-3 text-[13px] font-medium">
          Upload plan<input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" data-testid="plan-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
        {meta ? <>
          <Button tone="primary" onClick={() => void trace()} disabled={!!busy} data-testid="plan-trace">Trace with Opus 5.5</Button>
          <Button onClick={() => { setDraft(blank(meta)); setNotes(["Started from a blank rectangle: drag the outline and draw walls, doors and exits."]); }} disabled={!!busy} data-testid="plan-blank">Draw it myself</Button>
        </> : null}
        {busy ? <span className="text-[13px] text-ink-2" role="status">{busy}</span> : null}
        {error ? <span className="text-[13px] text-red-700" role="alert">{error}</span> : null}
      </div>
      {meta && draft ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-2">
            <Segmented label="Tool" value={tool} onChange={(t) => { setTool(t); setSel(null); }} options={TOOLS} size="sm" testId="plan-tools" />
            <div className="relative w-full overflow-hidden rounded-lg border border-line bg-white" style={{ aspectRatio: `${meta.width} / ${meta.height}` }}>
              <img src={`/api/plans/${meta.id}/image`} alt="Uploaded plan" className="absolute inset-0 h-full w-full select-none opacity-80" draggable={false} />
              <svg ref={svgRef} viewBox={`0 0 ${meta.width} ${meta.height}`} className="absolute inset-0 h-full w-full touch-none" data-testid="plan-canvas"
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
                <polygon points={draft.outline.map((p) => p.join(",")).join(" ")} fill="rgba(56,132,255,0.08)" stroke="#2563eb" strokeWidth={r * 0.7} data-testid="plan-outline" />
                {draft.obstacles.map((o, i) => (
                  <g key={`o${i}`}>
                    <polygon points={o.polygon.map((p) => p.join(",")).join(" ")} fill="rgba(100,116,139,0.35)" stroke="#475569" strokeWidth={r * 0.4} onPointerDown={(e) => { if (tool === "select") { e.stopPropagation(); setSel({ kind: "obstacles", i, v: null }); } }} />
                    {tool === "select" ? o.polygon.map((p, v) => <circle key={v} cx={p[0]} cy={p[1]} r={r} fill="white" stroke="#475569" onPointerDown={(e) => { e.stopPropagation(); dragRef.current = { kind: "obstacles", i, v }; setSel({ kind: "obstacles", i, v }); }} />) : null}
                  </g>
                ))}
                {draft.stage ? <polygon points={draft.stage.map((p) => p.join(",")).join(" ")} fill="rgba(168,85,247,0.3)" stroke="#7e22ce" strokeWidth={r * 0.4} /> : null}
                {draft.walls.map((w, i) => seg("walls", w, i, "#111827", r * 0.9))}
                {draft.doors.map((w, i) => seg("doors", w, i, "#16a34a", r * 1.2))}
                {draft.exits.map((w, i) => seg("exits", w, i, "#dc2626", r * 1.8))}
                {draft.labels.map((l, i) => <text key={`l${i}`} x={l.at[0]} y={l.at[1]} fontSize={r * 3.2} fill="#1e3a8a" textAnchor="middle" pointerEvents="none">{l.name}</text>)}
                {tool === "select" ? draft.outline.map((p, i) => <g key={`v${i}`}>{handle(p, { kind: "outline", i }, "#2563eb")}</g>) : null}
                {drawing ? <line x1={drawing.a[0]} y1={drawing.a[1]} x2={drawing.b[0]} y2={drawing.b[1]} stroke="#f59e0b" strokeWidth={r} strokeDasharray={`${r * 2} ${r}`} /> : null}
                {scalePts.map((p, i) => <circle key={`s${i}`} cx={p[0]} cy={p[1]} r={r * 1.6} fill="#f59e0b" />)}
                {scalePts.length === 2 ? <line x1={scalePts[0]![0]} y1={scalePts[0]![1]} x2={scalePts[1]![0]} y2={scalePts[1]![1]} stroke="#f59e0b" strokeWidth={r * 0.6} /> : null}
              </svg>
            </div>
            <p className="text-[12px] text-ink-3">Blue: outline. Black: walls. Green: doors (gaps in walls). Red: exits (on the outline). Grey: obstacles. Drag a handle to move it; select an item and press Delete to remove it; with “Outline point”, click near an edge to add a corner.</p>
          </div>
          <aside className="flex flex-col gap-3 text-[13px]">
            <section className="rounded-lg border border-line p-3" data-testid="plan-scale">
              <h2 className="font-medium">Scale</h2>
              <p className="text-ink-2">{draft.scale.ftPerPx ? <><span className="num">{draft.scale.ftPerPx.toFixed(4)}</span> ft per pixel ({draft.scale.evidence})</> : "Not set. Pick the Scale tool, click both ends of a known distance, then enter it."}</p>
              {tool === "scale" ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <input value={scaleLen} onChange={(e) => setScaleLen(e.target.value)} className="h-8 w-20 rounded border border-line px-2" inputMode="decimal" data-testid="plan-scale-length" />
                  <Segmented label="Unit" value={scaleUnit} onChange={setScaleUnit} options={[{ value: "m", label: "m" }, { value: "ft", label: "ft" }]} size="sm" />
                  <Button onClick={applyScale} disabled={scalePts.length !== 2} data-testid="plan-scale-apply">Apply</Button>
                </div>
              ) : null}
            </section>
            {selExit && sel?.kind === "exits" ? (
              <section className="rounded-lg border border-line p-3">
                <h2 className="font-medium">Selected exit</h2>
                <input value={selExit.name} onChange={(e) => edit((d) => ({ ...d, exits: d.exits.map((x, i) => (i === sel.i ? { ...x, name: e.target.value } : x)) }))} className="mt-1 h-8 w-full rounded border border-line px-2" />
                <label className="mt-1.5 flex items-center gap-2"><input type="checkbox" checked={selExit.main} onChange={(e) => edit((d) => ({ ...d, exits: d.exits.map((x, i) => (i === sel.i ? { ...x, main: e.target.checked } : x)) }))} />Main entrance (where most people came in)</label>
              </section>
            ) : null}
            {sel ? <Button onClick={del} data-testid="plan-delete">Delete selected</Button> : null}
            {check?.errors.some((e) => e.includes("cannot reach an exit")) ? <Button onClick={() => void suggest()} disabled={!!busy} data-testid="plan-suggest-doors">Add doors to sealed rooms</Button> : null}
            <section className={cx("rounded-lg border p-3", status === "error" ? "border-red-300 bg-red-50" : status === "warn" ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50")} data-testid="plan-checks" data-status={status ?? ""}>
              <h2 className="font-medium">Checks</h2>
              {check ? <>
                {check.errors.map((e, i) => <p key={`e${i}`} className="text-red-800">• {e}</p>)}
                {check.warnings.slice(0, 6).map((e, i) => <p key={`w${i}`} className="text-amber-800">• {e}</p>)}
                {!check.errors.length ? <p className="text-emerald-800">Ready to save{check.stats.areaSqft ? `: ${Math.round(check.stats.areaSqft).toLocaleString()} sq ft, ${draft.exits.length} exits, ${draft.walls.length} walls` : ""}.</p> : null}
              </> : <p className="text-ink-3">Checking…</p>}
            </section>
            {notes.length ? <section className="rounded-lg border border-line p-3"><h2 className="font-medium">Tracer notes</h2>{notes.map((n, i) => <p key={i} className="text-ink-2">• {n}</p>)}</section> : null}
            <section className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
              <label className="font-medium" htmlFor="plan-name">Venue name</label>
              <input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 rounded border border-line px-2" data-testid="plan-name" />
              <Button tone="primary" onClick={() => void save()} disabled={!!busy || status === "error"} data-testid="plan-save">Save as a venue</Button>
              {saved ? <p className="text-emerald-800" data-testid="plan-saved">Saved. The scenario generator will use this plan. <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="underline">Describe a scenario</a></p> : null}
            </section>
          </aside>
        </div>
      ) : meta ? <p className="text-[13px] text-ink-2">Plan uploaded ({meta.width} x {meta.height} px). Trace it with Opus 5.5, or draw it yourself.</p> : null}
    </div>
  );
}
