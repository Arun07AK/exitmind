import { z } from "zod";
import type { ClaudeLike } from "../llm/claude.ts";
import { env } from "../shared/env.ts";
import type { Params } from "../shared/params.ts";
import { protocolPolicy } from "../design/protocols.ts";
import type { Model } from "../sim/model.ts";
import type { Profiles } from "../sim/population.ts";
import type { ProfileId, Protocol, RoutePolicy } from "../sim/types.ts";
import type { Estimate, PlaybookEntry } from "../server/contract.ts";
import { damagedFromEstimate } from "./sentinel.ts";
import { estimateHazard } from "./verifier.ts";

export interface Candidate {
  id: string;
  protocol: Protocol;
  policy: RoutePolicy;
  summary: string;
}
export interface Proposal {
  protocol: Protocol;
  policy: RoutePolicy;
  rationale: string;
  rationaleSource: "llm" | "playbook" | "default";
  playbookMatch: string | null;
  alternatives: { protocol: Protocol; reason: string }[];
  candidateId: string;
}

const DESCRIBE: Record<Protocol, string> = {
  EVACUATE: "everyone leaves now by the nearest route; route costs include smoke and damage",
  PHASED_EVACUATION: "the hazard floor leaves first; other floors hold and follow in timed phases",
  HOLD_THEN_EVACUATE: "everyone holds in place briefly, then leaves by undamaged routes",
  LOCKDOWN_SHELTER: "everyone goes into lockable rooms and stays out of sight",
  HORIZONTAL_EVACUATION: "people in the hazard zone move to the next zone on the same floor; others stay in place",
  INFLOW_CONTROL: "entrances are closed to arrivals; people leave by the nearest safe route",
};

export function candidates(m: Model, e: Estimate, hp: Params, elapsedSec: number, profile: ProfileId, profiles: Profiles): Candidate[] {
  const hazard = estimateHazard(m, e, elapsedSec);
  const closed = damagedFromEstimate(e);
  type V = { protocol: Protocol; avoid?: boolean };
  const list: V[] = e.hazard === "quake" ? [{ protocol: "HOLD_THEN_EVACUATE" }, { protocol: "EVACUATE" }, { protocol: "PHASED_EVACUATION" }]
    : e.hazard === "threat" ? [{ protocol: "LOCKDOWN_SHELTER" }, { protocol: "EVACUATE" }]
    : e.hazard === "medical" || e.hazard === "crush" ? [{ protocol: "INFLOW_CONTROL" }, { protocol: "PHASED_EVACUATION" }, { protocol: "EVACUATE" }]
    : [{ protocol: "EVACUATE" }, { protocol: "EVACUATE", avoid: true }, { protocol: "PHASED_EVACUATION" }, { protocol: "HOLD_THEN_EVACUATE" }];
  const def = profiles[profile].defaultProtocol;
  if (!list.some((v) => v.protocol === def)) list.unshift({ protocol: def });
  return list.map((v, i) => ({
    id: `C${i + 1}`, protocol: v.protocol, summary: v.avoid ? "everyone leaves now, keeping away from every route in the hazard zone" : DESCRIBE[v.protocol],
    policy: protocolPolicy(m, v.protocol, hazard, hp, { atSec: Math.max(0, elapsedSec), closed, avoidHazardZone: !!v.avoid }),
  }));
}

export function matchPlaybook(book: readonly PlaybookEntry[], e: Estimate, profile: ProfileId): PlaybookEntry | null {
  const blocked = damagedFromEstimate(e).sort();
  const same = book.filter((b) => b.situation.hazard === e.hazard && b.situation.profile === profile && (e.zone === null || b.situation.zone === e.zone));
  return same.find((b) => JSON.stringify([...b.situation.blocked].sort()) === JSON.stringify(blocked))
    ?? same.find((b) => blocked.every((x) => b.situation.blocked.includes(x)))
    ?? null;
}

const PLANNER_SYSTEM = [
  "You are the Planner agent of EXITMIND, decision support for a venue operator during a simulated building incident.",
  "Choose exactly one candidate protocol. Every choice is checked by a simulation Verifier and must be approved by a human before anything reaches occupants.",
  "Prefer a verified playbook response when one matches. Never invent routes; you can only choose among the candidates.",
  "Write the rationale for the operator (not the public) in at most 60 words, citing the estimate's evidence. Give one short reason for each rejected candidate.",
].join(" ");

