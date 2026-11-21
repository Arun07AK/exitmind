export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;
export const IN_PER_FT = 12;
export const SQM_PER_SQFT = M_PER_FT * M_PER_FT;

export const ftToM = (ft: number): number => ft * M_PER_FT;
export const inToM = (inches: number): number => inches * M_PER_IN;
export const mToFt = (m: number): number => m / M_PER_FT;
export const mToIn = (m: number): number => m / M_PER_IN;
export const sqftToSqm = (sqft: number): number => sqft * SQM_PER_SQFT;
export const sqmToSqft = (sqm: number): number => sqm / SQM_PER_SQFT;

export function ftIn(feet: number, inches = 0): number {
  return feet + inches / IN_PER_FT;
}

export function secToTicks(sec: number, dtSec: number): number {
  return Math.round(sec / dtSec);
}

export function ticksToSec(ticks: number, dtSec: number): number {
  return ticks * dtSec;
}
