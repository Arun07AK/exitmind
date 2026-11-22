# Brief: EXITMIND in 60 seconds

<!-- Facts about the subject live here. Choices about the film live in style-guide.md and shotlist.md.
     The film may invent camera moves, openings and pacing. It may not invent screens, logos, numbers or claims. -->

## Film
Idea: EXITMIND is a crash test for crowds: Claude builds the scenario, decides how every group of people behaves, redesigns the building, and no plan reaches a person until a simulation and a human agree.
Audience: SatHack (Saturnalia '26) judges opening the submitted Drive link on a laptop; they have one minute and have not seen the app.
Duration: 52-60
Formats: 16:9
Renderer: html: the film is real screen recordings of the EXITMIND app (GPU Chromium, 60 fps screencast, conformed to 30 fps H.264), seeked per frame as <video> footage, with panels lifted out at native resolution, camera pushes, callouts and kinetic type drawn over them. A seekable HTML frame function is the smallest system that can crop, zoom and annotate real footage exactly at any t; nothing needs generated video.
Voices: announcer
Unacceptable: any screen that is not the real app; a number or claim not in the Facts; narration over a still; UI text too small to read when it is the subject; the old 8 fps choppy 3D; generic stock-AI look (gradient blobs, glowing brains, particle swooshes).

## Facts
- Product: EXITMIND by Team Pied Piper, SatHack, Saturnalia '26 (Thapar). Code: github.com/Arun07AK/exitmind
- One sentence in, Claude Opus 5.5 builds the scenario and asks for what is missing (footage: "Roughly how many people will be on the Fete Area ground when the fire starts (up to 8,000 can be simulated)?"), then lists 19 assumptions to check (footage). Source: footage/scenario.mp4, recorded 2026-11-22 with the live API.
- In the filmed scenario Opus assumed (footage, assumptions list): all 1,500 attendees young adults aged 18-21; 95% students and 5% staff; familiarity 80% for students and 95% for staff; mobility 2% slow walkers, 0.5% on crutches, 0.5% wheelchair users; main gate EX-G1 blocked. Source: footage/scenario.mp4 at 36-46 s, /api/sim/runs/sim:3.
- The filmed crowd run (sim:3) used live Claude Haiku; its feed rows read e.g. "#1200 · alarm noticed · Head for Main gate (south ...) (far, clear, the gate you came in through) · young_adult, student, unimpaired, unfamiliar · llm:haiku". Source: footage/scenario.mp4 at 58 s.
- Required scenario fields are crowd size, age groups and event type; the event type sets the crowd mix (concert 65% students / 30% visitors / 5% staff; lecture 95% / 0 / 5). Source: src/scenario/spec.ts, src/scenario/build.ts.
- Each person carries age, role, mobility, familiarity and the gate they came in through; decisions in the live feed show them with source llm:haiku (footage). Source: web/src/pages/simulate/RunStatsSheet.tsx, footage.
- Recorded Saturnalia run: 1,500 people, 800 Haiku calls, 8,004 Haiku decisions; replay is identical with 0 AI calls. Source: docs/PROGRESS.md (Custom Emergency Scenario Generator), data/fixtures/crowd_saturnalia_haiku.jsonl.
- Fete Area venue built from OpenStreetMap (ODbL). Source: docs/PROGRESS.md.
- Optimiser on Rinker Hall: worst fire found leaves 82.5 of 547 people inside at 10 minutes; 68% of all waiting sits behind one door (H1, the south stair exit); 49 alternatives, 392 simulations; Opus proposed 8 concepts, 6 built; safe capacity 362 -> 556 (+194). Source: docs/PITCH.md Sources table, data/design/architect.json, footage/optimise.mp4.
- Live: three keys: the AI decides, a simulation tries to break the decision, a human approves; an injected bad plan shows VERIFIED · FAIL and approval needs a typed reason. Source: docs/PITCH.md, footage/live.mp4.
- The behaviour is modelled, not validated against real evacuations (shown in the app's own label). Source: footage.

## Assets
Required: scenario-footage, optimise-footage, live-footage
Reference: refs/ (the team's own evaluation-round deck, slides rendered from runs/pitch-update/deck; palette and type grammar only)
Music: original

## Rules
Keep: the deck's palette (ink #0E1013, cream #F2EEE6, signal red #E2432A, green #39C18B), condensed uppercase display type, mono for numbers; the real UI at native sharpness.
Avoid: centred title on a gradient; everything fading in; logo stings; robotic word-by-word captions; zooming footage past 1.5x (it softens).
Never: invent product screens, metrics or quotes; change a number; show an AI output that was not produced by the app.

## Deliverables
16:9 MP4 with sound under 9.5 MB for the Drive "Upload new version" (Chrome file_upload limit 10 MB), poster frame, contact sheet, and a note on what still needs human review.
