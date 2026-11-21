import { z } from "zod";
import { ClaudeClient, type ClaudeLike } from "../llm/claude.ts";
import { env } from "../shared/env.ts";
import type { SimEnv } from "../sim/run.ts";
import type { ProfileId } from "../sim/types.ts";
import type { Nl2ParamsResult } from "../server/contract.ts";

export const DIMENSIONS = ["familiarity", "crowdSize", "ageSkew", "mobility", "grouping", "urgency", "compliance"] as const;
type Dim = (typeof DIMENSIONS)[number];
type Levels = Record<Dim, number>;

const LEXICON: Record<Dim, { low: string[]; high: string[] }> = {
  familiarity: { low: ["don't know the building", "dont know the building", "do not know the building", "first time", "visitors", "strangers", "new students", "unfamiliar", "open day", "guests"], high: ["regulars", "staff only", "know the building", "familiar", "everyday", "usual occupants"] },
  crowdSize: { low: ["quiet", "empty", "few people", "after hours", "night shift", "weekend"], high: ["fest", "festival", "packed", "crowded", "full house", "concert", "event", "sold out", "busy", "graduation"] },
  ageSkew: { low: ["kids", "children", "school", "students", "young", "teen"], high: ["elderly", "older", "seniors", "retirees", "patients", "aged"] },
  mobility: { low: ["athletes", "fit"], high: ["wheelchair", "patients", "elderly", "mobility", "disabled", "injured", "crutches"] },
  grouping: { low: ["alone", "individual", "commuters"], high: ["groups", "friends", "families", "fest", "party", "class groups", "tour"] },
  urgency: { low: ["calm", "relaxed", "drill", "no rush"], high: ["panic", "urgent", "smoke", "fire", "screaming", "rush", "chaos"] },
  compliance: { low: ["ignore", "drunk", "rowdy", "don't listen", "distracted", "party"], high: ["disciplined", "trained", "drilled", "staff", "follow instructions", "obedient"] },
};

export function lexiconLevels(text: string): Levels {
  const t = text.toLowerCase();
  const out = {} as Levels;
  for (const d of DIMENSIONS) {
    const lo = LEXICON[d].low.filter((k) => t.includes(k)).length, hi = LEXICON[d].high.filter((k) => t.includes(k)).length;
    out[d] = hi > lo ? (hi > 1 ? 4 : 3) : lo > hi ? (lo > 1 ? 0 : 1) : 2;
  }
  return out;
}

export function inferProfile(text: string): ProfileId {
  const t = text.toLowerCase();
  if (/hospital|ward|patients|clinic|nurse/.test(t)) return "hospital";
  if (/school|kids|children|pupils|class trip/.test(t)) return "school";
  if (/mall|shopping|shoppers|retail|store/.test(t)) return "mall";
  return "college";
}

const lerp = (lo: number, hi: number, level: number) => lo + ((hi - lo) * level) / 4;

export function levelsToParams(text: string, lv: Levels, simEnv: SimEnv, source: Nl2ParamsResult["source"]): Nl2ParamsResult {
  const profile = inferProfile(text);
  const P = simEnv.params;
  const out: Nl2ParamsResult["behaviour"] = {};
  const set = (key: string, level: number, why: string, invert = false) => {
    const e = P.entry(key);
    const v = Math.round(lerp(e.min, e.max, invert ? 4 - level : level) * 1000) / 1000;
    out[key] = { value: P.clamp(key, v), min: e.min, max: e.max, why };
  };
  set(`profile.${profile}.familiarShare`, lv.familiarity, `familiarity level ${lv.familiarity}/4`);
  set(`profile.${profile}.groupFraction`, lv.grouping, `grouping level ${lv.grouping}/4`);
  set(`premove.medianSec.${profile}`, lv.urgency, `urgency level ${lv.urgency}/4 (higher urgency, shorter delay)`, true);
  set("sign.compliance.base", lv.compliance, `compliance level ${lv.compliance}/4`);
  for (const k of ["slow", "wheelchair", "crutches"]) set(`profile.${profile}.share.${k}`, lv.mobility, `mobility-impaired level ${lv.mobility}/4`);
  const t = text.toLowerCase();
  const occupancy: Nl2ParamsResult["occupancy"] = /night shift|after hours|weekend|empty/.test(t) ? "after_hours" : /lecture|class|exam/.test(t) ? "classes_full" : "uniform";
  const loadFactor = [0.5, 0.75, 1, 1.5, 2][lv.crowdSize]!;
  const a = lv.ageSkew;
  const personaMix = { child: a <= 0 ? 0.6 : a === 1 ? 0.2 : 0.02, young_adult: a <= 1 ? 0.3 : a === 2 ? 0.6 : 0.2, adult: a >= 3 ? 0.3 : 0.25, older_adult: a >= 4 ? 0.48 : a === 3 ? 0.28 : 0.03 };
  const sum = Object.values(personaMix).reduce((x, y) => x + y, 0);
  return { text, profile, occupancy, loadFactor, behaviour: out, personaMix: Object.fromEntries(Object.entries(personaMix).map(([k, v]) => [k, Math.round((v / sum) * 1000) / 1000])), source };
}

export async function nl2params(text: string, simEnv: SimEnv, claude: ClaudeLike = new ClaudeClient()): Promise<Nl2ParamsResult> {
  if (!text.trim()) throw new Error("describe the crowd in a sentence");
  if (claude.available()) {
    try {
      const level = { type: "integer", enum: [0, 1, 2, 3, 4] };
      const lv = await claude.json({
        role: "parser", model: env("PERSONA_HAIKU_MODEL") ?? "claude-haiku-5-5", maxTokens: 120, timeoutMs: 4000,
        system: "Rate a short description of a building's occupants on fixed 0-4 scales (2 = typical). familiarity: how well people know the building. crowdSize: how full it is. ageSkew: 0 mostly children, 4 mostly elderly. mobility: share with reduced mobility. grouping: how much people move in groups. urgency: how urgently people react. compliance: how readily people follow instructions. Answer only with the ratings.",
        user: text.slice(0, 500),
        schema: { type: "object", properties: Object.fromEntries(DIMENSIONS.map((d) => [d, level])), required: [...DIMENSIONS], additionalProperties: false },
        parse: z.object(Object.fromEntries(DIMENSIONS.map((d) => [d, z.number().int().min(0).max(4)])) as Record<Dim, z.ZodNumber>),
      });
      return levelsToParams(text, lv as Levels, simEnv, "llm");
    } catch { /* fall through to the lexicon */ }
  }
  return levelsToParams(text, lexiconLevels(text), simEnv, "lexicon");
}
