import type { Floor, Portal, Pt, Space, SpaceKind, SpaceUse } from "../../../src/twin/schema.ts";
import { rect, src } from "./helpers.ts";

const F = "F3" as const;
const S = src("A108", "scaled", { note: "traced on A108 egress plan, cross-checked on A103" });
const ASSUMED = src("A103", "assumed", { note: "34 in per leaf assumed; position scaled from door swing on A103/A108" });

interface Opts { occupiable?: boolean; lockable?: boolean; axis?: [Pt, Pt]; clearWidthFt?: number }
const sp = (id: string, name: string, kind: SpaceKind, use: SpaceUse, polygon: Pt[], o: Opts = {}): Space => ({
  id, name, floor: F, kind, use, polygon,
  occupiable: o.occupiable ?? true, lockable: o.lockable ?? false,
  ...(o.axis ? { axis: o.axis } : {}), ...(o.clearWidthFt ? { clearWidthFt: o.clearWidthFt } : {}),
  src: S,
});
let n = 0;
const door = (a: Pt, b: Pt, s1: string, s2: string, leaves = 1): Portal => ({
  id: `D-F3-${String(++n).padStart(3, "0")}`, floor: F, kind: "door", a, b, clearWidthIn: 34 * leaves, connects: [s1, s2], accessible: true, src: ASSUMED,
});
const opening = (a: Pt, b: Pt, s1: string, s2: string): Portal => ({
  id: `D-F3-${String(++n).padStart(3, "0")}`, floor: F, kind: "opening", a, b, clearWidthIn: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 12), connects: [s1, s2], accessible: true,
  src: src("A108", "scaled", { note: "no wall drawn; width = full shared boundary" }),
});

const room = (id: string, name: string, use: SpaceUse, polygon: Pt[]) => sp(id, name, "room", use, polygon, { lockable: true });
const service = (id: string, name: string, use: SpaceUse, polygon: Pt[]) => sp(id, name, "service", use, polygon, { occupiable: false });

const OFFICES: [string, number, number][] = [
  ["0309", 60, 70], ["0311", 70, 80], ["0314", 80, 90], ["0315", 90, 100], ["0316", 100, 110], ["0319", 110, 120], ["0321", 120, 130.1],
  ["0322", 130.1, 140.1], ["0323", 140.1, 150.1], ["0325", 150.1, 160.1], ["0327", 160.1, 170.1], ["0329", 170.1, 180], ["0331", 180, 190.2], ["0332", 190.2, 201.5],
];

