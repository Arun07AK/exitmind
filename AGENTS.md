# AGENTS.md — working in the EXITMIND repo

Read this first, then `docs/PROGRESS.md` (where the build is), then the relevant sections of `docs/BLUEPRINT.md` (what to build). The blueprint is the source of truth for design decisions; this file is the source of truth for how to work.

## Project in one line

EXITMIND: building-egress design platform plus an agentic live-incident system. A sign state reaches a phone only after an agent decision, a verifier verdict and a human approval are all in the event log. Demo building: Rinker Hall (UF), traced from its construction drawings.

## How work is run

- The build is split into phases 0–8 (blueprint section 14). Phases 0–7 are built; Phase 8 (stretch) is not started and Arun has parked it.
- Arun asked for the remaining phases to run without stopping at phase boundaries. Still, at the end of each chunk of work:
  1. `npm test` passes (type-check, vitest, Playwright).
  2. `docs/PROGRESS.md` is updated: status, what changed, the evidence (command + actual output), deviations from the blueprint, and open items.
  3. One commit per chunk. Do not push unless asked.
- Blueprint decisions (section 2.1) are final. If one turns out to be impossible, say why; do not substitute silently.
- OPEN items (blueprint section 2.2) are Arun's to decide. O1 is decided (block unless overridden with a reason). O3 (default persona backend) is still open and needs a TypeSafe key.
- If something is skipped or fails, say so plainly. A test that cannot run (missing key, no phones) is reported as skipped with the reason, never as passed.
- Before starting a long pipeline, write its plan and a progress ledger to `runs/<name>/ledger.json` and put the exact resume command in `docs/PROGRESS.md`.
- When a result looks too good or too bad (a rating of 0/24, a plan worse than doing nothing), find out which agents cause it before changing a threshold. Several real simulator bugs were found this way; see the PROGRESS log.

## Commands

| Command | What it does |
|---|---|
| `npm test` | **all tests**: `tsc --noEmit`, `vitest run` (unit + acceptance), `playwright test` (3 browser specs; starts its own server on :8090 with `EXITMIND_OFFLINE=1`) |
| `npm run test:unit` / `npx vitest run tests/acceptance/<file>` | vitest only / one file |
| `npm run demo` | **the demo**: builds `dist/web` if missing, serves on `0.0.0.0:8080`, prints LAN URLs and sign QR codes |
| `npm run dev` + `npm run dev:web` | API server on :8080 and the Vite dev server (proxies `/api`, `/ws`) |
| `npm run llm:check` | verifies the keys in `.env` without printing them |
| `npm run sheets:fetch`, `twin:build`, `twin:overlay` | sheets into `data/sheets/` (ignored); build + validate the twin; overlays into `docs/verification/overlays/` (ignored) |
| `npm run sim -- --hazard fire --seed 1` | one run on the command line, with timing |
| `npm run bottlenecks`, `adversary -- --hazard fire --seeds 1,2,3`, `optimise -- --hazard fire --seeds 1,2,3`, `rate`, `playbook` | design pipelines; write `data/design/*.json` and `data/playbook/rinker.playbook.json`. Add `--policy rule` to force the rule-based crowd. |
| `npm run personas:collect` (`-- --instructed`, `-- --table`), `distill`, `bakeoff`, `results:table` | persona logs into `data/fixtures/` (needs a key), distilled policy, comparison docs in `docs/verification/` |
| `npm run replay -- <log.jsonl>` | replay a showcase log or a live session log (`runs/live/*.jsonl`) and compare state hashes |
| `npm run architect -- --venue <id>` | architectural optimisation (2-3 min on Rinker); `--no-opus` for rule-based only |
| `npm run plans:benchmark` | Opus traces Rinker A102 and is scored against the hand-traced twin (`-- --reuse` skips the API call) |
| `npm run venue:osm` | rebuild the Fete Area twin from the saved OSM extract (`-- --fetch` re-downloads from Overpass; build time only) |

Verification for any change: run `npm test` and paste the tail of its output as evidence. After changing anything in `src/sim` or `config/*.json`, the design outputs in `data/design/`, the playbook and the distilled policy are stale: re-run the pipelines (about 15 minutes in total) and the persona replays (`for f in data/fixtures/*.jsonl; do node src/cli/replay.ts $f; done`). A simulator change breaks replay of recorded persona logs unless the decision points stay identical; re-collect if replays report MISMATCH.

## Code conventions

