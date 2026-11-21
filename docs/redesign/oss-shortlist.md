# EXITMIND redesign: open-source shortlist

Checked on 2026-11-21 against the npm registry (`registry.npmjs.org`, `api.npmjs.org` weekly downloads), the GitHub API (stars, last push, licence) and bundlephobia (min+gzip of the **whole** package; tree-shaking usually ships less). "Pin" is the newest stable version published on or before 2026-11-14, so it meets the AGENTS.md rule of at least 7 days old. Where `latest` is newer than that, both are shown.

Current stack: React 19.3.1, r3f 9.8.2, drei 10.7.9, three 0.187.0, Tailwind 4.3.5, zustand 5.1.0, Vite 8.3.8, TypeScript 7.0.2. drei already pulls in `camera-controls` 3.1.2, `maath` 0.10.8, `meshline` 3.3.1 and `@use-gesture/react` 10.3.1 (checked in `package-lock.json`).

Verdicts: **Adopt** = add or use as is. **Adapt** = copy the technique, not the package. **Skip** = not worth it, reason given.

## 1. 3D view: human agents, architectural rendering, camera, lighting

| Candidate | Licence | Latest (date) → pin | Activity | Weekly dl · ★ | Compatibility | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| `@react-three/drei` (installed) | MIT | 10.7.9 (2026-09-25) | push 2026-11-17 | 6.1M · 10.2k | peers react ^19, r3f ^9, three ≥0.159 | already shipped | **Adopt more of it.** `CameraControls` (smooth `setLookAt`/`fitToBox` transitions for floor and preset cameras), `View` (several viewports in one context), `Edges`/`Outlines`, `ContactShadows`, `Lightformer`, `Detailed`, `PerformanceMonitor`. **Flag:** `<Environment preset>` downloads HDRIs from `raw.githack.com` (`core/useEnvironment.js`), which fails offline in the LAN demo. Use `<Environment>` with `<Lightformer>` children, or three's `RoomEnvironment`. |
| `@react-three/postprocessing` + `postprocessing` | MIT + Zlib | 3.2.2 (2026-10-21) + 6.39.6 (2026-11-01) | push 2026-10-21 / 2026-11-01 | 1.5M · 1.7k / 2.0M · 3.0k | peers react ^19, r3f ≥9.7, **three <0.188** | 102 + 110 (full pkgs) | **Adopt.** N8AO ambient occlusion (this is what makes an architectural model read well), SMAA, Outline/Selection for bottleneck highlights, tone mapping. **Flags:** (a) the `postprocessing` peer range blocks a three 0.188 upgrade until it is bumped; (b) it depends on `n8ao ^2.0.0`, which resolves to n8ao 2.1.0, published 2026-11-15T21:36Z (under 7 days old). Add `"overrides": {"n8ao": "2.0.2"}` (2.0.2 was published 2026-11-12), or install on or after 2026-11-23. |
| three 0.187 built-ins | MIT | — | push 2026-11-21 | 38M · 119k | native | 0 | **Adopt.** `InstancedMesh.setMorphAt` + `setColorAt` for agents (official example `webgl_instancing_morph`, 1024 instances), `SkinnedMesh.applyBoneTransform` to bake clips, `AgXToneMapping`/`NeutralToneMapping`, `RoomEnvironment`, `BufferGeometryUtils.mergeGeometries` to draw each floor's walls in one call. All verified in `node_modules/three`. |
| `@three.ez/instanced-mesh` (InstancedMesh2) | MIT | 0.3.16 (2026-07-26) | push 2026-10-06 (tests, benchmarks) | 11k · 488 | peer three ≥0.159; vanilla class, use through r3f `extend` | 17 | **Conditional.** Instanced skinning (`initSkeleton`, `setBonesAt`; its demo runs 3k instances), per-instance LOD and frustum culling. Add it only if the morph bake below can't give the clip crossfades you need. |
| `three-custom-shader-material` | MIT | 6.4.0 (2025-10-12) | quiet for 13 months | 130k · 1.4k | peers r3f ≥8, react ≥18, three ≥0.159 | small | **Skip** unless you take the VAT route. `onBeforeCompile` is enough for a capsule bob. |
| `@react-spring/three` | MIT | 10.1.2 (2026-06-24) | push 2026-10 | 2.3M | React 19 OK | — | **Skip.** camera-controls transitions plus `MathUtils.damp` in `useFrame` (for the explode factor) cover it. |
| `@react-three/csg` / `three-bvh-csg` | MIT | 4.0.0 (2025-03-02) / 0.0.18 (2026-02-17) | 0.0.x API | 32k / 337k | three ≥0.179 | — | **Skip for now.** Adapt only if door openings must be cut out of solid wall extrusions. |

