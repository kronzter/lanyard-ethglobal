import { describe, expect, it } from "vitest";
import {
  CanonicalError,
  canonicalBytes,
  canonicalHash,
  canonicalJson,
  keccak256,
  parseJsonStrict,
} from "../canonical";

describe("canonicalJson", () => {
  it("sorts object keys by UTF-16 code units (RFC 8785 §3.2.3 example)", () => {
    const value = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    // Check positions in the text: Object.keys would list integer-like keys ("1") first.
    const text = canonicalJson(value);
    const positions = ["\r", "1", "\u0080", "ö", "€", "😀", "דּ"].map((k) =>
      text.indexOf(`${JSON.stringify(k)}:`),
    );
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("encodes nested values with no whitespace and preserves array order", () => {
    expect(canonicalJson({ b: [3, 1, 2], a: { d: true, c: null }, e: "x" })).toBe(
      '{"a":{"c":null,"d":true},"b":[3,1,2],"e":"x"}',
    );
  });

  it("converts bigint, bytes and maps", () => {
    expect(canonicalJson({ block: 12345678901234567890n, zero: 0n })).toBe(
      '{"block":"12345678901234567890","zero":"0"}',
    );
    expect(canonicalJson(new Uint8Array([0xab, 0x01]))).toBe('"0xab01"');
    expect(
      canonicalJson(
        new Map([
          ["b", 2],
          ["a", 1],
        ]),
      ),
    ).toBe('[["a",1],["b",2]]');
  });

  it("omits undefined object properties", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  it("escapes strings like JSON and keeps non-ASCII as UTF-8", () => {
    expect(canonicalJson('é\n"\u0001')).toBe('"é\\n\\"\\u0001"');
    expect(new TextDecoder().decode(canonicalBytes("मुंबई"))).toBe('"मुंबई"');
  });

  it.each([
    ["a fraction", 1.5],
    ["an unsafe integer", 2 ** 53],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a negative bigint", -1n],
    ["a lone surrogate", "\ud800"],
    ["a Date", new Date(0)],
    ["a Set", new Set([1])],
    ["an undefined array element", [1, undefined]],
    ["a function", () => 1],
    [
      "a duplicate map key",
      new Map<unknown, number>([
        [1n, 1],
        ["1", 2],
      ]),
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalError);
  });

  it("rejects circular references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(/circular/);
  });

  it("allows the same object twice when it is not circular", () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});

describe("hashing", () => {
  it("matches published keccak256 vectors", () => {
    expect(keccak256(new Uint8Array())).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(keccak256(new TextEncoder().encode("abc"))).toBe(
      "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });

  it("hashes canonical bytes, so key order does not matter", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(canonicalHash({ a: 1 })).toBe(keccak256(new TextEncoder().encode('{"a":1}')));
  });
});

describe("parseJsonStrict", () => {
  it("parses and re-encodes canonically", () => {
    const text = ' { "b" : [1, "two", null, true], "a": {"c": -3} } ';
    expect(canonicalJson(parseJsonStrict(text))).toBe('{"a":{"c":-3},"b":[1,"two",null,true]}');
  });

  it("rejects duplicate keys that JSON.parse would silently accept", () => {
    expect(() => parseJsonStrict('{"score": 1, "score": 9}')).toThrow(/duplicate key/);
  });

  it("rejects fractions, exponents and unsafe integers", () => {
    expect(() => parseJsonStrict('{"a": 1.5}')).toThrow(/non-integer/);
    expect(() => parseJsonStrict("1e3")).toThrow(/non-integer/);
    expect(() => parseJsonStrict("9007199254740993")).toThrow(/safe integer/);
  });

  it("treats __proto__ as ordinary data", () => {
    const parsed = parseJsonStrict('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "{", '{"a" 1}', "[1,]", "tru", '"unterminated', "{} x", '"\u0001"']) {
      expect(() => parseJsonStrict(bad), bad).toThrow(CanonicalError);
    }
  });
});
