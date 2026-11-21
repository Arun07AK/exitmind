import type { Floor, Portal, Pt, Space, SpaceKind, SpaceUse } from "../../../src/twin/schema.ts";
import { rect, src } from "./helpers.ts";

const F = "F2" as const;
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
  id: `D-F2-${String(++n).padStart(3, "0")}`, floor: F, kind: "door", a, b, clearWidthIn: 34 * leaves, connects: [s1, s2], accessible: true, src: ASSUMED,
});

const room = (id: string, name: string, use: SpaceUse, polygon: Pt[]) => sp(id, name, "room", use, polygon, { lockable: true });
const service = (id: string, name: string, use: SpaceUse, polygon: Pt[]) => sp(id, name, "service", use, polygon, { occupiable: false });

const spaces: Space[] = [
  room("0203", "C.F.A.H.", "office", [[18, -1.8], [30, -1.8], [30, 28.3], [40.4, 28.3], [40.4, 43.6], [19.3, 43.6], [19.3, 29.6], [-4.6, 29.6]]),
  room("0202", "D.E.S.", "office", rect(30, -1.8, 50.1, 28.3)),
  room("0201", "Tech. services", "office", rect(50.1, -1.8, 60.2, 22.7)),
  sp("E297A", "Elevator", "elevator", "service", rect(60.2, -1.8, 70.3, 8.9), { occupiable: false }),
  sp("S298A", "Central stair", "stair", "circulation", rect(70.3, -1.8, 80.1, 20.1), { occupiable: false }),
  service("0246", "Women", "restroom", [[80.1, -1.8], [90.1, -1.8], [90.1, 23.3], [84.5, 23.3], [84.5, 28.2], [80.1, 28.2]]),
  service("0245", "Men", "restroom", rect(90.1, -1.8, 100.2, 22.8)),
  service("0205", "Janitor", "service", rect(90.1, 22.8, 95, 28.2)),
  room("0240", "Estimating / drawing / scheduling", "lab", [[100.2, -1.8], [150.1, -1.8], [150.1, 28.3], [110.1, 28.3], [110.1, 22.8], [100.2, 22.8]]),
  service("0240A", "Storage", "storage", rect(134.2, 28.3, 150.1, 33.2)),
  room("0238", "Construction lab", "lab", [[150.1, -1.8], [190.1, -1.8], [190.1, 28.2], [160.2, 28.2], [160.2, 33.2], [150.1, 33.2]]),
  service("0235", "Storage", "storage", [[190.1, -1.8], [201.5, -1.8], [201.5, 11.2], [196.6, 11.2], [196.6, 23.7], [190.1, 23.7]]),
  service("0235A", "Elec.", "service", rect(196.6, 11.2, 201.5, 28.2)),
  sp("S298B", "South stair", "stair", "circulation", [[201.5, 26], [210, 26], [210, 59.2], [201.7, 59.2], [201.7, 42.4], [200.5, 42.4], [200.5, 28.2], [201.5, 28.2]], { occupiable: false }),
  sp("C299A", "Corridor", "corridor", "circulation", [
    [60.2, 8.9], [70.3, 8.9], [70.3, 20.1], [80.1, 20.1], [80.1, 28.2], [70.3, 28.2], [70.3, 38.9], [100, 38.9], [100, 33.1], [98.1, 33.1], [98.1, 28.2],
    [95, 28.2], [95, 22.8], [110.1, 22.8], [110.1, 28.3], [116.5, 28.3], [116.5, 33.1], [110.1, 33.1], [110.1, 38.8], [180.2, 38.8], [180.2, 28.2],
    [190.1, 28.2], [190.1, 23.7], [196.6, 23.7], [196.6, 28.2], [200.5, 28.2], [200.5, 42.4], [201.7, 42.4], [201.7, 45.2], [78.1, 45.2], [67.6, 45.2], [67.6, 59.2], [60.2, 59.2],
    [60.2, 54.1], [62.5, 54.1], [62.5, 43.6], [40.4, 43.6], [40.4, 38.9], [60, 38.9], [60, 28.3], [50.1, 28.3], [50.1, 22.7], [60.2, 22.7],
  ], { axis: [[41, 41.8], [200, 41.8]], clearWidthFt: 6.0 }),
  service("0207A", "Storage", "storage", rect(19.3, 43.6, 26.7, 54.1)),
  room("0204", "Plan room", "office", rect(26.7, 43.6, 48.2, 54.1)),
  room("0209", "MCE / SW room", "office", rect(48.2, 43.6, 62.5, 54.1)),
  room("0206", "Computer lab", "lab", rect(18.6, 54.1, 60.2, 83.4)),
  service("0203A", "Server room", "service", rect(67.6, 45.2, 78.1, 59.2)),
  room("0208", "Information technology", "office", rect(60.2, 59.2, 78.1, 83.4)),
  room("0210", "Medium classroom", "classroom", rect(78.1, 45.2, 101.8, 83.4)),
  room("0215", "Medium classroom", "classroom", rect(101.8, 45.2, 126, 83.4)),
  room("0220", "Medium classroom", "classroom", rect(126, 45.2, 150, 83.4)),
  room("0225", "Medium classroom", "classroom", rect(150, 45.2, 174, 83.4)),
  room("0230", "Medium classroom", "classroom", [[174, 45.2], [196.8, 45.2], [196.8, 56], [201.7, 56], [201.7, 83.4], [174, 83.4]]),
];

