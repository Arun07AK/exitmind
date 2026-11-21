# EXITMIND

An AI-assisted building-safety design platform and agentic emergency system. It asks one question: *how do we design and run this building so people get out safely, even when their behaviour is unpredictable?*

No action reaches a person until three keys turn: **an AI agent decides, a simulation tries to break that decision, and a human approves it.**

> **Status:** Phases 0-7 are built. Phase 8 (open-ground event layout, stretch) is not started. Results, evidence, deviations and known gaps are in [`docs/PROGRESS.md`](docs/PROGRESS.md); the design is in [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md).

## Custom emergency scenario generator

On the Simulate page, open **Scenario** and describe the emergency in one text box. Claude Opus 5.5 turns the description into a scenario:

- **Required:** crowd size, age groups and event type. If any is missing, Opus asks for it (the server re-checks, so a reply cannot skip one).
- **Optional:** venue (Rinker Hall, or the Thapar Fete Area), emergency type and where it starts, mobility needs, blocked exits, other conditions. Defaults are listed as assumptions, together with the venue's own assumptions, before you press **Run simulation**.

Claude Haiku then acts as the crowd brain. Each person has a profile (role, age, mobility, whether they know the venue, the gate they came in through). People in the same situation share one Haiku decision and each draws their own choice from it, so a 1,500-person concert needs a few hundred calls instead of thousands. Blocked exits are not announced: people discover them when they get close and reroute. Every decision is logged, so a run replays to the identical state with no LLM calls. Without a key, the offline keyword parser and the distilled policy take over.

Below the box, **Try the Saturnalia demo** preloads a description of an evacuation during a Saturnalia concert at Thapar (students aged 18-21, the real venue from OpenStreetMap). Edit it or send it as is; Opus will ask how many people are there.

## Architectural optimisation

**Optimise → Architectural changes** answers: what should be built or changed, where, why, and how many more people reach safety. Full design: `docs/BLUEPRINT.md` section 9A.

1. **Diagnose.** Simulations record where people wait and charge each queue to the door or stair causing it. The result names the rooms feeding each queue, the nearby exits with spare capacity, and why people fail to get out (queue, long walk, late start, no step-free route, smoke).
2. **Generate.** Code turns each hotspot into real geometry:
   - new exterior exits, including direct discharge from a stair;
   - external stairs;
   - connecting passages through suitable rooms;
   - partition removal and double doors;
   - wider stairs and exits;
   - ramps.

   Claude Opus 5.5 reads the diagnosis and the room layout and proposes further concepts. The same code rebuilds each one or rejects it with a reason.
3. **Evaluate.** Every option, and the best pairs and triples, runs in the simulator on the same scenarios and seeds as the current layout. That includes the adversary's worst fire. Results are paired differences with 95% intervals.
4. **Rank.** Options are compared on safety gain, effort (relative units from quantities, not money) and number of structural changes. A weighted score uses editable weights in `config/architect.json`.
5. **Show.** A 2D plan shows waiting now, after the change, and the difference, with what to build, remove or modify. A 3D view shows the new construction. Each change lists its structural flags and regulatory notes.
6. **Quantify.** The panel shows extra people out by the target for the same crowd, the change in time for 95% to get out, and safe capacity: the largest crowd that gets out in every test run, before and after.

`npm run architect` (or **Re-run analysis** on the page) takes about 2–3 minutes on Rinker Hall. Results are concepts for professional review: anything that opens an outside or structural wall is marked as needing a structural engineer, and nothing here is a code approval.

## Your own plan

For better accuracy than the built-in venues, upload an architectural floor plan (PDF, PNG or JPEG) at `/plans`, or follow the link in the scenario box. Claude Opus 5.5 traces it. You then correct the draft in the editor, set the scale with two clicks, and save it as a venue that the scenario generator and the optimiser can use. Uploaded plans stay on this computer in git-ignored `data/uploads/` and are sent only to the Claude API for tracing.

