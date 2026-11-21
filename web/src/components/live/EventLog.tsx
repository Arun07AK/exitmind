import { useState } from "react";
import type { LogLine } from "../../../../src/server/contract.ts";
import { Button, cx, Segmented, Sheet } from "../ui.tsx";
import { clock, keyEvents, logText } from "./format.ts";

function Line({ l, dt, active, wide }: { l: LogLine; dt: number; active: boolean; wide?: boolean }) {
  return (
    <div className={cx("num grid gap-x-3 border-t border-[#f1f2f4] px-4 py-2 text-[12px]", wide ? "grid-cols-[72px_48px_92px_minmax(0,1fr)]" : "grid-cols-[64px_40px_minmax(0,1fr)] sm:grid-cols-[76px_56px_110px_minmax(0,1fr)]", active && "bg-inset")} data-record={l.id} title={`${l.type}: ${l.summary}`}>
      <span className="text-ink-3">{l.id}</span>
      <span className="text-ink-3">{dt > 0 ? clock(l.tick * dt) : `t${l.tick}`}</span>
      <span className={cx("truncate", wide ? "" : "hidden sm:block")}>{l.actor}</span>
      <span className="truncate font-sans text-ink-2"><span className={cx(wide ? "hidden" : "sm:hidden", "text-ink")}>{l.actor} · </span>{logText(l, dt)}</span>
    </div>
  );
}

export function EventLog({ log, dt, active }: { log: readonly LogLine[]; dt: number; active: string | null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"key" | "all">("key");
  const key = keyEvents(log);
  const tail = key.slice(-8);
  const hit = active ? log.find((l) => l.id === active) : null;
  const sheetLines = (mode === "key" ? key : log).slice().reverse();
  return (
    <section aria-labelledby="log-h" className="overflow-hidden rounded-xl border border-line bg-panel" data-testid="log-tail">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line px-4 py-3">
        <h2 id="log-h" className="m-0 text-[14px] font-semibold">Event log</h2>
        <span className="text-[12px] text-ink-3">append-only, hash-chained, replayable · {log.length} recent records</span>
        <Button className="ml-auto h-7 rounded-md px-2.5 text-[12px]" onClick={() => setOpen(true)} data-testid="log-open">Open full log</Button>
      </div>
      {active ? (
        <div className="border-b border-line bg-inset px-4 py-2 text-[12px] text-ink" data-testid="log-active">
          {hit ? <>Record <span className="num">{active}</span>: {hit.type} by {hit.actor} at <span className="num">{dt > 0 ? clock(hit.tick * dt) : `tick ${hit.tick}`}</span>: {logText(hit, dt)}</> : <>Record <span className="num">{active}</span> is not in the recent tail.</>}
        </div>
      ) : null}
      {tail.length ? tail.map((l) => <Line key={l.seq} l={l} dt={dt} active={l.id === active} />) : <div className="px-4 py-3 text-[12px] text-ink-3">No records yet.</div>}
      <Sheet open={open} onOpenChange={setOpen} title="Event log" description="Newest first. Sensor batches and sign deliveries are left out." width={640} testId="log-sheet">
        <Segmented label="Records" size="sm" value={mode} onChange={setMode} options={[{ value: "key", label: "Key events" }, { value: "all", label: "Everything" }]} className="mb-3" />
        <div className="-mx-5 border-b border-[#f1f2f4]">
          {sheetLines.map((l) => <Line key={l.seq} l={l} dt={dt} active={l.id === active} wide />)}
        </div>
      </Sheet>
    </section>
  );
}
