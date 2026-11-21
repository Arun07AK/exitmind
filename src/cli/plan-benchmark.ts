import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeClient } from "../llm/claude.ts";
import { draftToTwin, suggestDoors, type PlanDraft } from "../plans/draft.ts";
import { readDraft, storePlan, writeDraft } from "../plans/store.ts";
import { tracePlan } from "../plans/trace.ts";
import { repoPath } from "../shared/paths.ts";
import { loadEnv, makeWorld, runSync } from "../sim/run.ts";
import { loadTwin } from "../twin/build.ts";
import type { Pt } from "../twin/schema.ts";

const sheet = repoPath("data", "sheets", "A102.png");
const frame = (JSON.parse(readFileSync(repoPath("data", "twin", "rinker", "frames.json"), "utf8")) as Record<string, { origin_px: [number, number]; px_per_ft: [number, number] }>)["F1@A102"]!;
const CROP = [300, 1380, 3700, 2800] as const;
const tmp = mkdtempSync(join(tmpdir(), "exitmind-bench-"));
const crop = join(tmp, "A102-F1.png");
execFileSync("python3", ["-c", "import sys\nfrom PIL import Image\nImage.MAX_IMAGE_PIXELS=None\nim=Image.open(sys.argv[1]).crop(tuple(map(int,sys.argv[3:7])))\nim.save(sys.argv[2])", sheet, crop, ...CROP.map(String)]);
const meta = storePlan(readFileSync(crop), "image/png", "Rinker Hall first floor (A102 crop)");
const k = meta.width / (CROP[2] - CROP[0]);
const toFt = (p: readonly number[]): Pt => [(p[0]! / k + CROP[0] - frame.origin_px[0]) / frame.px_per_ft[0], (p[1]! / k + CROP[1] - frame.origin_px[1]) / frame.px_per_ft[1]];
const trueFtPerPx = 1 / (frame.px_per_ft[0] * k);

const t0 = Date.now();
const cached = process.argv.includes("--reuse") ? readDraft(meta.id) : null;
const cachedNotes = cached ? (JSON.parse(readFileSync(join(repoPath("data", "uploads", meta.id), "trace.json"), "utf8")) as { notes: string[]; checks: string[]; model: string; passes: number; secs: number; opusScale: PlanDraft["scale"] }) : null;
const r = cached && cachedNotes ? { draft: { ...cached, scale: cachedNotes.opusScale }, notes: cachedNotes.notes, checks: cachedNotes.checks, model: cachedNotes.model, passes: cachedNotes.passes } : await tracePlan(meta, new ClaudeClient());
const secs = cachedNotes?.secs ?? Math.round((Date.now() - t0) / 1000);
if (!cached) { writeDraft(meta.id, r.draft); writeFileSync(join(repoPath("data", "uploads", meta.id), "trace.json"), JSON.stringify({ notes: r.notes, checks: r.checks, model: r.model, passes: r.passes, secs, opusScale: r.draft.scale })); }
const opusScale = r.draft.scale;
const draft: PlanDraft = { ...r.draft, scale: { ftPerPx: trueFtPerPx, evidence: "registered drawing frame (as if set by the user with two clicks)" } };
writeFileSync(join(tmp, "draft.json"), JSON.stringify(draft));

const truth = loadTwin();
const f1 = truth.floors[0]!;
const area = (poly: Pt[]) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const inside = (x: number, y: number, p: Pt[]) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i]!, [xj, yj] = p[j]!; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const aiOutline = draft.outline.map(toFt);
let inter = 0, uni = 0;
for (let x = -40; x <= 280; x += 1) for (let y = -40; y <= 140; y += 1) { const a = inside(x, y, aiOutline), b = inside(x, y, f1.outline); if (a && b) inter++; if (a || b) uni++; }
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const trueExits = truth.exits.filter((e) => e.floor === "F1").map((e) => { const p = f1.portals.find((x) => x.id === e.portal)!; return { id: e.id, at: mid(p.a, p.b) }; });
const aiExits = draft.exits.map((e) => ({ name: e.name, at: mid(toFt(e.a), toFt(e.b)) }));
const exitErr = trueExits.map((t) => { const d = Math.min(...aiExits.map((a) => Math.hypot(a.at[0] - t.at[0], a.at[1] - t.at[1]))); return { id: t.id, d: Number.isFinite(d) ? Math.round(d * 10) / 10 : null }; });
const segDist = (p: Pt, a: Pt, b: Pt) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const sample = (segs: [Pt, Pt][], step = 2) => segs.flatMap(([a, b]) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt); });
const edges = (poly: Pt[]) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [Pt, Pt]);
const trueWalls = f1.spaces.flatMap((s) => edges(s.polygon));
const aiWalls: [Pt, Pt][] = [...draft.walls.map((w) => [toFt(w.a), toFt(w.b)] as [Pt, Pt]), ...edges(aiOutline)];
const near = (p: Pt, segs: [Pt, Pt][]) => segs.some(([a, b]) => segDist(p, a, b) <= 2.5);
const tw = sample(trueWalls), aw = sample(aiWalls);
const recall = tw.filter((p) => near(p, aiWalls)).length / tw.length, precision = aw.filter((p) => near(p, trueWalls)).length / aw.length;