## 2. 2D flow view: dots, fading trails per exit, density heatmap, bottlenecks, layers, pan and zoom

| Candidate | Licence | Latest (date) → pin | Activity | Weekly dl · ★ | Compatibility | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| r3f with an orthographic top camera (drei `MapControls`/`CameraControls`, instanced dots, trail shader, density `DataTexture`) | — | — | — | — | current stack | 0 new | **Adopt (primary).** One renderer and one agents module for both views. The camera can fly between the exploded 3D view and the plan. Synced compare comes free through drei `View`. |
| deck.gl (`@deck.gl/core`, `layers`, `aggregation-layers`; TripsLayer lives in `geo-layers`) | MIT | 9.4.1 (2026-10-28) | push 2026-11-21 | core 1.6M · 14.8k | React via core is fine; `@deck.gl/react` peers also need `@deck.gl/widgets`; `geo-layers` peers need `extensions`, `mesh-layers` and `@loaders.gl/core` | core 213 + layers 56 + agg 29 + geo 224 | **Adapt the technique.** TripsLayer = per-vertex timestamps plus a time-window fade in the shader (`modules/geo-layers/src/trips-layer/`, three small files), which makes scrubbing backwards free. HeatmapLayer = Gaussian KDE on the GPU. It is plan B if writing shaders stalls, but it costs 4–7 packages and a second WebGL engine. |
| `pixi.js` + `@pixi/react` (+ `pixi-viewport`) | MIT | 8.23.0 (2026-11-11) + 8.0.5 (2025-12-01) + 7.0.2 (7.0.3 is too new) | `@pixi/react` last push 2026-01-16 | 2.0M / 121k / 217k | `@pixi/react` needs React ≥19 (good) | 276 | **Skip.** A third renderer with no gain over r3f. |
| `d3-zoom` | ISC | 3.0.1 (2026-11-03) | active | 56.7M · 535 | framework-free | 17 | **Fallback.** The smallest upgrade if `Plan2D.tsx` stays on Canvas 2D: smooth wheel and pinch, plus an animated zoom-to-floor. |
| `simpleheat` / `heatmap.js` | BSD-2 / none declared | 1.0.0 (2026-10-26) / 2.0.5 (2016) | heatmap.js **abandoned** | 75k / 96k | — | tiny | **Skip.** The simulator already gives a grid, so blur it and upload it as a texture. |

Implementation notes taken from the contract (`src/server/contract.ts`):
- `FrameMsg` has **no per-agent target exit, heading or speed**. Colouring trails by destination exit needs a contract field (for example `target: number[]`), or, for buffered runs, the exit can be inferred once each agent leaves. Heading and walk speed can be derived from consecutive frames.
- Trails: one `LineSegments` geometry over all agents with a per-vertex `t`, and `alpha = 1 - (now - t) / trailLength`; discard when `t > now`. At 600 agents × 1 Hz × 600 s that is about 360k vertices in a single draw call.
- Density: bin agents per floor into about 1 ft cells, apply a separable Gaussian blur, upload as an R32F `DataTexture`, then apply a colour ramp in the shader. JuPedSim Web shows the same Gaussian-kernel look.

## 3. Timeline scrubber (play, pause, speed) over a buffered run

