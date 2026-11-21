export const EVENT_ID_RE = /^E\d{6,}$/;

export function eventId(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`bad event seq ${seq}`);
  return `E${String(seq).padStart(6, "0")}`;
}

export function eventSeq(id: string): number {
  if (!EVENT_ID_RE.test(id)) throw new RangeError(`bad event id ${id}`);
  return Number(id.slice(1));
}
