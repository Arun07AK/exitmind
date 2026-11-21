export const FLOOR_IDS = ["F1", "F2", "F3"] as const;
export type FloorId = (typeof FLOOR_IDS)[number];
export type Pt = [number, number];
export const SHEET_IDS = ["A102", "A103", "A107", "A108", "A602", "A603"] as const;
export type SheetId = (typeof SHEET_IDS)[number];

export interface SourceRef {
  sheet: SheetId | "OSM" | "UPLOAD";
  osm?: string;
  detail?: string;
  grid?: string;
  basis: "dimensioned" | "printed" | "scaled" | "assumed" | "ai-traced" | "user-edited";
  note?: string;
}

export const SPACE_KINDS = ["room", "corridor", "lobby", "stair", "elevator", "service", "exterior"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];
export const SPACE_USES = ["classroom", "lab", "office", "assembly", "circulation", "service", "restroom", "storage", "ward", "retail"] as const;
export type SpaceUse = (typeof SPACE_USES)[number];

export interface Space {
  id: string;
  name: string;
  floor: FloorId;
  kind: SpaceKind;
  use: SpaceUse;
  polygon: Pt[];
  occupiable: boolean;
  lockable: boolean;
  fixedSeats?: number;
  axis?: [Pt, Pt];
  clearWidthFt?: number;
  src: SourceRef;
}

export interface Portal {
  id: string;
  floor: FloorId;
  kind: "door" | "opening" | "corridor_section";
  a: Pt;
  b: Pt;
  clearWidthIn: number;
  connects: [string, string];
  accessible: boolean;
  src: SourceRef;
}

export interface Flight {
  from: FloorId;
  to: FloorId;
  travelFt: number;
  head: Pt[];
  landing: Pt[];
}

export interface Stair {
  id: string;
  name: string;
  enclosed: boolean;
  countsAsCodeExit: boolean;
  clearWidthIn: number;
  riserIn: number;
  treadIn: number;
  spaces: Partial<Record<FloorId, string>>;
  flights: Flight[];
  src: SourceRef;
}

export interface PrintedExit {
  occupants: number;
  requiredIn: number;
  providedIn: number;
}

export interface Exit {
  id: string;
  name: string;
  floor: FloorId;
  kind: "exterior" | "stair";
  portal: string;
  stair?: string;
  printed?: PrintedExit;
  src: SourceRef;
}

export interface SignMount {
  id: string;
  floor: FloorId;
  at: Pt;
  facing: Pt;
  space: string;
  staticDefaultToward: string;
  src: SourceRef;
}

export interface Floor {
  id: FloorId;
  name: string;
  elevationFt: number;
  outline: Pt[];
  voids: Pt[][];
  spaces: Space[];
  portals: Portal[];
}

export interface Zone {
  id: string;
  floor: FloorId;
  name: string;
  xRangeFt: [number, number];
}

export interface CodeBasis {
  occupantLoadSqftPerPerson: number;
  egressInPerPerson: { corridorsDoors: number; stairs: number };
  minDoorClearIn: number;
  minCorridorIn: number;
  minCorridorSmallLoadIn: number;
  minExits: number;
  travelDistanceFt: { nfpa101: number; sbc: number };
  commonPathFt: number;
  deadEndFt: number;
  twoDoorRoomLoad: number;
  twoDoorTravelFt: number;
  grossAreaSqft: Record<FloorId, number>;
  src: SourceRef;
}

export interface SheetMeta {
  id: SheetId;
  title: string;
  url: string;
}

export interface Twin {
  id: string;
  name: string;
  frame: { gridX: Record<string, number>; gridY: Record<string, number>; north: "-x" | "-y" };
  venue?: VenueMeta;
  zoneBands?: { suffix: string; name: string; x: [number, number] }[];
  floors: Floor[];
  stairs: Stair[];
  exits: Exit[];
  zones: Zone[];
  signMounts: SignMount[];
  codeBasis: CodeBasis;
  sheets: SheetMeta[];
  hash: string;
}

export type TwinSource = Omit<Twin, "hash" | "zones">;

export interface VenueMeta {
  kind: "outdoor" | "plan";
  label: string;
  origin: { lat: number; lon: number };
  attribution: string;
  osmWays: string[];
  stage: Pt[] | null;
  mainGates: string[];
  staffGates: string[];
  assumptions: string[];
}

/** A concrete change to a twin: what to build, remove or modify. Applied by applyEdits (src/twin/edit.ts). */
export interface GeometryPatch {
  addSpaces?: Space[];
  addPortals?: Portal[];
  addExits?: Exit[];
  addStairs?: Stair[];
  removePortals?: string[];
  updateSpaces?: { id: string; kind?: SpaceKind; use?: SpaceUse; occupiable?: boolean }[];
  updatePortals?: { id: string; clearWidthIn?: number; accessible?: boolean; a?: Pt; b?: Pt; kind?: Portal["kind"] }[];
  /** openings through wall barriers (uploaded plans, where walls are voids): a gap of widthFt centred on `at` */
  cutVoids?: { floor: FloorId; at: Pt; widthFt: number }[];
}