| Candidate | Licence | Latest (date) | Activity | Weekly dl · ★ | Compatibility | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| Radix `Slider` (in `radix-ui` 1.8.1; standalone `@radix-ui/react-slider` 1.6.1) + a small requestAnimationFrame clock in zustand | MIT | 2026-10-12 | push 2026-10-14 | 58M · 19.5k | React ^19 | 10 | **Adopt.** Keyboard support (arrows, Page, Home/End) and `aria-valuetext` ("t = 123 s") built in. Find the frame index by binary search over the buffered ticks, then reuse `web/src/lib/interp.ts`. Draw event ticks (bottleneck onset, exits clearing) as an SVG overlay. |
| React Aria `Slider` | Apache-2.0 | 1.22.1 (2026-10-09) | push 2026-11-21 | 9.9M · 16k | React 19 | heavier | Alternative, if React Aria is chosen for the UI kit. |
| `@theatre/core` + `@theatre/studio` | Apache-2.0 + **AGPL-3.0-only** | 0.7.2 (2024-05-19) | last release 2024 | 41k / 24k | — | — | **Skip.** The studio is AGPL and the project is stale. |
| `@xzdarcy/react-timeline-editor` | MIT | 1.0.0 (2026-01-25) | — | 26k | React ≥18; pulls interactjs and react-virtualized | — | **Skip.** It is a keyframe editor, which is overkill here. |
| `animation-timeline-js` | MIT | 2.3.5 (2024-07-21) | stale | 748 | — | — | **Skip.** |

## 4. Before/after comparison (synced split or swipe)

| Candidate | Licence | Latest (date) → pin | Activity | Weekly dl · ★ | Compatibility | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| `react-compare-slider` | MIT | 4.0.0 (2026-03-20) | push 2026-10-31 | 216k · 386 | React ≥16.8 | 3 | **Adopt.** A swipe divider over any children, including `<canvas>`, with keyboard and screen-reader support. `onPositionChange` can drive a 3D scissor split. |
| drei `View` (installed) | MIT | — | — | — | — | 0 | **Adopt** for synced 3D split views in one WebGL context; copy the camera pose from one view to the other on change. |
| `react-resizable-panels` | MIT | 4.24.1 (2026-11-18) → **4.22.1** (2026-11-13) | push 2026-11-18 | 33.9M · 5.5k | React 18/19 | 46 | Optional: only if users must drag-resize the split. A CSS grid is enough otherwise. |
| `allotment` / `img-comparison-slider` | MIT | 1.20.6 / 8.0.7 | active | 554k / 65k | — | — | **Skip.** They duplicate the picks above, and the second is aimed at images. |

## 5. Accessible UI kit (Tailwind 4, dark and minimal)

| Candidate | Licence | Latest (date) → pin | Activity | Weekly dl · ★ | Compatibility | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| `radix-ui` (umbrella) | MIT | 1.8.1 (2026-10-12) | push 2026-10-14 | 29.8M · 19.5k | React ^19; style through `data-[state=…]:` variants | tree-shakes (Slider 10, Popover 20) | **Adopt.** ToggleGroup (segmented control), Popover, Tooltip, Switch, Dialog, Slider. Take the markup from shadcn's Radix variants (`shadcn` CLI 4.23.0, MIT, Tailwind 4 and React 19) and adapt it to the existing `cx` helper, so you don't need `class-variance-authority`, `clsx` or `tailwind-merge`. Use Tailwind keyframes for enter and exit animations. |
| `@base-ui/react` | MIT (MUI) | 1.9.0 (2026-10-09) | push 2026-11-21 | 32.3M · 11.5k | React ^19 | 163 (full) | Strong alternative; shadcn ships Base UI variants too. The old name `@base-ui-components/react` is **deprecated**. |
| `react-aria-components` + `tailwindcss-react-aria-components` | Apache-2.0 | 1.22.1 (2026-10-09) + 2.2.0 (2026-06-18) | push 2026-11-21 | 9.9M · 16k | React 19; the plugin requires Tailwind ^4 | 273 (full) | Alternative: the best accessibility and i18n, but the heaviest. |
| `@ark-ui/react` / `@headlessui/react` | MIT | 5.40.0 / 2.2.10 (2026-04-07) | active / slower | 1.5M / 10.3M | React ≥18 | — | **Skip.** Ark pulls 69 Zag packages. Headless UI has no slider, tooltip or segmented control. |
| `lucide-react` | ISC | 1.77.0 (2026-11-20) → **1.72.0** (2026-11-11) | push 2026-11-20 | 143.6M · 25.9k | React ^19 | under 1 per icon (tree-shaken) | **Adopt** for icons. |
| `motion` | MIT | 14.14.0 (2026-11-13) | push 2026-11-21 | 38.9M · 35k | React 18/19 | 63 (full) | Optional. Tailwind keyframes plus Radix `data-state` already handle popover and dialog transitions. |
| `leva` | MIT | 0.10.1 (2025-10-31) | — | 1.6M · 6.3k | React 19 | — | Dev-only tuning panel, not for the product UI. |

