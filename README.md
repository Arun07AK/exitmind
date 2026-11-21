# EXITMIND

An AI-assisted building-safety design platform and agentic emergency system. It asks one question: *how do we design and run this building so people get out safely, even when their behaviour is unpredictable?*

No action reaches a person until three keys turn: **an AI agent decides, a simulation tries to break that decision, and a human approves it.**

> **Status:** Phase 0 (foundations) of 9. The simulator, twin, agents and UI are not built yet. See [`docs/PROGRESS.md`](docs/PROGRESS.md) for the phase ledger and [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the full design.

## What EXITMIND is, and is not

- Results describe **this model under stated assumptions**. They say nothing about whether the real Rinker Hall is safe.
- Persona behaviour is **modelled behaviour, not validated against real evacuations**.
- Crash-test ratings are **decision support for professional safety review, not a certification**.
- EXITMIND never contacts an emergency number, service, SMS gateway or webhook. A person calls 112.
- No casualty estimates, no personal data, no camera input. Occupant-facing text comes only from approved templates.
- The certified fire alarm panel stays in charge; EXITMIND only observes it.

## Run it

Requires Node.js 24 or later (TypeScript runs natively; there is no build step for server code).

```bash
npm install
npm test          # type-check + all tests
```

Commands for the sheets, twin, simulator and demo are added phase by phase; the planned list is in `docs/BLUEPRINT.md` section 4.5.

Copy `.env.example` to `.env` for API keys. `.env` is git-ignored.

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
| `zustand` | 5.1.0 | shared frame store for the 2D and 3D views |
| `qrcode` | 1.5.4 | sign registration QR codes |
| `nosleep.js` | 0.12.0 | keeps phone screens awake |
| `vite` | 8.3.8 | web build and dev server (dev) |
| `@vitejs/plugin-react` | 6.3.0 | React plugin for Vite (dev) |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 | styling (dev) |
| `vitest` | 5.1.0 | unit and acceptance tests (dev) |
| `@playwright/test` | 1.65.1 | browser and simulated-phone tests (dev) |
| `typescript` | 7.0.2 | type-checking only (dev) |
| `@types/node` 24.19.2, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@types/ws` 8.18.2, `@types/express` 5.0.6, `@types/qrcode` 1.5.6, `@types/three` 0.187.0 | — | type definitions (dev) |

Versions are pinned exactly. Every version was published at least 7 days before it was added. External tool used by scripts: `pdftoppm` (poppler) for rasterising the drawing sheets.

## APIs

| API | Used for | Without a key or network |
|---|---|---|
| Claude API (Anthropic), `api.anthropic.com` | Planner and Liaison agents, Haiku persona backend, plain-language parsing | playbook, templates, distilled policy, keyword lexicon |
| TypeSafe System One API, `api.typesafe.ai` | Jev persona backend (typed choices with probabilities), plain-language scores, brief line checks | distilled policy; Haiku backend |

The server's outbound HTTP is restricted to these two hosts.

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

## Behaviour parameters and literature

Every behaviour parameter the simulator reads lives in [`config/behaviour.params.json`](config/behaviour.params.json) with a value, a bounded range, a unit and a citation key from [`config/references.json`](config/references.json). Values outside the range are refused.

- **All parameters are currently `verified: false`.** Their values were seeded from the literature from memory during planning and must still be checked against each source.
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

## Modelling assumptions (to be filled in as they are introduced)

- Interior door widths are not on the six permitted sheets; 34" clear per leaf is assumed and tagged `basis: "assumed"`.
- Sign mount positions, candidate edit sites for the optimiser, the hospital compartment line, hazard spread ranges, optimiser costs and clearance targets are EXITMIND assumptions and are labelled as such wherever they appear.
