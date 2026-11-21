# EXITMIND — Implementation Blueprint

One engine that designs a building for safe egress and runs its emergencies, where no action reaches a person until an AI agent decides, a simulation tries to break the decision, and a human approves it.

- Status: planning complete, nothing built. Repo: `/Users/arunak/EgressLab` (empty apart from this file).
- Written 2026-11-21 by the planning session. The builder is a different model; this file is its only context.
- Every external fact below was checked in the planning session unless it carries one of these tags:
  - **VERIFY** — recalled or read at low zoom; the builder must confirm against the source before relying on it.
  - **ASSUMED** — not in any source; a stated modelling assumption that must be labelled as such in data and UI.

---

## 0. Rules for the builder

1. Work phase by phase (section 14). Finish and verify a phase, update `docs/PROGRESS.md`, commit, report with evidence (command + output), then **stop and wait for Arun's go**.
2. Decisions in section 2 are final. Do not reopen them. If one proves impossible, stop and say why; do not substitute silently.
3. Items in the OPEN register (section 2.2) belong to Arun. Never decide them.
4. Never fake a result. A test that cannot run (missing key, no phones) is reported as **skipped with the reason**, not as passed. If an acceptance criterion cannot be met, say so and why.
5. Every number shown in the UI or a report is computed in the run that displays it. No hard-coded metrics, no placeholder figures.
6. Language rules (also enforced by a test, section 13):
   - Persona behaviour is "modelled", never "predicted". Every persona surface carries: *"modelled behaviour, not validated against real evacuations"*.
   - Ratings are "decision support for professional safety review", never "certified", "compliant" or "approved".
   - Never say the real Rinker Hall is unsafe. Phrase findings as: *"In this model, under these assumptions, …"*.
   - Never write "saves lives", market-size figures, or casualty estimates. Only observed counts with their source record.
7. Hard constraints: no real emergency number, service, SMS gateway or webhook is contacted; no personal data; no camera input; occupant-facing text comes only from `config/templates.json`; the fire alarm panel is read-only.
8. Do not commit the drawing sheets or images derived from them (section 3.1).
9. Dependencies: use exactly the versions in section 4.2. Do not add a library without listing it in the README.

---

## 1. The product in one page

**Question answered:** how do we design and run this building so people get out safely even when their behaviour is unpredictable?

**Three keys.** A sign state reaches a phone only when the event log holds, for the same decision: (1) an agent decision, (2) a verifier verdict, (3) a human approval.

**One engine, two modes, joined by a playbook.**

| | Design mode | Live mode |
|---|---|---|
| User | architect, engineer, planner | venue operator |
| Input | twin + occupancy profile + hazard space | simulated sensor feed from a simulated incident |
| Loop | simulate → adversary finds the breaking scenario → optimiser edits the layout → adversary attacks again | Sentinel estimates → Planner proposes → Verifier attacks → human approves → signs change |
| Output | code check, bottlenecks, crash-test rating, **playbook** | phone signs, responder brief, post-incident report |

The playbook holds responses verified at design time. Live mode consults it first and falls back to it when the Planner LLM is unavailable.

**What makes this defensible in front of judges**

- The gate is structural: the sign server can only read `gate.published` events, and only `gate.ts` can write them.
- The Verifier forks from the Sentinel's *estimate*, not from the hidden ground truth, so its prediction can be wrong, and the Historian measures by how much.
- Optimisation is minimax: every layout change is re-attacked by the adversary before it counts.
- Persona decisions are typed choices over options the simulator enumerated, so an impossible move cannot be expressed.
- "No X without an alternative" is a type: `X_ALT` has a non-optional `alt`.
- Everything replays from an append-only, hash-chained log.

---

## 2. Decision registers

### 2.1 Final decisions

