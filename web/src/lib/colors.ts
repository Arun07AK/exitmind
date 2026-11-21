import type { SignState } from "../../../src/server/contract.ts";

export const STATE_LABELS: Record<number, string> = {
  1: "pre-movement",
  2: "moving",
  3: "on stair",
  4: "holding",
  5: "sheltering",
  6: "waiting",
  7: "deciding",
  8: "refuge",
  9: "protected",
};

export const STATE_COLORS: Record<number, string> = {
  1: "#94a3b8",
  2: "#38bdf8",
  3: "#a78bfa",
  4: "#f59e0b",
  5: "#f472b6",
  6: "#fbbf24",
  7: "#e879f9",
  8: "#34d399",
  9: "#10b981",
};

export const PERSONA_COLOR = "#ffffff";
export const PROTECTED = 9;

export const stateColor = (s: number): string => STATE_COLORS[s] ?? "#cbd5e1";

export const ARROW_ROT: Record<string, number> = { AHEAD: 0, RIGHT: 90, DOWN_RIGHT: 135, BACK: 180, DOWN_LEFT: 225, LEFT: 270 };
export const ARROW_GLYPH: Record<string, string> = { AHEAD: "\u2191", RIGHT: "\u2192", DOWN_RIGHT: "\u2198", BACK: "\u2193", DOWN_LEFT: "\u2199", LEFT: "\u2190" };

export const SIGN_COLORS: Record<SignState["kind"], string> = {
  ARROW: "#16a34a",
  X_ALT: "#dc2626",
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
  if (s.kind === "X_ALT") return `\u2715${ARROW_GLYPH[s.alt.dir] ?? ""}`;
  return s.kind === "HOLD" ? "H" : "L";
}
