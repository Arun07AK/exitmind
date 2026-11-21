import { describe, expect, it } from "vitest";
import { canonicalJSON, sha256Hex } from "../../src/shared/hash.ts";

describe("canonicalJSON", () => {
  it("is independent of key order, at every depth", () => {
    expect(canonicalJSON({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } })).toBe(canonicalJSON({ a: { c: "x", d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("omits undefined properties like JSON does", () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects values that do not round-trip through JSON", () => {
    expect(() => canonicalJSON({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJSON([1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
    expect(() => canonicalJSON([1, undefined])).toThrow(/undefined/);
    expect(() => canonicalJSON({ d: new Date(0) })).toThrow(/non-plain/);
    expect(() => canonicalJSON({ f: () => 1 })).toThrow(/unsupported/);
    expect(() => canonicalJSON({ n: 1n })).toThrow(/unsupported/);
  });
});

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
