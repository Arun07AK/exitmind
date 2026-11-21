import { finalizeTwin } from "./build.ts";
import type { Floor, Pt, SourceRef, Stair, Twin } from "./schema.ts";

const SRC: SourceRef = { sheet: "A107", basis: "assumed", note: "synthetic test geometry, not Rinker Hall" };
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const CODE: Twin["codeBasis"] = {
  occupantLoadSqftPerPerson: 100, egressInPerPerson: { corridorsDoors: 0.2, stairs: 0.3 }, minDoorClearIn: 32, minCorridorIn: 44, minCorridorSmallLoadIn: 36,
  minExits: 2, travelDistanceFt: { nfpa101: 200, sbc: 250 }, commonPathFt: 100, deadEndFt: 20, twoDoorRoomLoad: 50, twoDoorTravelFt: 75,
  grossAreaSqft: { F1: 0, F2: 0, F3: 0 }, src: SRC,
};

export function singleDoorRoom(sizeFt = 40, doorIn = 36): Twin {
  const half = doorIn / 24;
  const floor: Floor = {
    id: "F1", name: "Test floor", elevationFt: 0, outline: rect(0, 0, sizeFt, sizeFt), voids: [],
    spaces: [{ id: "R1", name: "Test room", floor: "F1", kind: "room", use: "assembly", polygon: rect(0, 0, sizeFt, sizeFt), occupiable: true, lockable: false, src: SRC }],
    portals: [{ id: "D1", floor: "F1", kind: "door", a: [sizeFt, sizeFt / 2 - half], b: [sizeFt, sizeFt / 2 + half], clearWidthIn: doorIn, connects: ["R1", "OUTSIDE"], accessible: true, src: SRC }],
  };
  return finalizeTwin({
    id: "synthetic-room", name: "Single-door test room", frame: { gridX: {}, gridY: {}, north: "-x" }, floors: [floor], stairs: [],
    exits: [{ id: "EX-1", name: "Test door", floor: "F1", kind: "exterior", portal: "D1", src: SRC }],
    signMounts: [], codeBasis: CODE, sheets: [],
  });
}

export function twoFloorStair(stairWidthIn = 44): Twin {
  const mk = (id: "F1" | "F2", elev: number): Floor => ({
    id, name: `Test ${id}`, elevationFt: elev, outline: rect(0, 0, 60, 30), voids: [],
    spaces: [
      { id: `${id}-R`, name: "Room", floor: id, kind: "room", use: "assembly", polygon: rect(0, 0, 45, 30), occupiable: true, lockable: false, src: SRC },
      { id: `${id}-S`, name: "Stair", floor: id, kind: "stair", use: "circulation", polygon: rect(45, 0, 60, 30), occupiable: false, lockable: false, src: SRC },
    ],
    portals: [
      { id: `${id}-SD`, floor: id, kind: "door", a: [45, 13], b: [45, 17], clearWidthIn: 48, connects: [`${id}-R`, `${id}-S`], accessible: true, src: SRC },
      ...(id === "F1" ? [{ id: "F1-EX", floor: id, kind: "door" as const, a: [60, 13] as Pt, b: [60, 17] as Pt, clearWidthIn: 48, connects: ["F1-S", "OUTSIDE"] as [string, string], accessible: true, src: SRC }] : []),
    ],
  });
  const stair: Stair = {
    id: "ST-T", name: "Test stair", enclosed: true, countsAsCodeExit: true, clearWidthIn: stairWidthIn, riserIn: 7, treadIn: 11,
    spaces: { F1: "F1-S", F2: "F2-S" },
    flights: [{ from: "F2", to: "F1", travelFt: 40, head: rect(46, 2, 59, 10), landing: rect(46, 20, 54, 28) }],
    src: SRC,
  };
  return finalizeTwin({
    id: "synthetic-stair", name: "Two-floor stair test", frame: { gridX: {}, gridY: {}, north: "-x" }, floors: [mk("F1", 0), mk("F2", 14)], stairs: [stair],
    exits: [{ id: "EX-T", name: "Test exit", floor: "F1", kind: "exterior", portal: "F1-EX", src: SRC }, { id: "EX-T2", name: "Stair exit F2", floor: "F2", kind: "stair", portal: "F2-SD", stair: "ST-T", src: SRC }],
    signMounts: [], codeBasis: CODE, sheets: [],
  });
}

export function corridor(lengthFt = 100, widthFt = 6): Twin {
  const floor: Floor = {
    id: "F1", name: "Test corridor", elevationFt: 0, outline: rect(0, 0, lengthFt, widthFt), voids: [],
    spaces: [{ id: "C1", name: "Corridor", floor: "F1", kind: "corridor", use: "circulation", polygon: rect(0, 0, lengthFt, widthFt), occupiable: true, lockable: false, src: SRC }],
    portals: [{ id: "D1", floor: "F1", kind: "door", a: [lengthFt, 0], b: [lengthFt, widthFt], clearWidthIn: widthFt * 12, connects: ["C1", "OUTSIDE"], accessible: true, src: SRC }],
  };
  return finalizeTwin({
    id: "synthetic-corridor", name: "Corridor test", frame: { gridX: {}, gridY: {}, north: "-x" }, floors: [floor], stairs: [],
    exits: [{ id: "EX-1", name: "Corridor end", floor: "F1", kind: "exterior", portal: "D1", src: SRC }],
    signMounts: [], codeBasis: CODE, sheets: [],
  });
}

