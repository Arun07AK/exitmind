import type { IncidentState, LiveState, LogLine, Protocol, RoutePolicy, SignState } from "../../../../src/server/contract.ts";
import { ARROW_GLYPH } from "../../lib/colors.ts";

export const STEPS: readonly IncidentState[] = ["NORMAL", "SUSPECTED", "CONFIRMED", "RESPONDING", "ALL_CLEAR"];
export const STEP_WORDS: Record<IncidentState, string> = { NORMAL: "Normal", SUSPECTED: "Suspected", CONFIRMED: "Confirmed", RESPONDING: "Responding", ALL_CLEAR: "All clear" };

export const PROTOCOL_WORDS: Record<Protocol, string> = {
  EVACUATE: "Evacuate now",
  PHASED_EVACUATION: "Phased evacuation",
  HOLD_THEN_EVACUATE: "Hold, then evacuate",
  LOCKDOWN_SHELTER: "Lock down and shelter",
  HORIZONTAL_EVACUATION: "Move to the next compartment",
  INFLOW_CONTROL: "Stop people coming in",
};

export const HAZARD_WORDS: Record<string, string> = { none: "No hazard", fire: "Fire", quake: "Earthquake", crush: "Crowd crush", threat: "Threat", medical: "Medical emergency" };

/** "ST-A@F2" -> "ST-A" */
export const routeId = (id: string | null | undefined): string => (id ?? "").split("@")[0]!;

export const clock = (sec: number | null | undefined): string => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "not reached";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const int = (v: number): string => Math.round(v).toLocaleString("en-US");
export const dec1 = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
export const people = (v: number): string => `${dec1(v)} ${v === 1 ? "person" : "people"}`;

/** simulated seconds per tick, from the state itself */
export const tickSec = (live: LiveState): number => (live.tick > 0 ? live.t / live.tick : 0);

export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const uniq = <T,>(a: readonly T[]): T[] => [...new Set(a)];

/** One or two sentences describing a route policy, built only from its fields. */
export function planSummary(p: RoutePolicy, kindOf: (id: string) => "exit" | "stair" | undefined): string {
  const n = p.zones.length;
  const out: string[] = [];
  const who = (k: number) => (k === n ? "Everyone" : `${k} of ${n} zones`);
  const verb = (k: number, one: string, many: string) => (k === n ? one : many);
  const evac = p.zones.filter((z) => z.instruction === "EVACUATE_VIA");
  if (evac.length) {
    const delays = uniq(evac.map((z) => z.delaySec)).sort((a, b) => a - b);
    const vias = uniq(evac.map((z) => z.via).filter((v): v is string => !!v));
    const exits = uniq(vias.filter((v) => kindOf(v) !== "stair").map(routeId));
    const stairs = uniq(vias.filter((v) => kindOf(v) === "stair").map(routeId));
    const by = [exits.length ? `by ${exits.length === 1 ? "exit" : "exits"} ${listWords(exits)}` : "", stairs.length ? `by ${stairs.length === 1 ? "stair" : "stairs"} ${listWords(stairs)}` : ""].filter(Boolean).join(", and ");
    const k = evac.length;
    const lead = delays.length === 1
      ? delays[0]! > 0 ? `${who(k)} ${verb(k, "holds", "hold")} for ${delays[0]} s, then ${verb(k, "leaves", "leave")}` : `${who(k)} ${verb(k, "leaves", "leave")} now`
      : `${who(k)} ${verb(k, "leaves", "leave")} in phases, after ${delays[0]} to ${delays.at(-1)} s`;
    out.push(`${lead}${by ? ` ${by}` : ""}.`);
  }
  const hold = p.zones.filter((z) => z.instruction === "HOLD").length;
  if (hold) out.push(`${who(hold)} ${verb(hold, "holds", "hold")} in place.`);
  const lock = p.zones.filter((z) => z.instruction === "LOCKDOWN").length;
  if (lock) out.push(`${who(lock)} ${verb(lock, "locks", "lock")} down in place.`);
  const comp = p.zones.filter((z) => z.instruction === "MOVE_TO_COMPARTMENT");
  if (comp.length) out.push(`${who(comp.length)} ${verb(comp.length, "moves", "move")} to the next compartment${comp[0]?.via ? ` (${listWords(uniq(comp.map((z) => routeId(z.via))))})` : ""}.`);
  if (p.closedRoutes.length) out.push(`Closed: ${listWords(p.closedRoutes)}.`);
  if (p.inflowClosed.length) out.push(`Entry closed at ${listWords(p.inflowClosed)}.`);
  return out.join(" ");
}