## 6. Small charts (sparklines, dot plots, area charts)

| Candidate | Licence | Latest (date) → pin | Activity | Weekly dl · ★ | Compatibility | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| `@visx/shape` + `@visx/scale` | MIT | 4.0.0 (2026-06-11) | push 2026-06-22 (slower, but v4 is new) | 11.8M · 21k | peers React ^18/^19; ships its own types | 10 + 17 | **Adopt.** `LinePath`, `AreaClosed` and `Circle` in plain SVG, the same approach as the current `Sparkline.tsx`. |
| `uplot` (+ `uplot-react`) | MIT | 1.6.32 (2025-03-14) + 1.2.4 | repo push 2026-11-21 | 1.1M · 10.7k | framework-free | 21 | Alternative for dense live time series (canvas). No dot plots. |
| `@observablehq/plot` | ISC | 0.6.19 (2026-11-05) | active | 1.4M · 5.4k | renders imperatively to the DOM | 124 (pulls all of d3) | **Skip.** Too heavy for small charts. |
| `recharts` | MIT | 3.11.0 (2026-11-17) → 3.10.1 | active | 71M · 27.7k | React 19 | 146 | **Skip.** Pulls Redux and is heavy for sparklines. |
| `@nivo/line` / `react-sparklines` / `@tremor/react` | MIT / MIT / Apache-2.0 | 0.99.0 (2025-05) / 1.7.0 (**2017, abandoned**) / 3.18.7 | — | — | Tremor **peers React ^18 only** | — | **Skip** all three. |

## Crowd-visualisation references (techniques to adapt)

| Reference | Licence | Activity | What to take |
|---|---|---|---|
| three.js `examples/webgl_instancing_morph.html` (r187) | MIT | in-tree | The core pattern for agents: one InstancedMesh, `mixer.setTime(t + offset[i])` then `setMorphAt(i)`. |
| deck.gl TripsLayer source | MIT | active | The time-window trail fade shader. |
| PedPy (`PedestrianDynamics/PedPy`, Python) | MIT | push 2026-11-07 | Classic and Voronoi density, N–t flow curves at exits, grid density and speed profiles. Port the formulas; N–t gives a ready area chart. |
| JuPedSim / JuPedSim Web (app.jupedsim.org) | Core **LGPL-3.0**; web app source not public (community repo MIT) | push 2026-11-20 | UX reference only: playback speed and the Gaussian-kernel density heatmap. Don't copy code. |
| Vadere (gitlab.lrz.de/vadere/vadere, Java) | **LGPL-3.0** | activity 2026-11-19 | Trajectories coloured by target. Technique only. |
| `chenjd/Render-Crowd-Of-Animated-Characters` (Unity) | MIT | 2024-12 · 1.8k★ | The animation-baker idea (bake skinned frames, play them back in the vertex shader). |
| InstancedMesh2 skinning demo | MIT | 2026 | A 3k-instance skinned crowd, if you need the conditional path. |
| `sharpen3d/openvat` (Blender VAT baker) | **GPL-3.0** | 2026-10 | Use it only as an offline tool. Never vendor its decoder code into the app. |
| `luis-herasme/instanced-skinned-mesh`, `GuestGD/threeSBML`, `mikelyndon/r3f-webgl-vertex-animation-textures`, `@threejs-kit/instanced-sprite-mesh` | **no licence declared** | 2024–2025 | Look only. Do not copy. |
| `srl-freiburg/pedsim_ros` (BSD-2), `LuluDavid/THREE.js-Crowd-Animation` (MIT), `yuka` (MIT) | — | last activity 2023 / 2020 / last npm release 2022 | **Stale.** Skip. |

## 3D agents: how to render about 600 walking humans in three 0.187

| Approach | Per-frame CPU | GPU | Look | Effort | Verdict |
|---|---|---|---|---|---|
| Capsule and head figures with a vertex-shader bob (`onBeforeCompile`, per-instance phase attribute) | matrices only | trivial | clean, model-like | low | **Far LOD and fallback.** |
| **Walk cycle baked into morph targets, played with `InstancedMesh.setMorphAt`** | writes 600 × (K+1) floats (K ≈ 16–24 keyframes) | loops over K influences per vertex | real walking people | medium | **Recommended.** Built into three with no dependency; shadows and depth work out of the box; `setColorAt` gives per-agent state and stress tint. |
| Instanced skinning (InstancedMesh2) | bone matrices per instance, then a texture upload (assuming a ~50-bone rig: 600 × 50 × 64 B ≈ 1.9 MB per frame) | normal skinning | best: crossfades between clips | medium | Conditional (see section 1). Caching poses per keyframe cuts the CPU cost. |
| Vertex animation textures with a custom shader | none | one texture fetch per vertex | same as morph | high: custom depth material and a bake pipeline | Overkill at 600; worth it at 5k or more. |

