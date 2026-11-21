import { Activity, CircleCheck, Flame, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { IncidentState, LiveState, LogLine } from "../../../../src/server/contract.ts";
import type { Twin } from "../../../../src/twin/schema.ts";
import { postJSON } from "../../api.ts";
import { Button, cx, Tip } from "../ui.tsx";
import { capital, clock, firstSignalTick, HAZARD_WORDS, STEP_WORDS, STEPS, tickSec } from "./format.ts";

const TONE: Record<IncidentState, { band: string; icon: string; title: string; pill: string }> = {
  NORMAL: { band: "bg-panel border-line", icon: "bg-inset text-ink-2", title: "text-ink", pill: "bg-ink text-white" },
  SUSPECTED: { band: "bg-warn-bg border-warn-line", icon: "bg-warn text-white", title: "text-warn-ink", pill: "bg-warn-ink text-white" },
  CONFIRMED: { band: "bg-danger-bg border-danger-line", icon: "bg-danger-strong text-white", title: "text-danger-ink", pill: "bg-danger-strong text-white" },
  RESPONDING: { band: "bg-danger-bg border-danger-line", icon: "bg-danger-strong text-white", title: "text-danger-ink", pill: "bg-danger-strong text-white" },
  ALL_CLEAR: { band: "bg-safe-bg border-safe-line", icon: "bg-safe-ink text-white", title: "text-safe-ink", pill: "bg-safe-ink text-white" },
};

function title(live: LiveState): string {
  const hz = HAZARD_WORDS[live.estimate?.hazard ?? "none"] ?? live.estimate?.hazard ?? "Hazard";
  switch (live.incident) {
    case "NORMAL": return "Normal operation";
    case "SUSPECTED": return `${hz} suspected`;
    case "CONFIRMED": return `${hz} confirmed`;
    case "RESPONDING": return `${hz}: response under way`;
    case "ALL_CLEAR": return "All clear";
  }
}

export function IncidentBanner({ live, log, twin }: { live: LiveState; log: readonly LogLine[]; twin: Twin | null }) {
  const tone = TONE[live.incident];
  const e = live.estimate;
  const at = STEPS.indexOf(live.incident);
  const first = live.incident === "NORMAL" ? null : firstSignalTick(log);
  const dt = tickSec(live);
  const zone = e?.zone ? twin?.zones.find((z) => z.id === e.zone) : undefined;
  const Icon = live.incident === "ALL_CLEAR" ? CircleCheck : e?.hazard === "fire" ? Flame : live.incident === "NORMAL" ? Activity : live.incident === "SUSPECTED" ? TriangleAlert : Activity;
  return (
    <section aria-label="Incident" className={cx("flex flex-none flex-wrap items-center gap-x-8 gap-y-3 border-b px-4 py-4 md:px-6", tone.band)}>
      <div className="flex min-w-0 flex-[1_1_520px] items-center gap-3.5">
        <span className={cx("grid h-10 w-10 flex-none place-items-center rounded-[10px]", tone.icon)}><Icon size={20} strokeWidth={2} aria-hidden="true" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span className={cx("text-[20px] font-semibold tracking-[0.01em]", tone.title)}>{title(live)}</span>
            {e && e.zone ? <span className="text-[13px] text-ink-2"><span className="num">{e.zone}</span>{zone ? ` · ${zone.name}` : ""}</span> : null}
            {e ? (
              <Tip label={`Sentinel estimate ${e.id}`}>
                <span className={cx("num text-[13px]", live.incident === "NORMAL" ? "text-ink-2" : tone.title)}>Sentinel confidence {Math.round(e.confidence * 100)}%</span>
              </Tip>
            ) : null}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-2">{e ? (e.reasons.length ? e.reasons.map(capital).join(" · ") : "No reasons given") : "Waiting for the first Sentinel estimate"}</div>
        </div>
      </div>
      <ol aria-label="Incident state" className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-[12px]" data-testid="incident-state" data-state={live.incident}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true" className="h-px w-3 bg-line-strong sm:w-4" /> : null}
            {i === at ? (
              <span aria-current="step" className={cx("inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 font-semibold", tone.pill)}>
                <span className="h-2 w-2 rounded-full bg-white" />{STEP_WORDS[s]}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-ink-3" title={STEP_WORDS[s]}>
                <span className={cx("box-border h-2 w-2 rounded-full", i < at ? "bg-idle" : "border-[1.5px] border-idle")} /><span className="hidden sm:inline">{STEP_WORDS[s]}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="num text-[13px] text-ink-2">
        {first !== null && dt > 0 ? <>{clock((live.tick - first) * dt)} since the first signal</> : <>session time {clock(live.t)}</>}
      </div>
    </section>
  );
}

const CONTROLS = [
  { action: "start_fire", label: "Start fire", tone: "danger" },
  { action: "start_quake", label: "Start earthquake", tone: "warn" },
  { action: "inject_bad_plan", label: "Inject bad plan", tone: "default" },
  { action: "restore_sensors", label: "Restore sensors", tone: "default" },
  { action: "all_clear", label: "All clear", tone: "ok" },
  { action: "reset", label: "Reset", tone: "ghost" },
] as const;

async function control(action: string, sensor?: string): Promise<string | null> {
  try {
    const r = await postJSON<{ ok?: boolean; error?: string; reason?: string }>("/api/live/control", sensor ? { action, sensor } : { action });
    return r.ok === false ? (r.error ?? r.reason ?? "rejected") : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function DemoStrip({ live }: { live: LiveState | null }) {
  const [sensor, setSensor] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const sensors = live?.estimate?.sensors ?? [];
  const run = async (action: string, s?: string) => {
    setMsg(null);
    const err = await control(action, s);
    setMsg(err ? `${action.replace(/_/g, " ")}: ${err}` : null);
  };
  const small = "h-7 rounded-md px-2.5 text-[12px]";
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#f3e3be] bg-[#fffbf2] px-4 py-2 text-[12px] text-warn-ink md:px-6" data-testid="demo-controls">
      <div className="min-w-0 flex-[1_1_360px]">
        <span className="font-semibold">Demo feed.</span> Building, sensors and phones are simulated. EXITMIND never contacts an emergency service, phone number or SMS gateway.
        {live?.offline ? <span className="ml-1.5 inline-flex h-5 items-center rounded-full border border-warn-line bg-panel px-1.5 align-middle text-[11px]">offline: no LLM calls</span> : null}
      </div>
      <div role="toolbar" aria-label="Demo controls" className="flex flex-wrap items-center gap-1.5">
        {CONTROLS.map((c) => (
          <Button key={c.action} tone={c.tone} className={small} onClick={() => void run(c.action)} data-testid={`ctl-${c.action}`}>{c.label}</Button>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-warn-line" />
        <select value={sensor} onChange={(e) => setSensor(e.target.value)} aria-label="Sensor to fail" className="h-7 max-w-44 rounded-md border border-line-strong bg-panel px-1.5 text-[12px] text-ink" data-testid="sensor-select">
          <option value="">Choose a sensor</option>
          {sensors.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.kind}, {s.zone}){s.status !== "ok" ? ` · ${s.status}` : ""}</option>)}
        </select>
        <Button className={small} onClick={() => void run("fail_sensor", sensor)} disabled={!sensor} data-testid="ctl-fail_sensor">Fail sensor</Button>
      </div>
      {msg ? <div className="w-full text-danger-ink" role="alert">{msg}</div> : null}
    </div>
  );
}
