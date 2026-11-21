import type { TwinSource } from "../../../src/twin/schema.ts";
import { exits } from "./exits.ts";
import { floor1 } from "./floor1.ts";
import { floor2 } from "./floor2.ts";
import { floor3 } from "./floor3.ts";
import { GRID_X, GRID_Y, src } from "./helpers.ts";
import { signMounts } from "./signs.ts";
import { stairs } from "./stairs.ts";

const SHEET_URL = "http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/";

export const rinker: TwinSource = {
  id: "rinker-hall",
  name: "Rinker Hall, University of Florida (as drawn, 11/21/01 construction documents)",
  frame: { gridX: { ...GRID_X }, gridY: { ...GRID_Y }, north: "-x" },
  floors: [floor1, floor2, floor3],
  stairs,
  exits,
  signMounts,
  codeBasis: {
    occupantLoadSqftPerPerson: 100,
    egressInPerPerson: { corridorsDoors: 0.2, stairs: 0.3 },
    minDoorClearIn: 32,
    minCorridorIn: 44,
    minCorridorSmallLoadIn: 36,
    minExits: 2,
    travelDistanceFt: { nfpa101: 200, sbc: 250 },
    commonPathFt: 100,
    deadEndFt: 20,
    twoDoorRoomLoad: 50,
    twoDoorTravelFt: 75,
    grossAreaSqft: { F1: 14915, F2: 16270, F3: 16270 },
    src: src("A107", "printed", { detail: "Code Summary: SBC 1997 Tables 1003.1, 1004, sections 1004.1.2, 1004.2; NFPA 101 (1994) 5-2.2.2, 26-1.7, 26-2.4, 26-2.6, 2-8" }),
  },
  sheets: [
    { id: "A102", title: "Mechanical level & first floor plan", url: `${SHEET_URL}Rinker_009.pdf` },
    { id: "A103", title: "Second & third floor plan", url: `${SHEET_URL}Rinker_010.pdf` },
    { id: "A107", title: "Mechanical level & first floor egress plan", url: `${SHEET_URL}Rinker_012.pdf` },
    { id: "A108", title: "Second & third level egress plan", url: `${SHEET_URL}Rinker_013.pdf` },
    { id: "A602", title: "Atrium stair plans, sections, elevations", url: `${SHEET_URL}Rinker_031.pdf` },
    { id: "A603", title: "Stair & elevator enlarged plans & sections", url: `${SHEET_URL}Rinker_032.pdf` },
  ],
};
