import { useEffect, useMemo, useState } from "react";
import type { DecisionCard, IncidentState, LiveState, LogLine, SignInfo } from "../../../src/server/contract.ts";
import { getJSON, postJSON } from "../api.ts";
import { Metric } from "../components/Metric.tsx";
import { OutcomeTable } from "../components/Outcome.tsx";
import { Badge, Button, Card, Chip, cx, Empty } from "../components/ui.tsx";
import { SIGN_COLORS, signText } from "../lib/colors.ts";
import { useStore } from "../store.ts";
import { FrameStatus, SyncedViews } from "../views/SyncedViews.tsx";

const INCIDENT_COLOR: Record<IncidentState, string> = { NORMAL: "green", SUSPECTED: "amber", CONFIRMED: "red", RESPONDING: "violet", ALL_CLEAR: "sky" };
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

function DemoControls({ live }: { live: LiveState | null }) {
  const [sensor, setSensor] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const sensors = live?.estimate?.sensors ?? [];
  const run = async (action: string, s?: string) => {
    setMsg(null);
    const err = await control(action, s);
    setMsg(err ? `${action}: ${err}` : null);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2" data-testid="demo-controls">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">demo</span>
      {CONTROLS.map((c) => (
        <Button key={c.action} tone={c.tone} onClick={() => void run(c.action)} data-testid={`ctl-${c.action}`}>{c.label}</Button>
      ))}
      <span className="mx-1 h-5 w-px bg-slate-700" />
      <select value={sensor} onChange={(e) => setSensor(e.target.value)} className="rounded bg-slate-800 px-2 py-1 text-sm" data-testid="sensor-select">
        <option value="">choose sensor</option>
        {sensors.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.kind}, {s.zone})</option>)}
      </select>
      <Button onClick={() => void run("fail_sensor", sensor)} disabled={!sensor} data-testid="ctl-fail_sensor">Fail a sensor</Button>
      {msg ? <span className="text-xs text-red-400">{msg}</span> : null}
    </div>
  );
}

