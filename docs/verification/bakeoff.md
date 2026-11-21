# Persona backend bake-off (O3)

Decision points: 40 (from rule-based runs on Rinker Hall: fire, earthquake, drill), saved to data/fixtures/decision_points.json.

| Backend | Status |
|---|---|
| Claude Haiku (claude-haiku-5-5) | run |
| TypeSafe Jev (jev-1.14.0) | not run (TYPESAFE_API_KEY missing) |

## haiku

- answered: 40/40; valid option ids: 40
- latency per API call (4 in flight): median 1477 ms, p90 1657 ms
- chosen option roles: MOVE_TO:NEAREST 18, FOLLOW_GROUP: 10, WAIT: 6, MOVE_TO:FAMILIAR 2, MOVE_TO:OTHER 2, FOLLOW_SIGN:SIGNED 2

The side-by-side comparison could not run because at least one provider key is missing, so O3 (default persona backend) stays undecided. The missing adapter is tested against stubs in tests/acceptance/personas.test.ts.
