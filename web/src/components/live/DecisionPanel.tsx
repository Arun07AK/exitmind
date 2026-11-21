import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { DecisionCard, LiveState, LogLine, Outcome } from "../../../../src/server/contract.ts";
import { postJSON } from "../../api.ts";
import { Badge, Button, Chip, cx, Tip } from "../ui.tsx";
import { clock, dec1, int, people, planSummary, PROTOCOL_WORDS, recordFor, tickSec } from "./format.ts";

const STATUS: Record<DecisionCard["status"], { text: string; cls: string }> = {
  verifying: { text: "verifier running", cls: "text-warn-ink" },
  pending: { text: "awaiting your approval", cls: "text-warn-ink" },
  approved: { text: "approved, signs updated", cls: "text-safe-ink" },
  overridden: { text: "approved over the verifier, signs updated", cls: "text-safe-ink" },
  rejected: { text: "rejected by the operator", cls: "text-ink-2" },
  timeout: { text: "not approved in time, signs held", cls: "text-warn-ink" },
  blocked: { text: "blocked by the gate", cls: "text-danger-ink" },
  superseded: { text: "superseded by a newer plan", cls: "text-ink-3" },
};

function Key({ tone, title, children }: { tone: "done" | "wait" | "fail" | "off"; title: ReactNode; children: ReactNode }) {
  return (
    <li className={cx("min-w-0 rounded-lg border px-2 py-2.5", tone === "done" ? "border-safe-line bg-safe-bg" : tone === "fail" ? "border-danger-line bg-danger-bg" : tone === "wait" ? "border-dashed border-[#c9cfd7] bg-panel" : "border-line bg-hover")}>
      <div className={cx("text-[11px] font-semibold", tone === "done" ? "text-safe-ink" : tone === "fail" ? "text-danger-ink" : tone === "wait" ? "text-warn-ink" : "text-ink-3")}>{title}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-ink">{children}</div>
    </li>
  );
}

function Row({ label, a, b, ra, rb }: { label: string; a: string; b: string; ra: string; rb: string }) {
  return (
    <tr className="border-t border-[#f1f2f4]">
      <th scope="row" className="py-1.5 pr-2 text-left font-normal">{label}</th>
      <td className="num py-1.5 text-right" title={`source ${ra}`}>{a}</td>
      <td className="num py-1.5 pl-3 text-right text-ink-3" title={`source ${rb}`}>{b}</td>
    </tr>
  );
}

function Forecast({ plan, none, targetSec }: { plan: Outcome; none: Outcome; targetSec: number | null }) {
  const smoke = plan.smokeExposurePS > 0 || none.smokeExposurePS > 0;
  return (
    <table className="w-full border-collapse text-[12px]" data-testid="forecast">
      <caption className="pb-1.5 text-left text-ink-2">Verifier forecast, modelled in the crowd simulator</caption>
      <thead>
        <tr className="text-ink-3">
          <th scope="col" className="py-1 text-left font-medium" />
          <th scope="col" className="py-1 text-right font-medium">This plan</th>
          <th scope="col" className="py-1 pl-3 text-right font-medium">Do nothing</th>
        </tr>
      </thead>
      <tbody>
        <Row label="95% out" a={clock(plan.clearance95Sec)} b={clock(none.clearance95Sec)} ra={plan.ref} rb={none.ref} />
        <Row label={targetSec !== null ? `Not out at ${clock(targetSec)} target` : "Not out at the target"} a={dec1(plan.remainingAtTarget)} b={dec1(none.remainingAtTarget)} ra={plan.ref} rb={none.ref} />
        <Row label="Person-seconds in dense crowd" a={int(plan.densityDangerPS)} b={int(none.densityDangerPS)} ra={plan.ref} rb={none.ref} />
        {smoke ? <Row label="Person-seconds in smoke" a={int(plan.smokeExposurePS)} b={int(none.smokeExposurePS)} ra={plan.ref} rb={none.ref} /> : null}
        <Row label="Gridlock" a={plan.gridlock ? "yes" : "none"} b={none.gridlock ? "yes" : "none"} ra={plan.ref} rb={none.ref} />
        <Row label="Badness score (lower is better)" a={int(plan.badness)} b={int(none.badness)} ra={plan.ref} rb={none.ref} />
      </tbody>
    </table>
  );
}