export function miniBuilding(): Twin {
  const doors = (fid: "F1" | "F2") => [
    ...[20, 60, 100, 120, 160, 185].map((x, i) => ({ id: `${fid}-D${i}`, floor: fid, kind: "door" as const, a: [x - 1.5, 20] as Pt, b: [x + 1.5, 20] as Pt, clearWidthIn: 34, connects: [`${fid}-R${x < 80 ? "N" : x < 140 ? "C" : "S"}`, `${fid}-COR`] as [string, string], accessible: true, src: SRC })),
    { id: `${fid}-SDA`, floor: fid, kind: "door" as const, a: [25, 30] as Pt, b: [29, 30] as Pt, clearWidthIn: 44, connects: [`${fid}-COR`, `${fid}-STA`] as [string, string], accessible: true, src: SRC },
    { id: `${fid}-SDB`, floor: fid, kind: "door" as const, a: [170, 30] as Pt, b: [174, 30] as Pt, clearWidthIn: 44, connects: [`${fid}-COR`, `${fid}-STB`] as [string, string], accessible: true, src: SRC },
  ];
  const spaces = (fid: "F1" | "F2") => [
    { id: `${fid}-RN`, name: "North room", floor: fid, kind: "room" as const, use: "classroom" as const, polygon: rect(0, 0, 80, 20), occupiable: true, lockable: true, src: SRC },
    { id: `${fid}-RC`, name: "Central room", floor: fid, kind: "room" as const, use: "classroom" as const, polygon: rect(80, 0, 140, 20), occupiable: true, lockable: true, src: SRC },
    { id: `${fid}-RS`, name: "South room", floor: fid, kind: "room" as const, use: "office" as const, polygon: rect(140, 0, 200, 20), occupiable: true, lockable: true, src: SRC },
    { id: `${fid}-COR`, name: "Corridor", floor: fid, kind: "corridor" as const, use: "circulation" as const, polygon: rect(0, 20, 200, 30), occupiable: true, lockable: false, axis: [[0, 25], [200, 25]] as [Pt, Pt], clearWidthFt: 10, src: SRC },
    { id: `${fid}-STA`, name: "Stair A", floor: fid, kind: "stair" as const, use: "circulation" as const, polygon: rect(20, 30, 36, 46), occupiable: false, lockable: false, src: SRC },
    { id: `${fid}-STB`, name: "Stair B", floor: fid, kind: "stair" as const, use: "circulation" as const, polygon: rect(164, 30, 180, 46), occupiable: false, lockable: false, src: SRC },
  ];
  const outline: Pt[] = [[0, 0], [200, 0], [200, 30], [180, 30], [180, 46], [164, 46], [164, 30], [36, 30], [36, 46], [20, 46], [20, 30], [0, 30]];
  const f1: Floor = { id: "F1", name: "Mini F1", elevationFt: 0, outline, voids: [], spaces: spaces("F1"), portals: [
    ...doors("F1"),
    { id: "F1-EXW", floor: "F1", kind: "door", a: [0, 21], b: [0, 29], clearWidthIn: 68, connects: ["F1-COR", "OUTSIDE"], accessible: true, src: SRC },
    { id: "F1-EXE", floor: "F1", kind: "door", a: [200, 21], b: [200, 29], clearWidthIn: 68, connects: ["F1-COR", "OUTSIDE"], accessible: true, src: SRC },
  ] };
  const f2: Floor = { id: "F2", name: "Mini F2", elevationFt: 14, outline, voids: [], spaces: spaces("F2"), portals: doors("F2") };
  const stair = (id: string, name: string, x0: number, sp: string): Stair => ({
    id, name, enclosed: true, countsAsCodeExit: true, clearWidthIn: 44, riserIn: 7, treadIn: 11, spaces: { F1: `F1-${sp}`, F2: `F2-${sp}` },
    flights: [{ from: "F2", to: "F1", travelFt: 30, head: rect(x0 + 1, 31, x0 + 15, 37), landing: rect(x0 + 1, 39, x0 + 15, 45) }], src: SRC,
  });
  return finalizeTwin({
    id: "synthetic-mini", name: "Mini test building", frame: { gridX: {}, gridY: {}, north: "-x" }, floors: [f1, f2],
    stairs: [stair("ST-A", "Stair A", 20, "STA"), stair("ST-B", "Stair B", 164, "STB")],
    exits: [
      { id: "EX-W", name: "West doors", floor: "F1", kind: "exterior", portal: "F1-EXW", src: SRC },
      { id: "EX-E", name: "East doors", floor: "F1", kind: "exterior", portal: "F1-EXE", src: SRC },
      { id: "EX-2A", name: "Stair A door", floor: "F2", kind: "stair", portal: "F2-SDA", stair: "ST-A", src: SRC },
      { id: "EX-2B", name: "Stair B door", floor: "F2", kind: "stair", portal: "F2-SDB", stair: "ST-B", src: SRC },
    ],
    signMounts: [
      { id: "M2-N", floor: "F2", at: [45, 25], facing: [1, 0], space: "F2-COR", staticDefaultToward: "ST-A", src: SRC },
      { id: "M2-C", floor: "F2", at: [110, 25], facing: [1, 0], space: "F2-COR", staticDefaultToward: "ST-A", src: SRC },
      { id: "M2-S", floor: "F2", at: [155, 25], facing: [-1, 0], space: "F2-COR", staticDefaultToward: "ST-B", src: SRC },
      { id: "M1-N", floor: "F1", at: [45, 25], facing: [1, 0], space: "F1-COR", staticDefaultToward: "EX-W", src: SRC },
      { id: "M1-S", floor: "F1", at: [155, 25], facing: [-1, 0], space: "F1-COR", staticDefaultToward: "EX-E", src: SRC },
    ],
    codeBasis: CODE, sheets: [],
  });
}
