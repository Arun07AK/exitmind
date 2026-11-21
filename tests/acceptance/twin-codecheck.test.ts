import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rinker } from "../../data/twin/rinker/index.ts";
import { codeCheck } from "../../src/design/codecheck.ts";
import { repoPath } from "../../src/shared/paths.ts";
import { finalizeTwin, loadTwin } from "../../src/twin/build.ts";
import { validateTwin } from "../../src/twin/validate.ts";

const twin = loadTwin();

describe("Rinker Hall digital twin", () => {
  it("the committed twin is the build of the traced sources and validates with no errors", () => {
    expect(finalizeTwin(rinker).hash).toBe(twin.hash);
    const r = validateTwin(twin);
    expect(r.errors).toEqual([]);
    expect(r.stats.floors).toBe(3);
    expect(r.stats.exits).toBe(9);
  });

  it("every space, portal, stair, exit and sign mount links to one of the six permitted sheets", () => {
    const sheets = new Set(["A102", "A103", "A107", "A108", "A602", "A603"]);
    const els = [...twin.floors.flatMap((f) => [...f.spaces, ...f.portals]), ...twin.stairs, ...twin.exits, ...twin.signMounts];
    for (const e of els) expect(sheets.has(e.src.sheet), e.id).toBe(true);
  });

  it("the five-dimension spot check is recorded against the sheets", () => {
    const doc = readFileSync(repoPath("docs", "verification", "twin-spotcheck.md"), "utf8");
    expect(doc.match(/^\| [1-5] \|/gm)?.length).toBe(5);
    expect(twin.frame.gridX.K! - twin.frame.gridX.B!).toBe(180);
    expect(twin.frame.gridY["4"]! - twin.frame.gridY["1"]!).toBe(82);
  });
});

describe("code check reproduces the method printed on the egress sheets", () => {
  const r = codeCheck(twin);
  it("recomputes every printed REQ'D width exactly (28.2, 1.8, 0.8, 47.1, 45.3)", () => {
    const widths = r.items.filter((i) => i.id.startsWith("width-"));
    expect(widths).toHaveLength(9);
    for (const w of widths) expect(w.required!.value, w.id).toBe(w.printed);
    expect([...new Set(widths.map((w) => w.required!.value))].sort((a, b) => a - b)).toEqual([0.8, 1.8, 28.2, 45.3, 47.1]);
    for (const w of widths) expect(w.status, w.id).toBe("passes_on_paper");
  });
  it("shows printed and recomputed occupant loads side by side and flags the gap rather than forcing agreement", () => {
    const loads = r.items.filter((i) => i.group === "occupant_load");
    expect(loads.map((l) => l.printed)).toEqual([154, 157, 151]);
    for (const l of loads) expect(l.note).toMatch(/differs/);
  });
  it("checks exits, travel distance (200 and 250 ft), common path and dead ends per floor, with methods stated", () => {
    for (const f of ["F1", "F2", "F3"]) {
      expect(r.items.find((i) => i.id === `exits-${f}`)!.status).toBe("passes_on_paper");
      expect(r.items.find((i) => i.id === `travel-${f}-200`)).toBeDefined();
      expect(r.items.find((i) => i.id === `travel-${f}-250`)).toBeDefined();
      expect(r.items.find((i) => i.id === `deadend-${f}`)!.method.length).toBeGreaterThan(10);
    }
    expect(r.disclaimer).toMatch(/not the real building/);
  });
});
