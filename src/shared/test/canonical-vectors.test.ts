import { describe, expect, it } from "vitest";
import { checkVectors, decodeTagged, type CanonicalVector } from "./vectors/check-vectors";
import vectors from "./vectors/canonical-vectors.json";

const pinned = vectors as CanonicalVector[];

describe("canonical encoding vectors on Node", () => {
  it("match every pinned canonical text and keccak", () => {
    expect(pinned.length).toBeGreaterThanOrEqual(12);
    expect(checkVectors(pinned)).toEqual([]);
  });

  it("follow the RFC 8785 key-order example", () => {
    const rfc = pinned.find((v) => v.name === "RFC 8785 key order")!;
    const order = ["\r", "1", "\u0080", "ö", "€", "😀", "דּ"].map((k) =>
      rfc.canonical.indexOf(`${JSON.stringify(k)}:`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("report a mismatch instead of passing silently", () => {
    const broken = [{ ...pinned[0]!, canonical: '{"x":1}' }];
    expect(checkVectors(broken).map((f) => f.field)).toEqual(["canonical"]);
  });

  it("decode tagged bigints, bytes and maps", () => {
    expect(decodeTagged({ $bigint: "7" })).toBe(7n);
    expect(decodeTagged({ $bytes: "0x0aFF" })).toEqual(new Uint8Array([10, 255]));
    expect(decodeTagged({ $map: [["a", { $bigint: "1" }]] })).toEqual(new Map([["a", 1n]]));
  });
});
