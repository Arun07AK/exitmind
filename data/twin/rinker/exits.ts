import type { Exit } from "../../../src/twin/schema.ts";
import { src } from "./helpers.ts";

const P = (note: string) => src("A107", "printed", { note });
const P2 = (note: string) => src("A108", "printed", { note });

export const exits: Exit[] = [
  { id: "EX-N", name: "North lobby doors (lobby C199A to plaza C196A)", floor: "F1", kind: "exterior", portal: "X-F1-1", printed: { occupants: 141, requiredIn: 28.2, providedIn: 136 }, src: P("doors C196A/4-6 at grid C") },
  { id: "EX-W", name: "West entry (entry / exhibit C199C)", floor: "F1", kind: "exterior", portal: "X-F1-2", printed: { occupants: 141, requiredIn: 28.2, providedIn: 68 }, src: P("row 4 entry vestibule") },
  { id: "EX-S", name: "South stair S198B exterior door", floor: "F1", kind: "exterior", portal: "X-F1-3", printed: { occupants: 141, requiredIn: 28.2, providedIn: 34 }, src: P("door to exterior steps east of grid K") },
  { id: "EX-E1", name: "East door from storage 0140A", floor: "F1", kind: "exterior", portal: "X-F1-4", printed: { occupants: 9, requiredIn: 1.8, providedIn: 68 }, src: P("row 1 double door") },
  { id: "EX-E2", name: "East door from soils & concrete lab 0138", floor: "F1", kind: "exterior", portal: "X-F1-5", printed: { occupants: 4, requiredIn: 0.8, providedIn: 68 }, src: P("row 1 double door") },
  { id: "EX-2A", name: "Second floor: central stair S298A", floor: "F2", kind: "stair", portal: "D-F2-005", stair: "ST-A", printed: { occupants: 157, requiredIn: 47.1, providedIn: 48 }, src: P2("PROVIDED = stair width; stair door 34 in assumed") },
  { id: "EX-2B", name: "Second floor: south stair S298B", floor: "F2", kind: "stair", portal: "D-F2-015", stair: "ST-B", printed: { occupants: 157, requiredIn: 47.1, providedIn: 48 }, src: P2("PROVIDED = stair width; stair door 34 in assumed") },
  { id: "EX-3A", name: "Third floor: central stair S398A", floor: "F3", kind: "stair", portal: "D-F3-027", stair: "ST-A", printed: { occupants: 151, requiredIn: 45.3, providedIn: 48 }, src: P2("PROVIDED = stair width; stair door 34 in assumed") },
  { id: "EX-3B", name: "Third floor: south stair S398B", floor: "F3", kind: "stair", portal: "D-F3-040", stair: "ST-B", printed: { occupants: 151, requiredIn: 45.3, providedIn: 48 }, src: P2("PROVIDED = stair width; stair door 34 in assumed") },
];
