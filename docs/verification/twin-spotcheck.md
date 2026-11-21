# Rinker Hall twin: dimension spot check

These are measurements of the traced twin (`data/twin/rinker/*.ts`, built to `data/twin/rinker.twin.json`) checked against the construction sheets. Sheet renders are 100 dpi, so the 1/8" plans come out at 12.5 px/ft and the 1/4" details at 25 px/ft. The registered frames (`data/twin/rinker/frames.json`) fit with residuals of 0.20 ft or less.

The sheets carry the notice *"This drawing, as an instrument of service, is and shall remain property of Croxton Collaborative Architects / Gould Evans Associates."* No sheet image or overlay is stored in this repo. Overlays were rendered to `/tmp/trace/` with `tools/trace_overlay.py`.

## Five dimensions

| # | Dimension | Sheet value (reference) | Twin value | Difference | How measured |
|---|---|---|---|---|---|
| 1 | Grid B → K | 180'-0": nine 20'-0" bay strings on A103 (second- and third-floor plans, top string, B–K). No single overall 180'-0" string can be read at 100 dpi. | 180.00 ft (`GRID_X.K − GRID_X.B`). Grid bubbles B→K on A103 (F2 plan) are 2249.8 px apart (top) and 2249.1 px (bottom). At the nominal 12.5 px/ft that is 179.98 / 179.93 ft. | ≤ 0.07 ft | Bubble centres from `frames.json`; nominal scale, not the fitted one. Traced F3 office partitions on grids D, F and J scan at 59.9, 99.9 and 179.9 ft. |
| 2 | Grid 1 → 4 | 82'-0": A103 right-hand strings 28'-0" + 16'-0" + 12'-11" + 4'-1" + 21'-0" (read at zoom, they sum to 82'-0") | 82.00 ft (`GRID_Y["4"] − GRID_Y["1"]`). Bubbles on A103 (F2 plan) are 1024.9 px apart (left) and 1024.0 px (right), i.e. 81.99 / 81.92 ft at 12.5 px/ft. | ≤ 0.08 ft | Same method as row 1. |
| 3 | Central stair flight width | A603 detail 6: flight strings 4'-7½" (DN flight) and 4'-6½" (UP flight), with a 9" gap. Scaled at 25 px/ft, the enclosure clear width is 248 px = 9.92 ft, which equals 4'-7½" + 9" + 4'-6½" (9'-11¾"). A108 prints the stair as PROVIDED 48". | `ST-A.clearWidthIn` = 48 in (A108 PROVIDED). The S298A polygon is 9.8 ft wide (x 70.3–80.1, wall centrelines). | Width: 48" against the narrower 54½" flight string, so the twin is 6½" narrower. Enclosure: 9.8 ft against 9.92 ft clear (−0.1 ft). | The twin uses the code PROVIDED width on purpose. 54½" less two handrail projections of about 3½" each gives about 47½", which agrees with 48". Clear width between handrails is not dimensioned on A603. |
| 4 | South stair overall plan length | A603 details 1–3: 16'-7½" (6'-3" + 4'-4½" + 6'-0"). It runs along the flight-side wall, from the far (west, row 4 side) wall to the jog where the floor landing starts. Details 1–3 are drawn rotated (north up). | S298B flight portion: y 42.4 (jog in the west wall, scanned on A108/A103/A107 at y ≈ 42.4–42.7) to y 59.2 (far wall) = 16.8 ft. The whole S298B polygon is x 200.5–210.0 × y 26.0–59.2 (8.5–9.5 × 33.2 ft), floor landing included. Flight pair x 201.7–210.0 = 8.3 ft, against 4'-1" + 4'-1" = 8'-2". | +0.2 ft (length); +0.1 ft (flight pair) | The twin polygon edge is a wall centreline. The string's end points (inside face or centreline) cannot be told apart at 100 dpi, so ±0.3 ft. |
| 5 | North lobby exit width (EX-N) | A107: PROVIDED 136" (141 occupants, REQ'D 28.2"). On A102 the exit is doors C196A/4 (single), C196A/5 (pair) and C196A/6 (single): 4 leaves, about 3'-1"–3'-2" each as drawn. | Portal `X-F1-1`: `clearWidthIn` = 136 (printed). The drawn segment is x = 40, y 29.8–42.2 = 12.4 ft (149"), the full leaf run of doors 4–6. | Clear width matches the printed value exactly. The drawn opening is 13" longer than the clear width (frames and mullions). | Leaf extents scaled on A102 at 50 px/ft (4× zoom). 136" = 4 × 34" clear per leaf, which matches the drawn leaf count. |

## Floor area: outline vs printed gross area

Printed gross areas are from the A107 code summary (1st 14,915; 2nd 16,270; 3rd 16,270 GSF). Twin outlines are traced at the exterior wall face. Voids are the "OPEN TO BELOW" atrium and lobby openings, including the atrium-stair slab openings. `src/design/codecheck.ts` uses *outline minus voids*.

| Floor | Twin outline (sq ft) | vs GSF | Voids (sq ft) | Outline − voids | vs GSF | Sum of space polygons |
|---|---|---|---|---|---|---|
| F1 | 14,187 | −4.9% | 0 | 14,187 | −4.9% | 13,842 |
| F2 | 16,524 | +1.6% | 1,096 | 15,428 | −5.2% | 15,050 |
| F3 | 16,547 | +1.7% | 1,112 | 15,435 | −5.1% | 14,988 |

Only the F2 and F3 outlines (without deducting voids) come within ±3%. Neither difference is a tracing error, as far as I can tell:

- **F2 and F3.** The outlines match the GSF to within 2%. The printed GSF therefore appears not to deduct the atrium openings. Outline minus voids is about 5% low, by roughly the area of the openings.
- **F1.** The outline leaves out, as instructed, the "OPEN TO BELOW" trapezoid at grids J–M / rows 3.5–4.2 (it sits over the mechanical level) and the exterior pocket at x 190–201 / y 44–60. Together these are about 1,100 sq ft. Including them would give 15,285 sq ft (+2.5%), so the printed first-floor GSF probably includes that area, or the mechanical level under it. The sheet does not say which.

## Not measurable from these sheets

- Interior door clear widths are not dimensioned. Every interior door is 34" per leaf (68" for pairs) with basis `assumed`. Exterior exit widths are the printed PROVIDED values.
- No overall 180'-0" string is legible on A103 at 100 dpi. Row 1 uses the sum of the 20'-0" bay strings.
- Stair clear width between handrails is not dimensioned on A603. The twin uses the A108 PROVIDED 48" for ST-A and ST-B. For the atrium stair (ST-ATR), about 4'-5" between guard lines was scaled from A602 detail 3, and 48" clear is assumed.
- South-stair riser and tread counts are not given separately. They are assumed equal to the central stair: 24 risers at 7.0" for F1→F2 (14'-0") and 22 at 6.82" for F2→F3 (12'-6"), all with 11" treads (A603 section 8).
- The exact end points of the 16'-7½" string (inside face or centreline) cannot be resolved, so row 4 carries ±0.3 ft.