Recipe:
1. Load the GLB.
2. For each of the K frames of the walk, idle and wheelchair clips, pose the skeleton and read the skinned positions with `applyBoneTransform`.
3. Store those positions as absolute morph targets. With absolute targets, three sets the base influence to 1 − Σw, so blending two neighbouring frames (w and 1 − w) just works.
4. Advance each agent's phase as `phase += speed·dt / strideLength` so feet don't slide.
5. Map simulator states: moving and on_stair → walk; holding, waiting and deciding → idle; mobility profile → wheelchair clip.

### Models (all licences checked on the publisher's page)

| Asset | Licence | Contents | Use |
|---|---|---|---|
| Kenney **Mini Characters 2.0** (kenney.nl/assets/mini-characters, mirrored on OpenGameArt) | **CC0** | 20 low-poly characters × 32 animations, **including wheelchair**; 4 MB zip | **Adopt.** The wheelchair clips match the mobility profiles. Check the triangle and bone counts after download. |
| Quaternius **Universal Animation Library** | **CC0** | 120+ clips on a humanoid rig (GLB, FBX, Blend) | Adopt for extra clips (jog, crouch-walk under smoke). |
| Quaternius **Universal Base Characters** | **CC0** | 6 bodies, glTF, about 13k triangles on average | Adapt: decimate to about 2k triangles with `npx @gltf-transform/cli@4.5.1 simplify` (MIT, dev-time only) before instancing 600. |
| Mixamo characters and animations | Adobe terms, not an open licence | — | **Avoid.** |

Record the asset licences in the README next to the Libraries table.

## Recommended set (pin exactly)

| # | Package | Version | Published | Licence | Covers |
|---|---|---|---|---|---|
| 1 | `@react-three/postprocessing` | 3.2.2 | 2026-10-21 | MIT | AO, SMAA, outline, tone mapping |
| 2 | `postprocessing` | 6.39.6 | 2026-11-01 | Zlib | required peer of #1 |
| 3 | `radix-ui` | 1.8.1 | 2026-10-12 | MIT | segmented control, popover, tooltip, switch, dialog, timeline slider |
| 4 | `lucide-react` | 1.72.0 | 2026-11-11 | ISC | icons |
| 5 | `@visx/shape` | 4.0.0 | 2026-06-11 | MIT | sparklines, area charts, dot plots |
| 6 | `@visx/scale` | 4.0.0 | 2026-06-11 | MIT | chart scales |
| 7 | `react-compare-slider` | 4.0.0 | 2026-03-20 | MIT | before/after swipe |
| 8 | `@three.ez/instanced-mesh` | 0.3.16 | 2026-07-26 | MIT | **conditional**: only if the morph bake isn't enough |

```
npm install --save-exact @react-three/postprocessing@3.2.2 postprocessing@6.39.6 radix-ui@1.8.1 lucide-react@1.72.0 @visx/shape@4.0.0 @visx/scale@4.0.0 react-compare-slider@4.0.0
```

Before installing:
- **n8ao timing:** before 2026-11-23, add `"overrides": { "n8ao": "2.0.2" }`, or n8ao 2.1.0 (6 days old) is pulled in transitively. This is Arun's call.
- **Repo rules:** add every new package to the README Libraries table.
- **Verification:** run `npm run typecheck:web` and `npm test`, because TypeScript 7 and Vite 8 compatibility were not tested here.
- **Bundle size:** about 250 KB gzip on top of today's bundle, estimated from the full-package figures. Most of it is postprocessing and N8AO; measure it with `vite build`.

Needs no new package: drei `CameraControls`, `View`, `Lightformer`, `ContactShadows` and `Edges`; three's morph instancing, AgX/Neutral tone mapping and `RoomEnvironment`; the TripsLayer-style trail shader; the KDE density texture; the timeline clock.