const portals: Portal[] = [
  door([40.4, 39.5], [40.4, 43.3], "0203", "C299A"),
  door([23.7, 43.6], [26.5, 43.6], "0203", "0207A"),
  door([50.1, 24.9], [50.1, 27.9], "0202", "C299A"),
  door([50.6, 22.7], [53.6, 22.7], "0201", "C299A"),
  door([70.3, 16.8], [70.3, 19.9], "C299A", "S298A"),
  door([80.1, 24.4], [80.1, 27.3], "C299A", "0246"),
  door([96.8, 22.8], [99.7, 22.8], "C299A", "0245"),
  door([95, 24], [95, 27], "C299A", "0205"),
  door([110.1, 23.2], [110.1, 26.2], "C299A", "0240"),
  door([146.5, 28.3], [149.5, 28.3], "0240", "0240A"),
  door([150.1, 24.1], [150.1, 27.1], "0240", "0238"),
  door([183.5, 28.2], [186.8, 28.2], "C299A", "0238"),
  door([190.7, 23.7], [193.7, 23.7], "C299A", "0235"),
  door([196.6, 24.2], [196.6, 27.2], "C299A", "0235A"),
  door([200.5, 37.3], [200.5, 40.3], "C299A", "S298B"),
  door([43.8, 43.6], [47.8, 43.6], "C299A", "0204"),
  door([62.5, 50.4], [62.5, 53.5], "C299A", "0209"),
  door([60.2, 54.4], [60.2, 57.4], "C299A", "0206"),
  door([67.6, 55.8], [67.6, 58.8], "C299A", "0203A"),
  door([60.6, 59.2], [63.6, 59.2], "C299A", "0208"),
  door([80.6, 45.2], [83.6, 45.2], "C299A", "0210"),
  door([102.4, 45.2], [105.4, 45.2], "C299A", "0215"),
  door([126.6, 45.2], [129.6, 45.2], "C299A", "0220"),
  door([150.6, 45.2], [153.6, 45.2], "C299A", "0225"),
  door([174.6, 45.2], [177.6, 45.2], "C299A", "0230"),
];

export const floor2: Floor = {
  id: F,
  name: "Second floor",
  elevationFt: 169.0,
  outline: [
    [17.8, -2.3], [202, -2.3], [202, 25.5], [210.5, 25.5], [210.5, 59.7], [202.2, 59.7], [202.2, 83.9], [18.1, 83.9], [18.1, 43.6], [18.8, 43.6],
    [18.8, 30.1], [-5.4, 30.1],
  ],
  voids: [
    rect(40.4, 28.3, 60, 38.9),
    [[70.3, 28.2], [98.1, 28.2], [98.1, 33.1], [100, 33.1], [100, 38.9], [70.3, 38.9]],
    [[110.1, 33.1], [116.5, 33.1], [116.5, 28.3], [134.2, 28.3], [134.2, 33.2], [160.2, 33.2], [160.2, 28.2], [180.2, 28.2], [180.2, 38.8], [110.1, 38.8]],
  ],
  spaces,
  portals,
};
