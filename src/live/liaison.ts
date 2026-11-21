import { z } from "zod";
import type { ClaudeLike } from "../llm/claude.ts";
import type { EventLog, EventRecord } from "../log/eventlog.ts";
import { env } from "../shared/env.ts";
import type { Model } from "../sim/model.ts";
import type { Brief, BriefLine, Estimate } from "../server/contract.ts";
import type { PublishedPayload } from "./gate.ts";

export const BRIEF_NOTICE = "Draft for the responder call. A human calls 112; EXITMIND never contacts anyone. Counts are sensor observations with their sources, not casualty estimates.";

export interface Fact {
  id: string;
  text: string;
  refs: string[];
}

export function briefFacts(log: EventLog, m: Model): Fact[] {
  const est = log.query({ type: "sentinel.estimate" }).at(-1);
  const pub = log.query({ type: "gate.published" }).at(-1);
  const facts: Fact[] = [];
  if (est) {
    const e = est.payload as Estimate;
    const zname = (z: string | null) => (z ? m.zones[m.zoneIndex.get(z) ?? -1]?.name ?? z : "location not determined");
    facts.push({ id: "F1", text: `Hazard: ${e.hazard} at ${zname(e.zone)}; Sentinel confidence ${e.confidence.toFixed(2)}.`, refs: [est.id] });
    const batch = log.query({ type: "sensor.batch" }).filter((r) => r.seq < est.seq).at(-1);
    let k = 2, total = 0;
    for (const [zone, c] of Object.entries(e.countsByZone).sort()) {
      if (c.value <= 0) continue;
      total += c.value;
      facts.push({ id: `F${k++}`, text: `People observed in ${zname(zone)}: ${c.value} (${c.source}).`, refs: [est.id, ...(batch ? [batch.id] : [])] });
    }
    const missing = e.sensors.filter((s) => s.kind === "density" && s.status !== "ok").map((s) => s.zone);
    if (missing.length) facts.push({ id: `F${k++}`, text: `No count for ${missing.map(zname).join(", ")}: density sensor ${e.sensors.find((s) => s.kind === "density" && s.status !== "ok")?.status}.`, refs: [est.id] });
    facts.push({ id: `F${k++}`, text: `Total people observed inside: ${total}.`, refs: [est.id, ...(batch ? [batch.id] : [])] });
  }
  if (pub) {
    const p = pub.payload as PublishedPayload;
    const closed = p.policy.closedRoutes;
    const used = [...new Set(p.policy.zones.map((z) => z.via).filter((v): v is string => !!v))];
    facts.push({ id: `F${facts.length + 1}`, text: `Action taken: ${p.protocol.replaceAll("_", " ").toLowerCase()} approved by the operator at t=${(pub.tick * 0.25).toFixed(0)} s (${p.verdict === "PASS" ? "verifier PASS" : "verifier FAIL, overridden with a reason"}).`, refs: pub.refs.length ? [pub.id, ...pub.refs] : [pub.id] });
    if (used.length) facts.push({ id: `F${facts.length + 1}`, text: `Routes in use: ${used.join(", ")}.`, refs: [pub.id] });
    facts.push({ id: `F${facts.length + 1}`, text: closed.length ? `Routes closed: ${closed.join(", ")}.` : "No routes closed by the plan.", refs: [pub.id] });
  }
  for (const r of log.query({ type: "sign.offline" }).slice(-3)) facts.push({ id: `F${facts.length + 1}`, text: `Sign ${(r.payload as { mount: string }).mount} went offline and shows the static exit sign.`, refs: [r.id] });
  return facts;
}

const numbers = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);

export function checkLines(lines: BriefLine[], facts: Fact[], log: EventLog): boolean {
  const ids = new Set(facts.flatMap((f) => f.refs));
  for (const l of lines) {
    if (!l.refs.length || !l.refs.every((r) => ids.has(r) && log.get(r))) return false;
    const allowed = new Set(facts.filter((f) => f.refs.some((r) => l.refs.includes(r))).flatMap((f) => numbers(f.text)));
    if (!numbers(l.text).every((n) => allowed.has(n) || n === 112)) return false;
  }
  return true;
}

export async function draftBrief(log: EventLog, m: Model, claude: ClaudeLike, tick: number, id: string): Promise<Brief> {
  const facts = briefFacts(log, m);
  const template: Brief = { id, createdTick: tick, source: "template", lines: facts.map((f) => ({ text: f.text, refs: f.refs })), notice: BRIEF_NOTICE };
  if (!claude.available() || !facts.length) return template;
  try {
    const r = await claude.json({
      role: "liaison", model: env("LIAISON_MODEL") ?? "claude-haiku-5-5", maxTokens: 1500, timeoutMs: 10000, effort: "low",
      system: "You draft a short responder brief for a human operator who will phone emergency services. Use only the facts given; never add numbers, casualty estimates or guesses. Each line must cite the record ids of the facts it uses. At most 8 lines, plain language.",
      user: JSON.stringify(facts),
      schema: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "refs"], properties: { text: { type: "string" }, refs: { type: "array", items: { type: "string" } } } } } } },
      parse: z.object({ lines: z.array(z.object({ text: z.string(), refs: z.array(z.string()) })).max(12) }),
    });
    const lines = r.lines.map((l) => ({ text: l.text.slice(0, 300), refs: l.refs }));
    return checkLines(lines, facts, log) ? { ...template, source: "llm", lines } : template;
  } catch {
    return template;
  }
}

export function briefTraceable(b: Brief, log: EventLog | readonly EventRecord[]): boolean {
  const has = (id: string) => (Array.isArray(log) ? log.some((r) => r.id === id) : !!(log as EventLog).get(id));
  return b.lines.every((l) => l.refs.length > 0 && l.refs.every(has));
}
