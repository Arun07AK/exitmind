import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ClaudeLike } from "../llm/claude.ts";
import { env } from "../shared/env.ts";
import { validateTwin } from "../twin/validate.ts";
import { DRAFT_JSON_SCHEMA, DraftSchema, draftToTwin, fromXY, type PlanDraft, type PlanMeta } from "./draft.ts";
import { planDir } from "./store.ts";

export const TRACE_MODEL = (): string => env("TRACE_MODEL") ?? env("SCENARIO_MODEL") ?? "claude-opus-5-5";
const Reply = z.preprocess(fromXY, DraftSchema.omit({ edited: true }).extend({ notes: z.array(z.string()) }));

function prompt(meta: PlanMeta, feedback?: string): string {
  return [
    `This image is an architectural floor plan (${meta.width} x ${meta.height} pixels). Trace it for an evacuation simulation. Give every point as {x, y} in image pixels: x to the right, y downwards, origin at the top-left corner.`,
    "outline: the outer boundary of the usable floor, as a simple polygon (no self-intersections), following the inside face of the exterior walls.",
    "walls: interior walls and partitions as straight segments (centre lines). Leave out furniture, dimension lines, hatching, text and grid lines.",
    "doors: openings in interior walls (a door leaf or a gap), as a segment across the opening along the wall line, as wide as the clear opening.",
    "exits: doors or openings in the outline that lead outside or to a protected exit route, as segments lying on the outline; give each a short name from the plan and set main=true for the main entrance(s).",
    "obstacles: large fixed things people cannot walk through (stage, fixed seating blocks, columns larger than a person, built-in counters), as polygons. stage: the stage polygon if there is one, else null.",
    "labels: room names or numbers printed on the plan, each at a point inside the room, with its kind.",
    "scale: if a scale bar, a written scale with a known print size, or a dimension string lets you work out feet per pixel, give ftPerPx and say what you used in evidence; otherwise null and explain. Never guess a scale.",
    "notes: anything you could not read or were unsure about. Accuracy matters more than completeness: a person will check and correct your draft.",
    ...(feedback ? [`Your previous draft failed these checks; fix them:\n${feedback}`] : []),
  ].join("\n\n");
}

export interface TraceResult { draft: PlanDraft; notes: string[]; checks: string[]; model: string; passes: number }

export function checkDraft(d: PlanDraft, meta: PlanMeta): { errors: string[]; warnings: string[]; stats: Record<string, number> } {
  const errors: string[] = [], warnings: string[] = [];
  if (!d.exits.length) errors.push("no exits traced: mark at least one opening in the outline that leads outside");
  if (d.exits.length === 1) warnings.push("only one exit traced; most assembly buildings need at least two");
  if (!d.scale.ftPerPx) return { errors: [...errors, "no scale: set it with two clicks and a known distance"], warnings, stats: {} };
  try {
    const twin = draftToTwin(d, meta);
    const v = validateTwin(twin);
    errors.push(...v.errors); warnings.push(...v.warnings);
    return { errors, warnings, stats: { ...v.stats, areaSqft: twin.codeBasis.grossAreaSqft.F1 } };
  } catch (e) {
    errors.push(String(e instanceof Error ? e.message : e));
    return { errors, warnings, stats: {} };
  }
}

export async function tracePlan(meta: PlanMeta, claude: ClaudeLike, opts: { scaleFtPerPx?: number | null } = {}): Promise<TraceResult> {
  if (!claude.available()) throw new Error("plan tracing needs Claude Opus 5.5 (no key, or EXITMIND_OFFLINE=1); draw the plan in the editor instead");
  const image = { mediaType: "image/png" as const, data: readFileSync(planDir(meta.id, "plan.png")).toString("base64") };
  const ask = (feedback?: string) => claude.json({
    role: "parser", model: TRACE_MODEL(), system: "You trace architectural floor plans into precise geometry for a building-safety simulation. You report only what the drawing shows.",
    user: prompt(meta, feedback), images: [image], schema: DRAFT_JSON_SCHEMA, parse: Reply, maxTokens: 64000, timeoutMs: 300_000, effort: "high",
  });
  let r = await ask();
  let draft: PlanDraft = { ...r, ...(opts.scaleFtPerPx ? { scale: { ftPerPx: opts.scaleFtPerPx, evidence: "set by the user" } } : {}) };
  let check = checkDraft(draft, meta);
  let passes = 1;
  if (check.errors.length && !check.errors.every((e) => e.startsWith("no scale"))) {
    r = await ask(check.errors.join("\n"));
    draft = { ...r, ...(opts.scaleFtPerPx ? { scale: { ftPerPx: opts.scaleFtPerPx, evidence: "set by the user" } } : {}) };
    check = checkDraft(draft, meta);
    passes = 2;
  }
  return { draft, notes: r.notes, checks: [...check.errors, ...check.warnings], model: TRACE_MODEL(), passes };
}
