import { describe, expect, it } from "vitest";
import { nl2params } from "../../src/design/nl2params.ts";
import { protocolPolicy, routeView } from "../../src/design/protocols.ts";
import { compileSigns, SignCompileError, templates, validateSignSafety } from "../../src/live/signcompiler.ts";
import { Rng } from "../../src/shared/rng.ts";
import { PROTOCOLS } from "../../src/sim/types.ts";
import { loadEnv } from "../../src/sim/run.ts";
import { miniBuilding } from "../../src/twin/synthetic.ts";
import { StubClaude } from "../helpers/stubs.ts";

const env = loadEnv(miniBuilding());
const m = env.model;

describe("signage safety", () => {
  it("property: over random route policies, no X is ever shown without a reachable alternative", () => {
    const rng = Rng.stream(9, "sign-safety");
    const els = m.elements.map((e) => e.id);
    let compiled = 0, rejected = 0, xs = 0;
    for (let k = 0; k < 300; k++) {
      const closed = els.filter(() => rng.bool(0.15));
      const rv = routeView(m, rng.bool(0.5) ? { kind: "quake", damaged: rng.bool(0.5) ? ["ST-B"] : [] } : { kind: "none" }, env.hazardParams, 0, closed);
      const policy = { zones: m.zones.map((z) => {
        const instruction = rng.pick(["EVACUATE_VIA", "EVACUATE_VIA", "EVACUATE_VIA", "HOLD", "MOVE_TO_COMPARTMENT"] as const);
        const fi = m.floors.findIndex((f) => f.id === z.floor);
        const via = instruction === "MOVE_TO_COMPARTMENT" ? rng.pick(m.zones.filter((x) => x.floor === z.floor).map((x) => x.id)) : rng.pick(m.elementsByFloor[fi]!.map((e) => m.elements[e]!.id));
        return { zone: z.id, instruction, via, delaySec: rng.pick([0, 0, 30]) };
      }), closedRoutes: closed, inflowClosed: [] };
      try {
        const s = compileSigns(m, { policy, rv, elapsedSec: rng.pick([0, 60]) });
        compiled++;
        xs += Object.values(s).filter((x) => x.kind === "X_ALT").length;
        expect(validateSignSafety(s, m, rv)).toEqual([]);
        for (const st of Object.values(s)) if (st.kind === "X_ALT") expect(st.alt.toward).not.toBe(st.blocked);
      } catch (e) {
        expect(e).toBeInstanceOf(SignCompileError);
        rejected++;
      }
    }
    console.log(`compiled ${compiled}, rejected ${rejected}, X_ALT states checked ${xs}`);
    expect(compiled).toBeGreaterThan(20);
    expect(xs).toBeGreaterThan(0);
  });

  it("every protocol compiles to template-only occupant text", () => {

    const allowed = new Set(Object.values(templates().sign));
    for (const p of PROTOCOLS) {
      const policy = protocolPolicy(m, p, { kind: "fire", floor: "F2", at: [30, 10] }, env.hazardParams);
      const rv = routeView(m, { kind: "fire", floor: "F2", at: [30, 10] }, env.hazardParams);
      for (const s of Object.values(compileSigns(m, { policy, rv, elapsedSec: 0 }))) {
        const label = s.kind === "HOLD" || s.kind === "LOCKDOWN" ? s.label : s.kind === "X_ALT" ? s.alt.label : s.arrow.label;
        expect(allowed.has(label), `${p}: ${label}`).toBe(true);
      }
    }
  });
});

describe("plain-language input", () => {
  it("'fest night, most people don't know the building' gives low familiarity and load above 1, within bounds (lexicon fallback)", async () => {
    const r = await nl2params("fest night, most people don't know the building", env, new StubClaude("down"));
    expect(r.source).toBe("lexicon");
    expect(r.loadFactor).toBeGreaterThan(1);
    const fam = r.behaviour[`profile.${r.profile}.familiarShare`]!;
    expect(fam.value).toBeLessThan(env.params.get(`profile.${r.profile}.familiarShare`));
    for (const [k, v] of Object.entries(r.behaviour)) { expect(v.value, k).toBeGreaterThanOrEqual(v.min); expect(v.value, k).toBeLessThanOrEqual(v.max); }
  });

  it("uses the LLM rating when available, mapped into bounded parameters", async () => {
    const claude = new StubClaude("sensible", () => ({ familiarity: 0, crowdSize: 4, ageSkew: 1, mobility: 2, grouping: 4, urgency: 3, compliance: 1 }));
    const r = await nl2params("fest night, most people don't know the building", env, claude);
    expect(r.source).toBe("llm");
    expect(r.behaviour["profile.college.familiarShare"]!.value).toBe(env.params.entry("profile.college.familiarShare").min);
    expect(r.loadFactor).toBe(2);
  });
});
