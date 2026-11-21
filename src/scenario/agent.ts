import type { ClaudeLike } from "../llm/claude.ts";
import { env } from "../shared/env.ts";
import { parseLexicon } from "./lexicon.ts";
import { AGENT_JSON_SCHEMA, AgentReplySchema, QUESTION, missingRequired, type AgentReply, type VenueInfo } from "./spec.ts";

export interface ChatTurn { role: "user" | "assistant"; text: string }
export interface AgentResult extends AgentReply { source: "llm" | "lexicon"; model: string | null; note?: string }

export const SCENARIO_MODEL = (): string => env("SCENARIO_MODEL") ?? "claude-opus-5-5";

function systemPrompt(venues: VenueInfo[]): string {
  return [
    "You are the scenario agent of EXITMIND, an evacuation design tool. An event manager describes an emergency scenario in plain language; you turn it into a structured scenario for a crowd simulation.",
    "Required details: crowd size, age groups, event type. If any is missing or ambiguous, set status=needs_info, list it in `missing`, and ask short, specific questions (one per missing detail). Never invent a required detail.",
    "Optional details: venue, emergency type and where it starts, mobility needs, blocked exits, and other conditions. When optional details are missing, choose sensible defaults and state every default as an assumption in plain words.",
    "Use only the venues, exit ids and zone ids listed below. If the manager names a venue that is not listed, use the closest listed venue and say so in the assumptions.",
    "Shares (ages, roles, familiarity, mobility) are fractions that sum to about 1 where they describe a mix; familiarity is the share of each role who know the venue well. Roles: student = regular attendee who knows the place, visitor = first-time or outside guest, staff = organisers, volunteers and security.",
    "emergencyWhere is a zone id or an exit id from the venue list, the word STAGE for anything at or near a venue's stage, or null. blockedExits are exit ids. Write the summary in two sentences for the manager. This is a design-time simulation: never give real emergency advice and never claim results predict real people.",
    `Venues:\n${JSON.stringify(venues, null, 1)}`,
  ].join("\n\n");
}

export function finalise(reply: AgentReply, venues: VenueInfo[], source: AgentResult["source"], model: string | null): AgentResult {
  const missing = [...new Set([...reply.missing, ...missingRequired(reply.spec)])];
  const questions = [...reply.questions];
  if (questions.length < missing.length) for (const k of missing.slice(questions.length)) questions.push(QUESTION[k]);
  const venue = venues.find((v) => v.id === reply.spec.venue);
  const exitIds = new Set(venue?.exits.map((e) => e.id) ?? []);
  const assumptions = [...reply.assumptions];
  const blocked = reply.spec.blockedExits.filter((id) => exitIds.has(id));
  if (blocked.length < reply.spec.blockedExits.length) assumptions.push(`Ignored blocked exits not in the venue: ${reply.spec.blockedExits.filter((id) => !exitIds.has(id)).join(", ")}.`);
  const spec = { ...reply.spec, blockedExits: blocked };
  if (spec.crowdSize && spec.crowdSize > 8000) { assumptions.push(`Crowd size capped at 8,000 (the simulator's limit); you asked for ${spec.crowdSize.toLocaleString()}.`); spec.crowdSize = 8000; }
  return { ...reply, spec, missing, questions: missing.length ? questions : [], assumptions, status: missing.length ? "needs_info" : "ready", source, model };
}

export async function scenarioAgent(turns: ChatTurn[], venues: VenueInfo[], claude: ClaudeLike): Promise<AgentResult> {
  const transcript = turns.map((t) => `${t.role === "user" ? "Manager" : "Agent"}: ${t.text}`).join("\n");
  if (!turns.some((t) => t.role === "user" && t.text.trim())) throw new Error("describe the scenario first");
  if (claude.available()) {
    try {
      const reply = await claude.json({
        role: "parser", model: SCENARIO_MODEL(), system: systemPrompt(venues), user: transcript.slice(-12000), schema: AGENT_JSON_SCHEMA,
        parse: AgentReplySchema, maxTokens: 16000, timeoutMs: 120000, effort: "medium",
      });
      return finalise(reply, venues, "llm", SCENARIO_MODEL());
    } catch (e) {
      return { ...finalise(parseLexicon(transcript, venues), venues, "lexicon", null), note: `Scenario agent unavailable (${String(e).slice(0, 120)}); used the offline keyword parser.` };
    }
  }
  return { ...finalise(parseLexicon(transcript, venues), venues, "lexicon", null), note: "Scenario agent offline (no key or EXITMIND_OFFLINE=1); used the offline keyword parser." };
}
