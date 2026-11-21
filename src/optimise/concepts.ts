import { z } from "zod";
import type { ClaudeLike } from "../llm/claude.ts";
import { env } from "../shared/env.ts";
import type { Pt, Space } from "../twin/schema.ts";
import type { Diagnosis, Hotspot } from "./diagnose.ts";
import { genExitWiden, genExternalStair, genNewExits, genPartition, genStairWiden, sharedWalls, structuralKind, type GenContext, type Modification } from "./generate.ts";

export const ARCHITECT_MODEL = (): string => env("ARCHITECT_MODEL") ?? env("SCENARIO_MODEL") ?? "claude-opus-5-5";
const KINDS = ["new_exit", "external_stair", "connecting_passage", "remove_partition", "second_door", "widen_door", "widen_stair", "ramp"] as const;
const Concept = z.object({ kind: z.enum(KINDS), hotspot: z.string(), floor: z.string(), spaces: z.array(z.string()), element: z.string().nullable(), rationale: z.string() });
const Reply = z.object({ interpretation: z.string(), concepts: z.array(Concept) });
export type ConceptT = z.infer<typeof Concept>;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["interpretation", "concepts"],
  properties: {
    interpretation: { type: "string" },
    concepts: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "hotspot", "floor", "spaces", "element", "rationale"], properties: {
      kind: { type: "string", enum: [...KINDS] }, hotspot: { type: "string" }, floor: { type: "string" }, spaces: { type: "array", items: { type: "string" } },
      element: { anyOf: [{ type: "string" }, { type: "null" }] }, rationale: { type: "string" },
    } } },
  },
};

const cen = (p: Pt[]): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function layout(g: GenContext): unknown {
  return g.twin.floors.map((f) => ({
    floor: f.id,
    spaces: f.spaces.filter((s) => s.kind !== "elevator").map((s) => ({
      id: s.id, name: s.name, kind: s.kind, use: s.use,
      outsideWall: f.outline.some((p, i) => { const q = f.outline[(i + 1) % f.outline.length]!; return s.polygon.some((a) => Math.abs((q[0] - p[0]) * (a[1] - p[1]) - (q[1] - p[1]) * (a[0] - p[0])) / (len(p, q) || 1) < 1); }),
      adjacent: f.spaces.filter((o) => o.id !== s.id && sharedWalls(s, o).length).map((o) => o.id),
      doorsTo: f.portals.filter((p) => p.connects.includes(s.id)).map((p) => p.connects.find((x) => x !== s.id)),
    })),
  }));
}

function prompt(d: Diagnosis, g: GenContext): string {
  return [
    "You are the architectural reasoning step of EXITMIND, an evacuation design tool. Below is a diagnosis measured in crowd simulations of a building, and the building's room layout.",
    "1. interpretation: explain in 3-5 plain sentences why people are delayed, citing hotspots by id. Use only numbers that appear in the diagnosis.",
    "2. concepts: propose 4-8 specific physical changes that would remove the causes. Think like an architect: a direct exit from a stair at ground level, an external stair on a façade, a passage through a storage room to an under-used exit, removing a partition, a second door for a crowded room, a ramp. Prefer changes that use spare exit capacity, avoid structural walls, and do not route people through restrooms, wards or rooms that must stay lockable.",
    "For each concept give: kind; hotspot id; floor id; spaces (new_exit / external_stair / second_door: the one room; connecting_passage: the full ordered route of space ids, each adjacent to the next; remove_partition: the two spaces); element (door, exit or stair id for widen_door / widen_stair / ramp, else null); rationale (one sentence).",
    "Every concept is rebuilt by code into geometry and tested in the simulator; anything that cannot be built is rejected, and no number you write is reported as a result.",
    `Diagnosis:\n${JSON.stringify({ summary: d.summary, hotspots: d.hotspots.slice(0, 6).map((h) => ({ id: h.id, floor: h.floor, element: h.element, why: h.why, fedBy: h.fedBy, spare: h.spare })), exits: d.exits, failures: d.failures.slice(0, 6), detours: d.detours.slice(0, 5) })}`,
    `Layout:\n${JSON.stringify(layout(g))}`,
  ].join("\n\n");
}

