import type { AgentReply, Spec, VenueInfo } from "./spec.ts";
import { QUESTION, missingRequired } from "./spec.ts";

const EVENT_WORDS: [RegExp, Spec["eventType"]][] = [
  [/\b(concert|gig|live music|band|dj night|star night)\b/i, "concert"], [/\b(fest|festival|saturnalia|carnival|fete)\b/i, "fest"],
  [/\b(lecture|class|seminar)\b/i, "lecture"], [/\bexam/i, "exam"], [/\b(match|sports|tournament|game)\b/i, "sports"],
  [/\b(conference|summit|convention)\b/i, "conference"], [/\b(exhibition|expo|fair)\b/i, "exhibition"],
];
const EMERGENCY_WORDS: [RegExp, Spec["emergency"]][] = [
  [/\b(fire|smoke|blaze)\b/i, "fire"], [/\b(earthquake|quake|tremor)\b/i, "quake"], [/\b(stampede|crush|surge)\b/i, "crush"],
  [/\b(shooter|attacker|threat|knife|gunman|armed)\b/i, "threat"], [/\b(medical|collapse|faint|cardiac)\b/i, "medical"],
];

export function parseLexicon(transcript: string, venues: VenueInfo[]): AgentReply {
  const t = transcript;
  const assumptions: string[] = [];
  const size = t.match(/(\d[\d,]*)\s*(k\b|thousand)?\s*(people|students|attendees|persons|visitors|fans|guests|crowd)/i) ?? t.match(/crowd (?:of|size)\s*(\d[\d,]*)/i);
  let crowdSize: number | null = size ? Number(size[1]!.replace(/,/g, "")) * (size[2] ? 1000 : 1) : null;
  if (!crowdSize) { const bare = t.match(/^\s*(\d[\d,]{1,6})\s*$/m); if (bare) crowdSize = Number(bare[1]!.replace(/,/g, "")); }
  const range = t.match(/(?:aged?|ages?)\s*(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/i) ?? t.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:year|yr)/i);
  let ages: Spec["ages"] = null, ageText: string | null = null;
  if (range) {
    const lo = Number(range[1]), hi = Number(range[2]);
    ageText = `${lo}-${hi}`;
    const band = (a: number) => (a < 13 ? "child" : a < 25 ? "young_adult" : a < 60 ? "adult" : "older_adult");
    ages = { child: 0, young_adult: 0, adult: 0, older_adult: 0 };
    for (let a = lo; a <= hi; a++) ages[band(a)] += 1 / (hi - lo + 1);
  } else if (/\b(students|college|university|undergrad)/i.test(t)) { ages = { child: 0, young_adult: 0.9, adult: 0.1, older_adult: 0 }; ageText = "students"; }
  else if (/\b(kids|children|school)/i.test(t)) { ages = { child: 0.85, young_adult: 0, adult: 0.15, older_adult: 0 }; ageText = "children"; }
  else if (/\b(elderly|seniors|older)/i.test(t)) { ages = { child: 0, young_adult: 0, adult: 0.4, older_adult: 0.6 }; ageText = "older adults"; }
  else if (/\b(adults|families)/i.test(t)) { ages = { child: 0.15, young_adult: 0.2, adult: 0.55, older_adult: 0.1 }; ageText = "mixed adults"; }
  const eventType = EVENT_WORDS.find(([r]) => r.test(t))?.[1] ?? null;
  const emergency = EMERGENCY_WORDS.find(([r]) => r.test(t))?.[1] ?? null;
  const venue = /\b(thapar|tiet|saturnalia|fete)\b/i.test(t) ? "thapar-fete" : /\brinker\b/i.test(t) ? "rinker-hall" : null;
  const v = venues.find((x) => x.id === (venue ?? "rinker-hall"));
  const blockedExits: string[] = [];
  if (/main (gate|entrance|exit)[^.]*\b(blocked|closed|locked|jammed)/i.test(t) || /\b(blocked|closed|locked)[^.]*main (gate|entrance)/i.test(t)) {
    const main = v?.exits.find((e) => /^Main/i.test(e.name));
    if (main) blockedExits.push(main.id);
  }
  for (const e of v?.exits ?? []) if (new RegExp(`\\b${e.id}\\b[^.]*\\b(blocked|closed)`, "i").test(t)) blockedExits.push(e.id);
  const spec: Spec = {
    eventType, eventLabel: t.split(/[.\n]/)[0]!.slice(0, 120), venue, crowdSize, ages, ageText,
    roles: null, familiarity: null, mobility: /wheelchair/i.test(t) ? { slow: 0.03, crutches: 0.01, wheelchair: 0.02 } : null,
    emergency, emergencyWhere: null, blockedExits: [...new Set(blockedExits)],
    compliance: /\b(drunk|rowdy|ignore)/i.test(t) ? "low" : null, urgency: /\b(panic|chaos)/i.test(t) ? "high" : null, conditions: [],
  };
  const missing = missingRequired(spec);
  if (!venue && !/\b(my|our|uploaded) (plan|venue|building|hall)\b/i.test(t)) assumptions.push("No venue named: using Rinker Hall.");
  if (!emergency) assumptions.push("No emergency type given: simulating a fire near the middle of the venue.");
  return { status: missing.length ? "needs_info" : "ready", missing, questions: missing.map((k) => QUESTION[k]), assumptions, summary: "", spec };
}
