export const ST = { PREMOVE: 1, MOVING: 2, ON_STAIR: 3, HOLDING: 4, SHELTERING: 5, WAITING: 6, DECIDING: 7, REFUGE: 8, PROTECTED: 9 } as const;
export const ST_NAMES = ["", "premove", "moving", "on_stair", "holding", "sheltering", "waiting", "deciding", "refuge", "protected"] as const;
export const INSTR = { NONE: 0, ROUTE: 1, HOLD: 2, LOCKDOWN: 3, COMPARTMENT: 4 } as const;
export const POLICY = { RULE: 0, DISTILLED: 1, LLM: 2 } as const;
export const T_LOCK = -2;
export const compTarget = (zi: number): number => -3 - zi;
