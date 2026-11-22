# Shot list: EXITMIND in 60 seconds

<!-- State list: CROWD -> ONE SENTENCE -> OPUS ASKS -> CROWD BUILT -> HAIKU DECIDES -> FLOW -> WORST FIRE -> ONE DOOR -> REDESIGNS -> CAPACITY -> THREE KEYS -> BLOCKED -> NAME.
     Continuous objects: the real app (every picture is footage of it); the left type column; the lifted panel on the right.
     Footage: assets/footage/{fete,scenario,optimise,live}.mp4, real screen recordings; scene.js maps film time to take time per beat. -->

## 1 HOOK ~4
why: open on the real crowd and the problem in one line: safety checks never test behaviour
in: black
out: the 16x replay of the live Haiku run full-bleed, crowd streaming to the gates; "SAFETY CHECKS COUNT DOORS." then "NOT PEOPLE." in red
say announcer: Fire safety checks count {doors} doors. They don't test what {people} people actually do.
do @0 hook-foot #vFete panel dur=0.6 sfx=swell
do @{doors} hl-doors #hl1 headline sfx=hit
do @{people} hl-people #hl2 accent sfx=hit

## 2 AGENT ~11
why: agentic customisation: one sentence in, Claude Opus asks for what is missing and builds the crowd
in: the crowd footage with the hook headline
out: the real scenario panel lifted at native size on the right; Opus's question boxed; four chips on the left: ages, roles, familiarity, mobility
say announcer: ExitMind does. Describe any emergency in {one} one sentence.
do @L1 agent-in #card panel sfx=whoosh
do @L1 bg-in #vScenBg cut
do @{one} k-one #k1 headline sfx=tap
say announcer: {opus} Claude Opus asks for what's {missing} missing,
do @{opus} opus-cut #vScenCrop cut
do @{opus}+0.25 opus-box #hiOpus accent sfx=pop
do @{missing} k-opus #k2 headline
say announcer: then builds the crowd: {ages} ages, {roles} roles, {fam} familiarity, {mob} mobility.
do @L3 asm-cut #vScenCrop cut sfx=tick
do @{ages} chip-ages #c1 micro sfx=tick
do @{roles} chip-roles #c2 micro sfx=tick
do @{fam} chip-fam #c3 micro sfx=tick
do @{mob} chip-mob #c4 micro sfx=tick

## 3 BRAIN ~10
why: the crowd brain: live Claude Haiku decisions per person, from their profile, and the flow they produce
in: the scenario panel and chips
out: the 2D flow of the same live run full-bleed with the decision count
say announcer: Then Claude {haiku} Haiku decides how every group {reacts} reacts.
do @L1 brain-in #card2 panel sfx=whoosh
do @L1 brain-bg #vFete2 cut
do @{haiku} k-haiku #k3 headline
do @{reacts} hi-haiku #hiHaiku micro sfx=tick
say announcer: {new} Someone new to the ground heads back to the gate they came {in} in through.
do @{new} hi-row #hiRow accent sfx=pop
do @{in} k-row #k5 headline
say announcer: {eight} Eight thousand decisions, in one {run} run.
do @{eight} flow-cut #vFlow cut sfx=whoosh
do @{eight}+0.1 count-dec #cnt headline sfx=rise dur=1.2
do @{run} k-run #k6 micro

## 4 OPTIMISE ~12
why: the optimiser: find the worst fire, the one door behind it, test redesigns with Claude's ideas, and prove the gain
in: the flow and the decision count
out: the Difference map in green and the safe-capacity numbers 362 -> 556 large on the left
say announcer: Then it attacks the {building} building. It hunts the worst {fire} fire,
do @L1 opt-in #optWrap panel sfx=whoosh
do @{building} k-attack #k7 headline
do @{fire} k-worst #k8 headline sfx=hit
say announcer: finds the one {door} door behind it,
do @{door} ring-h1 #ringH1 accent sfx=pop
do @{door}+0.2 k-door #k9 headline
say announcer: and tests {redesigns} forty-nine redesigns, {ideas} including Claude's own ideas.
do @{redesigns} diff-cut #vOpt cut sfx=whoosh
do @{redesigns} chip-49 #c5 micro sfx=tick
do @{redesigns}+0.4 chip-392 #c6 micro sfx=tick
do @{ideas} chip-opus #c7 micro sfx=tick
say announcer: Safe capacity: {from} three sixty-two, to {to} five fifty-six.
do @{from} cap-from #capFrom headline sfx=tap
do @{to} cap-to #capTo accent sfx=chime

## 5 LIVE ~10
why: the three-key gate on the night: AI decides, simulation attacks, human approves; a bad plan is blocked
in: the capacity numbers
out: the injected bad plan with VERIFIED · FAIL boxed in red and a BLOCKED stamp
say announcer: On the night, no sign changes until {three} three keys turn.
do @L1 live-in #card3 panel sfx=whoosh
do @L1 live-bg #vLive cut
do @{three} k-keys #k10 headline
say announcer: The {ai} AI decides. A {sim} simulation tries to break it. A {human} human approves.
do @{ai} key-ai #hiK1 micro sfx=tick
do @{sim} key-sim #hiK2 micro sfx=tick
do @{human} key-human #hiK3 micro sfx=tick
do @{human}+0.3 approve-click #vLiveCrop cut
say announcer: A bad {plan} plan? {blocked} Blocked.
do @{plan} bad-cut #vLiveCrop cut sfx=whoosh
do @{plan}+0.15 hi-fail #hiFail accent
do @{blocked} stamp #stamp accent sfx=hit

## 6 CLOSE ~3.5
why: leave the name and the promise
in: the blocked plan
out: EXITMIND, "EVERYONE GOES HOME.", team and repo
say announcer: ExitMind. {home} Everyone goes home.
do @L1 close-in #title headline sfx=swell
do @{home} close-tag #tag accent sfx=resolve
do @{home}+0.4 close-team #team micro