Benchmark on Rinker Hall's first floor, before any correction (`docs/verification/plan-benchmark.md`):
- outline overlap (IoU) 0.958;
- scale read from a printed dimension, 0.4% off;
- 91% of real walls found, and 92% of traced walls are real;
- 4 of 5 exits found.

Untraced doors leave some rooms sealed; one click on **Add doors to sealed rooms** fixed that in the benchmark.

## What EXITMIND is, and is not

- Results describe **this model under stated assumptions**. They say nothing about whether the real Rinker Hall is safe.
- Persona behaviour is **modelled behaviour, not validated against real evacuations**.
- Crash-test ratings are **decision support for professional safety review, not a certification**.
- EXITMIND never contacts an emergency number, service, SMS gateway or webhook. A person calls 112.
- No casualty estimates, no personal data, no camera input. Occupant-facing text comes only from approved templates.
- The certified fire alarm panel stays in charge; EXITMIND only observes it.

## Run it

Requires Node.js 24 or later (TypeScript runs natively; there is no build step for server code), Python 3 with Pillow for the drawing overlays, and `pdftoppm` (poppler) for the sheets.

```bash
npm install
npx playwright install chromium   # once, for the browser tests
cp .env.example .env              # optional: paste API keys; without them every LLM path uses its fallback
npm test                          # ALL tests: type-check, vitest (unit + acceptance), Playwright (browser + simulated phones)
npm run demo                      # THE demo: builds the web app, serves on 0.0.0.0:8080, prints LAN URLs and sign QR codes
```

`EXITMIND_OFFLINE=1 npm run demo` runs the whole demo with no network: personas use the distilled policy, the Planner uses the playbook, briefs use templates.

| Command | What it does |
|---|---|
| `npm run llm:check` | checks the API keys in `.env` with three tiny calls (never prints a key) |
| `npm run sheets:fetch` | downloads the six drawing sheets into the git-ignored `data/sheets/` |
| `npm run twin:build` / `twin:overlay` | builds and validates `data/twin/rinker.twin.json`; draws the twin over the sheets (git-ignored output) |
| `npm run sim -- --hazard fire` | one simulation run from the command line |
| `npm run recommend` | re-simulates the optimiser's changes on the worst case (8 seeds) and writes `data/design/recommend.json` for the Optimise page |
| `npm run bottlenecks` / `adversary` / `optimise` / `rate` / `playbook` | design-mode pipelines; results go to `data/design/` and show under Optimise → Analyses |
| `npm run personas:collect` / `distill` | record live LLM persona runs (needs a key), then distil them into `data/policy/distilled.policy.json` |
| `npm run bakeoff` / `results:table` | persona backend comparison and the rule-only / hybrid / distilled table, written to `docs/verification/` |
| `npm run architect -- --venue <id>` | architectural optimisation for a venue (`--no-opus` for rule-based only); writes `data/design/architect*.json` |
| `npm run plans:benchmark` | traces Rinker A102 with Opus 5.5 and compares it with the hand-traced twin (`-- --reuse` skips the API call) |
| `npm run venue:osm` | rebuilds the Fete Area twin from the saved OSM extract (`-- --fetch` re-downloads it) |
| `npm run replay -- <log.jsonl>` | replays a recorded showcase run or live session and checks the final state is identical |

Demo script (3 minutes): `/live` -> Start fire -> read the decision card -> Approve -> phones change -> Inject bad plan (FAIL, needs an override reason) -> Fail a sensor (confidence drops, signs hold) -> Reset -> Start earthquake (a different protocol) -> Approve -> All clear -> `/report`.

## Libraries

