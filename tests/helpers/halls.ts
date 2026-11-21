import { draftToTwin, type PlanDraft } from "../../src/plans/draft.ts";

export const HALL_META = { id: "0000000000aa", name: "Bottleneck hall", width: 400, height: 300, source: "test", createdAt: "2026-11-21T00:00:00Z" };
/** 100 x 60 ft hall (0.5 ft/px): a 3 ft west exit next to where the crowd stands, a 12 ft east exit at the far end, an interior partition with one door. */
export function bottleneckHall(over: Partial<PlanDraft> = {}): PlanDraft {
  return {
    outline: [[100, 90], [300, 90], [300, 210], [100, 210]],
    walls: [{ a: [160, 90], b: [160, 170] }],
    doors: [],
    exits: [{ a: [100, 147], b: [100, 153], name: "West door", main: true }, { a: [300, 126], b: [300, 150], name: "East doors", main: false }],
    obstacles: [], labels: [], stage: null, scale: { ftPerPx: 0.5, evidence: "test" }, edited: true, ...over,
  };
}
export const hallTwin = (over: Partial<PlanDraft> = {}) => draftToTwin(bottleneckHall(over), HALL_META);
