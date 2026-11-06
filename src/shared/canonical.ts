// Canonical JSON and hashing (plans/01-evidence-and-interfaces.md §2).
//
// RFC 8785 (JCS) with Lanyard's value rules:
//   - bigint      → unsigned base-10 string, no leading zeroes (negative bigints are rejected)
//   - Uint8Array  → lowercase 0x hex string
//   - Map         → array of [key, value] pairs sorted by the canonical encoding of the key
//   - number      → safe integers only (all Lanyard maths is integer); NaN/±Infinity/fractions rejected
//   - objects     → keys sorted by UTF-16 code units; `undefined` properties omitted
//   - strings     → must be well-formed UTF-16 (no lone surrogates)
// Addresses and hex strings are lowercased by the zod schemas at the boundary, not here:
// canonical encoding never rewrites string content.
// Hash = keccak256 of the canonical UTF-8 bytes. Pure: runs on Hermes, browser and Node.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Hex } from "./types/primitives";

export class CanonicalError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`canonical encoding at ${path || "$"}: ${reason}`);
    this.name = "CanonicalError";
  }
}

function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

const compareUtf16 = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function encode(value: unknown, path: string, stack: Set<object>): string {
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalError(path, "non-finite number");
      if (!Number.isSafeInteger(value)) throw new CanonicalError(path, `${value} is not a safe integer`);
      return String(value === 0 ? 0 : value);
    case "bigint":
      if (value < 0n) throw new CanonicalError(path, "negative bigint (only unsigned values are canonical)");
      return `"${value.toString(10)}"`;
    case "string":
      if (!isWellFormed(value)) throw new CanonicalError(path, "string contains a lone surrogate");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalError(path, `unsupported ${typeof value}`);
  }
  if (value === null) return "null";
  if (value instanceof Uint8Array) return `"0x${bytesToHex(value)}"`;
  if (stack.has(value)) throw new CanonicalError(path, "circular reference");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const elements: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i) || value[i] === undefined)
          throw new CanonicalError(`${path}[${i}]`, "missing or undefined array element");
        elements.push(encode(value[i], `${path}[${i}]`, stack));
      }
      return `[${elements.join(",")}]`;
    }
    if (value instanceof Map) {
      const entries = [...value.entries()].map(([k, v], i) => ({
        key: encode(k, `${path}<key ${i}>`, stack),
        value: encode(v, `${path}<${String(k)}>`, stack),
      }));
      entries.sort((a, b) => compareUtf16(a.key, b.key));
      for (let i = 1; i < entries.length; i++) {
        if (entries[i]!.key === entries[i - 1]!.key)
          throw new CanonicalError(path, `duplicate map key ${entries[i]!.key}`);
      }
      return `[${entries.map((e) => `[${e.key},${e.value}]`).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalError(path, `unsupported object type ${proto?.constructor?.name ?? "unknown"}`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort(compareUtf16);
    return `{${keys
      .map((k) => {
        if (!isWellFormed(k)) throw new CanonicalError(path, "key contains a lone surrogate");
        return `${JSON.stringify(k)}:${encode(record[k], `${path}.${k}`, stack)}`;
      })
      .join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

/** RFC 8785 canonical JSON text for `value` under Lanyard's value rules. */
export function canonicalJson(value: unknown): string {
  return encode(value, "", new Set());
}

/** Canonical UTF-8 bytes. */
export function canonicalBytes(value: unknown): Uint8Array {
  return utf8ToBytes(canonicalJson(value));
}

/** keccak256 of raw bytes as lowercase 0x hex. */
export function keccak256(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

/** keccak256 of the canonical bytes of `value`. */
export function canonicalHash(value: unknown): Hex {
  return keccak256(canonicalBytes(value));
}

/**
 * Strict JSON parser for evidence input: rejects duplicate object keys and any number that is
 * not a safe integer (where `JSON.parse` silently keeps the last duplicate or loses precision).
 * Objects are created so that a `__proto__` key is ordinary data.
 */
export function parseJsonStrict(text: string): unknown {
  let i = 0;
  const fail = (reason: string): never => {
    throw new CanonicalError(`offset ${i}`, reason);
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const parseString = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text.charCodeAt(i) < 0x20) fail("control character in string");
      i++;
    }
    if (text[i] !== '"') fail("unterminated string");
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const parseValue = (): unknown => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      const seen = new Set<string>();
      ws();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail("expected object key");
        const key = parseString();
        if (seen.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
        seen.add(key);
        ws();
        if (text[i] !== ":") fail("expected ':'");
        i++;
        Object.defineProperty(obj, key, {
          value: parseValue(),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") {
          i++;
          return obj;
        } else fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") {
          i++;
          return arr;
        } else fail("expected ',' or ']'");
      }
    }
    if (c === '"') return parseString();
    for (const [lit, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return v;
      }
    }
    const num = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (!num) return fail("unexpected token");
    i += num[0].length;
    if (num[2] !== undefined || num[3] !== undefined) fail(`non-integer number ${num[0]}`);
    const n = Number(num[0]);
    if (!Number.isSafeInteger(n)) fail(`${num[0]} is not a safe integer`);
    return n;
  };
  const value = parseValue();
  ws();
  if (i !== text.length) fail("trailing characters");
  return value;
}
