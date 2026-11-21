# Results table: rule-only vs hybrid vs distilled

Scenario: college profile, fire on F2 at (55, 20) ft, printed occupant load, seeds 1, 2, 3, 4, 5. Persona behaviour is modelled, not validated against real evacuations.

| Run | clearance95 (s) | not out at target | density-danger person-s | smoke exposure person-s | gridlock | badness |
|---|---|---|---|---|---|---|
| rule-only, seed 1 | 226.5 | 0 | 0 | 359.21 | false | 944.92 |
| distilled, seed 1 | 208.25 | 0 | 0 | 267.21 | false | 742.67 |
| hybrid (12 personas, replayed), seed 1 | 229.25 | 0 | 0 | 363.88 | false | 957.01 |
| rule-only, seed 2 | 193.75 | 1 | 0 | 921.64 | false | 2047.03 |
| distilled, seed 2 | 212.5 | 1 | 0 | 927.63 | false | 2077.76 |
| hybrid (12 personas, replayed), seed 2 | 197.75 | 1 | 0 | 921.77 | false | 2051.29 |
| rule-only, seed 3 | 218.75 | 0 | 0 | 211.58 | false | 641.91 |
| distilled, seed 3 | 215.5 | 0 | 0 | 182.31 | false | 580.12 |
| hybrid (12 personas, replayed), seed 3 | 213 | 0 | 0 | 208.15 | false | 629.3 |
| rule-only, seed 4 | 239 | 0 | 0 | 356.19 | false | 951.38 |
| distilled, seed 4 | 217 | 0 | 0 | 326.63 | false | 870.26 |
| hybrid (12 personas, replayed), seed 4 | 243.5 | 0 | 0 | 356.14 | false | 955.78 |
| rule-only, seed 5 | 201 | 0 | 0 | 203.4 | false | 607.8 |
| distilled, seed 5 | 224.5 | 0 | 0 | 339.51 | false | 903.52 |
| hybrid (12 personas, replayed), seed 5 | 204.25 | 0 | 0 | 268.31 | false | 740.87 |