const aiTwin = draftToTwin(draft, meta);
const crowd = { size: 154, ages: { young_adult: 0.9, adult: 0.1 }, roles: { student: 0.95, staff: 0.05 } };
const sc = (seed: number) => ({ id: "bench", profile: "college" as const, crowd, hazard: { kind: "none" as const }, behaviour: {}, loadFactor: 1, occupancy: "uniform" as const, protocol: "EVACUATE" as const, seed, maxSec: 900 });
const sim = (twin: typeof truth, z?: boolean) => [1, 2, 3].map((seed) => { const s = z ? { ...sc(seed), crowd: undefined, zoneCounts: { Z1N: 52, Z1C: 51, Z1S: 51 } } : sc(seed); const w = makeWorld(loadEnv(twin), s as never); const m = runSync(w); return { c95: m.clearance95Sec, out: w.n - m.remaining, n: w.n }; });
const aiC = sim(aiTwin), trueC = sim(truth, true);
const added = suggestDoors(draft, meta, loadEnv(aiTwin).model);
const fixed = { ...draft, doors: [...draft.doors, ...added] };
const fixedC = sim(draftToTwin(fixed, meta));
const drill = (v: ReturnType<typeof sim>) => { const done = v.filter((x) => x.c95 !== null); return `${v.map((x) => `${x.out}/${x.n}`).join(", ")} out; 95% out in ${done.length ? `${Math.round((done.reduce((a, x) => a + x.c95!, 0) / done.length) * 10) / 10} s` : "not reached"}${done.length < v.length ? ` (${v.length - done.length} of ${v.length} seeds never reach 95%)` : ""}`; };
const lines = [
  "# Plan tracing benchmark: Opus 5.5 on Rinker Hall, first floor",
  "",
  `Input: sheet A102 at 100 dpi, cropped to the first-floor plan (${CROP[2] - CROP[0]} x ${CROP[3] - CROP[1]} px) and reduced to ${meta.width} x ${meta.height} px (${(1 / trueFtPerPx).toFixed(2)} px per ft), as a user would upload it. Model ${r.model}, ${r.passes} pass(es), ${secs} s. Reference: the hand-traced twin (\`data/twin/rinker/floor1.ts\`). Coordinates are compared in the registered drawing frame.`,
  "",
  "| Measure | Opus draft | Hand-traced twin |",
  "|---|---|---|",
  `| Outline area | ${Math.round(area(aiOutline)).toLocaleString()} sq ft | ${Math.round(area(f1.outline)).toLocaleString()} sq ft |`,
  `| Outline overlap (IoU, 1 ft grid) | ${(inter / uni).toFixed(3)} | 1 |`,
  `| Exits traced | ${draft.exits.length} | ${trueExits.length} |`,
  `| Distance from each real exit to the nearest traced exit | ${exitErr.map((e) => `${e.id} ${e.d ?? "-"} ft`).join(", ")} | 0 |`,
  `| Walls: share of real wall length within 2.5 ft of a traced wall (recall) | ${(recall * 100).toFixed(0)}% | 100% |`,
  `| Walls: share of traced wall length within 2.5 ft of a real wall (precision) | ${(precision * 100).toFixed(0)}% | 100% |`,
  `| Interior walls / doors / obstacles traced | ${draft.walls.length} / ${draft.doors.length} / ${draft.obstacles.length} | ${f1.spaces.length} spaces, ${f1.portals.length} portals |`,
  `| Scale read by Opus | ${opusScale.ftPerPx ? `${opusScale.ftPerPx.toFixed(4)} ft/px (${((opusScale.ftPerPx / trueFtPerPx - 1) * 100).toFixed(1)}% off): ${opusScale.evidence}` : `none: ${opusScale.evidence}`} | ${trueFtPerPx.toFixed(4)} ft/px |`,
  `| Drill, 154 people on the first floor, 3 seeds | ${drill(aiC)} | ${drill(trueC)} |`,
  `| Same drill after one click on "Add doors to sealed rooms" (${added.length} doors added, no other edits) | ${drill(fixedC)} | |`,
  "",
  `Checks on the draft before correction: ${r.checks.length ? r.checks.slice(0, 8).join("; ") : "none"}.`,
  "",
  `Tracer notes: ${r.notes.slice(0, 8).join(" ")}`,
  "",
  "The draft above is Opus's output before any human correction, which is what the editor is for: rooms whose doors were not traced are sealed, and the checks panel lists the cells that cannot reach an exit.",
  "",
  "The hand-traced drill uses its own room layout and the stairs as non-exits on the first floor (people leave by the exterior doors), so the times compare the two layouts, not the two crowds.",
];
writeFileSync(repoPath("docs", "verification", "plan-benchmark.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
