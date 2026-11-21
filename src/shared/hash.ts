import { createHash } from "node:crypto";

export function canonicalJSON(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => {
          if (v === undefined) throw new TypeError(`undefined at ${path}[${i}]`);
          return encode(v, `${path}[${i}]`);
        }).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new TypeError(`non-plain object at ${path}`);
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`unsupported ${typeof value} at ${path}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
