import type { SignState } from "../../../src/server/contract.ts";

export const STATE_LABELS: Record<number, string> = {
  1: "not yet moving",
  2: "moving",
  3: "on stairs",
  4: "holding",
  5: "sheltering",
  6: "queuing",
  7: "deciding",
  8: "in refuge",
  9: "out",
};

/** Light-theme occupant colours; red is reserved for "in dense smoke" and is applied by the views. */
export const STATE_COLORS: Record<number, string> = {
  1: "#b4bbc6",
  2: "#1f2530",
  3: "#5b6b8c",
  4: "#f59e0b",
  5: "#0f766e",
  6: "#f59e0b",
  7: "#1f2530",
  8: "#0f766e",
  9: "#22c55e",
};

export const IN_SMOKE = "#e5372b";
export const PERSONA_COLOR = "#7c3aed";
export const PROTECTED = 9;
/** smoke level (0..255) above which an occupant counts as "in dense smoke" */
export const DENSE_SMOKE = 128;

export const stateColor = (s: number): string => STATE_COLORS[s] ?? "#1f2530";

/** Exit identity colours avoid green, amber and red, which belong to safety states. */
const EXIT_FIXED: Record<string, string> = { "EX-N": "#0891b2", "EX-W": "#7c3aed", "EX-S": "#db2777", "EX-E1": "#2563eb", "EX-E2": "#8b6b3e" };
const STAIR_FIXED: Record<string, string> = { "ST-A": "#22a6c8", "ST-ATR": "#9b6bf0", "ST-B": "#e4579a", ELEVATOR: "#94a3b8" };
const SPARE = ["#0e7490", "#9333ea", "#be185d", "#1d4ed8", "#a16207", "#0369a1", "#6d28d9"];
const assigned = new Map<string, string>();

export function elementColor(id: string | null | undefined): string {
  if (!id) return "#94a3b8";
  const fixed = EXIT_FIXED[id] ?? STAIR_FIXED[id.split("@")[0]!];
  if (fixed) return fixed;
  let c = assigned.get(id);
  if (!c) assigned.set(id, (c = SPARE[assigned.size % SPARE.length]!));
  return c;
}

/** Density ramp 0..1 → RGBA, yellow → orange → red → magenta. */
export function densityRamp(v: number): [number, number, number, number] {
  if (v <= 0) return [0, 0, 0, 0];
  const stops: [number, [number, number, number]][] = [[0, [250, 204, 21]], [0.35, [249, 115, 22]], [0.7, [239, 68, 68]], [1, [190, 24, 93]]];
  const t = Math.min(1, v);
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!, [t0, c0] = stops[i - 1]!;
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [Math.round(c0[0] + (c1[0] - c0[0]) * u), Math.round(c0[1] + (c1[1] - c0[1]) * u), Math.round(c0[2] + (c1[2] - c0[2]) * u), Math.round(90 + 130 * t)];
    }
  }
  return [190, 24, 93, 220];
}

export const ARROW_ROT: Record<string, number> = { AHEAD: 0, RIGHT: 90, DOWN_RIGHT: 135, BACK: 180, DOWN_LEFT: 225, LEFT: 270 };
export const ARROW_GLYPH: Record<string, string> = { AHEAD: "↑", RIGHT: "→", DOWN_RIGHT: "↘", BACK: "↓", DOWN_LEFT: "↙", LEFT: "←" };

export const SIGN_COLORS: Record<SignState["kind"], string> = {
  ARROW: "#15803d",
  X_ALT: "#d92d20",
  HOLD: "#f59e0b",
  LOCKDOWN: "#4c1d95",
  STATIC_DEFAULT: "#166534",
};

export function signText(s: SignState | null): string {
  if (!s) return "none";
  switch (s.kind) {
    case "ARROW":
      return `${ARROW_GLYPH[s.arrow.dir] ?? ""} ${s.arrow.label}`;
    case "X_ALT":
      return `X ${s.blocked} / ${ARROW_GLYPH[s.alt.dir] ?? ""} ${s.alt.label}`;
    case "HOLD":
      return "HOLD";
    case "LOCKDOWN":
      return "LOCKDOWN";
    case "STATIC_DEFAULT":
      return `${ARROW_GLYPH[s.arrow.dir] ?? ""} ${s.arrow.label} (static)`;
  }
}

export function signGlyph(s: SignState | null): string {
  if (!s) return "";
  if (s.kind === "ARROW" || s.kind === "STATIC_DEFAULT") return ARROW_GLYPH[s.arrow.dir] ?? "";
  if (s.kind === "X_ALT") return `✕${ARROW_GLYPH[s.alt.dir] ?? ""}`;
  return s.kind === "HOLD" ? "H" : "L";
}
