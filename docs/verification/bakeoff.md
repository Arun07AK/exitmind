# Persona backend bake-off (O3)

Decision points: 40 (from rule-based runs on Rinker Hall: fire, earthquake, drill), saved to data/fixtures/decision_points.json.

| Backend | Status |
|---|---|
| Claude Haiku (claude-haiku-5-5) | run |
| TypeSafe Jev (jev-1.14.0) | not run (TYPESAFE_API_KEY missing) |

## haiku

- answered: 40/40; valid option ids: 40
- latency median 8859 ms, p90 14697 ms

The side-by-side comparison could not run because at least one provider key is missing. The adapters are tested against stubs in tests/acceptance/personas.test.ts.
