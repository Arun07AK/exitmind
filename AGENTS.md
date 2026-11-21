# AGENTS.md — working in the EXITMIND repo

Read this first, then `docs/PROGRESS.md` (where the build is), then the relevant sections of `docs/BLUEPRINT.md` (what to build). The blueprint is the source of truth for design decisions; this file is the source of truth for how to work.

## Project in one line

EXITMIND: building-egress design platform plus an agentic live-incident system. A sign state reaches a phone only after an agent decision, a verifier verdict and a human approval are all in the event log. Demo building: Rinker Hall (UF), traced from its construction drawings.

## How work is run

- The build is split into phases 0–8 (blueprint section 14). Work on **one phase at a time**.
- At the end of each phase:
  1. `npm test` passes (type-check plus all tests).
  2. `docs/PROGRESS.md` is updated: status, what was built, the evidence (command + actual output), deviations from the blueprint, and open items.
  3. One commit for the phase.
  4. **Stop and wait for Arun's go** before starting the next phase.
- Small fixes inside the current phase do not need approval. New scope does.
- Blueprint decisions (section 2.1) are final. If one turns out to be impossible, stop and say why; do not substitute silently.
- OPEN items (blueprint section 2.2) are Arun's to decide. Never decide them.
- If something is skipped or fails, say so plainly. A test that cannot run (missing key, no phones) is reported as skipped with the reason, never as passed.
- Before starting a long pipeline (bulk persona collection, rating matrix, playbook generation), write its plan and a progress ledger to `runs/<name>/ledger.json` and put the exact resume command in `docs/PROGRESS.md`.

## Commands

| Command | What it does | Status |
|---|---|---|
| `npm install` | install pinned dependencies | available |
| `npm test` | `tsc --noEmit` then `vitest run` (Playwright is added to this script in Phase 2, when the first e2e test exists) | available |
| `npm run typecheck` | type-check only | available |
| `npx vitest run tests/unit/<file>` | run one test file | available |
| `npm run sheets:fetch`, `twin:build`, `twin:overlay`, `dev`, `demo`, … | see blueprint section 4.5 | added in later phases |

Verification for any change: run `npm test` and paste the tail of its output as evidence.

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
- Arun currently has an Anthropic key only. TypeSafe/Jev tests run against recorded fixtures until a TypeSafe key exists, and are labelled "fixture".
- The Rinker Hall sheets carry an ownership notice: keep them in `data/sheets/` (git-ignored), never commit them or overlay images derived from them. Commit only our own traced twin data.

## Repo map (current)

```
config/        behaviour.params.json  references.json  runtime.json
src/shared/    rng.ts  hash.ts  ids.ts  units.ts  paths.ts  params.ts  runtime.ts
src/log/       events.ts  eventlog.ts
tests/unit/    rng, hash, eventlog, params, determinism-scan (+ fixtures/rng-worker.ts)
docs/          BLUEPRINT.md  PROGRESS.md
```

The full target layout is in blueprint section 4.4. Update this map at each phase boundary.

## Working with Arun

- He learns by building and loses momentum when progress is invisible: end each phase with something he can see or run.
- Open long tasks with one line on what you are about to do; finish with a short recap (what changed, what is verified, what needs him).
- When a step needs him (keys, phones, a decision), cut his part down to one command or one click.
- Ask before anything destructive or anything outside this repository. Do not push unless asked.
