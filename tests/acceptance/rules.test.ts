import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../../src/shared/paths.ts";
import { PERSONA_LABEL } from "../../src/policy/personas.ts";
import { RATING_DISCLAIMER } from "../../src/design/rating.ts";
import { BRIEF_NOTICE } from "../../src/live/liaison.ts";
import { CODE_DISCLAIMER } from "../../src/design/codecheck.ts";
import { makeWorld, runSync } from "../../src/sim/run.ts";
import { miniBuilding } from "../../src/twin/synthetic.ts";
import { envFor, scenario } from "../helpers/sim.ts";

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(f)) out.push(p);
  }
  return out;
}
const SRC = files(repoPath("src"), /\.ts$/);
const WEB = (() => { try { return files(repoPath("web", "src"), /\.(ts|tsx)$/); } catch { return []; } })();
const TEXT = [...SRC, ...WEB, repoPath("config", "templates.json"), repoPath("README.md")];
const read = (f: string) => readFileSync(f, "utf8");
const strings = (s: string) => [...s.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]!).concat([...s.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!));

describe("language rules", () => {
  it("no banned claims appear in any user-facing string", () => {
    const banned = [/saves? lives/i, /life-saving/i, /\bcasualt/i, /\bfatalit/i, /death toll/i, /\binjur(y|ies) estimate/i, /validated against real evacuations(?!")/i, /building is unsafe/i, /\bunsafe building\b/i, /predicted behaviou?r/i, /predicts? how people/i, /persona predictions?/i];
    const hits: string[] = [];
    for (const f of TEXT) for (const s of strings(read(f))) {
      if (s.includes("not validated against real evacuations") || s.includes("not a certification") || s.includes("not certification")) continue;
      const negated = /\b(not|never|no)\b[^.]{0,60}(casualt|fatalit)/i.test(s);
      for (const b of banned) if (b.test(s) && !(negated && /casualt|fatalit/.test(b.source))) hits.push(`${f.replace(repoPath(), "")}: ${s.slice(0, 80)}`);
      if (/\bcertif(ied|ication)\b/i.test(s) && !/not (a )?certification|never claim|no claims? of certification|claim .*certification/i.test(s)) hits.push(`${f.replace(repoPath(), "")}: ${s.slice(0, 80)}`);
    }
    expect(hits).toEqual([]);
  });

  it("required labels exist and are shown where they belong", () => {
    expect(PERSONA_LABEL).toBe("modelled behaviour, not validated against real evacuations");
    expect(RATING_DISCLAIMER).toBe("Decision support for professional safety review, not certification.");
    expect(BRIEF_NOTICE).toMatch(/A human calls 112; EXITMIND never contacts anyone/);
    expect(CODE_DISCLAIMER).toMatch(/Passes on paper/i);
    const web = WEB.map(read).join("\n");
    if (WEB.length) {
      expect(web).toMatch(/modelled behaviour, not validated against real evacuations|PERSONA_LABEL|\.label/);
      expect(web).toMatch(/passes on paper/i);
      expect(web).toMatch(/Decision support for professional safety review, not certification\.|disclaimer/);
      expect(web).toMatch(/A human calls 112\. EXITMIND never contacts anyone\./);
    }
  });
});

describe("constraints", () => {
  it("network egress: only the two LLM APIs and the public drawing sheets are ever addressed", () => {
    const allowed = [/^https:\/\/api\.anthropic\.com/, /^https:\/\/api\.typesafe\.ai/, /^http:\/\/coremng\.dcp\.ufl\.edu\/rinkerhall\//, /^https?:\/\/(localhost|127\.0\.0\.1|x)(:|\/|$)/, /^http:\/\/\$\{/, /^https?:\/\/\$\{/];
    const bad: string[] = [];
    const buildTimeOnly: Record<string, RegExp> = { "/src/cli/venue-osm.ts": /^https:\/\/overpass-api\.de\/api\/interpreter/ };
    for (const f of SRC) for (const m of read(f).matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      const rel = f.replace(repoPath(), "");
      if (!allowed.some((a) => a.test(m[0])) && !buildTimeOnly[rel]?.test(m[0])) bad.push(`${rel}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
    const all = SRC.map(read).join("\n");
    expect(all).not.toMatch(/twilio|sendgrid|nodemailer|smtp|webhook|tel:|sms:/i);
    expect(all).not.toMatch(/\bfetch\(\s*["'`]http/);
  });

  it("the fire alarm panel is observed only: nothing in EXITMIND can clear or silence it", () => {
    const sensors = read(repoPath("src", "live", "sensors.ts"));
    expect(sensors).toMatch(/get panelAlarm\(\)/);
    expect(sensors.match(/this\.#panelAlarm = /g)?.length).toBe(1);
    expect(sensors).toMatch(/this\.#panelAlarm = true/);
    for (const f of SRC) expect(read(f), f).not.toMatch(/this\.#?panelAlarm\s*=\s*false|silenceAlarm|suppressAlarm|resetPanel/);
  });

  it("occupant-facing text comes only from templates: the sign path never imports an LLM client", () => {
    for (const f of ["live/signs.ts", "live/signcompiler.ts", "live/gate.ts"]) {
      const s = read(repoPath("src", ...f.split("/")));
      expect(s, f).not.toMatch(/from "[^"]*(llm\/|claude|typesafe|liaison|planner)[^"]*"/);
    }
    const sign = WEB.filter((f) => f.includes(`${join("src", "sign")}`)).map(read).join("\n");
    if (sign) expect(sign).not.toMatch(/\/api\/live\/brief|rationale/);
  });

  it("no camera or personal data: no media capture APIs, no name/phone/email fields", () => {
    const all = [...SRC, ...WEB].map(read).join("\n");
    expect(all).not.toMatch(/getUserMedia|mediaDevices|navigator\.geolocation|capture=/);
    // The only file input is the architectural plan upload: plan files only, no camera capture.
    const fileInputs = [...SRC, ...WEB].filter((f) => /input[^>]*type=["']file/.test(read(f)));
    expect(fileInputs.map((f) => f.replace(repoPath(), ""))).toEqual(["/web/src/pages/PlanEditor.tsx"]);
    expect(read(fileInputs[0]!)).toMatch(/type="file" accept="application\/pdf,image\/png,image\/jpeg"/);
    expect(all).not.toMatch(/phoneNumber|emailAddress|fullName|dateOfBirth/);
  });

  it("real numbers: two different scenarios give different computed figures (nothing is a fixed literal)", () => {
    const env = envFor(miniBuilding());
    const a = runSync(makeWorld(env, scenario({ seed: 1 })));
    const b = runSync(makeWorld(env, scenario({ seed: 1, hazard: { kind: "quake", damaged: ["ST-B"] } })));
    expect(a.clearance95Sec).not.toBe(b.clearance95Sec);
    expect(a.exitUsage).not.toEqual(b.exitUsage);
  });
});