- **TypeScript runs natively on Node 24** (type stripping). No compile step for server, simulator or CLI code. Therefore:
  - no `enum`, no `namespace`, no constructor parameter properties, no path aliases;
  - every relative import ends in `.ts`; use `import type` for type-only imports;
  - use `as const` arrays/objects instead of enums.
  - `tsconfig.json` enforces this (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`).
- ES modules only (`"type": "module"`). Resolve repo files with `repoPath()` from `src/shared/paths.ts`, never with the current working directory.
- Validate external input and config with `zod` (v4 API: `z.strictObject`, `.loose()`).
- Keep code compact; no speculative abstractions; do not add or remove comments unless asked.
- Dependencies: exact versions only (`npm install --save-exact`), each published at least 7 days earlier. Every new library must be added to the README table. Never change `.npmrc` or security settings to get past an install problem.

## Invariants (tests enforce these; do not weaken a test to pass)

- **Determinism.** Code in `src/shared`, `src/sim`, `src/policy`, `src/design` must not call `Math.random`, `Date.now`, `performance.now`, `new Date`, `crypto.randomUUID` or `getRandomValues` (`tests/unit/determinism-scan.test.ts`). `Math.random` is banned everywhere in `src`. All randomness comes from `Rng` in `src/shared/rng.ts`, using named streams: `Rng.stream(seed, "population")`, `Rng.stream(seed, "agent", String(id))`. Iterate agents in id order; break ties by id.
- **Behaviour parameters** are read only through `loadParams()` / `Params` in `src/shared/params.ts`. Every key lives in `config/behaviour.params.json` with value, bounds, unit, citation keys (resolving to `config/references.json`), a locator and `verified`. Reading an absent key throws. Scenario, adversary, LLM-derived and slider values pass through `params.clamp()`. Pure modelling guesses cite the `assumption` reference; never attach a paper to a number it does not contain. Set `verified: true` only after checking the number in the source, and say where in `locator`.
- **Runtime settings** (tick length, persona counts, gate fail mode, timeouts) live in `config/runtime.json`, validated by `src/shared/runtime.ts`. Add a section there when a phase first needs it.
- **Event log** (`src/log/eventlog.ts`) is append-only and hash-chained (SHA-256 over canonical JSON; the wall clock is excluded from the hash). Agents communicate only through it. Event types and actors are the fixed lists in `src/log/events.ts`; add a zod payload schema to `PAYLOAD_SCHEMAS` when a producer for that type is built. There is no update or delete API, and none may be added.
- **Language.** Persona output is "modelled", never "predicted", and carries "modelled behaviour, not validated against real evacuations". Ratings are "decision support for professional safety review", never certification. Never claim the real building is unsafe, never write "saves lives", never produce casualty estimates or market-size figures.
- **Hard constraints.** No real emergency number, service, SMS gateway or webhook is ever contacted. No personal data, no camera input. Occupant-facing text only from `config/templates.json`. The fire alarm panel feed is read-only.
- **Real numbers.** Every number shown in the UI or a report is computed in the run that shows it.

## Secrets and data

- API keys go in `.env` (git-ignored); `.env.example` lists the variables. Never print or commit a key.
- `.env` holds Arun's Anthropic key. There is no TypeSafe key, so the Jev adapter has only been tested against a stub (`tests/helpers/stubs.ts`); never describe it as tested live.
- Claude structured output: keep `max_tokens` generous (persona calls were silently truncated at 120) and keep schemas few and stable, because each distinct schema is compiled on first use.
- The Rinker Hall sheets carry an ownership notice: keep them in `data/sheets/` (git-ignored), never commit them or overlay images derived from them. Commit only our own traced twin data.

## Repo map (current)

```
config/        behaviour.params.json  hazards.json  profiles.json  runtime.json  templates.json
               optimiser.costs.json  demo.json  references.json
data/twin/     rinker/*.ts (traced sources, frames.json)  rinker.twin.json (built)
               thapar-fete/osm.json (OSM extract, ODbL)  thapar-fete.twin.json (built by npm run venue:osm)
data/design/   bottlenecks, adversary(-fire/-quake), optimiser, rating, playbook (.json, generated)
data/playbook/ rinker.playbook.json      data/policy/ distilled.policy.json
data/fixtures/ recorded Haiku persona logs (showcase_*, table_hybrid_*), decision_points.json
src/shared/    rng hash ids units paths params runtime env geom
src/log/       events eventlog clock
src/twin/      schema build validate raster augment edit candidates synthetic (test buildings)
src/sim/       types constants model fields hazards population world run scenario
src/policy/    types context rule personas (Haiku, Jev) crowdbrain (Haiku group decisions) distilled replay showcase
src/scenario/  spec (schema, required fields) agent (Opus 5.5) lexicon (offline parser) build (spec -> Scenario)
src/venue/     osm (OpenStreetMap extract -> outdoor twin)
src/plans/     draft (traced plan -> twin, door suggestions) store (uploads) trace (Opus 5.5 vision)
src/optimise/  diagnose generate concepts (Opus) evaluate search architect (architectural optimisation, BLUEPRINT 9A)
src/llm/       claude typesafe guard (allow-list, deadlines, call records)
src/design/    codecheck protocols prepare evaluate worker pool space adversary bottleneck
               optimiser rating playbook nl2params
src/live/      sensors sentinel planner verifier gate signcompiler signs liaison historian session
src/server/    index (REST + WS) contract (shared types with web/) frames channels simrunner live
src/cli/       one file per npm script
web/           React app (Design, Live, Report), Plan2D + Building3D on one store, sign page (no React)
tests/         unit/  acceptance/  e2e/  helpers/
tools/         Python helpers for grid registration and overlays
docs/          BLUEPRINT.md  PROGRESS.md  verification/ (spot check, bake-off, results table)
```

Key facts for anyone changing the simulator:

- `World` (`src/sim/world.ts`) is one class with typed arrays per agent; `step()` order is fixed. Door and stair capacity are token buckets, which is why the flow tests match the configured relation.
- Decisions go through `buildContext` -> a `DecisionPolicy` (rule, distilled, LLM, replay) -> `#apply`. Options are listed by the simulator; a policy can only pick an option id.
- Only `src/live/gate.ts` may append `gate.published`. `SignHub` reads sign states from those records. A test scans for this.
- The live session's ground-truth world consumes exactly four event types (`demo.control`, `gate.published`, `sign.online`, `sign.offline`), which is what makes a session replayable.

## Working with Arun

- He learns by building and loses momentum when progress is invisible: end each phase with something he can see or run.
- Open long tasks with one line on what you are about to do; finish with a short recap (what changed, what is verified, what needs him).
- When a step needs him (keys, phones, a decision), cut his part down to one command or one click.
- Ask before anything destructive or anything outside this repository. Do not push unless asked.
