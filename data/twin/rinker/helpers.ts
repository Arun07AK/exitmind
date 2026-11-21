import type { Pt, SourceRef } from "../../../src/twin/schema.ts";

export const GRID_X = {
  A: 0, "A.8": 15, B: 20, C: 40, D: 60, "D.5": 70, E: 80, F: 100, G: 120, H: 140, I: 160, J: 180, K: 200,
  "K.5": 211 + 2 / 12, L: 223.5, M: 238.5,
} as const;
export const GRID_Y = { "1": 0, "2": 28, "3": 44, "3.4": 56 + 11 / 12, "3.5": 61, "4": 82, "4.2": 88 } as const;
export type GridCol = keyof typeof GRID_X;
export type GridRow = keyof typeof GRID_Y;

export const gx = (c: GridCol): number => GRID_X[c];
export const gy = (r: GridRow): number => GRID_Y[r];
export const g = (c: GridCol, r: GridRow): Pt => [GRID_X[c], GRID_Y[r]];
export const off = ([x, y]: Pt, dx: number, dy: number): Pt => [x + dx, y + dy];

export function rect(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export const src = (sheet: SourceRef["sheet"], basis: SourceRef["basis"] = "scaled", extra: Partial<SourceRef> = {}): SourceRef => ({ sheet, basis, ...extra });
