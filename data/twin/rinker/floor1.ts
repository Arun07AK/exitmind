import type { Floor, Portal, Pt, Space, SpaceKind, SpaceUse } from "../../../src/twin/schema.ts";
import { rect, src } from "./helpers.ts";

const F = "F1" as const;
const S = src("A107", "scaled", { note: "traced on A107 egress plan, cross-checked on A102" });
const ASSUMED = src("A102", "assumed", { note: "34 in per leaf assumed; position scaled from door swing on A102/A107" });

interface Opts { occupiable?: boolean; lockable?: boolean; axis?: [Pt, Pt]; clearWidthFt?: number; fixedSeats?: number }
const sp = (id: string, name: string, kind: SpaceKind, use: SpaceUse, polygon: Pt[], o: Opts = {}): Space => ({
  id, name, floor: F, kind, use, polygon,
  occupiable: o.occupiable ?? true, lockable: o.lockable ?? false,
  ...(o.axis ? { axis: o.axis } : {}), ...(o.clearWidthFt ? { clearWidthFt: o.clearWidthFt } : {}),
  src: S,
});
let n = 0;
const door = (a: Pt, b: Pt, s1: string, s2: string, leaves = 1): Portal => ({
  id: `D-F1-${String(++n).padStart(3, "0")}`, floor: F, kind: "door", a, b, clearWidthIn: 34 * leaves, connects: [s1, s2], accessible: true, src: ASSUMED,
});
const opening = (a: Pt, b: Pt, s1: string, s2: string): Portal => ({
  id: `D-F1-${String(++n).padStart(3, "0")}`, floor: F, kind: "opening", a, b, clearWidthIn: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 12), connects: [s1, s2], accessible: true,
  src: src("A107", "scaled", { note: "no wall drawn; width = full shared boundary" }),
});
const exitDoor = (id: string, a: Pt, b: Pt, s: string, widthIn: number, accessible = true): Portal => ({
  id, floor: F, kind: "door", a, b, clearWidthIn: widthIn, connects: [s, "OUTSIDE"], accessible, src: src("A107", "printed", { note: "PROVIDED width printed on egress plan; position scaled" }),
});

const spaces: Space[] = [
  sp("C199A", "Lobby", "lobby", "circulation", [[40, 0], [60, 0], [60, 9.1], [70.3, 9.1], [70.3, 45.2], [46, 45.2], [46, 44.4], [40, 44.4]]),
  sp("E197A", "Elevator", "elevator", "service", rect(60, 0, 70.3, 9.1), { occupiable: false }),
  sp("S198A", "Central stair", "stair", "circulation", rect(70.3, 0, 80, 19.9), { occupiable: false }),
  sp("0146A", "Mech. room", "service", "service", rect(70.3, 19.9, 80, 28.2), { occupiable: false }),
  sp("0146", "Women", "service", "restroom", rect(80, 0, 90.3, 28.2), { occupiable: false }),
  sp("0145", "Men", "service", "restroom", rect(90.3, 0, 100.2, 28.2), { occupiable: false }),
  sp("0140A", "Storage", "room", "storage", rect(100.2, 0, 120, 22.6), { lockable: true }),
  sp("0143", "Interview", "room", "office", rect(100.2, 22.6, 110.2, 33.3), { lockable: true }),
  sp("0141", "Interview", "room", "office", rect(110.2, 22.6, 120, 33.3), { lockable: true }),
  sp("0140", "Structures studio", "room", "lab", rect(120, 0, 160, 33.3), { lockable: true }),
  sp("0138", "Soils & concrete lab", "room", "lab", rect(160, 0, 186, 28.3), { lockable: true }),
  sp("0136", "Shop", "room", "lab", rect(186, 0, 201.5, 19.3), { lockable: true }),
  sp("0134", "Shower", "service", "restroom", rect(191.5, 19.3, 201.3, 28.4), { occupiable: false }),
  sp("S198B", "South stair", "stair", "circulation", [[201.3, 26.2], [210, 26.2], [210, 59.2], [201.6, 59.2], [201.6, 42.6], [200.3, 42.6], [200.3, 28.4], [201.3, 28.4]], { occupiable: false }),
  sp("C199D", "Corridor", "corridor", "circulation", [
    [70.3, 33.1], [81, 33.1], [81, 28.2], [100.2, 28.2], [100.2, 33.3], [160, 33.3], [160, 28.3], [186, 28.3], [186, 19.3], [191.5, 19.3], [191.5, 28.4],
    [200.3, 28.4], [200.3, 42.6], [201.6, 42.6], [201.6, 43.7], [190, 43.7], [190, 45.2], [70.3, 45.2],
  ], { axis: [[71, 39.2], [200, 39.2]], clearWidthFt: 10.4 }),
  sp("C199B", "Corridor", "corridor", "circulation", rect(46, 45.2, 52.5, 58.8), { axis: [[49.25, 45.2], [49.25, 58.8]], clearWidthFt: 6.5 }),
  sp("0110A", "Elec.", "service", "service", rect(52.5, 45.2, 60.2, 58.8), { occupiable: false }),
  sp("0106", "Medium classroom", "room", "classroom", rect(19.7, 44.4, 46, 82.3), { lockable: true }),
  sp("0110", "Large classroom", "room", "assembly", [[46, 58.8], [60.2, 58.8], [60.2, 45.2], [100.2, 45.2], [100.2, 82.3], [46, 82.3]], { lockable: true }),
  sp("C199C", "Entry / exhibit", "lobby", "circulation", rect(100.2, 45.2, 120.2, 82.3)),
  sp("0115", "Student org. / lounge", "room", "assembly", rect(120.2, 45.2, 134.2, 82.3), { lockable: true }),
  sp("0125", "M.E.P. studio", "room", "lab", rect(134.2, 45.2, 190, 82.3), { lockable: true }),
];