| # | Decision | Reason |
|---|---|---|
| D1 | TypeScript end to end, one npm package, Node 24 running `.ts` natively (type stripping). No build step for server or simulator; Vite builds the web app. | Checked: `node main.ts` with a `.ts` worker thread ran on this machine (Node 24.13.1) and gave identical seeded sums. Arun is strongest in JS/React/Node. One language means one simulator for bulk runs, the Verifier and replay. |
| D2 | The simulator runs only in Node. Browsers render frames; they never simulate. | One source of truth makes 2D/3D sync and determinism simple, and avoids floating-point differences between browser engines. |
| D3 | Crowd model: fine-grid cellular automaton (0.4 m cells, 0.25 s tick) with SFPE hydraulic relations applied explicitly: capacity-limited portals (doors, corridor sections, stair entries) and stairs as FIFO pipes. | Deterministic, fast, robust. The door-flow relation is implemented directly, so the single-door test checks the implementation instead of hoping a force model converges. |
| D4 | One decision interface, four policies: `rule`, `llm` (Jev or Haiku), `distilled`, `replay`. All agents share the same grid and physics. | This is the hybrid. Showcase runs mix `llm` personas into a `rule` crowd; bulk runs use `distilled`; replays use `replay`. |
| D5 | Persona actions are a choice among options enumerated by the simulator (max 8, lettered A–H). | Impossible moves are unrepresentable; the LLM schema is fixed, so Claude's grammar cache is reused. |
| D6 | Distillation stores a probability distribution over *option roles* per situation key, with back-off. Jev's returned probabilities are used as soft labels; Haiku's choices as counts. | Role-level keys transfer across buildings; soft labels need far fewer calls. |
| D7 | Append-only JSONL event log with a SHA-256 hash chain, in one Node process, is the only channel between agents. | Meets "agents communicate only through the log"; tamper-evident; trivially replayable. |
| D8 | Live mode runs on a simulation clock. Every external input (LLM output, human click, phone connect/disconnect, injected fault) is logged with the tick at which it was applied. | Makes a live session replay to an identical final state. |
| D9 | The Planner emits a zone-level route policy. A deterministic `SignCompiler` turns it into per-sign states. | The LLM never writes sign content; signage safety is checked in one place. |
| D10 | Adversary: cross-entropy method over mixed continuous/categorical scenario space, common random numbers, held-out seeds for the final claim. | Simple, seeded, parallel, good on noisy black-box objectives. |
| D11 | Optimiser: greedy best-improvement-per-cost over an edit catalogue, re-running the adversary after every accepted edit. | Gives the "worst case before/after each change" report the brief asks for. |
| D12 | Sentinel is deterministic fusion (log-odds beliefs + count conservation), not an LLM. LLM roles are Planner and Liaison only, plus persona decisions and plain-language parsing. | Detection must be explainable and must degrade predictably when a sensor fails. |
| D13 | Phones use a plain WebSocket page with a client-side watchdog; HTTP on the LAN; `nosleep.js` after one tap. | Works with the internet off and without certificates. Fail-safe lives on the phone. |
| D14 | Demo hazards: **fire/smoke** then **earthquake** (Arun's choice). All four hazards are built and rated. | |
| D15 | Showcase runs use **12** live personas by default (`runtime.json: showcase.livePersonas`). | Arun asked for a recommendation. Twelve gives roughly 80–100 LLM calls per run, about 2.6% of the 462-person college load, enough to follow on screen and to move the outcome, without crowding the deadline. |
| D16 | Mechanical level (rooms 0030, 0030A) is excluded from simulation and from occupant load. | Unoccupied plant space; stated in the UI. |
| D17 | Drawing sheets are fetched by script into a git-ignored folder; the twin JSON (our own tracing) is committed. | The sheets carry an ownership notice; see 3.1. |

### 2.2 OPEN register (Arun decides)

| # | Item | Status | What the builder does meanwhile |
|---|---|---|---|
| O1 | Does a failing verdict block the action or only warn? | **Decided by Arun: block unless overridden with a reason** (`gate.failMode = "block_with_override"`). | Both modes stay implemented; `warn` remains available in `runtime.json`. |
| O2 | Which two hazards the demo shows. | **Decided: fire + earthquake.** | |
| O3 | Jev or Haiku as default persona backend. | **Undecided.** To be decided after the side-by-side test. Arun has an Anthropic key only. | Build both adapters. Run the bake-off (8.7) for whichever keys exist and report the other column as "not run: no key". `PERSONA_BACKEND` has no default; development uses `haiku` explicitly. |
| O4 | Live personas per showcase run. | **Provisionally 12** (D15); configurable. | |

---

## 3. Source facts from the drawings

### 3.1 Sheets

Index page: `http://coremng.dcp.ufl.edu/rinkerhall/drawings.htm`. PDF base: `http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/`.

| Sheet | Title | File | Used for |
|---|---|---|---|
| A102 | Mechanical level & first floor plan | `Rinker_009.pdf` | F1 geometry, grid dimensions |
| A103 | Second & third floor plan | `Rinker_010.pdf` | F2, F3 geometry, grid dimensions |
| A107 | Mechanical level & first floor egress plan + CODE SUMMARY | `Rinker_012.pdf` | code basis, F1 exits and loads |
| A108 | Second & third level egress plan | `Rinker_013.pdf` | F2, F3 exit loads and routes |
| A602 | Atrium stair plans, sections, elevations | `Rinker_031.pdf` | atrium stair |
| A603 | Stair & elevator enlarged plans & sections | `Rinker_032.pdf` | central and south stairs, floor elevations |

Checked facts about the files: each PDF is one page holding a single 1-bit JBIG2 scan, 12000 × ~16800 px, 400 dpi, page rotated 90°, **no text layer and no vector data**. Plans are drawn at 1/8" = 1'-0" (50 px per foot at full resolution); stair details at 1/4" = 1'-0". All dated 11/21/01, "100% Construction Documents". Tracing is therefore visual, against a calibrated grid.

Each sheet prints: *"This drawing, as an instrument of service, is and shall remain property of Croxton Collaborative Architects / Gould Evans Associates."* So: sheets and overlay images stay in git-ignored folders; the README cites the URL; the committed twin is our own measurement data with sheet references.

### 3.2 Code basis (read at high zoom from the CODE SUMMARY on A107)

Two codes are tabulated side by side: **1997 Standard Building Code (SBC)** and **1994 ANSI/NFPA 101 Life Safety Code**.

| Item | SBC | NFPA 101 |
|---|---|---|
| Occupancy | Group B Business (principal use); Group A-2 Small Assembly (large classroom only) | §26 New Business |
| Construction | Type IV, unprotected, fully sprinklered | — |
| Gross area | 1st 14,915 GSF; 2nd 16,270 GSF; 3rd 16,270 GSF; total 47,455 GSF | — |
| Occupant load | Table 1003.1: Business 100 gross sq ft/person; Assembly 1 fixed seat/person | §26-1.7: Business 100 gross sq ft/person |
| Egress width | Table 1004: corridors & doors 0.20; stairs 0.30 (inches per person) | §5-2.2.2: corridors & doors 0.20; stairs 0.30 |
| Minimum widths | door clear opening 32"; corridor 44" (36" if load under 50) | same |
| Travel distance | 250 ft max to exit | §26-2.6: 200 ft max |
| Common path | — | §26-2.4: 100 ft max |
| Dead-end corridor | 20 ft max | 20 ft max |
| Number of exits | §1004.2: load 1–500 → 2 exits. §1004.1.2: a room with 50+ occupants needs 2 egress doors if travel distance exceeds 75 ft | §2-8: at least 2 exits located remotely per §5-5 |
| Stair capacity | §1003.3.2: set by the floor with the highest load, not the building total | — |
| Corridor capacity | §1003.3.4: at least the exit width required | — |
| Stairs | max riser 7", max tread 11" as printed; landing width ≥ stair width; handrails both sides | §5-2.2.2.1 |
| Refuge / elevator | areas of refuge not required (fully sprinklered); one elevator as accessible means of egress, with sprinkler exception | §26-2.2.10 |
| Alarm | manual fire alarm; audible 60 dBA min; visible alarms in every occupied space | §26-3.4.3 notification by live public address |

No numeric remoteness rule is printed (only "per section 5-5"). The code check therefore reports measured exit separation as information and does not invent a pass/fail threshold.

### 3.3 Exit labels (read at high zoom from A107 and A108)

| Floor | Exit | Printed occupants | Printed REQ'D | Printed PROVIDED | Check |
|---|---|---|---|---|---|
| F1 | North lobby doors (lobby C199A to plaza C196A) | 141 | 28.2" | 136" | 141 × 0.2 = 28.2 |
| F1 | West entry (entry/exhibit C199C) | 141 | 28.2" | 68" | same |
| F1 | South door at stair S198B | 141 | 28.2" | 34" | same |
| F1 | East door from storage 0140A | 9 | 1.8" | 68" | 9 × 0.2 = 1.8 |
| F1 | East door from soils & concrete lab 0138 | 4 | .8" | 68" | 4 × 0.2 = 0.8 |
| F2 | Central stair S298A | 157 | 47.1" | 48" | 157 × 0.3 = 47.1 |
| F2 | South stair S298B | 157 | 47.1" | 48" | same |
| F3 | Central stair S398A | 151 | 45.3" | 48" | 151 × 0.3 = 45.3 |
| F3 | South stair S398B | 151 | 45.3" | 48" | same |

Printed loads total 154 + 157 + 151 = **462**. Gross area ÷ 100 would give 150 / 163 / 163. The sheet does not explain the difference. The code check shows both, flags the gap, and does not force agreement.

Orientation: the north arrow on A102/A103 points to the **left** of the sheet (towards grid A). So grid A is north, grid K south, row 1 east, row 4 west. A102 labels the row-4 door "WEST ENTRY" and A603 calls the grid-K stair "SOUTH STAIR", which agree.

### 3.4 Grid frame (dimension strings read at high zoom on A103; A102 agrees)

Twin coordinates are feet. `x` runs along the lettered grids (A → M), `y` along the numbered grids (1 → 4.2). Origin at A/1.

| Grid | x (ft) | | Grid | y (ft) |
|---|---|---|---|---|
| A | 0 | | 1 | 0 |
| A.8 | 15 | | 2 | 28 |
| B | 20 | | 3 | 44 |
| C | 40 | | 3.4 | 56.9167 (12'-11") |
| D | 60 | | 3.5 | 61 (4'-1") |
| D.5 | 70 (scaled midpoint, **VERIFY**) | | 4 | 82 (21'-0") |
| E | 80 | | 4.2 | 88 (6'-0") |
| F, G, H, I, J, K | 100, 120, 140, 160, 180, 200 | | | |
| K.5 | 211.1667 (11'-2") | | | |
| L | 223.5 (12'-4") | | | |
| M | 238.5 (15'-0") | | | |

Cross-check: B→K × 1→4 = 180 ft × 82 ft = 14,760 sq ft, against the printed 14,915 GSF for floor 1 (1% apart). Floors 2 and 3 add the angled wedge between A and B.

### 3.5 Levels and stairs

- Top-of-slab elevations: F1 +155.0, F2 +169.00, F3 +181.50 (printed on A102/A103 and in the A603 sections). Floor-to-floor 14.0 ft and 12.5 ft. Landings +162.00 and +175.25, parapet +195.67 (**VERIFY**, read at low zoom).
- Riser counts in the A603 sections read "12 risers" + "12 risers" (F1→F2) and "11 risers" + "11 risers" (F2→F3) (**VERIFY**). Arithmetic agrees: 168 in ÷ 24 = 7.0 in; 150 in ÷ 22 = 6.8 in.
- **Central stair** S198A / S298A / S398A (A603 details 5–7): next to elevator E_97A at about grid D–D.5 / 1–2. Dimension strings read 4'-7½" and 4'-6½" across the two flights (**VERIFY** what each string spans). A108 prints 48" provided. Discharges on F1 into lobby C199A.
- **South stair** S198B / S298B / S398B (A603 details 1–3): outside the grid-K wall at about K–K.5 / 2–3. Flight strings read 4'-1" each; overall 16'-7½" (**VERIFY**). A108 prints 48" provided. F1 door prints 34" provided; exterior steps continue to grade.
- **Atrium stair** (A602): open stair in the atrium between about grids F–H, rows 2–3, rising F1→F2→F3. A602 plan strings read "15 treads 13'-9"", "7 treads 6'-5"", "10 treads 9'-2"" twice (**VERIFY**; read the flight width from A602). The A108 route arrows appear to lead only to the two enclosed stairs (**VERIFY**), so the twin sets `countsAsCodeExit: false` for the atrium stair while still letting occupants use it.
- Floors 2 and 3 have floor openings ("OPEN TO BELOW") along the atrium; trace them as `voids`.

### 3.6 Room inventory (read at overview zoom — a checklist to confirm at full zoom, not a source)

- **F1:** plaza C196A (exterior), lobby C199A, elevator E197A, stair S198A, mech room 0146A, women 0146, men 0145, storage 0140A, interview 0143, interview 0141, structures studio 0140, soils & conc. lab 0138, shop 0136, shower 0134, stair S198B, corridors C199B and C199D, elec 0110A, medium classroom 0106, large classroom 0110, entry/exhibit C199C, student org./lounge 0115, M.E.P. studio 0125.
- **F2:** C.F.A.H. 0203, D.E.S. 0202, tech services 0201, elevator E297A, stair S298A, women 0246, men 0245, storage 0245A, 0246A, janitor 0205, CST/DWG/SCH. 0240, construction lab 0238, storage 0235, 0240A, 0207A, elec 0235A, plan room 0204, MCE/SW room 0209, server room 0203A, computer lab 0206, information tech 0208, medium classrooms 0210, 0215, 0220, 0225, 0230, corridors C299A (and others), stair S298B.
- **F3:** conference 0303, director grad/D.E. 0302, admin/registrar 0301, career office 0301A, reception 0304, open office 0305, storage/supply 0308, telephone 0308A, mail/kit/copy 0310, faculty work room 0312, resource center 0313, e-journal editor 0344, endowed chair 0342, storage 0343, C.C.S.L.C. 0341, C.C.E. 0340, C.P.R. 0338, B.C.I.A.C. 0336, elec 0336B, grad studios 0320, 0324, 0326, 0328, center storage 0334, closet 0333, director 0306, associate director 0307, faculty offices 0309, 0311, 0314, 0315, 0316, 0319, 0321, 0322, 0323, 0325, 0327, 0329, 0331, 0332, women 0346, men 0345, janitor 0345A, elevator E397A, corridors C399A–D, stairs S398A, S398B.

Interior door widths are **not** on the six permitted sheets. Use 34" clear per leaf (**ASSUMED**; it is the leaf width implied by the printed 34" / 68" / 136" exits) and tag each such door `basis: "assumed"`.

---

## 4. Stack and repository

### 4.1 Machine (checked)

macOS 27.0.1, Apple M3 Pro, 11 cores, 18 GB. Node 24.13.1, npm 11.8.0, Python 3.13.5, `pdftoppm` (poppler) at `/usr/local/bin`. No `pnpm`, no `uv`. `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` are not set in the shell; Arun has an Anthropic key only.

### 4.2 Dependencies (exact versions; each was at least 7 days old on 2026-11-21)

| Package | Version | Use |
|---|---|---|
| `@anthropic-ai/sdk` | 1.8.0 | Planner, Liaison, Haiku personas (latest 1.12.0 was published the same day, so it is avoided) |
| `@typesafe-ai/sdk` | 0.7.0 | Jev personas (needs Node ≥ 22) |
| `zod` | 4.6.7 | schemas, structured output |
| `express` | 5.3.0 | HTTP API and static files |
| `ws` | 8.23.0 | WebSockets (console and phones) |
| `react`, `react-dom` | 19.3.1 | web app |
| `three` | 0.187.0 | 3D |
| `@react-three/fiber` | 9.8.2 | 3D in React |
| `@react-three/drei` | 10.7.9 | controls, labels |
| `zustand` | 5.1.0 | frame store |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 | styling |
| `qrcode` | 1.5.4 | sign QR codes |
| `nosleep.js` | 0.12.0 | keep phone screens awake |
| `vite` | 8.3.8 | web build and dev server |
| `@vitejs/plugin-react` | 6.3.0 | |
| `vitest` | 5.1.0 | tests (5.1.1 was 3 days old) |
| `@playwright/test` | 1.65.1 | browser tests, simulated phones |
| `typescript` | 7.0.2 | type-check only (`tsc --noEmit`) |

No other runtime dependency. PRNG, worker pool, CEM, geometry, hashing (`node:crypto`) are written in-house. PDF rasterising shells out to `pdftoppm`.

### 4.3 TypeScript rules (required for native execution)

`tsconfig.json`: `"erasableSyntaxOnly": true, "allowImportingTsExtensions": true, "verbatimModuleSyntax": true, "noEmit": true, "strict": true, "module": "nodenext"`. Consequences: no `enum`, no `namespace`, no constructor parameter properties, no path aliases; every relative import ends in `.ts`; `import type` for types. `package.json` has `"type": "module"`. Use `as const` objects in place of enums.

### 4.4 Layout

```
EgressLab/
  package.json  tsconfig.json  vite.config.ts  vitest.config.ts  playwright.config.ts
  .env.example  .gitignore  README.md  AGENTS.md
  docs/        BLUEPRINT.md  PROGRESS.md  verification/   (tables committed; overlays/ ignored)
  config/      behaviour.params.json  profiles.json  hazards.json  optimiser.costs.json
               templates.json  runtime.json
  data/
    sheets/            (ignored) PDFs + PNGs
    twin/rinker/       frame.ts floor1.ts floor2.ts floor3.ts stairs.ts zones.ts signs.ts candidates.ts
    twin/rinker.twin.json        (built, committed)
    twin/openground/             (stretch)
    fixtures/          decision_points.json  showcase_log.jsonl
    library/           breaking-scenarios.json
    playbook/          rinker.playbook.json
    policy/            distilled.policy.json
  src/
    shared/   types.ts ids.ts rng.ts units.ts geom.ts hash.ts params.ts
    log/      eventlog.ts events.ts replay.ts
    twin/     schema.ts build.ts validate.ts raster.ts navgraph.ts edit.ts
    sim/      world.ts step.ts movement.ts density.ts portals.ts stairs.ts routing.ts
              decisionpoints.ts behaviours.ts population.ts metrics.ts run.ts snapshot.ts
              hazards/fire.ts hazards/crush.ts hazards/quake.ts hazards/threat.ts
    policy/   context.ts actions.ts rule.ts llm.ts jev.ts haiku.ts distilled.ts replay.ts
              distill.ts bakeoff.ts
    design/   codecheck.ts pool.ts worker.ts bulk.ts scenario.ts bottleneck.ts adversary.ts
              explain.ts optimiser.ts rating.ts playbook.ts nl2params.ts
    live/     orchestrator.ts groundtruth.ts panel.ts sensors.ts sentinel.ts statemachine.ts
              planner.ts verifier.ts gate.ts approval.ts signcompiler.ts signs.ts
              liaison.ts historian.ts
    llm/      claude.ts typesafe.ts guard.ts deadlines.ts
    server/   index.ts api.ts ws.ts signws.ts demo.ts
    cli/      sheets-fetch.ts twin-build.ts twin-overlay.ts run.ts bulk.ts adversary.ts optimise.ts
              rate.ts playbook.ts personas-collect.ts distill.ts bakeoff.ts results-table.ts
              replay.ts demo.ts
  web/        index.html  sign.html
    src/      main.tsx App.tsx store.ts net.ts
              views/Plan2D.tsx views/Building3D.tsx
              pages/Design.tsx pages/Live.tsx pages/Report.tsx
              components/…   sign/sign.ts
  tests/      unit/  acceptance/  e2e/
  runs/       (ignored) event logs and results
```

### 4.5 Commands

| Command | Does |
|---|---|
| `npm run sheets:fetch` | downloads the six PDFs, renders PNGs with `pdftoppm` into `data/sheets/` |
| `npm run twin:build` | builds and validates `data/twin/rinker.twin.json` |
| `npm run twin:overlay` | writes overlay pages and screenshots to `docs/verification/overlays/` |
| `npm run dev` | server on `:8080` + Vite dev server |
| `npm run build` | type-check + web build |
| `npm test` | **all tests**: `vitest run` then `playwright test` |
| `npm run demo` | **the demo**: builds web, starts the server on `0.0.0.0:8080` with the scripted timeline, prints LAN URL and sign QR codes |
| `npm run bakeoff`, `personas:collect`, `distill`, `adversary`, `optimise`, `rate`, `playbook`, `results:table`, `replay -- <log>` | design and persona pipelines |

Environment (`.env.example`): `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `PERSONA_BACKEND` (`jev` | `haiku` | `none`), `PERSONA_HAIKU_MODEL=claude-haiku-5-5`, `JEV_MODEL=jev-1.14.0`, `PLANNER_MODEL=claude-sonnet-5-5`, `LIAISON_MODEL=claude-haiku-5-5`, `EXITMIND_OFFLINE=0`, `PORT=8080`.

---

## 5. Core contracts

### 5.1 Units and identifiers

- Twin: feet and inches, exactly as dimensioned. Simulator: SI. Convert once at load (`units.ts`). Code check reports in imperial to match the sheet.
- Ids: spaces use the printed room number (`"0110"`, `"C199D"`); doors `D-F1-012`; exits `EX-N`, `EX-W`, `EX-S`, `EX-E1`, `EX-E2`; stairs `ST-A` (central), `ST-B` (south), `ST-ATR`; zones `Z1N`, `Z1C`, `Z1S`, `Z2N`…; sign mounts `SM-2F-03`; events `E000001`.

### 5.2 Determinism rules

- `rng.ts`: `sfc32` seeded through `splitmix32`. Named streams derived by hashing `(seed, streamName)`: one each for population, hazards, sensors, and one per agent. No `Math.random`, no `Date.now`, no `performance.now` inside `src/sim`, `src/policy` (except latency measurement stored outside the hashed payload) or `src/design`.
- Fixed iteration order everywhere: agents by id; ties by id. Bulk results are returned in input order regardless of worker completion order.
- State is typed arrays plus plain JSON, so `snapshot.ts` can clone, hash and restore it.
- `stateHash(world)` = SHA-256 over the typed arrays and counters. A checkpoint hash is logged every 40 ticks.
- A test greps `src/sim`, `src/policy`, `src/design` for forbidden calls.

### 5.3 Event log

```ts
interface EventRecord {
  id: string;            // "E000123"
  seq: number;
  tick: number;          // simulation tick when applied; -1 outside a run
  wall: string;          // ISO time; informational, excluded from the hash
  actor: "orchestrator" | "sentinel" | "planner" | "verifier" | "human" | "gate"
       | "signs" | "liaison" | "historian" | "persona" | "sim" | "demo";
  type: string;          // see 10.9
  payload: unknown;      // zod-validated per type
  refs: string[];        // ids this record depends on
  prev: string;          // previous hash
  hash: string;          // sha256(prev + canonicalJSON({seq,tick,actor,type,payload,refs}))
}
```

`eventlog.ts` exposes `append`, `subscribe(types, handler)`, `get(id)`, `query(filter)`, `verifyChain()`. It has no update or delete. Agents in `src/live` may import `src/log`, `src/shared`, `src/sim`, `src/llm`, but **not each other**; a test checks the import graph. Only `orchestrator.ts` wires them, by starting each with a log handle.

### 5.4 The single behaviour-parameter file

`config/behaviour.params.json`: every behaviour parameter the simulator reads.

```json
{ "walk.freeSpeed.mean": { "value": 1.34, "min": 1.0, "max": 1.6, "unit": "m/s",
    "cite": ["weidmann1993"], "locator": "free-flow speed", "verified": false } }
```

`params.ts` loads it, refuses values outside `[min, max]`, and exposes `clampParam(key, v)`. Every scenario value, adversary sample, plain-language result and LLM-derived number passes through `clampParam`. A test fails if the simulator reads a key that is absent, or if any entry lacks a citation. `verified` is `false` until the builder has checked the number against the source; the UI shows unverified parameters with a marker. The seed list is section 7.9.

---

## 6. Digital twin

### 6.1 Schema (`src/twin/schema.ts`)

```ts
type Pt = [number, number];                       // feet in the grid frame
interface SourceRef { sheet: "A102"|"A103"|"A107"|"A108"|"A602"|"A603"; detail?: string;
  grid?: string; basis: "dimensioned"|"printed"|"scaled"|"assumed"; note?: string }
interface Space { id: string; name: string; floor: FloorId;
  kind: "room"|"corridor"|"lobby"|"stair"|"elevator"|"service"|"exterior";
  use: "classroom"|"lab"|"office"|"assembly"|"circulation"|"service"|"ward"|"retail";
  polygon: Pt[]; axis?: [Pt, Pt]; clearWidthFt?: number;      // axis present => width is editable
  occupiable: boolean; fixedSeats?: number; lockable: boolean; zone: ZoneId; src: SourceRef }
interface Portal { id: string; floor: FloorId; kind: "door"|"opening"|"corridor_section"|"stair_entry";
  a: Pt; b: Pt; clearWidthIn: number; leaves?: 1|2;
  connects: [string, string];                     // space ids, or "OUTSIDE"
  exitId?: string; accessible: boolean; src: SourceRef }
interface Stair { id: "ST-A"|"ST-B"|"ST-ATR"; name: string; enclosed: boolean; countsAsCodeExit: boolean;
  clearWidthIn: number; riserIn: number; treadIn: number;
  flights: { from: FloorId; to: FloorId; travelFt: number; path: Pt[];
             upperEntry: string; lowerEntry: string }[];      // portal ids
  dischargeSpace: string; src: SourceRef }
interface SignMount { id: string; floor: FloorId; at: Pt; facing: Pt; zone: ZoneId;
  staticDefault: { dir: ArrowDir; toward: string }; src: SourceRef }   // basis "assumed"
interface Floor { id: "F1"|"F2"|"F3"; elevationFt: number; outline: Pt[]; voids: Pt[][];
  spaces: Space[]; portals: Portal[] }
interface Twin { id: string; name: string; frame: { gridX: Record<string,number>; gridY: Record<string,number>; north: "-x" };
  floors: Floor[]; stairs: Stair[]; zones: Zone[]; signMounts: SignMount[];
  codeBasis: CodeBasis; printedLoads: PrintedLoad[]; sheets: SheetMeta[]; hash: string }
```

Sign mount positions are EXITMIND proposals, not on the drawings: about ten mounts (corridor junctions, stair heads, lobby), each `basis: "assumed"` with a static default arrow that follows the A107/A108 egress arrows.

Zones: each floor splits into north (A–E), central (E–H) and south (H–K): `Z1N … Z3S`. Zones are the unit for sensors, sign policy, playbook keys and (for the hospital profile) smoke compartments, where the compartment line is **ASSUMED** and labelled hypothetical.

### 6.2 Authoring and build

- Author in `data/twin/rinker/*.ts` using helpers `g("C","3")` (grid intersection) and `off(pt, dx, dy)`. This keeps every coordinate tied to a gridline.
- `twin-build.ts` validates: polygons closed and non-self-intersecting; spaces on a floor do not overlap; every portal lies on a shared boundary; every occupiable space reaches an exit on the nav graph; every element has a `SourceRef`; then writes the JSON with a content hash.
- Tolerance target: walls within ±1 ft of the sheet (below the 0.4 m cell).
- `candidates.ts` holds hypothetical edit sites for the optimiser (2–3 new stair sites, 3–4 new exit door sites, refuge areas at stair landings), all `basis: "assumed"`.

### 6.3 Registration and overlay

Per plan, pick at least six grid intersections in the rendered PNG and store their pixel coordinates in `frame.ts`. Fit an affine map; a test requires residuals ≤ 0.5 ft. `twin-overlay.ts` writes an HTML page per floor (sheet PNG under an SVG of the twin) and screenshots it with Playwright.

### 6.4 Rasterising and navigation

- `raster.ts`: per floor a grid of 0.4 m cells, 182 × 68. A cell is walkable if its centre is inside a walkable space and outside every void. Each cell stores its space id.
- Moving between cells of different spaces is allowed only across a portal: precompute the allowed cell pairs straddling each portal segment. Diagonal moves need both orthogonal neighbours walkable and in the same space.
- `corridor_section` portals are generated automatically at the midpoint of every space with an `axis`, with `clearWidthIn` from `clearWidthFt`.
- `navgraph.ts`: nodes are spaces, stairs and exits; edges are portals with lengths. Used for the code check, route options and dead-end analysis.
- `edit.ts`: parametric edits (section 9.5) return a new twin; the raster and nav graph rebuild in a few milliseconds.

### 6.5 Verification of the twin

1. Overlay screenshots for F1, F2, F3 (local, ignored).
2. `docs/verification/twin-spotcheck.md`: five dimensions, twin against sheet, with sheet references: grid B→K (180'-0"), grid 1→4 (82'-0"), central stair flight width, south stair overall plan width (16'-7½"), north lobby exit provided width (136").
3. Floor area from the twin outline within ±3% of 14,915 / 16,270 / 16,270 GSF.

---

## 7. Simulator

### 7.1 World

SI units, tick `dt = 0.25 s`, cell `0.4 m`. Agent state is struct-of-arrays: `cell, floor, credit, vFree, state, stress, mobility, role, ageBand, familiar, knownMask, compliance, groupId, homeSpace, target, policyKind, nextDecisionTick, stairId, stairPos`. Agent states: `IDLE, PREMOVE, MOVING, QUEUED, ON_STAIR, HOLDING, SHELTERING, WAITING, DECIDING, ASSISTING, ASSISTED, REFUGE, PROTECTED`.

"Protected" means: outside the building; or, under lockdown, inside a lockable room outside the hazard; or, under horizontal evacuation, inside another compartment; or in a refuge area. Metrics use `protected`, never "safe" or "saved".

### 7.2 Step order (fixed)

1. Update hazards (smoke front, shaking, damage, threat).
2. Update perception: alarm noticed, hazard cues, signs seen, group separation, blocked timers.
3. Raise decision points; resolve synchronous policies now; register asynchronous ones with a due tick.
4. Apply decisions due this tick, in agent-id order.
5. Update stress.
6. Recompute the density field (count grid + summed-area table per floor).
7. Refill portal tokens.
8. Move agents in order of (distance-to-target ascending, id).
9. Advance stairs; hand agents to the lower floor.
10. Mark agents protected; accumulate metrics; `tick++`.

### 7.3 Movement

- Free speed per agent: truncated normal (Weidmann mean 1.34 m/s, sd 0.26), times a mobility factor, capped at `cell/dt = 1.6 m/s`.
- Speed factors multiply: density, smoke, stress, assisted.
- Density `D` at a cell: agents in the 5 × 5 cell window ÷ walkable area of that window.
- Density factor (SFPE, `a = 0.266 m²/person`): 1 for `D ≤ 0.54`; `(1 − a·D)/(1 − a·0.54)` for `0.54 < D ≤ 1.9`; held at the `D = 1.9` value above that, where exclusion and portal capacity govern.
- Credit: `credit += v·dt/0.4` each tick, capped at 1.5. A move costs 1 (orthogonal) or 1.414 (diagonal). Blocked agents keep their credit, so a queue shuffles forward the moment space opens.
- Target cell: the free neighbour with the lowest floor-field value below the agent's own; ties by fixed neighbour order.
- Personal-space rule: an agent will not enter a cell if that would push density in the 3 × 3 window above its tolerance `lerp(D_calm, D_push, stress)` (defaults 3.8 and 6.25 persons/m²). Calm crowds queue at about SFPE's stop density; stressed crowds pack tighter.
- Head-on deadlock: two agents wanting each other's cells swap when both hold ≥ 2 credit.

### 7.4 Portals (the door-flow relation)

Each portal has a token bucket. Refill per tick: `Fs_max × We × collapse × dt`, where `We = clearWidth − 2 × boundaryLayer` (0.15 m for doors and stairs, 0.20 m for corridors, per SFPE) and `Fs_max = 1.3 persons/s/m` for doors and corridors. Crossing costs one token; burst is capped at `max(1, ceil(refill))`. A closed portal (damage, lockdown, inflow control) refills at zero.

Stress effect ("faster is slower", bounded): `Fs_max` is multiplied by `1 − γ_door × meanStress` near the portal.

### 7.5 Stairs

A flight is a one-dimensional FIFO pipe of length `travelFt` and width `clearWidthIn`.

- Entry is a `stair_entry` portal with `Fs_max` for stairs (1.01 persons/s/m for a 7"/11" stair, SFPE; other geometries from the SFPE table).
- Speed on the stair: `k_stair × (1 − a·D)` with `k_stair = 1.08` for 7"/11", `D` = occupants ÷ (length × width). No overtaking; minimum headway `1/(3.8 × width)`. Entry is refused when the pipe is at 3.8 persons/m².
- At an intermediate landing, the flow from above and the entrants from that floor share the next flight's entry tokens in ratio `stair.mergeRatio` (default 0.5).
- Mobility: wheelchair users cannot enter a stair unless assisted with an evacuation chair; otherwise they go to a refuge area if one exists, else wait at the stair head.
- 3D position is interpolated along the flight `path` with height from the floor elevations.

### 7.6 Routing and decision points

Floor fields are Dijkstra distance grids, one per egress element per floor (each exit door on F1, each stair entry on every floor), plus on-demand fields for "return to space X", "nearest lockable room" and "away from threat". Cell cost rises in smoke. Fields are rebuilt whenever a hazard closes cells or portals.

An agent's choice is which egress element on its current floor to head for. Decision points:

| Point | Raised when |
|---|---|
| `ALARM_NOTICED` | pre-movement delay ends |
| `JUNCTION` | the agent enters a space offering more than one onward element, or arrives on a new floor |
| `SIGN_SEEN` | a sign enters view (perception roll succeeds) and its state differs from the last one seen |
| `BLOCKED` | no progress for `blocked.timeout` seconds, or the target is closed or in dense smoke |
| `GROUP_MEMBER_MISSING` | a group member is farther than `group.separationDist` |

At each point the simulator builds a `DecisionContext` (section 8.1) and asks the agent's policy.

### 7.7 The six required behaviours

| Behaviour | Mechanism |
|---|---|
| Familiarity | Each agent has a known set of egress elements. Familiar occupants know all. Unfamiliar ones know only the way they came in (an entry door and, upstairs, the open atrium stair with probability `familiarity.atriumEntryShare`), plus anything a seen sign indicates or that is in line of sight. Utility bonus `β_fam` for the known route. |
| Hesitation | Pre-movement delay drawn from a lognormal per profile, shortened by strong cues. A further short pause at each decision. |
| Stress | One bounded state in [0, 1]. Rises with hazard cues, high density, being blocked and stressed neighbours; decays otherwise. It raises speed (capped), route-choice noise, herding weight and density tolerance, and lowers sign compliance. |
| Groups and herding | Groups share a target and move at the slowest member's speed; separation raises a decision point. Herding adds `β_herd ×` (share of visible neighbours heading to an option). |
| Reduced mobility | Mobility classes with speed factors and stair capability; assisted evacuation pairs staff with patients. |
| Reaction to instructions | A sign is perceived with a probability that is higher for a dynamic (phone) sign than a static one; a perceived instruction is followed with probability `compliance × (1 − γ_c × stress)`, raised near staff. Announcements reach a fraction of a zone. |

Rule-policy utility for option `o`:
`U = −time_o − β_q·queue_o + β_fam·known_o + β_sign·signed_o·compliance − β_haz·hazard_o + β_herd·share_o + Gumbel(σ(stress))`, with the noise drawn from the agent's stream.

### 7.8 Hazards (`config/hazards.json`; ranges are stated assumptions, not physics)

| Hazard | Changes geometry | Changes behaviour |
|---|---|---|
| **Fire / smoke** | Smoke arrival time per cell = Dijkstra from the origin at a spread speed per space kind, delayed at doors, rising through floor voids. Smoke level ramps 0→1 after arrival. A growing fire core is impassable. | Speed falls with smoke level; routes through dense smoke are avoided; stress rises. |
| **Crowd crush** | Where density stays at or above `crush.density` for `crush.sustain` seconds, cell movement and nearby portal capacity are multiplied by `crush.collapseFactor` until density falls below `crush.recover`. | Scenario adds a surge (load multiplier, one preferred exit, raised baseline stress). |
| **Earthquake** | Stairs and exits flagged damaged are closed or reduced; debris cells slow movement. | Nobody moves during shaking; a hold period follows; a bounded fraction leaves early. Damage is unknown to an occupant until seen or signed. |
| **Medical / active threat** | A threat zone (static or moving) that must be avoided; for medical, a keep-clear zone and a responder route. | Agents move away or shelter in lockable rooms; exposure is person-seconds inside the zone. |

This is a simple spreading zone, not CFD, and the UI says so.

### 7.9 Parameter seed list for `behaviour.params.json`

All values below are **VERIFY** (recalled; references in section 18 were confirmed to exist). Keep `verified: false` until checked.

| Key | Value [min, max] | Source |
|---|---|---|
| `walk.freeSpeed.mean`, `.sd` | 1.34 [1.0, 1.6], 0.26 m/s | Weidmann 1993 |
| `flow.a` | 0.266 m²/person | SFPE Handbook, Gwynne & Rosenbaum |
| `flow.door.FsMax`, `flow.corridor.FsMax` | 1.3 [1.0, 1.9] persons/s/m | SFPE; upper bound Seyfried 2009 |
| `flow.stair.FsMax` (7"/11") | 1.01 [0.94, 1.16] | SFPE |
| `flow.stair.k` (7"/11") | 1.08 [1.00, 1.23] m/s | SFPE |
| `flow.boundary.door`, `.stair`, `.corridor` | 0.15, 0.15, 0.20 m | SFPE |
| `density.calmTolerance`, `.pushTolerance` | 3.8 [3.0, 4.0], 6.25 [5.0, 6.25] persons/m² | SFPE; Helbing 2007 |
| `density.danger` (exposure threshold) | 4.0 [3.5, 5.0] | Fruin; Still (**VERIFY** and add reference) |
| `crush.density`, `.collapseFactor` | 5.0 [4.0, 6.0], 0.2 [0, 0.5] | Helbing 2007; Helbing 2000 |
| `premove.median`, `.sigma` per profile | lognormal | Lovreglio 2019; Purser & Bensilum 2001 |
| `familiarity.beta`, `.atriumEntryShare` | bounded | Sime 1985; Kinateder 2018 |
| `herding.beta` | bounded, includes 0 | Haghani & Sarvi 2019; Helbing 2000 |
| `group.fraction`, `.sizeDist` | by profile | Moussaïd 2010 |
| `mobility.speedFactor.*` (slow, crutches, wheelchair, assisted) | by class | Boyce 1999; Kuligowski 2013 |
| `assist.speed.*`, evacuation-chair stair speed | by device | Hunt 2013 |
| `child.speedFactor` | by age band | Larusdottir & Dederichs 2010 |
| `sign.detect.static`, `.dynamic` | 0.38, 0.77 [bounded] | Xie 2011; Galea 2014 |
| `sign.compliance.base`, `.stressGamma` | bounded | Galea 2014; Kinateder 2018 |
| `smoke.speedFactor.min` | 0.3 [0.2, 0.6] | Jin 1978; Fridolf 2013 |
| `quake.earlyLeaverShare`, `.holdSec` | bounded | Bernardini 2016 |
| `stress.*` (gains, decay, speed cap ≤ 1.25) | bounded | Helbing 2000 (qualitative) — label "model assumption within bounded range" |
| `stair.mergeRatio` | 0.5 [0.3, 0.7] | **VERIFY** and add a merging-flow reference |

If a number cannot be confirmed against its source, keep it, leave `verified: false`, and say so in the README. Do not delete the flag to make a screen look clean.

### 7.10 Occupancy profiles (`config/profiles.json`)

| Profile | Mix | Default protocol |
|---|---|---|
| `college` (Rinker default) | mostly young adults; high familiarity; few staff; small groups; load = printed sheet loads (154 / 157 / 151) spread over occupiable spaces by area | `EVACUATE` (simultaneous) |
| `school` | children in class groups led by a teacher; high familiarity; high compliance near staff | `EVACUATE`, staff-led |
| `mall` | all ages; low familiarity; family groups; low staff ratio; higher load | `PHASED_EVACUATION` with inflow control |
| `hospital` | patients with a large non-ambulant share, nurses, visitors; assisted evacuation; staff ratio matters | `HORIZONTAL_EVACUATION` (defend in place) |

Each profile sets: age bands, mobility mix, familiarity share, staff ratio, group size distribution, pre-movement distribution, compliance base, load rule, default protocol, and whether assisted evacuation applies. Load factors for school, mall and hospital come from an occupant-load table that is **not on the sheet**: store them with a citation and `verified: false`. Any profile can be applied to any twin; applying one changes both the population and the default protocol.

### 7.11 Metrics per run

`clearance95`, `clearance100`, protected-over-time curve, `remainingAtTarget`, exposure in person-seconds (`smoke`, `densityDanger`, `threat`), `maxDensity`, per-cell person-seconds above `density.danger`, per-portal throughput / peak queue / queue person-seconds / utilisation, per-exit usage share, `gridlock` (people remain and no portal has passed anyone for 60 s outside a hold or lockdown), `llmCalls`, `fallbacks`.

Scalar used by the adversary and optimiser: `badness = min(clearance95, cap) + w1·densityDangerPS + w2·smokePS + w3·remainingAtTarget` with weights in `runtime.json`, printed wherever the scalar is shown.

### 7.12 Performance targets (measured and reported, not assumed)

- One Rinker college run (462 agents, 600 s simulated): target ≤ 150 ms on one core.
- 1,000 bulk runs: target ≤ 60 s on 8 workers.
- Verifier roll-forward: target ≥ 50× real time.

If a target is missed, report the measured figure and reduce run counts in `runtime.json`; do not weaken the model silently.

---

## 8. Decision policies and personas

### 8.1 Context, options, decision

```ts
interface DecisionContext {
  runId: string; tick: number; agentId: number; seq: number;
  point: "ALARM_NOTICED"|"JUNCTION"|"SIGN_SEEN"|"BLOCKED"|"GROUP_MEMBER_MISSING";
  persona: { ageBand: "child"|"young_adult"|"adult"|"older_adult";
    mobility: "unimpaired"|"slow"|"crutches"|"wheelchair"|"assisted_patient";
    familiarity: "first_visit"|"occasional"|"daily";
    role: "student"|"visitor"|"staff"|"teacher"|"nurse"|"patient"|"shopper";
    stress: "calm"|"uneasy"|"alarmed"|"panicked"; group: "alone"|"pair"|"group" };
  situation: { floor: string; spaceKind: string;
    hazardCue: "none"|"alarm_only"|"smell_smoke"|"see_smoke"|"see_fire"|"shaking"|"shaking_stopped"|"threat_seen";
    crowding: "empty"|"light"|"busy"|"packed"; sinceAlarm: "seconds"|"under_a_minute"|"minutes";
    sign: null | { kind: "ARROW"|"X_ALT"|"HOLD"|"LOCKDOWN"|"STATIC_DEFAULT"; dynamic: boolean; pointsTo?: string };
    groupStatus: "alone"|"together"|"member_missing" };
  options: Option[];                  // 2..8, only moves that are physically possible now
}
interface Option { id: "A"|"B"|"C"|"D"|"E"|"F"|"G"|"H";
  action: "MOVE_TO"|"WAIT"|"FOLLOW_GROUP"|"GO_BACK"|"FOLLOW_SIGN"|"HELP";
  target?: string; roles: OptionRole[]; desc: string }      // desc is template text with word buckets, no raw numbers
type OptionRole = "NEAREST"|"FAMILIAR"|"SIGNED"|"LEAST_CROWDED"|"MAJORITY"|"HAZARD_ON_ROUTE"|"STAIR"|"LEVEL";
interface Decision { optionId: string; source: "rule"|"jev"|"haiku"|"distilled"|"replay"|`fallback:${string}`;
  probs?: Record<string, number>; latencyMs?: number; logId?: string }
interface DecisionPolicy { decide(ctx: DecisionContext, rng: Rng): Decision | Promise<Decision> }
```

The typed action set is exactly the six actions above. `validate(ctx, decision)` accepts only an `optionId` present in `ctx.options`. Anything else is rejected, logged as `persona.decision.rejected`, and the agent falls back: distilled policy, then rule policy.

### 8.2 Jev adapter (`policy/jev.ts`) — from the TypeSafe docs checked 2026-11-21

- Endpoint `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`. SDK: `new TypeSafeClient({ defaultModel, timeout, retry })`, `client.systemOne({ state, questions })`, helpers `choice`, `noul`, `score`.
- A `choice` answer returns `choice`, `probabilities` (sums to 1) and `confidence`. Jev returns typed answers only; it generates no text.
- Pin `jev-1.14.0` (the alias `jev-latest` moves). Log the `model` field of each response.
- Request: `state = { persona, situation, options: [{id, desc}] }`; question `action = choice("Which option does this person take next? Answer as this specific person would behave in this situation, not as an ideal evacuee would.", { A: desc, … })`.
- The action is **sampled** from `probabilities` using the agent's seeded stream, and the full vector is logged.
- Documented weaknesses and what we do: first-option lean → shuffle option order with the seeded stream and log the order; weak arithmetic → describe distance and crowding in words; literal reading → explicit instructions; large state hurts accuracy → send only the fields above.
- Timeout 2,000 ms per attempt, one attempt. Errors `429` and `529` go straight to fallback (no waiting inside a showcase run).
- Pricing on the docs: $0.042 per million input tokens, output free. Rate limits are per organisation and visible only in the console.
- Without a key the adapter is tested against recorded fixtures through the SDK's `fetch` option. Mark those tests "fixture".

### 8.3 Haiku adapter (`policy/haiku.ts`) — from the Claude docs checked 2026-11-21

- Model `claude-haiku-5-5` (from $0.10 / $0.50 per million tokens; "fastest" tier). Other current IDs: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`.
- `client.messages.parse({ model, max_tokens: 200, thinking: { type: "disabled" }, output_config: { effort: "low", format: zodOutputFormat(Schema) }, system, messages })`; read `response.parsed_output`. `zodOutputFormat` comes from `@anthropic-ai/sdk/helpers/zod`. Disabling thinking is allowed on Haiku 5.5 at effort `high` or below.
- Schema (fixed, so the compiled grammar is cached; the first call with a new schema is slower): `{ option: enum A–H, confidence: enum low|medium|high }`. Structured outputs do not support numeric bounds, string length limits or `minItems` above 1, and need `additionalProperties: false`.
- The fixed enum can name a letter that is not offered. That is the real path for the "invalid output is rejected and logged" criterion.
- Check `stop_reason`: `refusal` or `max_tokens` counts as invalid.
- Warm the schema once at server start.

### 8.4 Showcase runs (live personas mixed into the crowd)

- `showcase.livePersonas` agents (default 12) are chosen by a seeded draw stratified across floors and archetypes, and get `policyKind = llm`. Everyone else is `rule`.
- At a decision point a persona enters `DECIDING` for a bounded pause (4–12 ticks). The request is sent at once; the decision is applied at the due tick. Before stepping past a due tick the run loop awaits that decision up to the wall-clock deadline (`runtime.json: persona.deadlineMs`, default 2,500). Late or failed → fallback, logged.
- At most 8 requests in flight. Decisions sharing a due tick are applied in agent-id order, so arrival order cannot change the result.
- Each call is logged as `persona.decision` with the full context, option order, raw response, probabilities, chosen option, source and latency.
- **Replay:** `ReplayPolicy` answers from the log by `(runId, agentId, seq)`. A replayed showcase run makes zero LLM calls and must reach the same final state hash.
- Real-time pacing is 4 ticks per second, so a 1–3 s thinking pause usually hides the LLM latency.
- Every persona surface (3D label, decision feed, report) carries the "modelled behaviour" label.

### 8.5 Distilled policy

- Situation key: `[point, ageBand, mobility, familiarity, roleClass, stress, hazardCue, crowding, signKind, groupStatus]`.
- Value: a distribution over **role signatures** (`MOVE_TO:FAMILIAR`, `MOVE_TO:NEAREST`, `MOVE_TO:SIGNED`, `MOVE_TO:LEAST_CROWDED`, `MOVE_TO:MAJORITY`, `FOLLOW_SIGN`, `WAIT`, `FOLLOW_GROUP`, `GO_BACK`, `HELP`).
- Built by `distill.ts` from logged decisions: Jev rows add their probability vector; Haiku rows add a one-hot count.
- Back-off: if a key has fewer than 5 samples, drop features in a fixed order (`crowding`, `sinceAlarm`-derived, `groupStatus`, `roleClass`, `ageBand`, …) until it does; if nothing matches, use the rule policy.
- At decision time: take the distribution, keep the signatures present in the options, renormalise, sample with the agent's stream.
- `personas-collect.ts` runs varied showcase scenarios headless at full speed to gather at least 2,000 decisions.
- The file records its training log ids, backend, model versions and date.

### 8.6 Tests for this section

- Typed actions: property test over thousands of generated contexts; no applied decision is outside the options; a forged invalid response is rejected, logged, and the agent proceeds under fallback.
- Distillation fidelity: for every key with ≥ 20 logged samples, total-variation distance between logged frequencies and 10,000 samples from the policy is ≤ **0.05**. Report held-out (20% split) distance as information.
- Zero calls: bulk workers start with API keys removed from their environment; `llm/guard.ts` counts calls; the bulk test asserts the count is 0.
- Showcase comparison: same scenario and seed, rule-only against hybrid; write a table of differences in clearance, exit shares, queue peaks and per-decision-point choice shares. Report what is found, including "no material difference" if that is the result.

### 8.7 Side-by-side test for O3 (`npm run bakeoff`)

Fixture: 60 real decision contexts captured from simulator runs, covering all five decision points, plus minimal pairs that differ in one persona attribute. For each available backend report:

| Measure | Meaning |
|---|---|
| valid rate | share of responses accepted by `validate` |
| latency p50 / p95 | wall time per decision |
| cost per 1,000 decisions | from reported token usage |
| spread | mean entropy of the choice distribution |
| attribute sensitivity | for each minimal pair, whether the choice shifts in the stated plausible direction (reported as plausibility checks, not validation) |
| self-consistency | agreement across 3 repeats |
| order sensitivity | agreement when option order is reversed |

Output: `docs/verification/bakeoff.md`. A backend without a key gets the row "not run: no key". Then stop for Arun's decision.

---

## 9. Design mode

### 9.1 Scenario

```ts
interface Scenario { id: string; twinHash: string; edits: Edit[]; profile: string;
  hazard: HazardSpec; behaviour: Record<string, number>;          // clamped
  personaMix: Record<string, number>; loadFactor: number;
  occupancy: "uniform"|"classes_full"|`event_in:${string}`|"after_hours";
  protocol: Protocol; signPlan?: Record<string, SignState>; seed: number }
```

### 9.2 Code check (`design/codecheck.ts`) — outcome 7

Recomputed from the twin, each row showing the printed value, the recomputed value, the rule and its sheet reference:

1. Occupant load per floor: floor area (outline minus voids) ÷ 100, beside the printed loads; differences flagged.
2. Required egress width: occupants × 0.2 (doors, corridors) or × 0.3 (stairs), using the printed load, against the provided width from the twin. Must reproduce 28.2", 1.8", 0.8", 47.1", 45.3" exactly.
3. Stair capacity governed by the most loaded floor (§1003.3.2).
4. Minimum widths: doors ≥ 32", corridors ≥ 44".
5. Number of exits per floor ≥ 2; exit separation reported as information.
6. Travel distance: longest shortest path from any walkable cell to the nearest exit (exterior door on F1; enclosed stair door on F2/F3), against 200 ft (NFPA 101) and 250 ft (SBC), both shown.
7. Common path of travel: from the most remote point of each room to the first nav-graph node offering two distinct exits, against 100 ft.
8. Dead ends: corridor branches beyond the last junction with no exit, against 20 ft.
9. Rooms with 50+ occupants and travel over 75 ft need two doors.

Rows that pass show "passes on paper". Rows where the twin lacks data (for example an assumed door width) show "not determinable from the permitted sheets".

### 9.3 Bulk runs and bottleneck finder — outcome 8

- `pool.ts`: in-house `worker_threads` pool, `cpus − 2` workers, each loading the twin once. `bulk(scenarios)` returns results in input order.
- `bottleneck.ts`, over N runs (hundreds to thousands):
  - congestion points: portals ranked by queue person-seconds and utilisation;
  - dangerous density: per-cell person-seconds above `density.danger`, clustered into connected hot spots;
  - exits: usage share against capacity share, flagged under-used or overloaded;
  - weak spots: one ranked list, each with a **replay link** (scenario id + seed + tick) to its worst run.
- A replay re-simulates from the seed; frames are not stored.

### 9.4 Adversary — outcome 9

- Search space: continuous behaviour parameters within their bounds (familiarity share, pre-movement scale, compliance, herding, baseline stress, mobility-impaired share, group share, load factor); categorical hazard origin (candidate cells per zone), blocked element (none or any stair/exit), occupancy pattern, hazard severity; persona mix weights.
- Method: cross-entropy. Population 48, elites 8, 8 generations, 3 seeds per candidate shared across the generation, smoothing 0.7. Truncated Gaussians for continuous dimensions, categorical distributions for discrete ones.
- Output: an archive of the 10 worst distinct scenarios, re-scored on 10 fresh seeds.
- The same routine attacks a fixed action (a sign plan) for the playbook and the Verifier, with a smaller budget.
- `explain.ts`: reset each factor to its default one at a time, measure the change in badness over 3 seeds, rank the factors, and add observed facts from the worst run (longest queue, peak density location, exit shares). Text is assembled from templates with those numbers.
- Acceptance: the worst scenario's badness exceeds the default crowd's on fresh seeds, reported as mean ± sd with the difference.

### 9.5 Layout optimiser — outcome 10

Edit catalogue (`config/optimiser.costs.json`; costs are **illustrative units, editable, not estimates**):

| Edit | Parameter | Code limit checked |
|---|---|---|
| widen a corridor | +1 ft steps on spaces with an `axis` | ≥ 44" |
| widen a stair | +6 in steps | ≥ 44", landing ≥ stair width |
| add a stair | one of the candidate sites | exits, travel distance |
| widen an exit door | +6 in steps | ≥ 32" clear |
| add or move an exit | one of the candidate sites | travel distance, dead ends |
| accessibility | accessible exit, refuge area at a stair landing, ramp at an exit with steps, evacuation chairs per stair | — |
| strategy | simultaneous, phased, horizontal | — |

Loop:

```
archive = adversary(layout)
repeat
  for each edit e that fits the remaining budget and passes the code check:
      score(e) = mean badness of (layout + e) over the archive, 3 shared seeds
  e* = best improvement per unit cost, if the improvement exceeds 2 standard errors
  layout += e*;  archive = archive ∪ adversary(layout, warm start)
  record: edit, cost, worst case before and after on fresh seeds, trade-offs
until no edit qualifies or the budget is spent
```

Trade-offs recorded per step: cost, floor area taken from rooms, change in each hazard's rating, change in code-check margins. Acceptance: on fresh seeds and after a fresh adversary attack, the optimised layout's worst case is lower than the original's, within budget and code limits.

### 9.6 Crash-test rating — outcome 11

For each hazard × profile cell: N = 50 distinct adversarial scenarios (from the adversary's elite history, with a minimum distance in parameter space). A scenario is survived when everyone is protected by the clearance target, `densityDangerPS` is zero and there is no gridlock. Clearance targets live in `runtime.json` per hazard and are printed beside every rating as "target set by the reviewer (EXITMIND default)". Stars: ≥ 95% → 5, ≥ 85% → 4, ≥ 70% → 3, ≥ 50% → 2, ≥ 25% → 1, else 0. Breaking scenarios are listed with replay links. Footer on every rating: "Decision support for professional safety review. Not a certification."

### 9.7 Playbook — outcome 12

- Signature: `{ hazard, zone, blocked: sorted element ids, occupancy }`.
- For each signature, candidate responses come from fixed generators (evacuate by nearest; evacuate avoiding the hazard zone; phased top-down; hold then evacuate; lockdown/shelter; horizontal; inflow control). Each is scored on 3 nominal seeds and on the worst case found by a small adversary run over the factors a live operator cannot know.
- Entry: `{ signature, response: { protocol, routePolicy }, verified: { nominal, worstCase, doNothing }, alternatives[], worstScenarioId, twinHash, generatedBy: runId }`.
- Lookup order: exact; same hazard and zone with a superset of blocked elements; the profile's default protocol.

### 9.8 Plain-language input — outcome 6

`nl2params(text)` asks the configured typed backend to rate fixed dimensions on five-level scales (familiarity, crowd size, age skew, mobility-impaired share, grouping, urgency, compliance): Jev `score` questions, or Haiku with a fixed enum schema. Levels map linearly into each parameter's `[min, max]` and to a persona mix. The result appears as bounded sliders the user can edit before running. Offline fallback: a keyword lexicon. Test: "fest night, most people don't know the building" yields a low familiarity share and a load factor above 1, all within bounds.

---

## 9A. Architectural optimisation engine (built 2026-11-21; supersedes the 9.x layout optimiser for structural proposals)

**Question it answers:** what to construct or change, exactly where, why it is needed, and how many more people reach safety as a result. The simulator is the judge throughout; the LLM proposes and explains, and the learned model only decides what to simulate next.

```
scenario set (same seeds for every candidate)
   │
   ├─► DIAGNOSE  src/optimise/diagnose.ts      measure where and why people wait
   │        │
   ├─► GENERATE  src/optimise/generate.ts      rule-based geometry from each hotspot
   │   + CONCEPTS src/optimise/concepts.ts     Opus 5.5 ideas, rebuilt by the same generators or rejected
   │        │
   ├─► EVALUATE  src/optimise/evaluate.ts      paired runs, 95% intervals, safe-capacity bisection
   ├─► SEARCH    src/optimise/search.ts        screen → full runs → pairs → triples (predicted, then simulated)
   │        │
   └─► REPORT    src/optimise/architect.ts     ranked alternatives, change plan, quantities, after-diagnosis
                 → data/design/architect[-venue].json → Optimise page (2D, 3D, numbers)
```

### 9A.1 Diagnose (simulation analytics, no LLM)
- **Scenario set:** drill and fire at 1.2× the printed load on three seeds, plus the adversary's worst fire on two seeds (`defaultScenarios`). Every candidate is judged on exactly this set.
- **Instrumentation:** each tick records a person who is MOVING or DECIDING but stayed in the same cell as *waiting*. That builds a per-cell waiting map, per-person waiting time, and per-door flow over 10 s windows.
- **Hotspots:** cells above 8% of the peak (at least 2 person-s per run) are grouped by 8-connectivity. Each group is charged to the nearest door or stair head within 25 ft (the constriction it queues behind), and records:
  - capacity (the simulator's own door or stair rate), peak demand, and how long the door ran at 85%+ of capacity;
  - the rooms the waiting people started in (the catchment) and the exits they were heading for;
  - nearby exits with spare capacity.
- **Failures:** everyone not out by the target is classified as *queue, travel, late start, no step-free route, smoke* or *sealed*, then grouped by where they were.
- **Layout analytics:** exits that carry far more or fewer people than their share of capacity; rooms whose walking route to the nearest exit is more than 1.5× the straight-line distance.

### 9A.2 Generate (geometry, not advice)
Each proposal is a `GeometryPatch` (new spaces, doors, exits, stairs, removed or updated doors, cuts through wall barriers). It is applied by `applyEdits`, rasterised and validated like the hand-traced twin.

| Generator | Placement rule |
|---|---|
| New exterior exit | ground-floor space edges that lie on the outline, closest to the hotspot; ≥ 2.5 ft from structural grid lines, ≥ 30 ft from existing exits; includes direct discharge from a stair |
| External stair | façade of an upper-floor space near the hotspot where a 16 × 10 ft footprint is clear on every floor; 48 in stair, flights per floor, a door per floor, ground discharge |
| Connecting passage | lowest-cost route over rooms that share walls (corridors 1, storage 1.5, offices 4, classrooms and labs 6; restrooms, wards, stairs and lifts excluded) from the hotspot to a spare exit; 44 in openings where no door exists |
| Remove partition / double door | for door constrictions; partition removal only off the structural grid and ≥ 8 ft long |
| Widen stair / exit | constrictions at stair heads and exits |
| Ramp | exits with steps; 1:12 slope from an assumed 21 in rise, plus a landing |
| Uploaded plans and outdoor venues | new openings in the perimeter nearest the hotspot; widened exits |

Every proposal also carries:
- **quantities:** doors, m² of wall opened, m of partition removed, m² of new floor, stair flights, m of ramp;
- **structure:** none, partition or structural. Outside walls and walls on the drawing's structural grid count as structural, and any opening in them is marked *needs a structural engineer*.
- **access and regulations:** the change in accessibility, and regulatory notes that cite the clause to verify;
- **drawing shapes:** build (green), remove (red) or modify (amber).

### 9A.3 Opus 5.5 concepts (where the LLM earns its place)
- **Input:** Opus reads the diagnosis (summary, hotspots, exits, failures, detours) and the room layout (spaces, uses, adjacency, outside walls, doors). It returns a plain-language interpretation plus 4–8 typed concepts (kind, hotspot, floor, spaces or route, element, rationale).
- **What it adds:** reasoning about room use (route through storage rather than a lab) and combinations that the fixed rules do not try.
- **Compilation:** `compile()` rebuilds each concept with the same generators and checks. A concept that cannot be built is rejected with a reason, for example "no façade clear on every floor", "route passes through a restroom" or "unknown space".
- **Interpretation guard:** the interpretation is dropped if it quotes a number that is not in the diagnosis.
- **No reported numbers:** Opus never supplies a reported number.
- **Ablation:** the report records how many Opus concepts were built and how many appear in the top 3.

### 9A.4 Evaluate, search and learn
- **Paired evaluation:** baseline and candidate run the same scenarios and seeds. Differences per run give the mean and a 95% interval for:
  - people out by the target;
  - time for 95% out (capped at the horizon);
  - badness.
- **Successive halving:** every single proposal is screened on 4 runs. The best 6 are re-run on the full set, and all their pairs are simulated.
- **Learned predictor for triples:** a ridge regression is trained on the simulated pairs. Its inputs are the sum and best of the single effects, shared hotspot and shared kind. It ranks all triples, and the top 5 are simulated.
- **Validation:** all triples are also simulated, and the rank correlation is reported for both ridge and plain addition of single effects.
- **When the predictor is used:** only if the rank correlation is at least 0.7 and the best triple is among its picks. If plain addition is as good, the simpler rule is used. Otherwise every triple is simulated and no runs are saved.
- **Why no learned congestion model:** a simulation costs 0.1–0.4 s here, so the congestion map comes from simulation, and a learned congestion predictor did not earn its place at this scale.
- **Ranking:**
  - a set of alternatives where none is beaten on all of safety gain, effort and structural changes;
  - a weighted score with editable weights (`config/architect.json`: safety 0.6, effort 0.25, structural 0.15);
  - effort in relative units from the quantities, ×1.5 for structural work. Not money.
- **Safe capacity:** bisection on the load factor (or crowd size) for the largest crowd where every test run gets everyone out by the target with no gridlock. It is computed for the baseline and for the three alternatives with the largest safety gain. "Extra people" is the difference.

### 9A.5 Show
- **API:** `/api/architect/run` runs the analysis as a background job with progress, `/api/architect/status` reports it, and `/api/architect/report?venue=` serves the latest result.
- **Optimise page, "Architectural changes":**
  - safe capacity, extra people out at the same crowd, time for 95% out, and the number of simulations;
  - a 2D plan per floor with the waiting map (now, after the best alternative, or the difference), hotspots, and the selected alternative's shapes;
  - a 3D view with new construction as solid green blocks;
  - the diagnosis with Opus's interpretation, what to build and why with structure and regulations, the ranked table, and the method note.

### 9A.6 Result on Rinker Hall (2026-11-21; 8 paired runs, 392 simulations, about 2.5 minutes)
- **Main cause:** the south stair's exterior door, about 68% of all waiting in the test set, which includes the adversary's worst fire.
- **Top alternative:** widen that door from 34 to 70 in.
  - people out by the target: +19.6 ± 26.6 at the same crowd;
  - time for 95% out: −175 ± 157 s;
  - effort 5.6 units; needs a structural engineer.
- **Safe capacity:** 362 people → 556 with the door widening, a double door upstairs and an external stair (+194).
- **Opus:** 8 concepts, 6 built, 2 rejected; 3 of the top 3 include an Opus concept.
- **Predictor:** rank correlation 0.74 (ridge) vs 0.77 (addition), best triple found, so addition is used and would save 120 simulations.
- **Confidence intervals are wide:** the two worst-case runs dominate the differences, so more seeds narrow them.

## 9B. Custom scenarios, venues and uploaded plans (built 2026-11-21)
- **Scenario generator:** one text box goes to Opus 5.5 (`src/scenario/`). Crowd size, age groups and event type are required, and the server re-checks them. Defaults come back as listed assumptions, and an offline keyword parser takes over without a key.
- **Haiku crowd brain:** `src/policy/crowdbrain.ts` makes one decision per group of people who share role, mobility, situation and options; each person draws their own choice from it. Calls are budgeted, with the distilled policy, then rules, as fallback.
- **Venues:** a registry (`src/twin/build.ts`) of built-in twins plus saved uploaded plans. The Thapar Fete Area comes from OpenStreetMap (`npm run venue:osm`, ODbL).
- **Uploaded plans:** PDF, PNG or JPEG, stored in git-ignored `data/uploads/`.
  - **Tracing:** Opus 5.5 traces outline, walls, doors, exits, obstacles, labels and scale in pixel coordinates (`src/plans/`). The draft is validated, and errors are sent back for one repair.
  - **Editor:** `/plans` lets the user drag, add, delete, set the scale with two clicks, and add doors to sealed rooms.
  - **Benchmark** (`npm run plans:benchmark`, `docs/verification/plan-benchmark.md`), Rinker first floor before any correction:
    - outline IoU 0.958;
    - scale 0.4% off;
    - wall recall 91% and precision 92%;
    - 4 of 5 exits found;
    - after one click on "Add doors to sealed rooms", all 154 people get out in every seed.

## 10. Live mode

### 10.1 Orchestrator and ground truth

- `groundtruth.ts` runs a seeded world (the "simulated incident") at 4 ticks per second (speed adjustable). Its occupants see the signs that are actually showing.
- `panel.ts` is a simulated fire alarm panel feed. EXITMIND only reads it. There is no write path, and a test asserts that.
- All agents below run in one process and touch only the event log.

### 10.2 Sensors (`sensors.ts`) — simulated, seeded noise

| Sensor | Reading | Placement |
|---|---|---|
| smoke | obscuration level | one per zone plus corridors |
| door counter | cumulative in / out | each zone boundary portal and exit |
| occupancy | people count for a zone | one per zone |
| seismic | peak acceleration | two units |
| operator report | typed observation from the console (for example "ST-B blocked") | human input, logged |

Fault injection (console or demo script): silence, stuck value, out-of-range, bias.

### 10.3 Sentinel (`sentinel.ts`)

- Hazard belief per zone and type: log-odds accumulators updated by sensor likelihood ratios; earthquake needs both seismic units above threshold for full belief.
- Occupancy per zone: count conservation from door counters, blended with occupancy sensors.
- Sensor health: silent (3 missed periods), stuck, out-of-range, inconsistent (conservation residual, or disagreement with both neighbours). Unhealthy sensors are excluded.
- Confidence in [0, 1] = min(coverage of healthy sensors for the affected zones, agreement among redundant sensors, freshness).
- Emits `sentinel.estimate` each second: beliefs, zone counts with uncertainty, blocked elements, confidence, the sensors used and the reasons for any exclusion.
- Below `sentinel.minConfidence` (default 0.6): no new decision is proposed or published; signs keep the last approved state, or the static default if there is none; the console shows the reason in words (for example "Smoke sensor Z2C silent 12 s; confidence 0.41 below 0.60; holding last approved state").

### 10.4 Incident state machine (`statemachine.ts`)

`NORMAL → SUSPECTED` (belief above θ1) `→ CONFIRMED` (belief above θ2 sustained, or two independent sensors, or panel alarm) `→ RESPONDING` (first `gate.published`) `→ ALL_CLEAR` (human declares it while belief is low and the panel is normal). All-clear restores static defaults through the same gate. Every transition is logged with its evidence ids.

### 10.5 Planner (`planner.ts`)

- Triggered on `CONFIRMED`, on a material change in the estimate, or on a human "re-plan".
- Input, assembled from the log: the estimate, confidence, zone counts, blocked elements, the profile's default protocol, the top three playbook matches with their verified figures, and any verifier feedback from the previous round.
- Output (zod schema; element ids are fixed enums from the twin, so the schema is stable):

```ts
{ candidates: Array<{                       // 1 to 3, validated in code
    protocol: "EVACUATE"|"PHASED_EVACUATION"|"HOLD_THEN_EVACUATE"|"LOCKDOWN_SHELTER"|"HORIZONTAL_EVACUATION"|"INFLOW_CONTROL",
    routePolicy: { zones: Array<{ zone, instruction: "EVACUATE_VIA"|"HOLD"|"LOCKDOWN"|"MOVE_TO_COMPARTMENT",
                                   via: elementId | null, delaySec: number }>,
                   closedRoutes: elementId[], inflowClosed: exitId[] },
    announcements: templateId[], playbookRef: string | null, rationale: string }> }
```

- Code-side validation: ids exist, delays within bounds, every occupied zone covered, protocol consistent with instructions. Invalid output gets one repair call, then fallback.
- Model `PLANNER_MODEL` (default `claude-sonnet-5-5`), effort `medium`, deadline 12 s.
- The Planner must either adopt a playbook entry (`playbookRef`) or explain the deviation in `rationale`. On deadline or error the top playbook match is proposed as `planner.fallback`; with no match, the profile's default protocol.
- If every candidate fails verification, one repair round runs with the verifier's reasons. Maximum two rounds.
- `rationale` is shown to the operator only. It never reaches a sign.

### 10.6 Verifier (`verifier.ts`)

- Starts from the **Sentinel estimate**: sample a population consistent with the zone counts (seeded), place the hazard as estimated.
- For the proposed decision, for each alternative, and for doing nothing (current signs): 6 nominal seeds plus 2 worst-case scenarios (the playbook's stored worst case for the matched signature, otherwise a small adversary run). Bulk policy, zero LLM calls, worker pool.
- Verdict (thresholds in `runtime.json`): **FAIL** if any rollout gridlocks, or the worst case is worse than doing nothing by more than ε, or the protected share at the target is below τ in the worst case, or sign compilation finds no positive alternative. **MARGINAL** if nominal improves but the worst case is within ±ε. **PASS** otherwise.
- Emits `verifier.verdict`: predicted outcome (nominal mean and range), worst case, comparison with doing nothing, verdict, reasons, and a replay handle for each rollout.
- Measure and log roll-forward speed against real time.

### 10.7 Human approval and the gate

- Console decision card: agent rationale; verifier's predicted outcome, worst case and verdict; rejected alternatives with their figures; buttons Approve / Reject; a countdown.
- `gate.failMode` (O1): `block_with_override` disables Approve on FAIL until the operator types a reason (logged as `human.override`); `warn` leaves it enabled.
- Timeout: no action within `approval.windowSec` (default 60 simulated seconds) logs `approval.timeout`; signs stay on the last approved or static state.
- `gate.ts` is the only writer of `gate.published`. `publish(decisionId)` requires, all referring to the same decision hash: a `planner.proposed` or `planner.fallback`; a `verifier.verdict`; a `human.approved` that references that verdict and has not expired; a `human.override` when the verdict is FAIL in blocking mode; and a sign plan that passes the safety validator. Otherwise it logs `gate.rejected` with the missing key.
- `signs.ts` derives current sign states by folding `gate.published` events. It has no setter.

### 10.8 Signs

```ts
type ArrowDir = "LEFT"|"RIGHT"|"AHEAD"|"BACK"|"DOWN_LEFT"|"DOWN_RIGHT";
type Arrow = { dir: ArrowDir; toward: string; label: TemplateId };
type SignState =
  | { kind: "ARROW"; arrow: Arrow }
  | { kind: "X_ALT"; blocked: string; alt: Arrow }       // alt is required
  | { kind: "HOLD"; label: TemplateId }
  | { kind: "LOCKDOWN"; label: TemplateId }
  | { kind: "STATIC_DEFAULT"; arrow: Arrow };
```

- `signcompiler.ts`: for each mount, read its zone's instruction. `HOLD` / `LOCKDOWN` map directly. Otherwise compute the walking direction from the mount towards the assigned element using the floor field and express it relative to the mount's facing. If the mount's static default points at a closed route, emit `X_ALT` with the alternative; otherwise `ARROW`.
- Safety validator: every `X_ALT.alt` targets an open element reachable from the mount under the current estimate. If not, compilation fails and nothing is published.
- Phone page (`web/sign.html`, plain TypeScript, no React):
  - Register by scanning a per-mount QR code from the console (`/sign?m=SM-2F-03`) or by opening `/sign` and choosing a location on the plan.
  - WebSocket `/ws/sign`. The server sends the mount's static default, the current state, a sequence number and `ttlMs` (5,000). It re-sends every 2 s. The phone pings every 2 s.
  - Watchdog on the phone: no server message within `ttlMs`, or socket closed → show the static default with an "offline — static sign" badge and retry every second.
  - Server: no ping for 6 s → `sign.offline` logged; the ground-truth world then treats that mount as a static sign.
  - No approved state → the server sends `STATIC_DEFAULT`.
  - One tap starts `nosleep.js`. Full-screen SVG, high contrast, text only from `templates.json`.
- Mounts with no phone are static signs. The console can open extra browser tabs as signs.

### 10.9 Event types

`session.started`, `world.checkpoint`, `sensor.batch`, `sensor.fault`, `panel.state`, `operator.report`, `sentinel.estimate`, `sentinel.sensor_health`, `incident.state`, `planner.requested`, `planner.proposed`, `planner.fallback`, `llm.call`, `verifier.verdict`, `approval.requested`, `human.approved`, `human.rejected`, `human.override`, `approval.timeout`, `gate.published`, `gate.rejected`, `sign.registered`, `sign.online`, `sign.offline`, `liaison.brief`, `historian.report`, `persona.decision`, `persona.decision.rejected`, `playbook.updated`, `policy.updated`, `library.scenario_added`.

`llm.call` stores model, request, response, token usage, latency and outcome (`ok`, `timeout`, `error`, `invalid`).

### 10.10 Liaison (`liaison.ts`) — outcome 17

- Builds a fact list from **observed** records only: people remaining per zone (latest estimate, with the sensors it came from), clear and blocked routes, hazard location and confidence, actions taken with times. Each fact carries its record id.
- Claude (`LIAISON_MODEL`) returns `{ lines: [{ text, refs: EventId[] }] }`.
- Validators, per line: every ref is one of the supplied facts; every number in the text appears in the referenced records; no banned content (casualty figures, predictions, advice to the public). A failing line is replaced by the template line for that fact. With a TypeSafe key, an extra Jev `noul` check ("does this line follow from these records?") must reach 0.9.
- Fallback when the LLM is unavailable: the template brief, one line per fact.
- UI: each line shows clickable record chips. Footer: "A person must call 112. EXITMIND contacts no one."
- `llm/guard.ts` wraps `fetch` so the server can reach only `api.anthropic.com` and `api.typesafe.ai`. A test asserts any other host throws, and that the code contains no `tel:`, SMS or webhook call.

### 10.11 Historian (`historian.ts`) — outcome 19

On all-clear or on request:

1. For each approved decision, compare the Verifier's predicted outcome (nominal and worst case) with what the ground-truth simulation then did. Table of errors.
2. Timeline of states, decisions, approvals, sensor faults and fallbacks, every row linked to its record.
3. If the simulated outcome was worse than the predicted worst case, or a target was missed, reconstruct the scenario and append it to `data/library/breaking-scenarios.json`, then re-verify the affected playbook entries.
4. Add the session's persona decisions to the distillation set and rebuild `distilled.policy.json` with a new version.
5. Write the report to `runs/<session>/report.md` and show it at `/report/<session>`. Narrative text is templated.

---

## 11. Web application

- One React app. Routes: `/` Design, `/live` Operator console, `/report/:session`. `/sign` is a separate entry.
- **Design** tabs: Twin & code check · Simulate · Bottlenecks · Adversary · Optimiser · Rating · Playbook. A plain-language box at the top feeds the parameter panel.
- **Live**: synced 2D and 3D on the left; on the right the incident state, confidence with reason, decision card, sign list (online / offline, current state, QR), responder brief, log tail. Demo controls: start fire, start earthquake, inject bad plan, fail a sensor.
- **Views.** Server streams binary frames at 4 Hz over WebSocket (positions, floors, states, density grids, hazard grids, sign states). `store.ts` holds `{ frameA, frameB, alpha }`; both views read that one store and interpolate with the same `alpha`.
  - `Plan2D.tsx`: Canvas 2D. Walls, doors, agents, signs; heatmap toggle between live density and cumulative time above threshold; three floors as tabs or small multiples; optional sheet underlay when the sheets are present locally; click a portal or cell for its figures.
  - `Building3D.tsx`: react-three-fiber. Slabs at real elevations with an "explode" slider, translucent walls, stairs as ramps, agents as one `InstancedMesh` coloured by state (personas highlighted and labelled), smoke as a per-floor `DataTexture` layer, fire core, damaged stairs in red, camera shake during an earthquake, sign billboards showing their current state.
  - Each canvas exposes `data-tick` and `data-state-hash`.
- Metrics render through a `<Metric value source>` component that takes its value from an API result and shows its source run or record.

---

## 12. Failure handling

| Failure | Behaviour | Logged as |
|---|---|---|
| Persona LLM error, timeout or invalid output | distilled policy, then rule policy | `persona.decision` with `fallback:…`, or `persona.decision.rejected` |
| Planner LLM error or deadline | top playbook match, then profile default protocol | `planner.fallback` |
| Liaison or parser LLM unavailable | templates; keyword lexicon | `llm.call` outcome + fallback flag |
| `EXITMIND_OFFLINE=1` or no network | all LLM adapters short-circuit to the fallbacks above | `llm.call` outcome `offline` |
| Any one sensor silent or corrupt | sensor excluded, confidence drops; below threshold nothing new is published; reason shown | `sentinel.sensor_health`, `sentinel.estimate` |
| No human response in the window | signs keep last approved or static state | `approval.timeout` |
| Phone loses connection | phone shows static default; world treats it as static | `sign.offline` |
| No approved state exists | static default | — |
| Verdict FAIL | per `gate.failMode` | `verifier.verdict`, `human.override` |
| Sign plan has an X with no reachable alternative | compilation fails; nothing published | `gate.rejected` |

---

## 13. Tests mapped to the acceptance criteria

| Criterion | Test (in `tests/acceptance/` unless noted) | Stated tolerance |
|---|---|---|
| Determinism | `determinism.test.ts`: same scenario and seed twice → equal state hashes; showcase run replayed from its log → equal hash, 0 LLM calls; live session replayed → equal hash | exact |
| Single-door flow | `door-flow.test.ts`: 10 m × 10 m room, 200 agents, door 0.9 / 1.2 / 1.8 m; flow between the 10th and 90th percentile of exits against `Fs_max × We` | ± 5% |
| Stair flow, free walking, no deadlock | `sim-relations.test.ts` | ± 5%; ± 1 tick; all agents out |
| Persona actions | `persona-actions.test.ts` (8.6) | none outside the set |
| Distilled policy | `distill.test.ts` | TVD ≤ 0.05; 0 calls in bulk |
| Showcase comparison | `showcase-compare.test.ts` writes `docs/verification/showcase-vs-rule.md` | report differences |
| Adversary and optimiser | `adversary.test.ts`, `optimiser.test.ts`, each over 5 seeds | worst > default; optimised < original; within budget and code limits |
| Occupancy profiles | `profiles.test.ts`: college → hospital changes mix, default protocol and results | — |
| Synced views | `tests/e2e/sync.spec.ts`: sample `data-tick` and `data-state-hash` on both canvases during playback | equal |
| Gate | `gate.test.ts`: publish with each key missing in turn fails; direct write to sign state is impossible; import-graph check | — |
| Signage safety | `sign-safety.test.ts`: property test over random route policies; no `X_ALT` without a reachable alternative | — |
| Protocol choice | `protocols.test.ts`: fire → `EVACUATE` with reroute; earthquake → `HOLD_THEN_EVACUATE`; each verified and explained | — |
| Bad decision caught | `bad-decision.test.ts`: injected gridlock plan → FAIL verdict with predicted outcome on the card | — |
| Sensor failure | `sensor-failure.test.ts`: silence or corrupt each sensor in turn | confidence falls; hold; reason present |
| LLM failure | `llm-failure.test.ts`: each adapter forced to fail; system keeps running | — |
| Human timeout | `human-timeout.test.ts` | — |
| Phone failure | `tests/e2e/phones.spec.ts`: three browser contexts as phones; one goes offline → static default; reconnect → state restored | — |
| Brief traceability | `brief.test.ts`: every line resolves to existing record ids; numbers match | — |
| Real numbers | `real-numbers.test.ts`: two scenarios give different API figures and the UI shows them; scan for forbidden literal metrics | — |
| Language rules | `language.test.ts`: banned phrases absent from templates and UI strings; required labels present | — |
| Constraints | `constraints.test.ts`: egress allow-list; panel read-only; templates only | — |
| Demo, offline | `tests/e2e/demo-offline.spec.ts` with `EXITMIND_OFFLINE=1` | runs end to end |

Tests needing an API key are skipped without it and listed as skipped in the final report. The three-real-phone test is manual (15.3) and needs Arun.

---

## 14. Phases

Each phase ends with: tests green, evidence pasted, `docs/PROGRESS.md` updated, one commit, **stop**.

| Phase | Builds | Main files | Verified by |
|---|---|---|---|
| **0 Foundations** | git init, package, configs, `AGENTS.md`, PRNG, units, params loader with seed file, event log with hash chain, `.env.example`, README skeleton listing libraries / APIs / data sources | `src/shared`, `src/log`, `config/*` | `npm test`: PRNG repeatability, hash chain, params bounds and citations, forbidden-call scan |
| **1 Twin, 2D, code check** | fetch sheets, calibrate, trace F1–F3, stairs, voids, zones, sign mounts, candidates; build and validate; overlay; 2D view; code check | `data/twin`, `src/twin`, `design/codecheck.ts`, `views/Plan2D.tsx` | overlays; five-dimension spot check; area within ±3%; code check reproduces every printed REQ'D figure |
| **2 Simulator, hazards, profiles, 3D** | world, movement, portals, stairs, routing, rule policy, four hazards, four profiles, metrics, frame streaming, 3D view | `src/sim`, `policy/rule.ts`, `views/Building3D.tsx`, `server/ws.ts` | determinism, door-flow, stair-flow, no-deadlock, profiles, hazard tests; measured performance; synced-views e2e |
| **3 Personas** | context and options, Haiku adapter, Jev adapter (fixtures), showcase protocol, logging and replay, collection, distillation, bake-off | `src/policy`, `src/llm` | persona, distill, replay tests; `bakeoff.md`. **Stop: O3** |
| **4 Design mode** | pool, bulk, bottlenecks, adversary, explanation, optimiser, rating, playbook, plain-language input, design UI | `src/design`, `pages/Design.tsx` | adversary and optimiser tests over 5 seeds; `results:table` comparing rule-only, hybrid and distilled; rating matrix |
| **5 Live core** | ground truth, panel, sensors, Sentinel, state machine, Planner, Verifier, gate, approval, console | `src/live`, `pages/Live.tsx` | gate, protocol, bad-decision, sensor, LLM-failure, timeout tests. **Stop: O1** |
| **6 Phones, brief, report** | sign compiler, sign page, QR registration, heartbeat, Liaison, Historian, report page | `live/signs.ts`, `signcompiler.ts`, `liaison.ts`, `historian.ts`, `web/sign.html` | sign-safety, phones e2e, brief, historian tests; manual three-phone check with Arun |
| **7 Demo and hardening** | scripted demo timeline, offline mode, README complete, full run of both commands | `server/demo.ts`, `cli/demo.ts` | actual output of `npm test` and `npm run demo`, including failures and skips |
| **8 Stretch** | open-ground twin where barricades and gates are movable exits; optimiser moves gates | `data/twin/openground` | same engine runs; adversary and optimiser produce a result |

Before any long pipeline (bulk collection, rating matrix, playbook generation), write its plan and progress to `runs/<name>/ledger.json` so it can resume.

---

## 15. Demo

### 15.1 Three-minute script (fire, then earthquake)

| Time | Beat | On screen |
|---|---|---|
| 0:00 | "It passes on paper." | Twin over the drawing; code check rows with the sheet's own numbers |
| 0:25 | Describe the crowd in words: "fest night, most people don't know the building". | Parameters appear as bounded sliders; showcase run in 3D with labelled personas |
| 0:45 | The adversary finds the breaking scenario and says why. | Replay of the worst run; ranked weak spots; rating for fire |
| 1:05 | The optimiser spends a budget; the adversary attacks again. | Worst case before and after; rating changes; playbook generated |
| 1:25 | Live: smoke on floor 2. | Sentinel confidence rises; state Suspected → Confirmed; Planner adopts a playbook entry; Verifier against doing nothing |
| 1:45 | Human approves. | Three phones change: arrow, X with alternative, arrow |
| 2:00 | A deliberately bad plan is injected. | FAIL verdict, predicted gridlock, Approve blocked |
| 2:15 | Earthquake. | Phones show HOLD; then evacuation that avoids the damaged south stair |
| 2:35 | Pull a phone off the network; silence a sensor. | Phone shows the static sign; console explains the hold |
| 2:45 | Responder brief and report. | Each line opens its log record; "a person calls 112" |
| 2:55 | Close on the three keys. | The three log records behind one sign state |

`npm run demo` starts the scripted timeline; each beat is triggered from the console so the presenter controls the pace.

### 15.2 Network runbook

- Laptop and phones on one network. If the venue Wi-Fi isolates clients, use a phone hotspot with mobile data off; the laptop and the other phones join it.
- The server binds `0.0.0.0:8080` and prints its LAN address and the sign QR codes.
- Set phone auto-lock to "never" as well as tapping to start `nosleep.js`.
- Offline rehearsal: `EXITMIND_OFFLINE=1 npm run demo` with Wi-Fi internet off. Personas use the distilled policy, the Planner uses the playbook, text uses templates. The showcase beat replays `data/fixtures/showcase_log.jsonl`.

### 15.3 Manual three-phone check (Arun)

1. Open the console; scan three QR codes with three phones at three mounts.
2. Confirm each shows its static default and appears online.
3. Start the fire incident, approve; confirm the three phones show the approved states.
4. Turn Wi-Fi off on one phone; within 5 s it shows the static sign; the console shows it offline.
5. Turn Wi-Fi on; it returns to the approved state.
6. Record the result in `docs/verification/phones.md`.

---

## 16. README must contain

- What EXITMIND is and is not (the language rules of section 0).
- Every library with its version (table 4.2), every API (Claude API; TypeSafe System One API), every data source (the six Rinker Hall sheets with URLs; the literature in section 18).
- How to run: `npm install`, `npm run sheets:fetch`, `npm test`, `npm run demo`.
- Which parameters are still `verified: false`.
- Modelling assumptions: interior door widths, sign mount positions, candidate edit sites, hospital compartment line, hazard ranges, optimiser costs, clearance targets.

---

## 17. Risks

| Risk | Mitigation |
|---|---|
| Tracing three floors from scans is slow or inaccurate | Grid-referenced authoring, validation on build, overlays. Trace F1 fully first; F3's fourteen faculty offices are a repeated pattern. |
| The cellular model shows artefacts (lane locking, door starvation) | The relations and tests in section 7 are fixed; micro-rules (tie-breaking, swap rule, window sizes) may be tuned to pass them. Report any tuning. |
| TypeSafe key never arrives | Jev adapter stays fixture-tested; the bake-off reports one column; O3 stays open and Haiku is used explicitly. |
| LLM latency stalls a showcase run | Thinking pause in simulated time, 2.5 s deadline, concurrency cap, fallback, offline replay log. |
| Verifier too slow for a live decision | Rollout counts in `runtime.json`; stored worst cases from the playbook; measured speed shown on the card. |
| Unverified literature values | `verified` flag shown in UI and README. |
| Venue network blocks phone-to-laptop traffic | Hotspot plan in 15.2; rehearse before judging. |
| Scope | Phases are ordered so that each stop leaves something demonstrable. Phase 8 is optional. |

---

## 18. References

All were resolved against OpenAlex on 2026-11-21 (24 exact matches, 1 likely). Values taken from them remain **VERIFY** until read.

| Key | Reference | DOI |
|---|---|---|
| weidmann1993 | Weidmann, *Transporttechnik der Fussgänger*, ETH Zürich IVT 90 | — |
| sfpe2016 | Gwynne & Rosenbaum, "Employing the Hydraulic Model in Assessing Emergency Movement", *SFPE Handbook of Fire Protection Engineering* (matched "likely") | 10.1007/978-1-4939-2565-0_59 |
| helbing1995 | Helbing & Molnár, "Social force model for pedestrian dynamics" | 10.1103/physreve.51.4282 |
| helbing2000 | Helbing, Farkas & Vicsek, "Simulating dynamical features of escape panic" | 10.1038/35035023 |
| helbing2007 | Helbing, Johansson & Al-Abideen, "Dynamics of crowd disasters" | 10.1103/physreve.75.046109 |
| seyfried2005 | Seyfried et al., "The fundamental diagram of pedestrian movement revisited" | 10.1088/1742-5468/2005/10/p10002 |
| seyfried2009 | Seyfried et al., "New insights into pedestrian flow through bottlenecks" | 10.1287/trsc.1090.0263 |
| kretz2006 | Kretz et al., "Experimental study of pedestrian flow through a bottleneck" | 10.1088/1742-5468/2006/10/p10014 |
| boyce1999a | Boyce, Shields & Silcock, "…capabilities of disabled people moving horizontally and on an incline" | 10.1023/a:1015339216366 |
| boyce1999b | Boyce, Shields & Silcock, "…capability of disabled people to negotiate doors" | 10.1023/a:1015391217275 |
| kuligowski2013 | Kuligowski et al., "Stair evacuation of older adults and people with mobility impairments" | 10.1016/j.firesaf.2013.09.027 |
| hunt2013 | Hunt, Galea & Lawrence, "…trained hospital staff using movement assist devices…" | 10.1002/fam.2215 |
| larusdottir2010 | Larusdottir & Dederichs, "Evacuation of children: movement on stairs and on horizontal plane" | 10.1007/s10694-010-0177-6 |
| sime1985 | Sime, "Movement toward the familiar" | 10.1177/0013916585176003 |
| kinateder2018 | Kinateder, Comunale & Warren, "Exit choice … influenced by exit familiarity and neighbor behavior" | 10.1016/j.ssci.2018.03.015 |
| haghani2019 | Haghani & Sarvi, "'Herding' in direction choice-making during collective escape of crowds" | 10.1016/j.ssci.2019.02.034 |
| moussaid2010 | Moussaïd et al., "The walking behaviour of pedestrian social groups…" | 10.1371/journal.pone.0010047 |
| purser2001 | Purser & Bensilum, "Quantification of behaviour for engineering design standards and escape time calculations" | 10.1016/s0925-7535(00)00066-7 |
| lovreglio2019 | Lovreglio et al., "A pre-evacuation database for use in egress simulations" | 10.1016/j.firesaf.2018.12.009 |
| xie2011 | Xie et al., "Experimental analysis of the effectiveness of emergency signage…" | 10.1002/fam.1095 |
| galea2014 | Galea, Xie & Lawrence, "Experimental and survey studies on the effectiveness of dynamic signage systems" | 10.3801/iafss.fss.11-1129 |
| fridolf2013 | Fridolf et al., "Movement speed and exit choice in smoke-filled rail tunnels" | 10.1016/j.firesaf.2013.03.007 |
| jin1978 | Jin, "Visibility through fire smoke" | — |
| bernardini2016 | Bernardini, Quagliarini & D'Orazio, "Towards creating a combined database for earthquake pedestrians' evacuation models" | 10.1016/j.ssci.2015.09.001 |
| park2023 | Park et al., "Generative Agents: Interactive Simulacra of Human Behavior" | 10.1145/3586183.3606763 |

Provider documentation read on 2026-11-21: `docs.typesafe.ai` (quick start, Choice, Noul, models, errors, model jaggedness, JavaScript SDK, client config); `platform.claude.com/docs` (models overview, structured outputs, effort).

---

## 19. Kick-off prompt for the builder

> Read `docs/BLUEPRINT.md` in full. Follow section 0. Start Phase 0 only. When its checks pass, update `docs/PROGRESS.md`, commit, show the command output as evidence, and stop for approval before Phase 1.
