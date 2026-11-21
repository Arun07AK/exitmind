import type { Stair } from "../../../src/twin/schema.ts";
import { rect, src } from "./helpers.ts";

export const stairs: Stair[] = [
  {
    id: "ST-A",
    name: "Central stair (S198A / S298A / S398A)",
    enclosed: true,
    countsAsCodeExit: true,
    clearWidthIn: 48,
    riserIn: 7.0,
    treadIn: 11,
    spaces: { F1: "S198A", F2: "S298A", F3: "S398A" },
    flights: [
      { from: "F3", to: "F2", travelFt: 29.4, head: rect(71, 15.5, 75, 19.5), landing: rect(75.6, 15.5, 79.5, 19.5) },
      { from: "F2", to: "F1", travelFt: 31.7, head: rect(71, 15.5, 75, 19.5), landing: rect(75.6, 15.5, 79.5, 19.5) },
    ],
    src: src("A603", "dimensioned", {
      detail: "5-8",
      note: "A108 PROVIDED 48 in used as clear width; A603 det. 6 flight strings 4'-7 1/2\" and 4'-6 1/2\"; sect. 8: 12+12 risers F1-F2 (168 in / 24 = 7.0 in), 11+11 risers F2-F3 (150 in / 22 = 6.82 in), 11 in treads",
    }),
  },
  {
    id: "ST-B",
    name: "South stair (S198B / S298B / S398B)",
    enclosed: true,
    countsAsCodeExit: true,
    clearWidthIn: 48,
    riserIn: 7.0,
    treadIn: 11,
    spaces: { F1: "S198B", F2: "S298B", F3: "S398B" },
    flights: [
      { from: "F3", to: "F2", travelFt: 28.4, head: rect(206.2, 38.5, 209.8, 42.3), landing: rect(202, 38.5, 205.7, 42.3) },
      { from: "F2", to: "F1", travelFt: 30.7, head: rect(206.2, 38.5, 209.8, 42.3), landing: rect(202, 38.5, 205.7, 42.3) },
    ],
    src: src("A603", "dimensioned", {
      detail: "1-3",
      note: "A108 PROVIDED 48 in; A603 flights 4'-1\" each, overall 16'-7 1/2\"; risers/treads assumed equal to the central stair (same floor-to-floor heights)",
    }),
  },
  {
    id: "ST-ATR",
    name: "Atrium stair (open)",
    enclosed: false,
    countsAsCodeExit: false,
    clearWidthIn: 48,
    riserIn: 7.0,
    treadIn: 11,
    spaces: {},
    flights: [
      { from: "F3", to: "F2", travelFt: 32.4, head: rect(146.2, 28.6, 149.6, 32.9), landing: rect(111, 28.8, 115.5, 32.8) },
      { from: "F2", to: "F1", travelFt: 31.8, head: rect(98.4, 28.6, 102, 32.8), landing: rect(66.4, 28.8, 70.1, 32.8) },
    ],
    src: src("A602", "dimensioned", {
      detail: "3, 5",
      note: "plan strings: F1-F2 15 treads 13'-9\" + landing 7'-2 1/2\" + 7 treads 6'-5\"; F2-F3 10 treads 9'-2\" + landing 10'-3\" + 10 treads 9'-2\"; width ~4'-5\" between guard lines scaled, 48 in clear assumed",
    }),
  },
];