const portals: Portal[] = [
  opening([70.3, 33.1], [70.3, 45.2], "C199A", "C199D"),
  opening([46, 45.2], [52.5, 45.2], "C199A", "C199B"),
  door([70.3, 16.8], [70.3, 19.8], "C199A", "S198A"),
  door([70.3, 24.4], [70.3, 27.4], "C199A", "0146A"),
  door([83.3, 28.2], [86.3, 28.2], "C199D", "0146"),
  door([96, 28.2], [99.1, 28.2], "C199D", "0145"),
  door([100.6, 33.3], [103.6, 33.3], "C199D", "0143"),
  door([116.8, 33.3], [119.8, 33.3], "C199D", "0141"),
  door([120, 1.5], [120, 9.5], "0140A", "0140", 2),
  door([120.8, 33.3], [123.8, 33.3], "C199D", "0140"),
  door([160, 28.8], [160, 31.8], "C199D", "0140"),
  door([160, 0.8], [160, 4.8], "0140", "0138"),
  door([181.6, 28.3], [185.6, 28.3], "C199D", "0138"),
  door([186, 0.8], [186, 4.8], "0138", "0136"),
  door([186.6, 19.3], [189.5, 19.3], "C199D", "0136"),
  door([191.5, 19.8], [191.5, 22.8], "C199D", "0134"),
  door([200.3, 37.3], [200.3, 40.4], "C199D", "S198B"),
  opening([100.2, 45.2], [120.2, 45.2], "C199D", "C199C"),
  door([120.8, 45.2], [123.8, 45.2], "C199D", "0115"),
  door([134.6, 45.2], [137.6, 45.2], "C199D", "0125"),
  door([185.7, 45.2], [188.7, 45.2], "C199D", "0125"),
  door([46, 46.8], [46, 52.2], "C199B", "0106", 2),
  door([46.4, 58.8], [52.4, 58.8], "C199B", "0110", 2),
  door([52.5, 46.5], [52.5, 57.5], "C199B", "0110A", 2),
  door([100.2, 71.2], [100.2, 74.4], "0110", "C199C"),
  exitDoor("X-F1-1", [40, 29.8], [40, 42.2], "C199A", 136),
  exitDoor("X-F1-2", [107.2, 82.3], [112.8, 82.3], "C199C", 68),
  exitDoor("X-F1-3", [210, 37.6], [210, 40.4], "S198B", 34, false),
  exitDoor("X-F1-4", [106.2, 0], [114, 0], "0140A", 68),
  exitDoor("X-F1-5", [166, 0], [173.8, 0], "0138", 68),
];

export const floor1: Floor = {
  id: F,
  name: "First floor",
  elevationFt: 155.0,
  outline: [
    [39.5, -0.5], [202, -0.5], [202, 25.7], [210.5, 25.7], [210.5, 59.7], [201, 59.7], [201, 44.2], [190.5, 44.2], [190.5, 82.8],
    [19.2, 82.8], [19.2, 43.9], [39.5, 43.9],
  ],
  voids: [],
  spaces,
  portals,
};
