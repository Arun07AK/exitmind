# EXITMIND — progress ledger

Updated at every phase boundary. Newest phase on top of the log. Design: `docs/BLUEPRINT.md`. How to work: `AGENTS.md`.

## Where we are

| Phase | Scope | Status |
|---|---|---|
| 0 Foundations | repo, configs, RNG, units, params loader, hash-chained event log | **Done, awaiting Arun's go for Phase 1** |
| 1 Twin, 2D, code check | trace Rinker F1–F3, overlay, code check, 2D view | not started |
| 2 Simulator, hazards, profiles, 3D | crowd model, 4 hazards, 4 profiles, synced 3D | not started |
| 3 Personas | Haiku/Jev adapters, showcase, replay, distillation, bake-off | not started (stops for O3) |
| 4 Design mode | bottlenecks, adversary, optimiser, rating, playbook, NL input | not started |
| 5 Live core | sensors, Sentinel, Planner, Verifier, gate, console | not started (stops for O1) |
| 6 Phones, brief, report | sign page, Liaison, Historian | not started |
| 7 Demo and hardening | scripted demo, offline mode, README | not started |
| 8 Stretch | open-ground event layout | not started |

## Resume

```bash
cd /Users/arunak/EgressLab
git log --oneline | head -5        # last phase commit
npm install                         # if node_modules is missing
npm test                            # must be green before continuing
```

Then read the "Next" section below and the blueprint section for that phase. No background jobs or long pipelines are running.

## Open items (Arun)

| # | Item | State |
|---|---|---|
| O1 | Failing verdict: block-with-override or warn only | Unanswered. `config/runtime.json` → `gate.failMode` is provisionally `"block_with_override"`; both modes get built. Ask again at the Phase 5 stop. |
| O3 | Default persona backend, Jev or Haiku | Undecided; needs the side-by-side test in Phase 3. Blocked on a TypeSafe API key for the Jev column. |
| — | TypeSafe API key | Not available yet (Arun has Anthropic only). Get one at console.typesafe.ai/keys. |
| — | Anthropic key in `.env` | Arun has one; copy `.env.example` to `.env` and paste it before Phase 3. |
| — | Committing the drawing sheets | Sheets carry an ownership notice, so they stay git-ignored unless Arun confirms the event rules allow committing them. |
| — | Paywalled sources | Parameter values stay `verified: false` until checked; PDFs from the Thapar library would let them be verified. |

Decided: O2 demo hazards = fire + earthquake. O4 live personas = 12 (configurable).

---

## Log

### Phase 0 — Foundations (2026-11-21)

**Built**

- `package.json` (ES modules, Node ≥ 24, scripts `test`, `typecheck`), all blueprint dependencies installed at exact versions; `package-lock.json`.
- `tsconfig.json` set up for native type stripping (`erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `strict`, `noEmit`); `vitest.config.ts`; `.gitignore`; `.env.example`.
- `src/shared/rng.ts`: sfc32 seeded through splitmix32; named streams via `Rng.stream(seed, ...names)` / `deriveSeed`; state save/restore; `int`, `range`, `bool`, `normal`, `truncNormal`, `lognormal`, `gumbel`, `pick`, `weightedIndex`, `shuffled`.
- `src/shared/hash.ts` (canonical JSON with sorted keys, rejects non-JSON values; SHA-256), `ids.ts` (event ids `E000001`), `units.ts` (ft/in/m, ticks), `paths.ts` (`repoPath`).
- `src/shared/params.ts`: loads `config/behaviour.params.json`; refuses values outside `[min, max]`, inverted bounds and unknown citations; `get` throws on absent keys; `clamp`; `withOverrides` refuses out-of-range values; `unverified()`.
- `src/shared/runtime.ts`: zod-validated `config/runtime.json` (sim tick and cell size, showcase persona count, persona deadlines, gate fail mode, approval window).
- `config/references.json`: the 25 OpenAlex-resolved references from blueprint section 18, plus an explicit `assumption` key for modelling guesses.
- `config/behaviour.params.json`: 60 bounded parameters seeded from blueprint section 7.9. **All are `verified: false`.** 23 cite `assumption` (alone or alongside a qualitative source).
- `src/log/events.ts`: the fixed actor list and the 31 event types of blueprint section 10.9; payload schema for `session.started`.
- `src/log/eventlog.ts`: append-only JSONL log with SHA-256 hash chain (wall clock excluded from the hash), refs must point to existing records, records deep-frozen, typed subscriptions with ordered delivery (appends made inside handlers are queued, not re-entered), queries, `verifyChain`, `EventLog.verifyFile`, and refusal to open a tampered file. No update or delete API.
- Tests in `tests/unit/`: rng, hash, eventlog, params, determinism-scan.
- `README.md` skeleton (scope and language rules, libraries with versions, APIs, the six sheets with URLs, references with DOIs, assumptions), `AGENTS.md`.

**Evidence**

`npm test` (type-check, then vitest), 2026-11-21:

```
> exitmind@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json

 Test Files  5 passed (5)
      Tests  41 passed (41)
```

Per file: determinism-scan 3, hash 4, eventlog 14, params 10, rng 10. Highlights:

- RNG golden outputs for seed 42 pinned: `[3825871779, 1851418855, 1383259262, 890322987]`.
- A `.ts` worker thread produces the same 1,000-value stream as the main thread.
- Tamper tests: editing one payload in a JSONL log gives `{ ok: false, seq: 2, reason: "hash does not match record content" }`, and reopening that file throws. Deleting a line is also detected.
- The determinism guard was checked against a planted violation: a temporary `src/shared/zz_probe.ts` containing `Math.random()` made both scan tests fail and name the file. The probe was then deleted and the scan passed again.

**Deviations from the blueprint**

- `cite` in `behaviour.params.json` is a list of reference keys (blueprint 5.4 updated to match), so a range taken from two sources can cite both.
- Added an `assumption` reference key so modelling guesses are labelled honestly instead of being attributed to a paper.
- `npm test` runs `tsc --noEmit` and `vitest run`. Playwright joins the script in Phase 2, when the first e2e test exists (`playwright test` with no tests exits with an error).
- `config/runtime.json` holds only the sections Phase 0 and the decision registers need; later phases add theirs.
- Event payload schemas exist only for `session.started`; each phase adds schemas for the events it produces.
- Added `@types/*` dev dependencies (not listed in blueprint 4.2) for type-checking; `@types/node` is pinned to the 24.x line to match the runtime.

**Not done / known gaps**

- No parameter value has been checked against its source yet.
- `replay.ts` (blueprint 4.4 `src/log/`) is deferred to Phase 2, when there is a simulation to replay.

**Next: Phase 1 — Twin, 2D view, code check** (blueprint sections 3, 6, 9.2, 11)

1. `npm run sheets:fetch`: download the six PDFs into `data/sheets/` and render PNGs with `pdftoppm`.
2. Register the grid frame (≥ 6 grid intersections per plan, affine fit, residual ≤ 0.5 ft).
3. Trace F1, then F2 and F3 in `data/twin/rinker/*.ts` using grid helpers; stairs, voids, zones, sign mounts, optimiser candidate sites.
4. `npm run twin:build` validates and writes `data/twin/rinker.twin.json`; `twin:overlay` writes local overlay screenshots.
5. Code check reproduces the printed REQ'D widths (28.2", 1.8", 0.8", 47.1", 45.3") and the other checks; 2D plan view.
6. Verification: overlays, five-dimension spot check (`docs/verification/twin-spotcheck.md`), floor area within ±3% of 14,915 / 16,270 / 16,270 GSF.
