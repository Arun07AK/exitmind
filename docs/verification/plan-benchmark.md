# Plan tracing benchmark: Opus 5.5 on Rinker Hall, first floor

Input: sheet A102 at 100 dpi, cropped to the first-floor plan (3400 x 1420 px) and reduced to 1600 x 668 px (5.88 px per ft), as a user would upload it. Model claude-opus-5-5, 1 pass(es), 45 s. Reference: the hand-traced twin (`data/twin/rinker/floor1.ts`). Coordinates are compared in the registered drawing frame.

| Measure | Opus draft | Hand-traced twin |
|---|---|---|
| Outline area | 13,967 sq ft | 14,187 sq ft |
| Outline overlap (IoU, 1 ft grid) | 0.958 | 1 |
| Exits traced | 4 | 5 |
| Distance from each real exit to the nearest traced exit | EX-N 21.9 ft, EX-W 0.6 ft, EX-S 55.1 ft, EX-E1 0.9 ft, EX-E2 1.1 ft | 0 |
| Walls: share of real wall length within 2.5 ft of a traced wall (recall) | 91% | 100% |
| Walls: share of traced wall length within 2.5 ft of a real wall (precision) | 92% | 100% |
| Interior walls / doors / obstacles traced | 28 / 9 / 0 | 22 spaces, 30 portals |
| Scale read by Opus | 0.1695 ft/px (-0.4% off): Grid dimension 20'-0" between grid lines C (x≈370) and D (x≈487), D–E and F–G each ≈118 px; 20/118 ≈ 0.1695 ft/px. | 0.1701 ft/px |
| Drill, 154 people on the first floor, 3 seeds | 137/154, 134/154, 132/154 out; 95% out in not reached (3 of 3 seeds never reach 95%) | 154/154, 154/154, 154/154 out; 95% out in 137.2 s |
| Same drill after one click on "Add doors to sealed rooms" (4 doors added, no other edits) | 154/154, 154/154, 154/154 out; 95% out in 165.5 s | |

Checks on the draft before correction: FLOOR: 495 of 7216 cells cannot reach an exit.

Tracer notes: Outline is simplified; west lobby/vestibule area between y≈250–330 and the east stair projection (S198D) are approximate. Plaza C196A and the area 'Open to Below' at the southeast are outside the enclosed floor and excluded. Exact door positions and widths are estimated from small door arcs; several interior doors (restrooms, mech room, lockers alcoves) were omitted. Possible additional exits (east stair to exterior, shop/east doors, sink entry near grid J/4) could not be confirmed and were not included. Corridor C199D shape (y≈258–330) and the wall junctions near grid K are uncertain.

The draft above is Opus's output before any human correction, which is what the editor is for: rooms whose doors were not traced are sealed, and the checks panel lists the cells that cannot reach an exit.

The hand-traced drill uses its own room layout and the stairs as non-exits on the first floor (people leave by the exterior doors), so the times compare the two layouts, not the two crowds.
