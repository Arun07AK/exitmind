import type { EventLog, EventRecord } from "../log/eventlog.ts";
import type { Model } from "../sim/model.ts";
import type { RoutePolicy, SignState } from "../sim/types.ts";
import type { RouteView } from "../design/protocols.ts";
import { compileSigns, SignCompileError, validateSignSafety } from "./signcompiler.ts";

export type FailMode = "block_with_override" | "warn";

export interface PublishedPayload {
  decisionId: string;
  protocol: string;
  policy: RoutePolicy;
  signs: Record<string, SignState>;
  signsAfter: Record<string, SignState>;
  switchSec: Record<string, number>;
  verdict: "PASS" | "FAIL";
  overridden: boolean;
}

export class GateError extends Error {}

function one(log: EventLog, type: EventRecord["type"], pred: (r: EventRecord) => boolean): EventRecord | undefined {
  return log.query({ type }).filter(pred).at(-1);
}

const dec = (r: EventRecord): string | undefined => (r.payload as { decisionId?: string } | null)?.decisionId;

/** The only code path that can create a published sign plan. It checks the three keys in the log itself. */
export function publish(log: EventLog, tick: number, decisionId: string, failMode: FailMode, model: Model, rv: RouteView): EventRecord {
  const reject = (reason: string): never => {
    log.append({ tick, actor: "gate", type: "gate.rejected", payload: { decisionId, reason } });
    throw new GateError(reason);
  };
  const proposal = one(log, "planner.proposed", (r) => dec(r) === decisionId) ?? reject("no logged agent decision (planner.proposed)");
  const verdict = one(log, "verifier.verdict", (r) => dec(r) === decisionId && r.refs.includes(proposal.id)) ?? reject("no logged verifier verdict for this decision");
  const approval = one(log, "human.approved", (r) => dec(r) === decisionId && r.refs.includes(verdict.id)) ?? reject("no logged human approval for this decision");
  const v = (verdict.payload as { verdict: "PASS" | "FAIL" }).verdict;
  const override = one(log, "human.override", (r) => dec(r) === decisionId && r.refs.includes(verdict.id));
  if (v === "FAIL" && failMode === "block_with_override") {
    const reason = (override?.payload as { reason?: string } | undefined)?.reason?.trim();
    if (!override || !reason) reject("verifier verdict is FAIL and no human override with a reason is logged (gate.failMode = block_with_override)");
  }
  const policy = (proposal.payload as { policy: RoutePolicy }).policy;
  let signs: Record<string, SignState>, signsAfter: Record<string, SignState>;
  try {
    signs = compileSigns(model, { policy, rv, elapsedSec: 0 });
    signsAfter = compileSigns(model, { policy, rv, elapsedSec: 1e9 });
  } catch (e) {
    return reject(e instanceof SignCompileError ? `sign plan does not compile: ${e.message}` : String(e));
  }
  const switchSec: Record<string, number> = {};
  for (const mt of model.mounts) {
    const z = mt.zone >= 0 ? policy.zones.find((x) => x.zone === model.zones[mt.zone]!.id) : undefined;
    if (z && z.delaySec > 0 && z.instruction === "EVACUATE_VIA") switchSec[mt.id] = z.delaySec;
  }
  const problems = [...validateSignSafety(signs, model, rv), ...validateSignSafety(signsAfter, model, rv)];
  if (problems.length) reject(`sign safety: ${problems.join("; ")}`);
  const payload: PublishedPayload = { decisionId, protocol: (proposal.payload as { protocol: string }).protocol, policy, signs, signsAfter, switchSec, verdict: v, overridden: !!override };
  return log.append({ tick, actor: "gate", type: "gate.published", payload, refs: [proposal.id, verdict.id, approval.id, ...(override ? [override.id] : [])] });
}

export function approvedStateFor(model: Model, published: EventRecord | null, mount: string, tick: number, dt: number): { state: SignState | null; ref: string | null } {
  if (!published) return { state: null, ref: null };
  const p = published.payload as PublishedPayload;
  const elapsed = (tick - published.tick) * dt;
  const sw = p.switchSec[mount];
  const s = sw !== undefined && elapsed >= sw ? p.signsAfter[mount] : p.signs[mount];
  void model;
  return s ? { state: s, ref: published.id } : { state: null, ref: null };
}