function Sentinel({ live }: { live: LiveState }) {
  const e = live.estimate;
  return (
    <Card title="Sentinel" testId="sentinel">
      {!e ? <p className="text-xs text-slate-500">No estimate yet.</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{e.hazard}{e.zone ? ` in ${e.zone}` : ""}</span>
            <span className="font-mono" title={`source: estimate ${e.id}`}>confidence {Math.round(e.confidence * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-800" data-testid="confidence-bar" data-confidence={e.confidence}>
            <div className={cx("h-full", e.confidence >= 0.6 ? "bg-red-500" : e.confidence >= 0.3 ? "bg-amber-500" : "bg-sky-500")} style={{ width: `${Math.round(e.confidence * 100)}%` }} />
          </div>
          {e.reasons.length ? <ul className="list-disc pl-4 text-xs text-slate-300">{e.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
          <div className="flex flex-wrap gap-1" data-testid="sensor-health">
            {e.sensors.map((s) => (
              <span key={s.id} title={`${s.kind} in ${s.zone}`} className={cx("rounded border px-1 font-mono text-[10px]", s.status === "ok" ? "border-slate-700 text-slate-400" : s.status === "silent" ? "border-amber-500 bg-amber-950 text-amber-300" : "border-red-500 bg-red-950 text-red-300")} data-status={s.status}>
                {s.id} {s.status !== "ok" ? s.status : ""}
              </span>
            ))}
          </div>
          {Object.keys(e.countsByZone).length ? (
            <div className="flex flex-wrap gap-1">
              {Object.entries(e.countsByZone).map(([z, v]) => <Metric key={z} label={`people in ${z}`} value={v.value} source={v.source} digits={0} />)}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Decision({ live, onRef }: { live: LiveState; onRef: (id: string) => void }) {
  const c: DecisionCard | null = live.current;
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(""); setErr(null); }, [c?.id]);
  if (!c) return <Card title="Decision" testId="decision-empty"><p className="text-xs text-slate-500">No decision pending. Start a demo incident.</p></Card>;
  const v = c.verdict;
  const fail = v?.verdict === "FAIL";
  const blocking = fail && live.failMode === "block_with_override";
  const pending = c.status === "pending";
  const dt = live.tick > 0 ? live.t / live.tick : 0;
  const left = live.approvalDeadlineTick !== null ? live.approvalDeadlineTick - live.tick : null;
  const decide = async (verdict: "approve" | "reject", why?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await postJSON<{ ok?: boolean; error?: string; reason?: string }>("/api/live/decision", { id: c.id, verdict, ...(why ? { reason: why } : {}) });
      if (r.ok === false) setErr(r.error ?? r.reason ?? "rejected by the gate");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Decision" testId="decision-card">
      <div data-testid="decision" data-decision-id={c.id} data-protocol={c.protocol} data-status={c.status} data-verdict={v?.verdict ?? ""} className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold text-white" data-testid="decision-protocol">{c.protocol.replace(/_/g, " ")}</span>
          <Badge color={pending ? "amber" : c.status === "approved" || c.status === "overridden" ? "green" : "slate"} testId="decision-status">{c.status}</Badge>
          {c.injected ? <Badge color="red">injected for demo</Badge> : null}
          <span className="ml-auto font-mono text-[10px] text-slate-500">{c.id} · tick {c.createdTick}</span>
        </div>
        <div>
          <div className="text-xs text-slate-400">rationale <Badge color={c.rationaleSource === "llm" ? "violet" : c.rationaleSource === "playbook" ? "sky" : "slate"}>{c.rationaleSource}</Badge>{c.playbookMatch ? <span className="ml-1">playbook match <Chip onClick={() => onRef(c.playbookMatch!)}>{c.playbookMatch}</Chip></span> : null}</div>
          <p className="mt-1 text-slate-200">{c.rationale}</p>
        </div>
        {c.status === "verifying" || !v ? <p className="text-xs text-amber-300">Verifier is running the plan against the simulation.</p> : (
          <div className="rounded border border-slate-800 p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs text-slate-400">verifier verdict</span>
              <Badge color={fail ? "red" : "green"} testId="verdict">{v.verdict}</Badge>
              <Chip onClick={() => onRef(v.id)}>{v.id}</Chip>
            </div>
            {v.reasons.length ? <ul className="mb-2 list-disc pl-4 text-xs text-slate-300">{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
            <OutcomeTable onRef={onRef} columns={[{ title: "forecast for this plan", outcome: v.predicted }, { title: "worst case", outcome: v.worstCase, extra: v.worstCase.scenario }, { title: "do nothing", outcome: v.doNothing }]} />
          </div>
        )}
        {c.alternatives.length ? (
          <div>
            <div className="text-xs text-slate-400">rejected alternatives</div>
            <ul className="mt-1 space-y-1 text-xs">
              {c.alternatives.map((a, i) => (
                <li key={i} className="rounded border border-slate-800 p-1.5">
                  <span className="font-medium text-slate-200">{a.protocol.replace(/_/g, " ")}</span>: {a.reason}
                  {a.predicted ? <span className="ml-1 font-mono text-slate-400" title={`source: ${a.predicted.ref}`}>(badness {a.predicted.badness}, 95% clearance {a.predicted.clearance95Sec ?? "not reached"}{a.predicted.clearance95Sec !== null ? " s" : ""})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {c.signPreview.length ? (
          <div>
            <div className="text-xs text-slate-400">sign preview</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.signPreview.map((s) => (
                <span key={s.mount} className="rounded px-1.5 py-0.5 font-mono text-[10px] text-white" style={{ background: SIGN_COLORS[s.state.kind] }} data-testid="sign-preview" data-mount={s.mount} data-kind={s.state.kind}>
                  {s.mount}: {signText(s.state)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {pending ? (
          <div className="space-y-2 border-t border-slate-800 pt-2">
            {left !== null ? (
              <div className="text-xs text-amber-300" data-testid="approval-countdown">
                approval window: {Math.max(0, left)} ticks{dt > 0 ? ` (${Math.max(0, Math.round(left * dt))} s simulated)` : ""}; on timeout signs stay on the last approved or static state
              </div>
            ) : null}
            {fail && !blocking ? <p className="text-xs text-red-300">The verifier failed this plan. Approval is allowed in warn mode.</p> : null}
            {blocking ? (
              <div className="space-y-1">
                <p className="text-xs text-red-300">The verifier failed this plan. Approval is blocked unless you give a reason.</p>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for overriding the verifier" className="w-full rounded border border-red-800 bg-slate-950 p-2 text-sm" data-testid="override-reason" />
              </div>
            ) : null}
            <div className="flex gap-2">
              {blocking ? (
                <Button tone="danger" disabled={busy || !reason.trim()} onClick={() => void decide("approve", reason.trim())} data-testid="override">Override with reason</Button>
              ) : (
                <Button tone="ok" disabled={busy} onClick={() => void decide("approve")} data-testid="approve">Approve</Button>
              )}
              <Button tone="ghost" disabled={busy} onClick={() => void decide("reject")} data-testid="reject">Reject</Button>
            </div>
            {err ? <p className="text-xs text-red-400">{err}</p> : null}
          </div>
        ) : null}
        {live.history.length ? <div className="text-[10px] text-slate-500">{live.history.length} earlier decisions: {live.history.slice(-6).map((h) => `${h.protocol} (${h.status})`).join(", ")}</div> : null}
      </div>
    </Card>
  );
}

function SignRow({ s }: { s: SignInfo }) {
  const [big, setBig] = useState(false);
  const qr = `/api/signs/qr?mount=${encodeURIComponent(s.mount)}`;
  return (
    <li className="flex items-center gap-2 border-b border-slate-800/60 py-1.5" data-testid={`sign-row-${s.mount}`} data-online={String(s.online)} data-phones={s.phones}>
      <button type="button" onClick={() => setBig((b) => !b)} className="shrink-0 rounded bg-white p-0.5" title="show QR code">
        <img src={qr} alt={`QR code for ${s.mount}`} loading="lazy" className={big ? "h-40 w-40" : "h-10 w-10"} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-slate-200">{s.mount}</span>
          <span className="text-slate-500">{s.floor}</span>
          <Badge color={s.online ? "green" : "slate"}>{s.online ? "online" : "offline"}</Badge>
          <span className="text-slate-500">{s.phones} phone{s.phones === 1 ? "" : "s"}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px]">
          <span className="rounded px-1 text-white" style={{ background: SIGN_COLORS[s.state.kind] }}>{signText(s.state)}</span>
          {s.approvedRef ? <span className="font-mono text-slate-500">approved {s.approvedRef}</span> : <span className="text-slate-500">no approved plan</span>}
        </div>
      </div>
      <a href={`/sign?mount=${encodeURIComponent(s.mount)}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-sky-400 hover:underline" title={s.url}>open</a>
    </li>
  );
}

function Brief({ live, onRef, active }: { live: LiveState; onRef: (id: string) => void; active: string | null }) {
  const b = live.brief;
  return (
    <Card title="Responder brief" testId="brief">
      <p className="mb-2 rounded border border-amber-700 bg-amber-950/50 p-2 text-sm font-semibold text-amber-200" data-testid="no-contact">A human calls 112. EXITMIND never contacts anyone.</p>
      {!b ? <p className="text-xs text-slate-500">No brief yet.</p> : (
        <>
          <p className="mb-2 rounded border border-sky-700 bg-sky-950/50 p-2 text-sm font-medium text-sky-100" data-testid="brief-notice">{b.notice}</p>
          <ul className="space-y-1 text-sm">
            {b.lines.map((l, i) => (
              <li key={i} className="text-slate-200" data-testid="brief-line">
                {l.text} <span className="whitespace-nowrap">{l.refs.map((r) => <Chip key={r} active={active === r} onClick={() => onRef(r)}>{r}</Chip>)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-slate-500">{b.id} · tick {b.createdTick} · {b.source}</div>
        </>
      )}
    </Card>
  );
}

function LogTail({ log, active }: { log: LogLine[]; active: string | null }) {
  const lines = log.slice(-80).reverse();
  const hit = active ? log.find((l) => l.id === active) : null;
  return (
    <Card title="Event log" testId="log-tail">
      {active ? <div className="mb-1 text-xs text-sky-300">{hit ? `record ${active}: ${hit.type} by ${hit.actor} at tick ${hit.tick}: ${hit.summary}` : `record ${active} is not in the recent tail`}</div> : null}
      <div className="max-h-64 overflow-auto font-mono text-[11px]">
        {lines.map((l) => (
          <div key={l.seq} className={cx("flex gap-2 border-b border-slate-900 py-0.5", l.id === active && "bg-sky-950")}>
            <span className="w-12 shrink-0 text-slate-500">{l.seq}</span>
            <span className="w-12 shrink-0 text-slate-500">t{l.tick}</span>
            <span className="w-24 shrink-0 truncate text-slate-400">{l.actor}</span>
            <span className="w-40 shrink-0 truncate text-sky-300">{l.type}</span>
            <span className="truncate text-slate-300">{l.summary}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Live() {
  const live = useStore((s) => s.live);
  const log = useStore((s) => s.log);
  const setLive = useStore((s) => s.setLive);
  const addLog = useStore((s) => s.addLog);
  const clearLog = useStore((s) => s.clearLog);
  const setChannel = useStore((s) => s.setChannel);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

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

  const signs = useMemo(() => [...(live?.signs ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.mount.localeCompare(b.mount)), [live?.signs]);
  const toggle = (id: string) => setActive((a) => (a === id ? null : id));

  return (
    <div className="grid h-full min-h-0 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_30rem]" data-testid="live-page">
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <DemoControls live={live} />
        {live?.holdReason ? <div className="rounded-lg border border-amber-600 bg-amber-950/60 p-2 text-sm text-amber-200" data-testid="hold-banner">Signs are held at the last approved or static state: {live.holdReason}</div> : null}
        <FrameStatus />
        <SyncedViews className="min-h-[26rem] flex-1" />
        <LogTail log={log} active={active} />
      </div>
      <div className="min-h-0 space-y-3 overflow-auto pr-1">
        {error && !live ? <Empty>Live state unavailable: {error}</Empty> : null}
        {live ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2">
              <span className="text-xs text-slate-400">incident</span>
              <Badge color={INCIDENT_COLOR[live.incident]} className="px-2 py-1 text-sm" testId="incident-state" data-state={live.incident}>{live.incident.replace("_", " ")}</Badge>
              <span className="text-xs text-slate-500">tick {live.tick} · {live.t} s · session {live.sessionId}</span>
              {live.offline ? <Badge color="amber">offline</Badge> : null}
              <span className="ml-auto text-[10px] text-slate-500">gate mode: {live.failMode.replace(/_/g, " ")}</span>
            </div>
            <Sentinel live={live} />
            <Decision live={live} onRef={toggle} />
            <Card title={`Signs (${signs.filter((s) => s.online).length} online of ${signs.length})`} testId="sign-list">
              <ul className="max-h-80 overflow-auto">{signs.map((s) => <SignRow key={s.mount} s={s} />)}</ul>
            </Card>
            <Brief live={live} onRef={toggle} active={active} />
          </>
        ) : null}
      </div>
    </div>
  );
}