/** Short text of what a sign displays. */
export function signShort(s: SignState): string {
  switch (s.kind) {
    case "ARROW":
    case "STATIC_DEFAULT":
      return `${ARROW_GLYPH[s.arrow.dir] ?? ""} ${routeId(s.arrow.toward)}`;
    case "X_ALT":
      return `✕ ${routeId(s.blocked)} ${ARROW_GLYPH[s.alt.dir] ?? ""} ${routeId(s.alt.toward)}`;
    case "HOLD":
      return "HOLD";
    case "LOCKDOWN":
      return "LOCKDOWN";
  }
}

export const shortMount = (id: string): string => id.replace(/^SM-/, "");

/** Log record about a decision, by type ("human.approved" ...). Summaries start with the decision id. */
export function recordFor(log: readonly LogLine[], types: readonly string[], decisionId: string): LogLine | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const l = log[i]!;
    if (types.includes(l.type) && (l.summary === decisionId || l.summary.startsWith(`${decisionId} `) || l.summary.startsWith(`${decisionId}:`) || l.summary.includes(`"decisionId":"${decisionId}"`))) return l;
  }
  return undefined;
}

/** Tick of the record that moved the incident out of NORMAL most recently. */
export function firstSignalTick(log: readonly LogLine[]): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const l = log[i]!;
    if (l.type === "incident.state" && l.summary.startsWith("NORMAL ->")) return l.tick;
  }
  return null;
}

function fields(summary: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of summary.matchAll(/"(\w+)":("((?:[^"\\]|\\.)*)"|-?[\d.]+|true|false|null)/g)) if (!(m[1]! in out)) out[m[1]!] = m[3] ?? m[2]!;
  return out;
}

/** Readable text for a log line; JSON payload summaries are reduced to their simple fields. */
export function logText(l: LogLine, dt: number): string {
  const s = l.summary.replace(/\s+/g, " ").trim();
  if (!s.startsWith("{")) {
    if (l.type === "planner.proposed") {
      const m = /^(\S+) ([A-Z_]+)(.*)$/.exec(s);
      if (m && m[2]! in PROTOCOL_WORDS) return `${m[1]} proposed: ${PROTOCOL_WORDS[m[2] as Protocol].toLowerCase()}${m[3]}`;
    }
    if (l.type === "gate.published") {
      const m = /^(\S+) ([A-Z_]+) (.*)$/.exec(s);
      if (m && m[2]! in PROTOCOL_WORDS) return `${m[1]} ${PROTOCOL_WORDS[m[2] as Protocol].toLowerCase()} ${m[3]}`;
    }
    if (l.type === "human.approved") return `${s.split(" ")[0]} approved${s.includes(" ") ? `: ${s.slice(s.indexOf(" ") + 1)}` : ""}`;
    if (l.type === "human.rejected") return `${s.split(" ")[0]} rejected${s.includes(" ") ? `: ${s.slice(s.indexOf(" ") + 1)}` : ""}`;
    if (l.type === "human.override") return `${s.split(" ")[0]} approved over the verifier, reason: ${s.slice(s.indexOf(" ") + 1)}`;
    return s;
  }
  const f = fields(s);
  switch (l.type) {
    case "session.started": return `session ${f.sessionId ?? ""} started (${f.mode ?? "live"}, seed ${f.seed ?? "?"})`;
    case "planner.requested": return `${f.decisionId ?? "plan"} requested${f.injected === "true" ? " (injected bad plan)" : ""}`;
    case "planner.fallback": return `${f.decisionId ?? ""} from ${f.source ?? "fallback"}${f.why ? `: ${f.why}` : ""}`;
    case "approval.requested": {
      const d = Number(f.deadlineTick);
      return `approval requested for ${f.decisionId ?? ""}${Number.isFinite(d) && dt > 0 ? `, ${Math.round((d - l.tick) * dt)} s window` : ""}`;
    }
    case "approval.timeout": return `${f.decisionId ?? ""} not approved in time; signs held at ${f.held ?? "their last state"}`;
    case "liaison.brief": return `responder brief ${f.id ?? ""} drafted`;
    default: {
      const kv = Object.entries(f).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(" · ");
      return kv || s;
    }
  }
}

/** Key events: no checkpoints, and a sentinel estimate only when it changed. */
export function keyEvents(log: readonly LogLine[]): LogLine[] {
  let last = "";
  return log.filter((l) => {
    if (l.type === "world.checkpoint") return false;
    if (l.type === "sentinel.estimate") {
      const same = l.summary === last;
      last = l.summary;
      return !same;
    }
    return true;
  });
}

export const capital = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
