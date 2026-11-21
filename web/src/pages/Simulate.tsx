import { Box, Columns2, Crosshair, Layers3, Map as MapIcon, Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useApi } from "../api.ts";
import { Button, cx, Dot, HazardTag, IconButton, Segmented } from "../components/ui.tsx";
import { useGeometry } from "../geometry.ts";
import { countAgents } from "../sim/derive.ts";
import { adoptRun, lastSim, loadPresets, OCCUPANCY_LABEL, PROTOCOL_LABEL, useScenario } from "../sim/scenario.ts";
import { LAYER_DEFS, useView, type FloorSel, type ViewMode } from "../sim/viewState.ts";
import { useStore } from "../store.ts";
import Plan2D, { type PlanPoint } from "../views/Plan2D.tsx";
import { RunStatsSheet } from "./simulate/RunStatsSheet.tsx";
import { DEFAULT_FORM, ScenarioSheet, type CustomForm } from "./simulate/ScenarioSheet.tsx";
import { StatusPanel } from "./simulate/StatusPanel.tsx";
import { Transport } from "./simulate/Transport.tsx";

let booting = false;
const Building3D = lazy(() => import("../views/Building3D.tsx"));

interface Meta { targets?: Record<string, number> }

function Legend({ twoD }: { twoD: boolean }) {
  const item = (c: string, l: string, ring?: boolean) => <span className="inline-flex items-center gap-1.5"><Dot color={c} ring={ring} />{l}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2" data-testid="legend">
      {item("#1f2530", "Moving")}
      {item("#5b6b8c", "On stairs")}
      {item("#f59e0b", "Queuing")}
      {item("#b4bbc6", "Not yet moving")}
      {item("#e5372b", "In dense smoke")}
      {twoD ? <span>Path colour = exit chosen</span> : null}
      {twoD ? <span className="inline-flex items-center gap-2">Density<span className="h-1.5 w-[72px] rounded-full bg-[linear-gradient(90deg,#facc15,#f97316,#ef4444,#be185d)]" /><span className="num">1 → 5+ p/m²</span></span> : null}
    </div>
  );
}

function ScenarioCard({ onEdit }: { onEdit: () => void }) {
  const { scenario, label, busy } = useScenario();
  const occupants = useStore((s) => s.frame?.n ?? null);
  const { geo } = useGeometry();
  if (!scenario) return <div className="flex items-center gap-2 text-ink-3">{busy ? "Starting a run…" : "Scenario details unavailable for this run"}<Button onClick={onEdit} className="h-7 px-2.5 text-[12px]" data-testid="edit-scenario">Choose a scenario</Button></div>;
  const hz = scenario.hazard;
  let where = "";
  if (hz.floor && hz.at && geo) {
    const f = geo.twin.floors.find((x) => x.id === hz.floor);
    const inside = (p: readonly (readonly [number, number])[], x: number, y: number) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i]!, [xj, yj] = p[j]!; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const sp = f?.spaces.find((s) => inside(s.polygon, hz.at![0], hz.at![1]));
    where = `${sp?.name ?? "origin"}, ${f?.name.toLowerCase() ?? hz.floor}`;
  } else if (hz.kind === "quake") where = hz.damaged?.length ? `damage at ${hz.damaged.join(", ")}` : "no structural damage";
  else if (hz.kind === "crush") where = hz.surgeExit ? `surge towards ${hz.surgeExit}` : "surge at the busiest exit";
  else where = "whole building";
  return (
    <section aria-label="Scenario" className="flex max-w-[600px] flex-col gap-1.5" data-testid="scenario-card">
      <div className="flex flex-wrap items-center gap-2">
        <HazardTag kind={hz.kind} />
        <span className="text-[15px] font-medium first-letter:uppercase">{where}</span>
        <Button onClick={onEdit} className="ml-1 h-7 px-2.5 text-[12px]" data-testid="edit-scenario">Edit scenario</Button>
      </div>
      <div className="truncate text-ink-2" title={label}>
        {occupants !== null ? <><span className="num">{occupants}</span> occupants · </> : null}{OCCUPANCY_LABEL(scenario.occupancy)} · {PROTOCOL_LABEL(scenario.protocol)} · {label} · seed <span className="num">{scenario.seed}</span>
      </div>
    </section>
  );
}