/** Rebuild one Opus concept as geometry with the same generators and checks as the rule-based proposals. */
export function compile(c: ConceptT, g: GenContext): { mod: Modification | null; reason: string } {
  const h0 = g.diagnosis.hotspots.find((h) => h.id === c.hotspot) ?? g.diagnosis.hotspots[0];
  if (!h0) return { mod: null, reason: "no hotspot to attach it to" };
  const f = g.twin.floors.find((x) => x.id === c.floor);
  if (!f) return { mod: null, reason: `unknown floor ${c.floor}` };
  const sp = c.spaces.map((id) => f.spaces.find((s) => s.id === id));
  if (sp.some((s) => !s)) return { mod: null, reason: `unknown space(s) on ${c.floor}: ${c.spaces.filter((_, i) => !sp[i]).join(", ")}` };
  const spaces = sp as Space[];
  const at = (s: Space): Hotspot => ({ ...h0, floor: f.id, centroid: cen(s.polygon) });
  const tag = (m: Modification): Modification => ({ ...m, source: "opus", why: `${c.rationale} (${m.why})` });
  switch (c.kind) {
    case "new_exit": {
      if (!spaces[0]) return { mod: null, reason: "no room given" };
      const m = genNewExits(g, at(spaces[0])).find((x) => x.title.includes(spaces[0]!.id));
      return m ? { mod: tag(m), reason: "built" } : { mod: null, reason: `no buildable 68 in door position on an outside wall of ${spaces[0].id} (grid lines, wall length or 30 ft remoteness)` };
    }
    case "external_stair": {
      if (!spaces[0]) return { mod: null, reason: "no room given" };
      const m = genExternalStair(g, at(spaces[0]))[0];
      return m ? { mod: tag(m), reason: "built" } : { mod: null, reason: `no façade near ${spaces[0].id} that is clear on every floor for a 16 x 10 ft stair` };
    }
    case "connecting_passage": {
      if (spaces.length < 2) return { mod: null, reason: "a passage needs at least two spaces" };
      const portals: Modification["edit"]["patch"] = { addPortals: [] };
      let structural: "partition" | "structural" = "partition";
      for (let i = 0; i + 1 < spaces.length; i++) {
        const A = spaces[i]!, B = spaces[i + 1]!;
        if (["restroom", "ward"].includes(B.use) || B.kind === "elevator") return { mod: null, reason: `route passes through ${B.name} (${B.use})` };
        if (f.portals.some((p) => p.connects.includes(A.id) && p.connects.includes(B.id))) continue;
        const sw = sharedWalls(A, B).sort((x, y) => len(y[0], y[1]) - len(x[0], x[1]))[0];
        if (!sw) return { mod: null, reason: `${A.id} and ${B.id} do not share a wall` };
        if (structuralKind(g.twin, sw[0], sw[1], false) === "structural") structural = "structural";
        const m: Pt = [(sw[0][0] + sw[1][0]) / 2, (sw[0][1] + sw[1][1]) / 2], L = len(sw[0], sw[1]), ux = (sw[1][0] - sw[0][0]) / L, uy = (sw[1][1] - sw[0][1]) / L;
        portals.addPortals!.push({ id: `D-op-${A.id}-${B.id}`, floor: f.id, kind: "door", a: [m[0] - ux * 2, m[1] - uy * 2], b: [m[0] + ux * 2, m[1] + uy * 2], clearWidthIn: 44, connects: [A.id, B.id], accessible: true, src: { sheet: g.twin.floors[0]!.spaces[0]!.src.sheet, basis: "assumed", note: "EXITMIND proposal (Opus concept): new 44 in opening" } });
      }
      if (!portals.addPortals!.length) return { mod: null, reason: "the route already exists through existing doors" };
      const id = `O-passage-${spaces.map((s) => s.id).join("-")}`;
      return { mod: { id, kind: "connecting_passage", title: `Connecting passage ${spaces.map((s) => s.name).join(" → ")} (${portals.addPortals!.length} new opening${portals.addPortals!.length > 1 ? "s" : ""})`, why: c.rationale, hotspot: h0.id, source: "opus",
        edit: { kind: "geometry", target: id, patch: portals }, quantities: { doorsAdded: portals.addPortals!.length, wallOpeningM2: Math.round(portals.addPortals!.length * 1.12 * 2.1 * 10) / 10, roomsCrossed: spaces.slice(1, -1).filter((s) => s.kind === "room").length },
        structural, needsEngineer: structural === "structural", accessibility: 0,
        regulations: ["Rooms on the route must keep a 44 in clear path and must not be lockable against people leaving (NFPA 101 7.5.2; verify).", structural === "structural" ? "An opening is on a structural grid line: needs a structural engineer." : "Openings in partitions assumed non-structural; confirm with the structural drawings."],
        viz: portals.addPortals!.map((p) => ({ floor: f.id, kind: "construct" as const, segment: [p.a, p.b] as [Pt, Pt], label: "new opening" })) }, reason: "built" };
    }
    case "remove_partition": {
      if (spaces.length !== 2) return { mod: null, reason: "give exactly two spaces" };
      const door = f.portals.find((p) => p.connects.includes(spaces[0]!.id) && p.connects.includes(spaces[1]!.id));
      if (!door) return { mod: null, reason: `${spaces[0]!.id} and ${spaces[1]!.id} have no door between them to start from` };
      const m = genPartition(g, { ...h0, floor: f.id, element: { id: door.id, kind: "door", name: door.id } }).find((x) => x.kind === "remove_partition");
      return m ? { mod: tag(m), reason: "built" } : { mod: null, reason: "the wall is on the structural grid, a stair enclosure, or shorter than 8 ft" };
    }
    case "second_door": {
      const room = spaces[0];
      if (!room) return { mod: null, reason: "no room given" };
      const existing = f.portals.filter((p) => p.connects.includes(room.id)).map((p) => cen([p.a, p.b]));
      const opts = f.spaces.filter((o) => (o.kind === "corridor" || o.kind === "lobby") && o.id !== room.id).flatMap((o) => sharedWalls(room, o).map((sw) => ({ o, sw, m: cen(sw) })))
        .map((x) => ({ ...x, d: Math.min(...existing.map((e) => len(e, x.m)), 999) })).sort((a, b) => b.d - a.d)[0];
      if (!opts || opts.d < 15) return { mod: null, reason: `no corridor wall of ${room.id} far enough from its existing door` };
      const L = len(opts.sw[0], opts.sw[1]), ux = (opts.sw[1][0] - opts.sw[0][0]) / L, uy = (opts.sw[1][1] - opts.sw[0][1]) / L;
      const a: Pt = [opts.m[0] - ux * 1.5, opts.m[1] - uy * 1.5], b: Pt = [opts.m[0] + ux * 1.5, opts.m[1] + uy * 1.5];
      const st = structuralKind(g.twin, opts.sw[0], opts.sw[1], false);
      const id = `O-door-${room.id}`;
      return { mod: { id, kind: "second_door", title: `Second door from ${room.name} ${room.id} to ${opts.o.name} (${Math.round(opts.d)} ft from the existing door)`, why: c.rationale, hotspot: h0.id, source: "opus",
        edit: { kind: "geometry", target: id, patch: { addPortals: [{ id: `D-${id}`, floor: f.id, kind: "door", a, b, clearWidthIn: 34, connects: [room.id, opts.o.id], accessible: true, src: { sheet: g.twin.floors[0]!.spaces[0]!.src.sheet, basis: "assumed", note: "EXITMIND proposal (Opus concept): second door" } }] } },
        quantities: { doorsAdded: 1, wallOpeningM2: 1.8 }, structural: st, needsEngineer: st === "structural", accessibility: 0,
        regulations: ["Rooms for 50 or more people need two remote doors when travel is long (printed code basis); the new door must swing in the direction of travel."],
        viz: [{ floor: f.id, kind: "construct", segment: [a, b], label: "second door" }] }, reason: "built" };
    }
    case "widen_door": case "widen_stair": case "ramp": {
      if (!c.element) return { mod: null, reason: "no element given" };
      const isStair = g.twin.stairs.some((s) => s.id === c.element), isExit = g.twin.exits.some((e) => e.id === c.element);
      const h = { ...h0, element: { id: c.element, kind: isStair ? "stair" as const : isExit ? "exit" as const : "door" as const, name: c.element } };
      const list = isStair ? genStairWiden(g, h) : isExit ? genExitWiden(g, h) : genPartition(g, h);
      const m = list.find((x) => (c.kind === "ramp" ? x.kind === "ramp" : x.kind === c.kind));
      return m ? { mod: tag(m), reason: "built" } : { mod: null, reason: `${c.kind} does not apply to ${c.element}` };
    }
  }
}

