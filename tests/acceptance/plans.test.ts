import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cutWall, draftToTwin, type PlanDraft } from "../../src/plans/draft.ts";
import { planDir, storePlan } from "../../src/plans/store.ts";
import { checkDraft, tracePlan } from "../../src/plans/trace.ts";
import { loadEnv, makeWorld, runSync } from "../../src/sim/run.ts";
import { validateTwin } from "../../src/twin/validate.ts";
import { StubClaude } from "../helpers/stubs.ts";
import { scenario } from "../helpers/sim.ts";

const meta = { id: "abcdef012345", name: "Test hall", width: 400, height: 300, source: "PNG", createdAt: "2026-11-21T00:00:00Z" };
// 200 x 120 px hall at 0.5 ft/px (100 x 60 ft), split by a wall at x=200 with one 8 ft door; exits on the west and east walls.
const hall = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  outline: [[100, 90], [300, 90], [300, 210], [100, 210]],
  walls: [{ a: [200, 90], b: [200, 210] }],
  doors: [{ a: [200, 142], b: [200, 158] }],
  exits: [{ a: [100, 140], b: [100, 156], name: "West doors", main: true }, { a: [300, 140], b: [300, 156], name: "East doors", main: false }],
  obstacles: [], labels: [{ name: "Hall A", at: [150, 150], kind: "hall" }], stage: null,
  scale: { ftPerPx: 0.5, evidence: "test" }, ...over,
});

describe("uploaded plans", () => {
  it("cuts door gaps out of walls", () => {
    const pieces = cutWall([0, 0], [0, 60], [{ a: [0, 26], b: [0, 34] }], 2.5);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]![1][1]).toBeCloseTo(26, 5);
    expect(pieces[1]![0][1]).toBeCloseTo(34, 5);
  });

  it("a traced draft becomes a valid twin in feet; walls block, the door connects both halves, people get out", () => {
    const twin = draftToTwin(hall(), meta);
    expect(validateTwin(twin).errors).toEqual([]);
    expect(twin.codeBasis.grossAreaSqft.F1).toBe(6000);
    expect(twin.exits.map((e) => e.id)).toEqual(["EX-E1", "EX-E2"]);
    expect(twin.floors[0]!.portals[0]!.clearWidthIn).toBe(96);
    expect(twin.venue!.kind).toBe("plan");
    expect(twin.floors[0]!.portals[0]!.src.basis).toBe("ai-traced");
    const env = loadEnv(twin);
    const w = makeWorld(env, scenario({ crowd: { size: 200, ages: { adult: 1 }, roles: { visitor: 1 } }, hazard: { kind: "none" }, seed: 3 }));
    const m = runSync(w);
    expect(m.remaining).toBe(0);
    expect(m.gridlock).toBe(false);
    const closed = draftToTwin(hall({ doors: [], exits: [hall().exits[0]!] }), meta);
    const w2 = makeWorld(loadEnv(closed), scenario({ crowd: { size: 200, ages: { adult: 1 }, roles: { visitor: 1 } }, hazard: { kind: "none" }, seed: 3 }));
    expect(runSync(w2).remaining).toBeGreaterThan(0);
  });

  it("checks report missing scale and missing exits in plain words", () => {
    expect(checkDraft(hall({ scale: { ftPerPx: null, evidence: "none" } }), meta).errors.join(" ")).toMatch(/no scale/);
    expect(checkDraft(hall({ exits: [] }), meta).errors.join(" ")).toMatch(/no exits/);
  });

  const tmp = mkdtempSync(join(tmpdir(), "exitmind-plan-"));
  const ids: string[] = [];
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); for (const id of ids) rmSync(planDir(id), { recursive: true, force: true }); });

  it("stores an uploaded image (deduplicated by content) and renders a PNG at most 1600 px", () => {
    const f = join(tmp, "plan.png");
    execFileSync("python3", ["-c", "from PIL import Image, ImageDraw\nim=Image.new('RGB',(2400,1800),'white')\nd=ImageDraw.Draw(im)\nd.rectangle([300,300,2100,1500],outline='black',width=8)\nim.save(__import__('sys').argv[1])", f]);
    const m1 = storePlan(readFileSync(f), "image/png", "Sketch");
    const m2 = storePlan(readFileSync(f), "image/png", "Sketch");
    ids.push(m1.id);
    expect(m2.id).toBe(m1.id);
    expect(Math.max(m1.width, m1.height)).toBe(1600);
    expect(() => storePlan(Buffer.from("not a pdf"), "application/pdf", "x")).toThrow(/not a PDF/);
    expect(() => storePlan(Buffer.from("x"), "text/plain", "x")).toThrow(/PDF, PNG or JPEG/);
  });

  it("tracing: Opus's draft is checked, and a failing draft gets one repair pass with the errors", async () => {
    const f = join(tmp, "plan2.png");
    execFileSync("python3", ["-c", "from PIL import Image\nImage.new('RGB',(400,300),'white').save(__import__('sys').argv[1])", f]);
    const m = storePlan(readFileSync(f), "image/png", "Stub plan");
    ids.push(m.id);
    let n = 0;
    const claude = new StubClaude("sensible", (u) => {
      n++;
      const base = { ...hall(), notes: ["stub"] } as Record<string, unknown>;
      if (n === 1) return { ...base, exits: [] };
      expect(String(u.text)).toMatch(/no exits traced/);
      return base;
    });
    const r = await tracePlan(m, claude);
    expect(r.passes).toBe(2);
    expect(r.draft.exits).toHaveLength(2);
    expect(r.checks.filter((c) => c.startsWith("no exits"))).toEqual([]);
    await expect(tracePlan(m, new StubClaude("down"))).rejects.toThrow(/needs Claude Opus 5.5/);
  });
});