| Package | Version | Use |
|---|---|---|
| `@anthropic-ai/sdk` | 1.8.0 | Claude API: Planner, Liaison, Haiku personas |
| `@typesafe-ai/sdk` | 0.7.0 | TypeSafe System One API: Jev personas |
| `zod` | 4.6.7 | schemas and structured output |
| `express` | 5.3.0 | HTTP API and static files |
| `ws` | 8.23.0 | WebSockets for the console and phone signs |
| `react`, `react-dom` | 19.3.1 | web app |
| `three` | 0.187.0 | 3D view |
| `@react-three/fiber` | 9.8.2 | 3D in React |
| `@react-three/drei` | 10.7.9 | 3D controls and labels |
| `zustand` | 5.1.0 | run buffer and shared playhead for the 2D and 3D views |
| `@react-three/postprocessing` | 3.2.2 | ambient occlusion and anti-aliasing in the 3D view |
| `postprocessing` | 6.39.6 | effect passes used by `@react-three/postprocessing`; its `n8ao` dependency is pinned to 2.0.2 with `overrides` (2.1.0 was under 7 days old) |
| `radix-ui` | 1.8.1 | accessible segmented controls, popovers, tooltips, sheets and the timeline slider |
| `lucide-react` | 1.72.0 | icons |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | 5.3.0 | self-hosted IBM Plex fonts, so the offline demo keeps its typography |
| `qrcode` | 1.5.4 | sign registration QR codes |
| `nosleep.js` | 0.12.0 | keeps phone screens awake |
| `vite` | 8.3.8 | web build and dev server (dev) |
| `@vitejs/plugin-react` | 6.3.0 | React plugin for Vite (dev) |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 | styling (dev) |
| `vitest` | 5.1.0 | unit and acceptance tests (dev) |
| `@playwright/test` | 1.65.1 | browser and simulated-phone tests (dev) |
| `typescript` | 7.0.2 | type-checking only (dev) |
| `@types/node` 24.19.2, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@types/ws` 8.18.2, `@types/express` 5.0.6, `@types/qrcode` 1.5.6, `@types/three` 0.187.0 | — | type definitions (dev) |

Versions are pinned exactly. Every version was published at least 7 days before it was added. External tools used by scripts: `pdftoppm` (poppler) for rasterising the drawing sheets, and Python 3 with Pillow (`tools/*.py`) for grid registration and the overlay images.

## APIs

| API | Used for | Without a key or network |
|---|---|---|
| Claude API (Anthropic), `api.anthropic.com` | Scenario agent (Claude Opus 5.5, `claude-opus-5-5`), crowd brain and persona backend (Claude Haiku 5.5), Planner and Liaison agents (Sonnet / Haiku), plain-language parsing | offline keyword parser, distilled policy, playbook, templates |
| TypeSafe System One API, `api.typesafe.ai` | Jev persona backend (typed choices with probabilities). **Not exercised against the live API in this build: no TypeSafe key was available; the adapter is tested against a stub only.** | distilled policy; Haiku backend |

The server's outbound HTTP is restricted to these two hosts. `npm run venue:osm -- --fetch` (build time only, never the server) also queries the OpenStreetMap Overpass API at `overpass-api.de`; the extract it saves is committed, so nothing is fetched at run time.

## Data sources

Rinker Hall, M.E. Rinker, Sr. School of Building Construction, University of Florida. Construction documents dated 11/21/01 (Croxton Collaborative / Gould Evans Associates), index at <http://coremng.dcp.ufl.edu/rinkerhall/drawings.htm>.

| Sheet | Title | URL |
|---|---|---|
| A102 | Mechanical level & first floor plan | <http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/Rinker_009.pdf> |
| A103 | Second & third floor plan | <http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/Rinker_010.pdf> |
| A107 | Mechanical level & first floor egress plan, code summary | <http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/Rinker_012.pdf> |
| A108 | Second & third level egress plan | <http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/Rinker_013.pdf> |
| A602 | Atrium stair plans, sections, elevations | <http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/Rinker_031.pdf> |
| A603 | Stair & elevator enlarged plans & sections | <http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/Rinker_032.pdf> |

The sheets remain the property of their architects. They are downloaded by script into a git-ignored folder and are not redistributed here. The committed digital twin is this project's own tracing, with every element linked to its sheet.

Code basis printed on sheet A107: 1997 Standard Building Code and 1994 ANSI/NFPA 101 Life Safety Code.

**Fete Area, Thapar Institute of Engineering & Technology (TIET), Patiala** (the Saturnalia concert ground). Outline and surrounding paths from OpenStreetMap: way 396666360 ("Fete Area") and the paths and service roads within 250 m, fetched from the Overpass API on 2026-11-21. © OpenStreetMap contributors, available under the [Open Database License (ODbL)](https://www.openstreetmap.org/copyright). The raw extract is `data/twin/thapar-fete/osm.json`; the derived twin `data/twin/thapar-fete.twin.json` is likewise ODbL. Gates are placed where OSM paths meet the boundary; the stage position, gate widths and which gate is "main" or "backstage" are EXITMIND assumptions, listed in the twin and shown before every run. Google Maps was not used (its terms do not allow building a model from its map data).

## Behaviour parameters and literature

Every behaviour parameter the simulator reads lives in [`config/behaviour.params.json`](config/behaviour.params.json) with a value, a bounded range, a unit and a citation key from [`config/references.json`](config/references.json). Values outside the range are refused.

- **All parameters are currently `verified: false`.** Their values were seeded from the literature from memory during planning and have NOT been checked against each source. Treat every number as provisional.
- Parameters citing the key `assumption` are modelling assumptions with ranges chosen by this project, not taken from a source.

All references below were resolved against OpenAlex on 2026-11-21.

| Key | Reference | DOI |
|---|---|---|
| `weidmann1993` | Weidmann, U. (1993). Transporttechnik der Fussgänger (Schriftenreihe des IVT Nr. 90). *ETH Zürich, Institut für Verkehrsplanung, Transporttechnik, Strassen- und Eisenbahnbau* | — |
| `sfpe2016` | Gwynne, S. M. V.; Rosenbaum, E. R. (2016). Employing the Hydraulic Model in Assessing Emergency Movement. *SFPE Handbook of Fire Protection Engineering, 5th ed. (Springer)* | [10.1007/978-1-4939-2565-0_59](https://doi.org/10.1007/978-1-4939-2565-0_59) |
| `helbing1995` | Helbing, D.; Molnár, P. (1995). Social force model for pedestrian dynamics. *Physical Review E* | [10.1103/physreve.51.4282](https://doi.org/10.1103/physreve.51.4282) |
| `helbing2000` | Helbing, D.; Farkas, I.; Vicsek, T. (2000). Simulating dynamical features of escape panic. *Nature* | [10.1038/35035023](https://doi.org/10.1038/35035023) |
| `helbing2007` | Helbing, D.; Johansson, A.; Al-Abideen, H. Z. (2007). Dynamics of crowd disasters: An empirical study. *Physical Review E* | [10.1103/physreve.75.046109](https://doi.org/10.1103/physreve.75.046109) |
| `seyfried2005` | Seyfried, A.; Steffen, B.; Klingsch, W.; Boltes, M. (2005). The fundamental diagram of pedestrian movement revisited. *Journal of Statistical Mechanics: Theory and Experiment* | [10.1088/1742-5468/2005/10/p10002](https://doi.org/10.1088/1742-5468/2005/10/p10002) |
| `seyfried2009` | Seyfried, A.; Passon, O.; Steffen, B.; Boltes, M.; Rupprecht, T.; Klingsch, W. (2009). New Insights into Pedestrian Flow Through Bottlenecks. *Transportation Science* | [10.1287/trsc.1090.0263](https://doi.org/10.1287/trsc.1090.0263) |
| `kretz2006` | Kretz, T.; Grünebohm, A.; Schreckenberg, M. (2006). Experimental study of pedestrian flow through a bottleneck. *Journal of Statistical Mechanics: Theory and Experiment* | [10.1088/1742-5468/2006/10/p10014](https://doi.org/10.1088/1742-5468/2006/10/p10014) |
| `boyce1999a` | Boyce, K. E.; Shields, T. J.; Silcock, G. W. H. (1999). Toward the Characterization of Building Occupancies for Fire Safety Engineering: Capabilities of Disabled People Moving Horizontally and on an Incline. *Fire Technology* | [10.1023/a:1015339216366](https://doi.org/10.1023/a:1015339216366) |
| `boyce1999b` | Boyce, K. E.; Shields, T. J.; Silcock, G. W. H. (1999). Toward the Characterization of Building Occupancies for Fire Safety Engineering: Capability of Disabled People to Negotiate Doors. *Fire Technology* | [10.1023/a:1015391217275](https://doi.org/10.1023/a:1015391217275) |
| `kuligowski2013` | Kuligowski, E. D.; Peacock, R. D.; Wiess, E.; Hoskins, B. L. (2013). Stair evacuation of older adults and people with mobility impairments. *Fire Safety Journal* | [10.1016/j.firesaf.2013.09.027](https://doi.org/10.1016/j.firesaf.2013.09.027) |
| `hunt2013` | Hunt, A. L. E.; Galea, E. R.; Lawrence, P. J. (2013). An analysis and numerical simulation of the performance of trained hospital staff using movement assist devices to evacuate people with reduced mobility. *Fire and Materials* | [10.1002/fam.2215](https://doi.org/10.1002/fam.2215) |
| `larusdottir2010` | Larusdottir, A. R.; Dederichs, A. S. (2010). Evacuation of Children: Movement on Stairs and on Horizontal Plane. *Fire Technology* | [10.1007/s10694-010-0177-6](https://doi.org/10.1007/s10694-010-0177-6) |
| `sime1985` | Sime, J. D. (1985). Movement toward the Familiar: Person and Place Affiliation in a Fire Entrapment Setting. *Environment and Behavior* | [10.1177/0013916585176003](https://doi.org/10.1177/0013916585176003) |
| `kinateder2018` | Kinateder, M. T.; Comunale, B.; Warren, W. H. (2018). Exit choice in an emergency evacuation scenario is influenced by exit familiarity and neighbor behavior. *Safety Science* | [10.1016/j.ssci.2018.03.015](https://doi.org/10.1016/j.ssci.2018.03.015) |
| `haghani2019` | Haghani, M.; Sarvi, M. (2019). 'Herding' in direction choice-making during collective escape of crowds: How likely is it and what moderates it?. *Safety Science* | [10.1016/j.ssci.2019.02.034](https://doi.org/10.1016/j.ssci.2019.02.034) |
| `moussaid2010` | Moussaïd, M.; Perozo, N.; Garnier, S.; Helbing, D.; Theraulaz, G. (2010). The Walking Behaviour of Pedestrian Social Groups and Its Impact on Crowd Dynamics. *PLoS ONE* | [10.1371/journal.pone.0010047](https://doi.org/10.1371/journal.pone.0010047) |
| `purser2001` | Purser, D. A.; Bensilum, M. (2001). Quantification of behaviour for engineering design standards and escape time calculations. *Safety Science* | [10.1016/s0925-7535(00)00066-7](https://doi.org/10.1016/s0925-7535(00)00066-7) |
| `lovreglio2019` | Lovreglio, R.; Kuligowski, E. D.; Gwynne, S.; Boyce, K. E. (2019). A pre-evacuation database for use in egress simulations. *Fire Safety Journal* | [10.1016/j.firesaf.2018.12.009](https://doi.org/10.1016/j.firesaf.2018.12.009) |
| `xie2011` | Xie, H.; Filippidis, L.; Galea, E. R.; Blackshields, D.; Lawrence, P. J. (2011). Experimental analysis of the effectiveness of emergency signage and its implementation in evacuation simulation. *Fire and Materials* | [10.1002/fam.1095](https://doi.org/10.1002/fam.1095) |
| `galea2014` | Galea, E. R.; Xie, H.; Lawrence, P. J. (2014). Experimental and Survey Studies on the Effectiveness of Dynamic Signage Systems. *Fire Safety Science* | [10.3801/iafss.fss.11-1129](https://doi.org/10.3801/iafss.fss.11-1129) |
| `fridolf2013` | Fridolf, K.; Ronchi, E.; Nilsson, D.; Frantzich, H. (2013). Movement speed and exit choice in smoke-filled rail tunnels. *Fire Safety Journal* | [10.1016/j.firesaf.2013.03.007](https://doi.org/10.1016/j.firesaf.2013.03.007) |
| `jin1978` | Jin, T. (1978). Visibility through fire smoke. *Journal of Fire and Flammability* | — |
| `bernardini2016` | Bernardini, G.; Quagliarini, E.; D'Orazio, M. (2016). Towards creating a combined database for earthquake pedestrians' evacuation models. *Safety Science* | [10.1016/j.ssci.2015.09.001](https://doi.org/10.1016/j.ssci.2015.09.001) |
| `park2023` | Park, J. S.; O'Brien, J.; Cai, C. J.; Morris, M. R.; Liang, P.; Bernstein, M. S. (2023). Generative Agents: Interactive Simulacra of Human Behavior. *ACM Symposium on User Interface Software and Technology (UIST)* | [10.1145/3586183.3606763](https://doi.org/10.1145/3586183.3606763) |

## Modelling assumptions

These are EXITMIND's own choices, not facts about the building or findings from the literature. Each is labelled where it appears in the app.

- **Interior door widths** are not on the six permitted sheets; 34" clear per leaf is assumed and tagged `basis: "assumed"`. Code-check rows that depend on them are shown as information, not pass/fail.
- **Occupant loads.** The college profile uses the loads printed on the egress sheets (154 / 157 / 151). School, mall and hospital profiles use an assumed area per person, which puts far more people in the building than its exits were sized for.
- **Hazards** (`config/hazards.json`) are simple spreading zones, not physics. Smoke slows people and makes routes costly; only the fire core is impassable. An earthquake damages chosen stairs or exits, and people who move during an assumed aftershock window count as exposed.
- **Dangerous density** is counted above 5 persons/m2; a doorway's flow collapses after 10 s above that and recovers below 4.5.
- **Announcements** are assumed to halve the remaining pre-movement delay for people who hear them.
- **Assisted evacuation.** People who cannot use stairs wait beside the stair. One assisted elevator trip every 90 s takes one of them out (the A107 code summary lists the elevator as the accessible means of egress); the elevator is not used after an earthquake.
- **Clearance targets** (`config/runtime.json`): 600 s for fire and crush, 720 s for earthquake, 300 s for a threat. They are reviewer settings and every rating depends on them.
- **Sign mount positions, zones (north / central / south bands), optimiser costs and the badness weights** are EXITMIND defaults. Optimiser costs are illustrative units, not estimates.
- **Sensors** are simulated. The fire alarm panel is modelled as an input EXITMIND can only read.
- **Outdoor venue (Fete Area).** Flat open ground following the OSM outline, no barriers or stalls inside; a 90 x 40 ft stage at the middle of the north edge; four gates where paths meet the boundary (20 ft main, 12 ft others). People notice gates within 60 m, find out a gate is blocked within 15 m of it, and smoke from an open-air fire stays within 35 m of it. Attendees came in through the main gates and staff through the backstage gate.
- **Crowd brain groups.** People share a Haiku decision when their role, mobility, situation and available options match; up to 800 calls per run (`config/runtime.json` `crowdBrain`), after which the distilled policy decides.
- **Persona behaviour** is modelled behaviour, not validated against real evacuations. The distilled policy is built from 596 Claude Haiku decisions on Rinker Hall scenarios.