export function DecisionPanel({ live, log, kindOf, onRef }: { live: LiveState; log: readonly LogLine[]; kindOf: (id: string) => "exit" | "stair" | undefined; onRef: (id: string) => void }) {
  const c = live.current;
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(""); setErr(null); }, [c?.id]);
  if (!c) {
    return (
      <section className="rounded-xl border border-line bg-panel p-4" data-testid="decision-empty">
        <h2 className="m-0 text-[14px] font-semibold">Decision</h2>
        <p className="mt-1.5 mb-0 text-ink-2">No plan to decide. When the Sentinel confirms an incident, the planner proposes a plan, the verifier tests it and it waits here for your approval.</p>
        {live.history.length ? <p className="mt-2 mb-0 text-[12px] text-ink-3">Earlier: {live.history.slice(-6).map((h) => `${h.id} ${PROTOCOL_WORDS[h.protocol].toLowerCase()} (${h.status})`).join(", ")}</p> : null}
      </section>
    );
  }
  const v = c.verdict;
  const fail = v?.verdict === "FAIL";
  const blocking = fail && live.failMode === "block_with_override";
  const pending = c.status === "pending";
  const done = c.status === "approved" || c.status === "overridden";
  const dt = tickSec(live);
  const left = live.approvalDeadlineTick !== null ? live.approvalDeadlineTick - live.tick : null;
  const st = STATUS[c.status];
  const nSigns = c.signPreview.length;
  const human = recordFor(log, ["human.approved", "human.override", "human.rejected"], c.id);
  const gate = recordFor(log, ["gate.published"], c.id);
  const rolls = v?.reasons.map((r) => /(\d+) roll-forwards/.exec(r)?.[1]).find(Boolean);
  const target = v?.reasons.map((r) => /(\d+) s clearance target/.exec(r)?.[1]).find(Boolean);
  const worst = v?.worstCase.scenario ?? "";
  const worstText = worst.includes(": ") ? worst.slice(worst.indexOf(": ") + 2) : worst;
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
    <section aria-labelledby="dec-h" data-testid="decision" data-decision-id={c.id} data-protocol={c.protocol} data-status={c.status} data-verdict={v?.verdict ?? ""}
      className={cx("overflow-hidden rounded-xl border bg-panel", pending ? "border-ink shadow-[0_0_0_1px_#14171c]" : done ? "border-safe-line" : "border-line")}>
      <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-4 py-3", done ? "border-safe-line bg-safe-bg" : "border-line bg-panel")}>
        <h2 id="dec-h" className="m-0 text-[14px] font-semibold">Decision <span className="num">{c.id}</span></h2>
        <span className={cx("font-medium", st.cls)} data-testid="decision-status">{st.text}</span>
        {c.injected ? <Badge color="red">injected bad plan (demo)</Badge> : null}
        {pending && left !== null ? (
          <Tip label={`Approval window: ${Math.max(0, left)} ticks. On timeout the signs stay on the last approved or static state.`}>
            <span className="ml-auto inline-flex h-6 items-center gap-1 rounded-full border border-warn-line bg-warn-bg px-2.5 text-[12px] font-medium whitespace-nowrap text-warn-ink" data-testid="approval-countdown">
              <span className="num">{dt > 0 ? clock(Math.max(0, left) * dt) : `${Math.max(0, left)} ticks`}</span> left to approve
            </span>
          </Tip>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div>
          <div className="text-[22px] font-semibold tracking-[-0.01em]" data-testid="decision-protocol">{PROTOCOL_WORDS[c.protocol]}</div>
          <div className="mt-1 leading-normal text-ink-2">{planSummary(c.policy, kindOf).split(/([A-Z][A-Z0-9]*-[A-Z0-9@-]*[A-Z0-9])/).map((t, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{t}</span> : t))}</div>
        </div>
        <ol aria-label="Three-key gate" className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
          <Key tone="done" title="1 · PROPOSED">
            {c.rationaleSource === "llm" ? "Planner (LLM)" : c.rationaleSource === "playbook" ? "Planner, matches playbook" : "Planner default rule"}
          </Key>
          {!v ? (
            <Key tone="wait" title="2 · VERIFYING">Rolling the plan forward in the simulator</Key>
          ) : (
            <Key tone={fail ? "fail" : "done"} title={<>2 · VERIFIED · <span data-testid="verdict">{v.verdict}</span></>}>
              {rolls ? <><span className="num">{rolls}</span> roll-forwards </> : fail ? "Failed in simulation " : "Passed in simulation "}<Chip onClick={() => onRef(v.id)}>{v.id}</Chip>
            </Key>
          )}
          {pending ? (
            <Key tone="wait" title="3 · YOUR APPROVAL">{blocking ? "Needs a typed reason: the verifier failed this plan" : "Needed before any sign changes"}</Key>
          ) : done ? (
            <Key tone="done" title={c.status === "overridden" ? "3 · OVERRIDDEN" : "3 · APPROVED"}>by the operator{human && dt > 0 ? <> at <span className="num">{clock(human.tick * dt)}</span></> : null}</Key>
          ) : (
            <Key tone="off" title={c.status === "verifying" ? "3 · YOUR APPROVAL" : `3 · ${c.status.toUpperCase()}`}>{c.status === "verifying" ? "Asked once the verifier finishes" : st.text}</Key>
          )}
        </ol>
        {v ? (
          <>
            <Forecast plan={v.predicted} none={v.doNothing} targetSec={target ? Number(target) : null} />
            <div className="rounded-lg bg-hover px-3 py-2.5 text-[12px] leading-normal text-ink-2" title={`source ${v.worstCase.ref}`} data-testid="worst-case">
              Worst case tried: {worstText || "not described"}. {people(v.worstCase.remainingAtTarget)} not out at the target; {v.worstCase.clearance95Sec === null ? "95% out not reached in the run" : <>95% out at <span className="num">{clock(v.worstCase.clearance95Sec)}</span></>}{v.worstCase.gridlock ? "; gridlock" : ""}.
            </div>
            {v.reasons.length && fail ? (
              <ul className="m-0 list-disc space-y-0.5 rounded-lg border border-danger-line bg-danger-bg py-2 pr-3 pl-7 text-[12px] leading-normal text-danger-ink" data-testid="verdict-reasons">
                {v.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="m-0 rounded-lg border border-dashed border-warn-line bg-warn-bg px-3 py-2.5 text-[12px] text-warn-ink">The verifier is running this plan, a worst case and doing nothing against the simulation.</p>
        )}
        {pending ? (
          <div className="flex flex-col gap-2">
            {fail && !blocking ? <p className="m-0 text-[12px] text-danger-ink">The verifier failed this plan. Approval is allowed because the gate is in warn mode.</p> : null}
            {blocking ? (
              <label className="flex flex-col gap-1 text-[12px] text-danger-ink">
                The verifier failed this plan. Approval is blocked unless you type a reason; it is written to the event log.
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for overriding the verifier" className="w-full rounded-lg border border-danger-line bg-panel p-2 text-[13px] text-ink" data-testid="override-reason" />
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {blocking ? (
                <Button tone="danger" disabled={busy || !reason.trim()} onClick={() => void decide("approve", reason.trim())} className="h-11 flex-[1_1_220px] rounded-[10px] text-[14px] font-semibold" data-testid="override">{nSigns ? `Override and publish to ${nSigns} signs` : "Override with reason"}</Button>
              ) : (
                <Button tone="primary" disabled={busy} onClick={() => void decide("approve")} className="h-11 flex-[1_1_220px] rounded-[10px] text-[14px] font-semibold" data-testid="approve">{nSigns ? `Approve and publish to ${nSigns} signs` : "Approve"}</Button>
              )}
              <Button disabled={busy} onClick={() => void decide("reject")} className="h-11 flex-[0_1_120px] rounded-[10px] text-[14px]" data-testid="reject">Reject</Button>
            </div>
            {err ? <p className="m-0 text-[12px] text-danger-ink" role="alert">{err}</p> : null}
            <p className="m-0 text-[12px] leading-normal text-ink-3">If nobody approves within the window, signs keep their last approved or static state.{live.failMode === "block_with_override" ? " A failing verdict can only be approved with a typed reason." : ""}</p>
          </div>
        ) : null}
        {done ? (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-safe-line bg-safe-bg p-3 font-medium text-safe-ink" data-testid="decision-done">
            <Check size={18} strokeWidth={2.2} aria-hidden="true" className="flex-none" />
            <span>
              {c.status === "overridden" ? "Approved over the verifier" : "Approved"}{nSigns ? ` and published to ${nSigns} signs` : ""}.{" "}
              {gate ? <>The gate logged all three keys in <Chip onClick={() => onRef(gate.id)}>{gate.id}</Chip></> : "Waiting for the gate record."}
              {c.status === "overridden" && human ? <span className="block text-[12px] font-normal">Reason: {human.summary.slice(c.id.length).trim()}</span> : null}
            </span>
          </div>
        ) : null}
        {v && v.reasons.length && !fail ? (
          <details className="text-ink-2" data-testid="verdict-reasons">
            <summary className="cursor-pointer text-[12px] font-medium text-ink">Verifier notes ({v.reasons.length})</summary>
            <ul className="mt-2 mb-0 list-disc pl-4.5 text-[12px] leading-relaxed">{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        ) : null}
        {c.alternatives.length ? (
          <details className="text-ink-2" data-testid="alternatives">
            <summary className="cursor-pointer text-[12px] font-medium text-ink">{c.alternatives.length} alternative{c.alternatives.length === 1 ? "" : "s"} the planner rejected</summary>
            <ul className="mt-2 mb-0 list-disc pl-4.5 text-[12px] leading-relaxed">
              {c.alternatives.map((a, i) => (
                <li key={i}>
                  {PROTOCOL_WORDS[a.protocol]}: {a.reason}
                  {a.predicted ? <span className="num text-ink-3" title={`source ${a.predicted.ref}`}> (badness {int(a.predicted.badness)}, 95% out at {clock(a.predicted.clearance95Sec)})</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="text-[12px] leading-normal text-ink-3" data-testid="rationale">
          Planner rationale{c.rationaleSource === "llm" ? "" : c.rationaleSource === "playbook" ? " (from the playbook)" : " (default rule)"}, quoted: “{c.rationale}”
          {c.playbookMatch ? <span className="ml-1 whitespace-nowrap"><Chip onClick={() => onRef(c.playbookMatch!)}>{c.playbookMatch}</Chip></span> : null}
        </div>
        {live.history.length ? <div className="border-t border-line pt-2 text-[11px] text-ink-3">Earlier decisions: {live.history.slice(-6).map((h) => `${h.id} ${PROTOCOL_WORDS[h.protocol].toLowerCase()} (${STATUS[h.status].text})`).join("; ")}</div> : null}
      </div>
    </section>
  );
}