const spaces: Space[] = [
  room("0303", "Conference room", "office", [[17.8, -1.7], [30.1, -1.7], [30.1, 28.4], [19.4, 28.4], [19.4, 29.5], [-4.6, 29.5]]),
  room("0302", "Director grad. / D.E.", "office", rect(30.1, -1.7, 50.1, 11.2)),
  room("0301", "Admin. / registrar", "office", rect(50.1, -1.7, 60, 15.2)),
  room("0301A", "Career office", "office", [[30.1, 11.2], [50.1, 11.2], [50.1, 15.2], [60, 15.2], [60, 28.4], [30.1, 28.4]]),
  sp("0304", "Reception", "lobby", "office", rect(19.4, 28.4, 40.3, 43.7)),
  room("0305", "Open office", "office", rect(19.3, 43.7, 50.2, 70.5)),
  room("0306", "Director", "office", rect(19.3, 70.5, 41.5, 83.6)),
  room("0307", "Associate director", "office", [[41.5, 70.5], [50.2, 70.5], [50.2, 68], [60, 68], [60, 83.6], [41.5, 83.6]]),
  service("0308", "Storage / supply", "storage", [[50.2, 43.7], [57.3, 43.7], [57.3, 56.2], [63, 56.2], [63, 62.7], [50.2, 62.7]]),
  service("0308A", "Telephone", "service", rect(57.3, 43.7, 63, 56.2)),
  room("0310", "Mail / kitchen / copy", "office", rect(67.2, 43.7, 80, 63.8)),
  room("0312", "Faculty work room", "office", rect(80, 43.7, 102.3, 56.3)),
  room("0313", "Resource center", "office", rect(80, 56.3, 102.3, 63.8)),
  room("0320", "Grad. studio", "lab", rect(107.6, 43.7, 126.1, 63.6)),
  room("0324", "Grad. studio", "lab", rect(126.1, 43.7, 142.2, 63.6)),
  room("0326", "Grad. studio", "lab", rect(142.2, 43.7, 158, 63.6)),
  room("0328", "Grad. studio", "lab", rect(158, 43.7, 180, 63.6)),
  service("0334", "Center storage", "storage", rect(185.9, 43.7, 197.2, 63.6)),
  ...OFFICES.map(([id, x0, x1]) => room(id, "Faculty office", "office", rect(x0, 68, x1, 83.6))),
  sp("E397A", "Elevator", "elevator", "service", rect(60, -1.7, 70.2, 9), { occupiable: false }),
  sp("S398A", "Central stair", "stair", "circulation", rect(70.2, -1.7, 80, 20.1), { occupiable: false }),
  service("0346", "Women", "restroom", [[80, -1.7], [90.1, -1.7], [90.1, 23.2], [84.7, 23.2], [84.7, 28.2], [80, 28.2]]),
  service("0345A", "Janitor", "service", rect(84.7, 23.2, 94.6, 28.2)),
  service("0345", "Men", "restroom", rect(90.1, -1.7, 100, 23.2)),
  room("0344", "E-journal editor", "office", rect(100, -1.7, 110.1, 14)),
  room("0342", "Endowed chair", "office", rect(110.1, -1.7, 120.2, 14)),
  service("0343", "Storage", "storage", rect(105.4, 14, 114.7, 23.2)),
  room("0341", "C.C.S.L.C.", "office", rect(120.2, -1.7, 140.2, 28.2)),
  room("0340", "C.C.E.", "office", [[140.2, -1.7], [160, -1.7], [160, 23.3], [151.9, 23.3], [151.9, 28.2], [140.2, 28.2]]),
  room("0338", "C.P.R.", "office", rect(160, -1.7, 180.1, 28.2)),
  room("0336", "B.C.I.A.C.", "office", [[180.1, -1.7], [201.5, -1.7], [201.5, 11.3], [196.6, 11.3], [196.6, 23], [190.9, 23], [190.9, 28.2], [180.1, 28.2]]),
  service("0336B", "Elec.", "service", rect(196.6, 11.3, 201.5, 28.2)),
  sp("S398B", "South stair", "stair", "circulation", [[201.5, 26], [210, 26], [210, 59.2], [201.7, 59.2], [201.7, 42.4], [200.5, 42.4], [200.5, 28.2], [201.5, 28.2]], { occupiable: false }),
  sp("C399A", "Corridor", "corridor", "circulation", [
    [60, 9], [70.2, 9], [70.2, 20.1], [80, 20.1], [80, 28.2], [70.2, 28.2], [70.2, 38.6], [100, 38.6], [100, 28.2], [94.6, 28.2], [94.6, 23.2], [100, 23.2],
    [100, 14], [105.4, 14], [105.4, 23.2], [114.7, 23.2], [114.7, 14], [120.2, 14], [120.2, 28.2], [110.2, 28.2], [110.2, 38.6], [149.8, 38.6], [149.8, 43.7],
    [67.2, 43.7], [67.2, 63.8], [63, 63.8], [63, 43.7], [40.3, 43.7], [40.3, 38.6], [60, 38.6],
  ], { axis: [[41, 41.15], [149.8, 41.15]], clearWidthFt: 5.1 }),
  sp("C399B", "Corridor", "corridor", "circulation", [
    [145.9, 28.2], [151.9, 28.2], [151.9, 23.3], [160, 23.3], [160, 38.6], [180.1, 38.6], [180.1, 28.2], [190.9, 28.2], [190.9, 23], [196.6, 23], [196.6, 28.2],
    [200.5, 28.2], [200.5, 42.4], [201.7, 42.4], [201.7, 43.7], [149.8, 43.7], [149.8, 33.2], [145.9, 33.2],
  ], { axis: [[149.8, 41.15], [200.5, 41.15]], clearWidthFt: 5.1 }),
  sp("C399C", "Corridor", "corridor", "circulation", [
    [50.2, 62.7], [63, 62.7], [63, 63.8], [102.3, 63.8], [102.3, 43.7], [107.6, 43.7], [107.6, 63.6], [194.7, 63.6], [194.7, 68], [50.2, 68],
  ], { axis: [[50.2, 65.8], [194.7, 65.8]], clearWidthFt: 4.2 }),
  sp("C399D", "Corridor", "corridor", "circulation", rect(180, 43.7, 185.9, 63.6), { axis: [[182.95, 43.7], [182.95, 63.6]], clearWidthFt: 5.6 }),
];

