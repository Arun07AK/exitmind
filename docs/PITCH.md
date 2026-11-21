# EXITMIND: evaluation-round pitch

**The idea in one line:** a crash test for crowds, run before the event and again during it. No AI decision reaches a person until three keys turn: the AI decides, a simulation tries to break the decision, and a human approves.

**Deck:** [Pied Piper – EXITMIND (evaluation round)](https://docs.google.com/presentation/d/1IIK1OBMzFSzHfucOTwjsMzMr0sHrYVRL38m56TvR4F8/edit), 10 slides. The idea-round deck ("Pied Piper – Building Evacuation Simulator", hardware exit nodes) is unchanged; its hardware is now the "Next" column on slide 10. **Code:** [github.com/Arun07AK/exitmind](https://github.com/Arun07AK/exitmind).

**Updated 22 Nov 2026** for the plan upload (Opus 5.5 traces your floor plan) and the architectural optimisation engine (diagnose, generate, Opus concepts, paired evaluation, safe capacity). Demo 2 now uses the **Architectural changes** panel, which is what the Optimise page opens on.

**The three moments judges should remember**

1. **Saturnalia:** first-timers head back to the gate they came in through, find it blocked, and turn around. EXITMIND shows you where the crowd actually goes.
2. **Rinker Hall:** the search finds the worst fire (82.5 of 547 people still inside at 10 minutes), the diagnosis shows the one door causing it, and the optimiser proves the building can safely hold **362 → 556** people with two wider doors and an external stair.
3. **The bad plan:** a plan that sounds sensible ("shut the doors to contain the smoke") causes gridlock in the simulation, and approval is blocked.

**Closing line:** *"Every fest should end the same way: everyone goes home."*

---

## The script (about 3½ minutes; the 3-minute cut is marked)

`SAY` is spoken. `DO` is the person at the laptop. Numbers in **[brackets]** change from run to run: read them off the screen on the day. Every other number comes from the committed results (see Sources).

### 0:00 · Hook

`DO` Dark slide, or a slide with just *"25 November 2023 · Kochi"*.

`SAY`
> November 2023. Cochin University, in Kochi. A concert at their tech fest, more than two thousand people.
>
> The auditorium wasn't even full. But it had one gate, for getting in *and* getting out. When it started to rain, the crowd outside surged through that gate. People fell on the steps. Four young people never went home. Three of them were engineering students, like us.
>
> *(cut for 3:00)* Bengaluru, last June: eleven more, outside a stadium, at a celebration.

*Pause for two seconds.*

### 0:30 · The gap

`SAY`
> There was room inside. What failed is the one thing a floor plan can't show you: what a crowd *does* when something changes. Our safety checks count doors and people. They don't test behaviour.
>
> So we built EXITMIND: a crash test for crowds, before the event and during it.

### 0:45 · Demo 1: Saturnalia (people are not all the same)

`DO` Simulate → **Edit scenario** → **Try this scenario** (Saturnalia card) → **Set up scenario**.

`SAY` *(talk while Opus thinks, about 15 s)*
> Let's crash-test a night we all know: Saturnalia. One sentence. That's our real Fete Area, built from OpenStreetMap. Claude Opus turns the sentence into a full scenario, and when something is missing, it asks instead of guessing.

`DO` Opus asks how many people are there. Type: **"1,500. Fire near the stage. Main gate blocked."** → **Send**.

`SAY` *(talk while Opus builds the scenario)*
> Every person gets a profile: student or staff, first-timer or regular, and the gate they came in through. Then Claude Haiku decides how each group reacts, thousands of choices in one run. That takes about four minutes live, so here's the run we did before we came up.

`DO` Switch to the pre-run Saturnalia tab, **2D Flow**, press play at 4× or 8×.

`SAY`
> Watch the first-timers. Half of them head straight back to the gate they came in through. One of those gates is blocked, and nobody announced it. They only find out when they get there, and they turn around.
>
> *(cut for 3:00)* And look at the side gate: **[519]** people. If you're organising Saturnalia, that's where your volunteers and lights go, and you learn it *before* the fest, not during it.

### 1:35 · Demo 2: Rinker Hall (find the worst case, then fix it)

`DO` **Optimise** tab (it opens on **Architectural changes**, floor F1, "Waiting now"). Point at the red patch marked **H1**, then click **Difference**, then point at the **Safe capacity 362 → 556** card.

`SAY`
> Now a real building: Rinker Hall, a three-storey university building, traced from its construction drawings.
>
> We don't test it with an average fire. EXITMIND has an adversary: a search that runs hundreds of simulations, hunting for the fire that hurts most. In the worst one it found, eighty-two people are still inside at the ten-minute mark.
>
> Then it finds why. This red patch is one door, the south stair's exit: it carries a quarter of everyone leaving on seven percent of the exit capacity. EXITMIND turns that into real construction options: wider doors, new exits, an external stair. Claude Opus proposes its own ideas too, and every option is built, simulated on the same crowds, and ranked.
>
> The result: this building can safely hold one hundred and ninety-four more people. Three hundred and sixty-two becomes five hundred and fifty-six, with everyone out in all eight test runs.
>
> *(cut for 3:00)* And the quickest fix, one door fifteen centimetres wider plus a phased alarm, takes the worst fire from eighty-two people inside to zero or one.

### 2:10 · Demo 3: Live (three keys)

`DO` **Live** tab (press **Reset** beforehand) → **Start fire**. The Sentinel confirms in about 15 s; keep talking.

`SAY`
> That's design. Now the night itself. Fire on the second floor.
>
> An AI planner proposes a response. But in EXITMIND, no sign changes until three keys turn. One: the AI decides. Two: a simulation tries to break that decision. Three: a human approves.

`DO` Point at the three boxes on the decision card → **Approve and publish to 12 signs**.

`SAY`
> Approved, and the signs on these phones change.
> *(If the phones weren't checked before the pitch, say instead: "and the signs on the plan change.")*

`DO` **Inject bad plan**.

`SAY`
> But what if the AI is confidently wrong? This plan sounds sensible: shut the ground-floor doors to contain the smoke. The simulation says: gridlock. **[283]** people still inside at ten minutes, against **[3]** if we'd done nothing. Approval is blocked. Overriding it takes a typed reason, written into a log nobody can quietly edit.

### 2:45 · Close

`DO` "Real today / Next" slide (below), or stay on the blocked decision card.

`SAY`
> Everything you just saw runs today, on a real building and our own fest ground, even with the internet off. *(cut for 3:00)* Next: real sensors, real signage, and checking our crowd model against real drills with fire-safety engineers.
>
> We can't make crowds predictable. But we can crash-test the night before it happens, and make sure no AI moves a crowd until a simulation and a human have checked it.
>
> Every fest should end the same way: everyone goes home. We're EXITMIND.

### Changing the length

- **3:00:** drop the three lines marked *(cut for 3:00)*.
- **4:00:** after Rinker Hall, add the plan upload: "And it isn't limited to buildings we traced. Upload any floor plan, PDF or photo, and Claude Opus traces the walls, doors and exits for you to check. On Rinker's first floor, before any correction, it matched the outline at 0.958 overlap and found 91% of the walls." (Open `/plans` only if you have a plan you're allowed to show; don't show the Rinker sheets, which belong to their architects.)
- **5:00:** after the bad plan, add **Start earthquake** ("a different hazard gets a different protocol: hold first, then leave by the stairs that aren't damaged"), then **Fail sensor** ("confidence drops, the console says why, and the signs hold instead of guessing"). Finish on the responder brief: every line links to the log record it came from, and "A human calls 112. EXITMIND never contacts anyone."

---

## Closing slide: real today vs next

| Real today (shown in the demo) | Next (not built yet) |
|---|---|
| Rinker Hall traced from 6 public construction drawings; the Thapar Fete Area built from OpenStreetMap; your own plan traced by Opus 5.5 and corrected in the editor (one floor at a time) | Multi-floor plan import (stairs between floors are not traced yet) |
| Opus scenario agent; Haiku crowd brain (up to 800 calls a run); every run replays exactly from its log with no AI calls | Checking every behaviour parameter against its paper, and comparing the model with real drill data |
| Worst-case search; diagnosis; architectural optimiser (generators + Opus concepts, paired evaluation, safe capacity 362 → 556 on Rinker Hall) | The full optimiser for open-air events: gates, barriers, the stage (the Fete Area gets the simpler perimeter generators today) |
| Live: sensor fusion, AI planner, simulation verifier, human approval gate, phone signs, traceable responder brief, hash-chained log, offline mode | Real sensors and a read-only fire panel feed (today the building, sensors and phones are simulated) |
| Phone signs with a fail-safe static fallback, tested with simulated phones | A pilot on real phones and signage at a real event |

---

## Before you go on stage

1. `npm run llm:check`, then `npm run demo`. Open the console on the laptop.
2. **About 10 minutes before:** run the Saturnalia scenario once (1,500 people, fire near the stage, main gate blocked). It takes about 4½ minutes. Leave that tab open and don't reload it. Write down its exit counts for the **[side gate]** line.
3. Tabs in order: **A** Simulate (fresh, for the live Opus question) · **B** the pre-run Saturnalia in 2D Flow · **C** Optimise, on Architectural changes (it loads the committed analysis; don't press **Re-run analysis** on stage, it takes 2–3 minutes) · **D** Live, after pressing **Reset**.
4. **Phones (not yet tested on real devices):** run the three-phone check in `docs/PROGRESS.md` ("Three real phones") on the venue network. If it fails, use the "signs on the plan" line instead.
5. **Network:** if the venue Wi-Fi blocks phone-to-laptop traffic, use a phone hotspot with mobile data off (blueprint 15.2).
6. **If the internet dies:** restart with `EXITMIND_OFFLINE=1 npm run demo`. Optimise and Live work fully. Skip the live Opus question (the offline parser doesn't pick up "main gate blocked") and go straight to the pre-run tab.
7. **Don't read the "This plan / Do nothing" numbers on the first (approved) plan aloud.** In a small fire the two can be close. Point at **VERIFIED · PASS** and move on to the bad plan.
8. **Two labels a judge might spot:** the Saturnalia card says the venue was "mapped using Google Maps or OpenStreetMap", but only OpenStreetMap was used (README). And the header still reads "Rinker Hall · University of Florida" while the Fete Area is on screen.

---

## Judge questions

**"Is the crowd behaviour real?"**
It's modelled behaviour, not validated against real evacuations, and every screen says so. Every behaviour parameter has a range and a citation to published research, but we haven't yet checked each number against its paper. That's our first next step, with fire-safety engineers. EXITMIND gives decision support for professional review. It doesn't certify anything.

**"What stops the AI from doing something dangerous?"**
Four things. The AI can only pick from options the simulator lists, so it can't invent an impossible route. It never writes sign text: signs come from approved templates, and the compiler refuses any "no exit" sign that doesn't show an alternative. Every plan is stress-tested against doing nothing. And only a human approval publishes. That last rule is enforced in code: one file is allowed to publish, and a test checks it.

**"What if the internet or the AI fails mid-incident?"**
It falls back in layers. The planner falls back to the playbook verified at design time, the crowd to a policy distilled from recorded AI decisions, and the brief to templates. A phone that loses its connection shows its static exit sign. The whole demo runs with the network off.

**"Evacuation simulators already exist. What's new?"**
Professional egress simulators exist, and engineers use them at design time. What we haven't seen in one tool: a search that hunts for the worst case, AI-driven people who behave differently from each other, fixes re-tested before they're recommended, and the same engine standing behind a live decision with a human approval.

**"Why should we trust your numbers?"**
Every number on screen is computed in the run that shows it, never typed in. Runs are seeded and replay to the identical state, AI runs included: they replay from the log with zero AI calls. A fix only counts as validated if its gain is more than twice its standard error across eight seeds. The automated suite has 114 unit and acceptance tests, all passing, plus 6 browser test files, including simulated phones and the plan editor.

**"How does the optimiser decide what to build?"**
It measures before it suggests. First it records where people wait and which door each queue is stuck behind. Code then turns each hotspot into real geometry: a new exit, an external stair, a passage, a wider door, a ramp. Claude Opus reads the same diagnosis and proposes its own ideas, but the same code has to build them; 2 of its 8 were rejected, for example "no façade clear on every floor". Every option, and the best pairs and triples, runs on the same 8 scenario runs as today's building, and gains come with 95% intervals. Ranking weighs safety, effort and structural change, and anything structural is flagged for an engineer.

**"Why is the extra-people number so uncertain (+19.6 ± 26.6)?"**
Because two of the eight test runs are the worst fire the adversary found, and they dominate the differences. That's why we lead with safe capacity: the largest crowd that gets out in every one of the eight runs, before and after (362 → 556). More seeds would narrow the interval.

**"Can it work on our building?"**
Yes, if you have a floor plan. Upload a PDF or image, and Claude Opus 5.5 traces it into a draft you correct in the editor, then save as a venue. On Rinker Hall's first floor the uncorrected draft scored 0.958 outline overlap, found 91% of the walls and 4 of 5 exits, and read the scale to within 0.4%. One floor at a time for now.

**"Your approved plan wasn't much better than doing nothing."**
In a small fire, most people get out either way. The verifier's job is to block plans that make things worse or cause gridlock. It passed that plan and failed the bad one.

**"Privacy? Cameras?"**
No cameras and no personal data. Density comes from per-zone sensor counts, and phones receive only approved template signs.

**"Does it call 112?"**
Never. EXITMIND never contacts an emergency number, service, SMS gateway or webhook: a person calls 112. The certified fire alarm panel stays in charge, and EXITMIND only reads it.

**"Why a US building?"**
We needed real construction drawings with a printed egress plan and code summary, and Rinker Hall's are public. Every traced element links back to its sheet. The same tracing process works for any drawing set, and our own fest ground came from OpenStreetMap in one command.

**"Who uses this?"**
At design time, architects and fire-safety engineers. On the night, venue and event teams, like a fest committee, with their safety officer as the human key.

---

## Sources for every number

| Claim | Source |
|---|---|
| CUSAT, 25 Nov 2023: 4 dead (3 engineering students), over 2,000 people, auditorium not full, one gate for entry and exit, rush when it rained, people fell on the steps | [Indian Express](https://indianexpress.com/article/india/kerala/kochi-university-stampede-cusat-9042475/), [NDTV](https://www.ndtv.com/kerala-news/cusat-what-led-to-kerala-campus-stampede-that-left-four-students-dead-4606751), [The News Minute](https://www.thenewsminute.com/kerala/how-the-cusat-stampede-happened-eyewitnesses-recount-the-terrible-tragedy), [New Indian Express](https://www.newindianexpress.com/states/kerala/2023/Nov/25/four-students-killed-in-stampede-during-tech-fest-at-kochis-cusat-2636164.html) |
| Bengaluru, 4 Jun 2025: 11 dead outside M. Chinnaswamy Stadium during the RCB celebration | [The Hindu](https://www.thehindu.com/news/cities/bangalore/rcb-ipl-victory-celebrations-stampede-bengaluru-death-toll/article69656538.ece), [AP](https://apnews.com/article/india-cricket-stadium-stampede-casualties-4b568af6dd17b9387f4ffad02ace9caf) |
| Saturnalia: about half of first-time visitors head for their entry gate first; side gate 519; everyone out; replay identical with 0 AI calls | Recorded live Haiku run, `data/fixtures/crowd_saturnalia_haiku.jsonl`; summary in `docs/PROGRESS.md` (Custom Emergency Scenario Generator) |
| Rinker Hall: 82.5 of 547 still inside at 10:00 → 0.3; EX-S carries 34.1% of exit use with 9.1% of exit width; 34 → 40 in; 8 seeds; no new code-check failures | `data/design/recommend.json`, Optimise page |
| "Hundreds of simulations" for the worst-case search | `config/runtime.json`: population 16 × 5 generations × 3 seeds = 240 runs |
| Bad plan: gridlock, [283] vs [3] still inside | Computed live by the verifier; the numbers differ per run |
| Behaviour parameters, none checked against their source yet | `config/behaviour.params.json` (`verified: false` on all), `README.md` |
| Safe capacity 362 → 556 (+194, A20); 68% of waiting behind EX-S, 25% of people on 7% of capacity, saturated 110 s; 392 simulations, 49 alternatives; Opus 8 concepts, 6 built, 3 of the top 3; +19.6 ± 26.6 (A1) | `data/design/architect.json` (`search.safeCapacity`, `diagnosis.hotspots`, `search.alternatives`, `ablation`), Optimise → Architectural changes |
| Plan tracing: IoU 0.958, 91% wall recall, 4 of 5 exits, scale 0.4% off | `docs/verification/plan-benchmark.md` |
| 114 tests passing | `npx vitest run` on 22 Nov 2026: `Test Files 21 passed (21) · Tests 114 passed (114)` |
