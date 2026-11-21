# EXITMIND redesign: build plan

Design reference: the canvas "EXITMIND Redesign" (https://claude.ai/artifact/NsnpQRUPTFRQcwGeLEYFJz): Simulate 3D, Simulate 2D Flow, Optimise, Live, Design system. Light theme (Arun, 2026-11-21: "go for a lighter theme, avoid dark theme"). Library shortlist: `docs/redesign/oss-shortlist.md`.

Every number on the canvas came from the simulator (worst-case fire from `data/design/adversary-fire.json`, seeds 88000–88007, scripts kept in the session scratchpad). The build must reproduce them through the app's own API, not copy them.

## Decisions taken

- Three modes, one shell: `/simulate`, `/optimise`, `/live`. The Report page stays at `/report`, reached from Optimise → Export report.
- 3D / 2D Flow is a view toggle inside Simulate (and in Optimise compare). Both read one playhead, so switching keeps the time, positions, routes, states and hazards.
- Runs are buffered on the client. Rule and distilled runs finish in under 0.5 s on the server, so the client receives every frame and play, pause, scrub and speed happen locally. Showcase runs with live personas still stream; the scrubber then covers what has arrived.
- The 2D Flow view stays on Canvas 2D: the existing `Plan2D.tsx` already has the floor raster, picking and heat, and it keeps lines and text crisp at any zoom. The 3D view stays on react-three-fiber.
- New libraries, pending the age check below: `radix-ui` 1.8.1, `lucide-react` 1.72.0, `@visx/shape` 4.0.0, `@visx/scale` 4.0.0, `react-compare-slider` 4.0.0, and `@react-three/postprocessing` 3.2.2 with `postprocessing` 6.39.6. Each gets exact pinning and a README row.

## Phases (stop and show Arun at each boundary)

| Phase | What | Main files | Verified by |
|---|---|---|---|
| A. Data | Frames carry each agent's target element, cumulative exit use, per-door queue counts and smoke coverage per floor. Client run buffer and one shared playhead in the store. | `src/server/contract.ts`, `frames.ts`, `simrunner.ts`; `web/src/store.ts`, new `web/src/sim/buffer.ts` | New unit test: the last frame's exit use equals the run summary. `sync.spec` passes. Determinism scan passes. `npm test` green. |
| B. Shell | Light tokens in `index.css`, IBM Plex (self-hosted if approved), top bar with the mode switch, Radix controls, evidence chips, and the routes above. | `web/src/App.tsx`, `router.ts`, `index.css`, `components/ui.tsx` and new small components | `npm run build:web`, typecheck. Screenshots of every route at 1440×900 and 390 wide. |
| C. Simulate | 2D Flow: layers (agents, trajectories by exit, density, bottlenecks, exits, smoke), floor rail, inspector, legend. 3D: light architectural model, extruded walls, exploded floors, camera presets, instanced figures, ambient occlusion. Transport with the people-inside curve. Scenario drawer that holds the old form and the plain-language box. | `views/Plan2D.tsx`, `views/Building3D.tsx`, new `pages/Simulate.tsx`, `components/Transport.tsx`, `components/StatusPanel.tsx` | `sync.spec` extended: switch 2D↔3D mid-run and get the same tick and hash. Screenshot loop against the reference images. Frame-rate check. |
| D. Optimise | `POST /api/design/compare` (scenario, variant edits, seeds) runs on the worker pool and returns per-seed metrics and mean danger cells. A recommendation list is built from bottlenecks and optimiser edits, each labelled validated, no effect or not testable. Before/after plans, figures, per-seed dot plot, table, and "Watch both runs". | `src/design/compare.ts` (new), `src/server/index.ts`, new `pages/Optimise.tsx` | Unit test: compare figures equal direct `evaluate()` runs on the same seeds. UI figures equal the API response. Screenshots. |
| E. Live | Restyle to the canvas: incident banner and state stepper, demo-feed labelling, zone matrix, floor plan with sign previews and damaged stairs, decision card with the three-key gate, forecast and approve or reject, brief, log. Demo controls move into a menu. Existing `data-testid`s are kept. | `pages/Live.tsx` | `demo-offline.spec` and `phones.spec` pass. Screenshots. |
| F. Polish | Screenshot loop at 1440×900, 1280×800 and phone width. Keyboard and contrast pass. Performance. Limitations written up. README library table and `PROGRESS.md` updated. One commit per phase. | — | `npm test` green, plus final screenshots. |

## Needs Arun

1. `@react-three/postprocessing` pulls `n8ao` 2.1.0, which is 6 days old (the repo rule is 7). Either install on or after 2026-11-23, or pin `"overrides": {"n8ao": "2.0.2"}`.
2. Fonts for the offline LAN demo: self-host IBM Plex (OFL, via `@fontsource`), or use system fonts.

## What the engine cannot do yet (shown honestly in the UI)

- "Add an exit" can't be tested: the optimiser supports `add_exit`, but no candidate exit positions exist for Rinker Hall. Optimise shows it as "Not testable yet". Marking candidate wall segments is a follow-up.
- "Trapped" is not a model state. The UI uses "in dense smoke", "queuing" and "still inside at the target time" instead.
- In fast-smoke worst cases the smoke field covers whole floors within about 3 minutes, so the smoke layer is most useful early in a run.
- Live mode has zone counts from sensors, never per-person positions (no cameras or personal data, by design).

## Resume

```bash
cd /Users/arunak/EgressLab && git status && npm test
```

Then read this file and `docs/PROGRESS.md`, and continue from the first phase without a ✅ below.

Progress: A ✅ · B ✅ · C ✅ · D ✅ · E ✅ · F ✅ (2026-11-21; not committed). Decisions taken for Arun: n8ao pinned to 2.0.2 via `overrides`; IBM Plex self-hosted with `@fontsource`.