export interface ConceptReport { model: string; interpretation: string | null; proposed: number; built: Modification[]; rejected: { concept: ConceptT; reason: string }[]; note?: string }

export async function opusConcepts(d: Diagnosis, g: GenContext, claude: ClaudeLike): Promise<ConceptReport> {
  if (!claude.available()) return { model: ARCHITECT_MODEL(), interpretation: null, proposed: 0, built: [], rejected: [], note: "Opus unavailable (no key or offline): rule-based proposals only." };
  try {
    const r = await claude.json({ role: "planner", model: ARCHITECT_MODEL(), system: "You are an experienced architect specialising in means of egress. Be concrete and conservative about structure.", user: prompt(d, g), schema: SCHEMA, parse: Reply, maxTokens: 16000, timeoutMs: 180_000, effort: "high" });
    const known = new Set((JSON.stringify(d).match(/\d+(\.\d+)?/g) ?? []).map((x) => String(Number(x))));
    const nums = (r.interpretation.match(/\d+(\.\d+)?/g) ?? []).filter((x) => !/^H\d/.test(x));
    const unsupported = nums.filter((x) => !known.has(String(Number(x))));
    const built: Modification[] = [], rejected: ConceptReport["rejected"] = [];
    for (const c of r.concepts) { const x = compile(c, g); if (x.mod) built.push(x.mod); else rejected.push({ concept: c, reason: x.reason }); }
    return { model: ARCHITECT_MODEL(), interpretation: unsupported.length ? null : r.interpretation, proposed: r.concepts.length, built, rejected, ...(unsupported.length ? { note: `Interpretation dropped: it quoted numbers not in the diagnosis (${unsupported.slice(0, 5).join(", ")}).` } : {}) };
  } catch (e) {
    return { model: ARCHITECT_MODEL(), interpretation: null, proposed: 0, built: [], rejected: [], note: `Opus call failed (${String(e).slice(0, 160)}): rule-based proposals only.` };
  }
}