export async function plan(opts: {
  claude: ClaudeLike; model: Model; estimate: Estimate; hp: Params; elapsedSec: number; profile: ProfileId; profiles: Profiles; playbook: readonly PlaybookEntry[]; timeoutMs: number;
}): Promise<Proposal> {
  const cands = candidates(opts.model, opts.estimate, opts.hp, opts.elapsedSec, opts.profile, opts.profiles);
  const pb = matchPlaybook(opts.playbook, opts.estimate, opts.profile);
  const pbCand = pb ? cands.find((c) => c.protocol === pb.protocol) : undefined;
  const fallback = (why: string): Proposal => {
    const chosen = pbCand ?? cands[0]!;
    const src = pbCand ? "playbook" : "default";
    return {
      protocol: chosen.protocol, policy: pb && pbCand ? { ...chosen.policy } : chosen.policy, candidateId: chosen.id,
      rationale: pbCand ? `Playbook entry ${pb!.id} matches (${pb!.situation.hazard} in ${pb!.situation.zone}); its response was verified at design time: ${pb!.rationale}` : `No playbook match; using the first-choice protocol for ${opts.estimate.hazard} (${DESCRIBE[chosen.protocol]}). ${why}`,
      rationaleSource: src, playbookMatch: pb?.id ?? null,
      alternatives: cands.filter((c) => c.id !== chosen.id).map((c) => ({ protocol: c.protocol, reason: src === "playbook" ? "not the verified playbook response for this situation" : "lower priority for this hazard in the fallback order" })),
    };
  };
  if (!opts.claude.available()) return fallback("Planner LLM unavailable (offline or no key).");
  try {
    const user = JSON.stringify({
      estimate: { hazard: opts.estimate.hazard, zone: opts.estimate.zone, confidence: opts.estimate.confidence, evidence: opts.estimate.reasons, peopleByZone: Object.fromEntries(Object.entries(opts.estimate.countsByZone).map(([k, v]) => [k, v.value])) },
      occupancyProfile: opts.profile,
      playbookMatch: pb ? { id: pb.id, protocol: pb.protocol, verified: pb.verified, rationale: pb.rationale } : null,
      candidates: cands.map((c) => ({ id: c.id, protocol: c.protocol, what: c.summary, routes: c.policy.zones.map((z) => `${z.zone}:${z.instruction}${z.via ? `->${z.via}` : ""}${z.delaySec ? `+${z.delaySec}s` : ""}`) })),
    });
    const ids = cands.map((c) => c.id);
    const r = await opts.claude.json({
      role: "planner", model: env("PLANNER_MODEL") ?? "claude-sonnet-5-5", system: PLANNER_SYSTEM, user, maxTokens: 400, timeoutMs: opts.timeoutMs, effort: "low",
      schema: {
        type: "object", additionalProperties: false, required: ["candidateId", "rationale", "rejected"],
        properties: {
          candidateId: { type: "string", enum: ids }, rationale: { type: "string" },
          rejected: { type: "array", items: { type: "object", additionalProperties: false, required: ["candidateId", "reason"], properties: { candidateId: { type: "string", enum: ids }, reason: { type: "string" } } } },
        },
      },
      parse: z.object({ candidateId: z.string(), rationale: z.string(), rejected: z.array(z.object({ candidateId: z.string(), reason: z.string() })) }),
    });
    const chosen = cands.find((c) => c.id === r.candidateId);
    if (!chosen) return fallback("Planner returned an unknown candidate.");
    return {
      protocol: chosen.protocol, policy: chosen.policy, candidateId: chosen.id, rationale: r.rationale.slice(0, 600), rationaleSource: "llm", playbookMatch: pb?.id ?? null,
      alternatives: cands.filter((c) => c.id !== chosen.id).map((c) => ({ protocol: c.protocol, reason: r.rejected.find((x) => x.candidateId === c.id)?.reason.slice(0, 200) ?? "not chosen" })),
    };
  } catch (e) {
    return fallback(`Planner LLM failed (${String(e).slice(0, 80)}).`);
  }
}

export function badPlan(m: Model, e: Estimate, hp: Params): Proposal {
  const hazard = estimateHazard(m, e, 0);
  const base = protocolPolicy(m, "EVACUATE", hazard, hp, { closed: damagedFromEstimate(e) });
  const ground = m.floors[0]!.id;
  const exits = m.elements.filter((el) => el.kind === "exit").map((el) => el.id);
  return {
    protocol: "EVACUATE",
    policy: {
      zones: base.zones.map((z) => (m.zones[m.zoneIndex.get(z.zone)!]!.floor === ground ? { zone: z.zone, instruction: "HOLD" as const, via: null, delaySec: 900 } : z)),
      closedRoutes: [...new Set([...base.closedRoutes, ...exits])],
      inflowClosed: exits,
    },
    rationale: "INJECTED BAD PLAN (demo): keep every ground-floor exit door shut to contain smoke, hold the ground floor, and send the upper floors down the stairs. Shown to prove the Verifier catches gridlock.",
    rationaleSource: "default", playbookMatch: null, alternatives: [], candidateId: "BAD",
  };
}
