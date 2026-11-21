import { useEffect, useMemo, useState } from "react";
import type { LiveState, LogLine } from "../../../src/server/contract.ts";
import { getJSON } from "../api.ts";
import { DecisionPanel } from "../components/live/DecisionPanel.tsx";
import { EventLog } from "../components/live/EventLog.tsx";
import { PlanCard, type PlanSign } from "../components/live/FloorPlan.tsx";
import { tickSec } from "../components/live/format.ts";
import { DemoStrip, IncidentBanner } from "../components/live/IncidentBanner.tsx";
import { BriefPanel, SignsPanel } from "../components/live/SidePanels.tsx";
import { ZoneMatrix } from "../components/live/ZoneMatrix.tsx";
import { Empty } from "../components/ui.tsx";
import { useGeometry } from "../geometry.ts";
import { useStore } from "../store.ts";

export default function Live() {
  const live = useStore((s) => s.live);
  const log = useStore((s) => s.log);
  const hazard = useStore((s) => s.hazard);
  const setLive = useStore((s) => s.setLive);
  const addLog = useStore((s) => s.addLog);
  const clearLog = useStore((s) => s.clearLog);
  const setChannel = useStore((s) => s.setChannel);
  const { geo, error: geoError } = useGeometry();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [floorPick, setFloorPick] = useState<number | null>(null);
  const [crowd, setCrowd] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = () => getJSON<LiveState>("/api/live/state").then((s) => { if (alive) { setLive(s); setError(null); } }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    poll();
    const id = window.setInterval(poll, 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [setLive]);

  const session = live?.sessionId;
  useEffect(() => {
    clearLog();
    setFloorPick(null);
  }, [session, clearLog]);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      const st = useStore.getState().log;
      const since = st.length ? st[st.length - 1]!.seq : 0;
      getJSON<LogLine[]>(`/api/live/log?since=${since}`).then((l) => { if (alive) addLog(l); }).catch(() => undefined);
    };
    poll();
    const id = window.setInterval(poll, 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [addLog, session]);

  const frameChannel = live?.frameChannel ?? null;
  useEffect(() => {
    setChannel(frameChannel);
  }, [frameChannel, setChannel]);
  useEffect(() => () => setChannel(null), [setChannel]);

  const kinds = useMemo(() => new Map((geo?.grid.elements ?? []).map((e) => [e.id, e.kind] as const)), [geo]);
  const kindOf = (id: string) => kinds.get(id);
  const toggle = (id: string) => setActive((a) => (a === id ? null : id));

  const current = live?.current ?? null;
  const pending = !!current && (current.status === "pending" || current.status === "verifying") && current.signPreview.length > 0;
  const signs = useMemo(() => {
    const m = new Map<string, PlanSign>();
    for (const s of live?.signs ?? []) m.set(s.mount, { mount: s.mount, state: s.state, pending: false });
    if (pending) for (const p of current!.signPreview) m.set(p.mount, { mount: p.mount, state: p.state, pending: true });
    return m;
  }, [live?.signs, current, pending]);
  const published = (live?.signs ?? []).some((s) => s.state.kind !== "STATIC_DEFAULT");
  const counts = useMemo(() => Object.fromEntries(Object.entries(live?.estimate?.countsByZone ?? {}).map(([k, v]) => [k, v.value])), [live?.estimate]);

  const autoFloor = useMemo(() => {
    if (!geo) return 0;
    const idx = (f: string | undefined) => (f ? geo.twin.floors.findIndex((x) => x.id === f) : -1);
    const dmg = hazard?.damaged.map((d) => geo.grid.elements.find((e) => e.id === d)?.floor).find(Boolean);
    const zoneFloor = live?.estimate?.zone ? geo.twin.zones.find((z) => z.id === live.estimate!.zone)?.floor : undefined;
    for (const f of [hazard?.fireOrigin?.floor, zoneFloor, dmg]) if (idx(f) >= 0) return idx(f);
    return 0;
  }, [geo, hazard, live?.estimate]);
  const floorIdx = floorPick ?? autoFloor;

  return (
    <div className="h-full overflow-auto bg-page" data-testid="live-page">
      {live ? <IncidentBanner live={live} log={log} twin={geo?.twin ?? null} /> : (
        <section aria-label="Incident" className="border-b border-line bg-panel px-4 py-4 text-ink-2 md:px-6">{error ? `Live state unavailable: ${error}` : "Connecting to the live session"}</section>
      )}
      <DemoStrip live={live} />
      {live?.holdReason ? (
        <div className="border-b border-warn-line bg-warn-bg px-4 py-2 text-[13px] font-medium text-warn-ink md:px-6" data-testid="hold-banner" role="status">
          Signs are held at the last approved or static state: {live.holdReason}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-4 px-4 pt-4 pb-6 md:px-6">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          {geo && live ? <ZoneMatrix estimate={live.estimate} current={current} twin={geo.twin} grid={geo.grid} /> : null}
          {geo ? (
            <PlanCard geo={geo} floorIdx={floorIdx} onFloor={setFloorPick} hazard={hazard} signs={signs} counts={counts} closedRoutes={current?.policy.closedRoutes ?? []} crowd={crowd} onCrowd={setCrowd}
              mode={pending ? "preview" : published ? "published" : "static"} />
          ) : <Empty>{geoError ? `Floor plan unavailable: ${geoError}` : "Loading the floor plan"}</Empty>}
          <EventLog log={log} dt={live ? tickSec(live) : 0} active={active} />
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4 max-[1123px]:order-first max-[1123px]:basis-full min-[1124px]:max-w-[520px]">
          {live ? (
            <>
              <DecisionPanel live={live} log={log} kindOf={kindOf} onRef={toggle} />
              <BriefPanel live={live} onRef={toggle} active={active} />
              <SignsPanel live={live} />
            </>
          ) : error ? <Empty>Live state unavailable: {error}</Empty> : null}
        </div>
      </div>
    </div>
  );
}