export default function Simulate() {
  const view = useView((s) => s.view);
  const floor = useView((s) => s.floor);
  const layers = useView((s) => s.layers);
  const explode = useView((s) => s.explode);
  const { setView, setFloor, toggleLayer, setExplode, camera } = useView.getState();
  const scenario = useScenario((s) => s.scenario);
  const meta = useApi<Meta>("/api/meta");
  const [editing, setEditing] = useState(false);
  const [stats, setStats] = useState(false);
  const [form, setForm] = useState<CustomForm>(DEFAULT_FORM);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const v = q.get("view");
    if (v === "2d" || v === "3d" || v === "split") setView(v);
    const ch = q.get("channel") ?? lastSim.channel;
    const st = useStore.getState();
    if (ch) {
      lastSim.channel = ch;
      if (st.channel !== ch) st.setChannel(ch, { autoplay: true, follow: false });
      void adoptRun(ch);
      return;
    }
    if (st.channel?.startsWith("sim:") || booting) return;
    booting = true;
    void loadPresets().then((list) => {
      const p = list.find((x) => x.id.includes("worst") && x.hazard === "fire") ?? list[0];
      if (p) void useScenario.getState().run(p.scenario, p.label, "rule");
    });
  }, [setView]);

  const targetSec = scenario ? meta.data?.targets?.[scenario.hazard.kind] ?? null : null;
  const twoD = view !== "3d";
  const onPick = (p: PlanPoint) => { setForm({ ...form, at: p }); setPicking(false); setEditing(true); };

  return (
    <div className="flex h-full flex-col" data-testid="simulate-page">
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-stage p-3 md:block md:overflow-hidden md:p-0">
        <div className={cx("relative order-2 h-[58vh] shrink-0 md:absolute md:inset-0 md:h-auto", view === "split" ? "grid grid-cols-1 gap-px bg-line md:grid-cols-2" : "")} data-testid="synced-views" data-view={view}>
          {view !== "3d" ? (
            <div className={cx("min-h-0 bg-stage", view === "split" ? "relative" : "absolute inset-0")}>
              <div className={cx("absolute inset-0", view === "split" ? "md:left-[84px] md:right-3 md:top-[152px] md:bottom-[96px]" : "md:top-[132px] md:right-[332px] md:bottom-[96px] md:left-[84px]")}>
                <Plan2D onPlanClick={picking ? onPick : undefined} marker={form.at} />
              </div>
            </div>
          ) : null}
          {view !== "2d" ? (
            <div className={cx("min-h-0 bg-stage", view === "split" ? "relative" : "absolute inset-0")}>
              <Suspense fallback={<div className="grid h-full place-items-center text-ink-3">Loading 3D view</div>}>
                <Building3D className="absolute inset-0" />
              </Suspense>
            </div>
          ) : null}
        </div>

        <div className="order-1 flex flex-col gap-3 md:contents">
          <div className="md:absolute md:top-4 md:left-4"><ScenarioCard onEdit={() => setEditing(true)} /></div>
          <div className="md:absolute md:top-4 md:right-[332px]">
            <Segmented<ViewMode> label="View" value={view} onChange={setView} testId="view-toggle" options={[
              { value: "3d", label: <><Box size={14} />3D</>, testId: "view-3d" },
              { value: "2d", label: <><MapIcon size={14} />2D Flow</>, testId: "view-2d" },
              { value: "split", label: <><Columns2 size={14} />Split</>, testId: "view-split" },
            ]} />
          </div>
          {twoD ? (
            <div role="group" aria-label="Layers" className="flex flex-wrap items-center gap-1.5 md:absolute md:top-[84px] md:left-[84px]" data-testid="layers">
              <span className="mr-1 text-[12px] text-ink-3">Layers</span>
              {LAYER_DEFS.map((d) => (
                <button key={d.key} type="button" aria-pressed={layers[d.key]} onClick={() => toggleLayer(d.key)} data-testid={`layer-${d.key}`}
                  className={cx("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors", layers[d.key] ? "border-[#c9cfd7] bg-panel text-ink" : "border-[#d9dde3] text-ink-3 hover:text-ink")}>
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: d.swatch, opacity: layers[d.key] ? 1 : 0.3 }} />{d.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="order-3 flex flex-col gap-3 md:contents">
          <div className="flex flex-wrap gap-3 md:absolute md:top-1/2 md:left-4 md:-translate-y-1/2 md:flex-col md:flex-nowrap">
            <FloorRail floor={floor} setFloor={setFloor} />
            <div role="group" aria-label="Camera" className="flex gap-0.5 self-start rounded-[10px] border border-line bg-panel p-[3px] shadow-[0_1px_2px_rgba(16,24,40,0.05)] md:flex-col">
              <IconButton label="Zoom in" onClick={() => camera("zoomIn")} className="h-9 w-11 md:w-[52px]"><Plus size={16} /></IconButton>
              <IconButton label="Zoom out" onClick={() => camera("zoomOut")} className="h-9 w-11 md:w-[52px]"><Minus size={16} /></IconButton>
              {view !== "2d" ? <IconButton label={explode ? "Stack floors" : "Separate floors"} pressed={explode} onClick={() => setExplode(!explode)} className="h-9 w-11 md:w-[52px]"><Layers3 size={16} /></IconButton> : null}
              {view !== "2d" ? <IconButton label="Top view" onClick={() => camera("top")} className="h-9 w-11 md:w-[52px]"><Crosshair size={16} /></IconButton> : null}
              <IconButton label="Reset view" onClick={() => camera("reset")} className="h-9 w-11 md:w-[52px]">{view === "2d" ? <Maximize size={16} /> : <RotateCcw size={16} />}</IconButton>
            </div>
          </div>
          <div className="md:absolute md:right-[332px] md:bottom-[84px] md:left-[84px]"><Legend twoD={twoD} /></div>
          <div className="md:absolute md:top-4 md:right-4 md:bottom-[88px] md:w-[300px] md:overflow-auto"><StatusPanel onStats={() => setStats(true)} /></div>
        </div>

        {picking ? (
          <div className="fixed top-[64px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-ink bg-panel px-4 py-2.5 shadow-lg" role="status">
            <Crosshair size={16} />Click on the plan to place the hazard origin
            <Button tone="ghost" onClick={() => { setPicking(false); setEditing(true); }}>Cancel</Button>
          </div>
        ) : null}
      </div>
      <Transport className="flex-none py-2 md:h-[72px] md:py-0" maxSec={scenario?.maxSec ?? 900} targetSec={targetSec} />
      <ScenarioSheet open={editing} onOpenChange={setEditing} form={form} setForm={setForm} onPickOrigin={() => { setEditing(false); setPicking(true); if (view === "3d") setView("2d"); }} />
      <RunStatsSheet open={stats} onOpenChange={setStats} />
    </div>
  );
}

function FloorRail({ floor, setFloor }: { floor: FloorSel; setFloor: (f: FloorSel) => void }) {
  const { geo } = useGeometry();
  const frame = useStore((s) => s.frame);
  const hazard = useStore((s) => s.hazard);
  const counts = useMemo(() => countAgents(frame, geo, hazard), [frame, geo, hazard]);
  const floors = geo?.twin.floors ?? [];
  const opts: { value: string; label: React.ReactNode; title: string }[] = [
    { value: "all", label: <FloorBtn id="All" n={counts?.inside} />, title: "All floors" },
    ...floors.map((f, i) => ({ value: String(i), label: <FloorBtn id={f.id} n={counts?.perFloor[i]?.inside} />, title: f.name })).reverse(),
  ];
  return <Segmented label="Floor" value={String(floor)} onChange={(v) => setFloor((v === "all" ? "all" : Number(v)) as FloorSel)} options={opts} tone="ink" className="border border-line bg-panel shadow-[0_1px_2px_rgba(16,24,40,0.05)] md:flex-col [&>*]:h-11 [&>*]:w-[52px] [&>*]:px-0" testId="floor-rail" />;
}

function FloorBtn({ id, n }: { id: string; n: number | undefined }) {
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="text-[13px] font-semibold">{id}</span>
      <span className="num text-[10px] opacity-70">{n ?? "—"}</span>
    </span>
  );
}