const portals: Portal[] = [
  door([22.6, 28.4], [28.6, 28.4], "0303", "0304", 2),
  door([37.2, 11.2], [40.1, 11.2], "0302", "0301A"),
  door([50.6, 15.2], [53.5, 15.2], "0301", "0301A"),
  door([60, 11.9], [60, 14.8], "0301", "C399A"),
  opening([35.2, 28.4], [40.1, 28.4], "0301A", "0304"),
  door([40.3, 40.3], [40.3, 43.3], "0304", "C399A"),
  opening([19.4, 43.7], [40.3, 43.7], "0304", "0305"),
  door([50.2, 64.6], [50.2, 67.6], "0305", "C399C"),
  door([38.4, 70.5], [41.2, 70.5], "0305", "0306"),
  door([42.4, 70.5], [45.2, 70.5], "0305", "0307"),
  door([50.2, 59.4], [50.2, 62.4], "0305", "0308"),
  door([63, 45], [63, 48], "C399A", "0308A"),
  door([67.2, 44.2], [67.2, 47.2], "C399A", "0310"),
  door([67.2, 58.3], [67.2, 61.3], "C399A", "0310"),
  door([102.3, 53], [102.3, 56], "C399C", "0312"),
  door([80.5, 63.8], [83.5, 63.8], "C399C", "0313"),
  door([123, 63.6], [126, 63.6], "C399C", "0320"),
  door([126.6, 63.6], [129.6, 63.6], "C399C", "0324"),
  door([154.8, 63.6], [157.8, 63.6], "C399C", "0326"),
  door([158.4, 63.6], [161.4, 63.6], "C399C", "0328"),
  door([185.9, 44], [185.9, 47], "C399D", "0334"),
  opening([63, 63.8], [67.2, 63.8], "C399A", "C399C"),
  opening([102.3, 43.7], [107.6, 43.7], "C399A", "C399C"),
  opening([149.8, 38.6], [149.8, 43.7], "C399A", "C399B"),
  opening([180, 43.7], [185.9, 43.7], "C399B", "C399D"),
  opening([180, 63.6], [185.9, 63.6], "C399C", "C399D"),
  door([70.2, 17], [70.2, 20], "C399A", "S398A"),
  door([80, 24.6], [80, 27.6], "C399A", "0346"),
  door([96.8, 23.2], [99.8, 23.2], "C399A", "0345"),
  door([94.6, 25], [94.6, 28], "C399A", "0345A"),
  door([100.4, 14], [103.4, 14], "C399A", "0344"),
  door([116.8, 14], [119.8, 14], "C399A", "0342"),
  door([114.7, 19.6], [114.7, 22.6], "C399A", "0343"),
  door([120.2, 24.4], [120.2, 27.4], "C399A", "0341"),
  door([152.2, 23.3], [155.2, 23.3], "C399B", "0340"),
  door([160, 23.6], [160, 26.6], "C399B", "0338"),
  door([180.6, 28.2], [183.6, 28.2], "C399B", "0336"),
  door([192.4, 23], [195.4, 23], "C399B", "0336"),
  door([196.6, 24.2], [196.6, 27.2], "C399B", "0336B"),
  door([200.5, 37.5], [200.5, 40.5], "C399B", "S398B"),
  ...OFFICES.map(([id, x0]) => door([x0 + 0.4, 68], [x0 + 3.4, 68], "C399C", id)),
];

export const floor3: Floor = {
  id: F,
  name: "Third floor",
  elevationFt: 181.5,
  outline: [
    [17.6, -2.2], [202, -2.2], [202, 25.5], [210.5, 25.5], [210.5, 59.7], [202.2, 59.7], [202.2, 84.1], [18, 84.1], [18, 43.7], [18.8, 43.7], [18.8, 30],
    [-5.4, 30],
  ],
  voids: [
    rect(40.3, 28.4, 60, 38.6),
    rect(70.2, 28.2, 100, 38.6),
    [[110.2, 28.2], [145.9, 28.2], [145.9, 33.2], [149.8, 33.2], [149.8, 38.6], [110.2, 38.6]],
    rect(160, 28.2, 180.1, 38.6),
  ],
  spaces,
  portals,
};
