import type { FloorId, Pt, SignMount } from "../../../src/twin/schema.ts";
import { src } from "./helpers.ts";

const m = (id: string, floor: FloorId, at: Pt, facing: Pt, space: string, staticDefaultToward: string): SignMount => ({
  id, floor, at, facing, space, staticDefaultToward,
  src: src(floor === "F1" ? "A107" : "A108", "assumed", { note: "EXITMIND proposed sign location" }),
});

export const signMounts: SignMount[] = [
  m("SM-1F-01", "F1", [60, 30], [1, 0], "C199A", "EX-N"),
  m("SM-1F-02", "F1", [49.2, 51], [0, 1], "C199B", "EX-N"),
  m("SM-1F-03", "F1", [110, 39], [1, 0], "C199D", "EX-W"),
  m("SM-1F-04", "F1", [192, 38], [-1, 0], "C199D", "EX-S"),
  m("SM-2F-01", "F2", [65, 22], [0, 1], "C299A", "EX-2A"),
  m("SM-2F-02", "F2", [66, 41.8], [1, 0], "C299A", "EX-2A"),
  m("SM-2F-03", "F2", [133, 41.8], [-1, 0], "C299A", "EX-2B"),
  m("SM-2F-04", "F2", [194, 41.8], [-1, 0], "C299A", "EX-2B"),
  m("SM-3F-01", "F3", [65, 22], [0, 1], "C399A", "EX-3A"),
  m("SM-3F-02", "F3", [105, 41.1], [1, 0], "C399A", "EX-3A"),
  m("SM-3F-03", "F3", [120, 65.8], [1, 0], "C399C", "EX-3A"),
  m("SM-3F-04", "F3", [195, 41.1], [-1, 0], "C399B", "EX-3B"),
];
