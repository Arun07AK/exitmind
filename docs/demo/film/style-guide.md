# Style guide: EXITMIND in 60 seconds

## Reference analysis
Reference: the team's own evaluation-round deck (refs/, 10 slides), measured by `studio ref`.
Palette (by area): cream #F1EDE5 59%, warm grey #DAD7D3 11%, ink #111416 9%; accents signal red #DE7152 / #E2432A, persona purple #7E5ECC, green #48A781 / #177C57.
Typography: condensed uppercase display (Barlow Condensed 600 in the deck; this film uses the installed DIN Condensed Bold, the same class: narrow, tall, technical); IBM Plex Sans for labels; IBM Plex Mono for every number.
Composition: eye goes to the upper-left headline first, then to the figure on the right; generous margins.
Pacing: stills only in the reference; the film sets its own: a meaningful change every 1-2.5 s (fast-paced, 60 s).
Motion: implied by the deck: hard cuts between ideas, figures that build in steps, no decorative motion.
Texture: flat, clean; no grain, no gradients except a functional dark scrim over footage.
Do not copy: slide layouts, slide copy or photos; take palette, type class and restraint.

## Film language
- The real app is the hero. Footage runs full-bleed or as a lifted panel at native pixel size (1:1, never upscaled past 1.5x).
- Night stage: ink #0E1013 behind lifted panels, with the same footage blurred and darkened behind them so the viewer never leaves the app.
- Type sits left on a scrim; panels sit right. Labels are short, uppercase, condensed; numbers are mono.
- Red marks danger and the thing to look at (highlight boxes, the blocked stamp); green marks what passed or improved; purple marks the crowd brain.

## Motion rules (one rule per class of object; the tokens below are the numbers)
micro     chips and underlines snap in, almost no overshoot
panel     lifted panels and footage frames slide 60-90 px and settle fast
headline  condensed headlines arrive fast, then hold long enough to read
accent    highlight boxes and the BLOCKED stamp: the only overshoot in the film
camera    pushes on footage are slow and short; never more than 1.5x
cut       footage jumps between moments of a take are hard cuts on a word

## Banned in this film
Glowing brains, particles, gradient blobs, typewriter captions of the narration, a centred title on a gradient, everything fading in, footage zoomed past 1.5x, any screen that is not the app.

## Tokens
```json
{
  "fps": 30,
  "seed": 7,
  "palette": {"paper": "#0E1013", "ink": "#F2EEE6", "accent": "#E2432A", "cool": "#7E5ECC", "muted": "#9AA0A8", "green": "#39C18B", "card": "#FFFFFF", "scrim": "#0E1013"},
  "fonts": {"display": "DIN Condensed", "label": "IBM Plex Sans", "mono": "IBM Plex Mono"},
  "type": {"min_px": {"16:9": 34}},
  "motion": {
    "micro": {"w": 34, "z": 0.9},
    "panel": {"w": 18, "z": 0.95},
    "headline": {"w": 26, "z": 0.8},
    "accent": {"w": 18, "z": 0.45},
    "camera": {"ease": "smoother", "dur": 1.4},
    "cut": {"ease": "step"}
  },
  "pacing": {"max_static_s": 1.8},
  "sound": {"bpm": 112, "key": "D", "music_db": -17}
}
```
