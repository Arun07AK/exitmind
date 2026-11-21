import type { DecisionCard, Estimate, GridInfo } from "../../../../src/server/contract.ts";
import type { ZoneInstruction } from "../../../../src/sim/types.ts";
import type { Twin, Zone } from "../../../../src/twin/schema.ts";
import { cx, Pop, Tip } from "../ui.tsx";
import { capital, HAZARD_WORDS, int, routeId } from "./format.ts";

function routeLine(z: ZoneInstruction | undefined) {
  if (!z) return <span className="text-ink-3">No plan for this zone</span>;
  const via = <span className="font-medium text-ink">{routeId(z.via)}</span>;
  switch (z.instruction) {
    case "EVACUATE_VIA": return z.delaySec > 0 ? <>Hold {z.delaySec} s, then {via}</> : <>Leave now via {via}</>;
    case "HOLD": return <>Hold in place</>;
    case "LOCKDOWN": return <>Lock down in place</>;
    case "MOVE_TO_COMPARTMENT": return <>Move to {z.via ? via : "the next compartment"}</>;
  }
}

/** Closed routes that have an element on this zone's floor inside its x range. */
function closedHere(zone: Zone, closed: readonly string[], grid: GridInfo): string[] {
  return closed.filter((r) => grid.elements.some((el) => (el.id === r || el.id.startsWith(`${r}@`)) && el.floor === zone.floor && el.x >= zone.xRangeFt[0] && el.x < zone.xRangeFt[1]));
}

const STATUS_WORDS: Record<DecisionCard["status"], string> = {
  verifying: "being verified", pending: "awaiting approval", approved: "approved", rejected: "rejected", timeout: "not approved in time", blocked: "blocked by the gate", overridden: "approved over the verifier", superseded: "superseded",
};

export function ZoneMatrix({ estimate, current, twin, grid }: { estimate: Estimate | null; current: DecisionCard | null; twin: Twin; grid: GridInfo }) {
  const counts = estimate?.countsByZone ?? {};
  const floors = [...twin.floors].reverse();
  const zonesOf = (f: string) => twin.zones.filter((z) => z.floor === f).sort((a, b) => a.xRangeFt[0] - b.xRangeFt[0]);
  const head = zonesOf(floors[0]?.id ?? "F1").map((z) => {
    const fl = twin.floors.find((f) => f.id === z.floor);
    const rest = fl && z.name.startsWith(fl.name) ? z.name.slice(fl.name.length).trim() : z.name;
    return capital(rest).replace(/-/g, "–");
  });
  const values = Object.values(counts);
  const total = values.reduce((s, v) => s + v.value, 0);
  const sources = values.map((v) => v.source);
  const sensorIds = [...new Set(sources.map((s) => s.split(" in ")[0]!))];
  const records = [...new Set(sources.map((s) => s.split(" in ")[1]).filter((r): r is string => !!r))];
  const sensors = estimate?.sensors ?? [];
  const healthy = sensors.filter((s) => s.status === "ok").length;
  const policy = current?.policy;
  const closed = policy?.closedRoutes ?? [];
  const hazardWord = HAZARD_WORDS[estimate?.hazard ?? "none"] ?? "Hazard";
  return (
    <section aria-labelledby="occ-h" className="rounded-xl border border-line bg-panel p-3 sm:p-4" data-testid="zone-matrix">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="occ-h" className="m-0 text-[14px] font-semibold">People observed by zone</h2>
        {values.length ? <span className="num text-ink-2">{int(total)} inside</span> : null}
        <span className="ml-auto flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-ink-3">
          {sensorIds.length ? <span>{sensorIds.every((s) => s.startsWith("DEN-")) && sensorIds.length > 1 ? `density sensors ${sensorIds[0]} to ${sensorIds.at(-1)}` : sensorIds.join(", ")}</span> : <span>no counts yet</span>}
          {records.length ? <span className="num">· record {records.join(", ")}</span> : null}
          {sensors.length ? (
            <>
              <span>·</span>
              <Pop align="end" trigger={<button type="button" className={cx("underline decoration-dotted underline-offset-2 hover:text-ink", healthy < sensors.length && "font-medium text-warn-ink")}>{healthy} of {sensors.length} sensors healthy</button>}>
                <div className="w-72 text-[12px]">
                  <div className="mb-2 text-[13px] font-semibold text-ink">Sensor health</div>
                  <div className="flex flex-wrap gap-1" data-testid="sensor-health">
                    {sensors.map((s) => (
                      <span key={s.id} title={`${s.kind} in ${s.zone}`} data-status={s.status} className={cx("num rounded border px-1 text-[10px]", s.status === "ok" ? "border-line-strong text-ink-2" : s.status === "silent" ? "border-warn-line bg-warn-bg text-warn-ink" : "border-danger-line bg-danger-bg text-danger-ink")}>
                        {s.id}{s.status !== "ok" ? ` ${s.status}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </Pop>
            </>
          ) : null}
        </span>
      </div>
      <div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))] gap-1.5 sm:grid-cols-[72px_repeat(3,minmax(0,1fr))]">
        <span />
        {head.map((h, i) => <span key={i} className="truncate px-1 text-[11px] text-ink-3 sm:text-[12px]" title={h}>{h}</span>)}
        {floors.map((f) => {
          const zs = zonesOf(f.id);
          const sum = zs.reduce((s, z) => s + (counts[z.id]?.value ?? 0), 0);
          return [
            <span key={`${f.id}-h`} className="flex flex-col justify-center font-semibold">
              {f.id}
              <span className="num text-[11px] font-normal text-ink-3">{int(sum)}<span className="hidden sm:inline"> people</span></span>
            </span>,
            ...zs.map((z) => {
              const c = counts[z.id];
              const warn = closedHere(z, closed, grid);
              const here = estimate?.zone === z.id && estimate.hazard !== "none";
              const hot = warn.length > 0 || here;
              return (
                <Tip key={z.id} label={c ? `${z.name}: ${c.value} people, source ${c.source}` : `${z.name}: no count`}>
                  <div className={cx("flex min-w-0 flex-col gap-1 rounded-lg border p-2 sm:px-3 sm:py-2.5", hot ? "border-danger-line bg-danger-bg" : "border-inset bg-hover")} data-zone={z.id} data-testid={`zone-${z.id}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[18px] leading-none font-medium sm:text-[22px]">{c ? int(c.value) : "–"}</span>
                      <span className="num text-[10px] text-ink-3 sm:text-[11px]">{z.id}</span>
                    </div>
                    {policy ? <div className="text-[11px] leading-snug text-ink-2 sm:text-[12px]">{routeLine(policy.zones.find((p) => p.zone === z.id))}</div> : null}
                    {warn.length ? <div className="text-[11px] font-medium text-danger-ink">{warn.join(", ")} closed on this floor</div> : null}
                    {here ? <div className="text-[11px] font-medium text-danger-ink">{hazardWord} reported here</div> : null}
                  </div>
                </Tip>
              );
            }),
          ];
        })}
      </div>
      <p className="mt-2.5 mb-0 text-[12px] text-ink-3">
        {current ? <>Routes from decision <span className="num">{current.id}</span>, {STATUS_WORDS[current.status]}.</> : <>No plan yet: routes appear when the planner proposes one.</>} Counts are sensor observations; hover a zone for its source.
      </p>
    </section>
  );
}
