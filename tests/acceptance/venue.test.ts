import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "../../src/shared/paths.ts";
import { loadEnv, makeWorld, runSync } from "../../src/sim/run.ts";
import { loadVenue } from "../../src/twin/build.ts";
import { validateTwin } from "../../src/twin/validate.ts";
import { buildFeteTwin, type OsmExtract } from "../../src/venue/osm.ts";
import { scenario } from "../helpers/sim.ts";

const twin = loadVenue("thapar-fete");
const env = loadEnv(twin);
const crowd = { size: 1200, ages: { young_adult: 1 }, roles: { student: 0.6, visitor: 0.35, staff: 0.05 }, placement: "stage_front" as const };

describe("Thapar Fete Area venue from OpenStreetMap", () => {
  it("is the build of the saved OSM extract, validates, and credits OSM under the ODbL", () => {
    const osm = JSON.parse(readFileSync(repoPath("data", "twin", "thapar-fete", "osm.json"), "utf8")) as OsmExtract;
    expect(buildFeteTwin(osm).hash).toBe(twin.hash);
    expect(validateTwin(twin).errors).toEqual([]);
    expect(twin.venue!.attribution).toMatch(/OpenStreetMap contributors.*Open Database License/);
    expect(twin.exits.length).toBeGreaterThanOrEqual(3);
    expect(twin.venue!.mainGates.length).toBeGreaterThan(0);
    expect(twin.venue!.assumptions.join(" ")).toMatch(/Stage position is not in OSM/);
    for (const p of twin.floors[0]!.portals) expect(p.src.basis).toBe("assumed");
  });

  it("walkable area matches the OSM polygon minus the assumed stage (within 3%)", () => {
    const fm = env.model.floors[0]!;
    let cells = 0;
    for (let i = 0; i < fm.n; i++) if (fm.walkable[i]) cells++;
    const walk = cells * (0.4 / 0.3048) ** 2;
    const expected = twin.codeBasis.grossAreaSqft.F1 - 90 * 40;
    expect(Math.abs(walk - expected) / expected).toBeLessThan(0.03);
  });

  it("a concert crowd evacuates with no gridlock; attendees remember the gate they came in through", () => {
    const w = makeWorld(env, scenario({ crowd, seed: 2 }));
    const entryOf = Array.from(w.entryEl);
    const m = runSync(w);
    expect(m.remaining).toBe(0);
    expect(m.gridlock).toBe(false);
    const staffEntry = entryOf.filter((e, a) => w.role[a] === 2 && e >= 0).map((e) => env.model.elements[e]!.id);
    for (const g of staffEntry) expect(twin.venue!.staffGates).toContain(g);
  });

  it("a blocked gate nobody was told about: people head for it, discover it, and reroute; everyone still gets out", () => {
    const blocked = twin.venue!.mainGates[0]!;
    const bi = env.model.elementIndex.get(blocked)!;
    const w = makeWorld(env, scenario({ crowd, seed: 2, blockedExits: [blocked] }));
    let headedThere = 0;
    runSync(w, (ww) => { if (ww.tick === 400) for (let a = 0; a < ww.n; a++) if ((ww.closedMask[a]! >> bi) & 1) headedThere++; }, 1);
    const m = w.summary();
    expect(m.exitUsage[blocked]).toBe(0);
    expect(headedThere).toBeGreaterThan(0);
    expect(m.remaining).toBe(0);
    expect(m.gridlock).toBe(false);
  });
});
