// Runtime-neutral canonical-encoding vector check: the same code runs under vitest on Node, in a
// headless browser (scripts/vectors-browser.mjs) and later on Hermes (spike S11). Inputs are
// tagged JSON so bigints, bytes and maps survive the trip: {"$bigint": "…"}, {"$bytes": "0x…"},
// {"$map": [[key, value], …]}.
import { canonicalHash, canonicalJson } from "../../canonical";

export type CanonicalVector = { name: string; input: unknown; canonical: string; keccak: string };
export type VectorFailure = {
  name: string;
  field: "canonical" | "keccak" | "error";
  expected: string;
  actual: string;
};

export function decodeTagged(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeTagged);
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && keys[0] === "$bigint") return BigInt(o.$bigint as string);
  if (keys.length === 1 && keys[0] === "$bytes") {
    const hex = (o.$bytes as string).slice(2);
    return new Uint8Array(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
  }
  if (keys.length === 1 && keys[0] === "$map") {
    return new Map((o.$map as [unknown, unknown][]).map(([k, val]) => [decodeTagged(k), decodeTagged(val)]));
  }
  return Object.fromEntries(keys.map((k) => [k, decodeTagged(o[k])]));
}

/** Every mismatch between this runtime's encoding and the pinned vectors (empty when they agree). */
export function checkVectors(vectors: CanonicalVector[]): VectorFailure[] {
  const failures: VectorFailure[] = [];
  for (const v of vectors) {
    try {
      const value = decodeTagged(v.input);
      const canonical = canonicalJson(value);
      if (canonical !== v.canonical)
        failures.push({ name: v.name, field: "canonical", expected: v.canonical, actual: canonical });
      const hash = canonicalHash(value);
      if (hash !== v.keccak)
        failures.push({ name: v.name, field: "keccak", expected: v.keccak, actual: hash });
    } catch (e) {
      failures.push({ name: v.name, field: "error", expected: "no error", actual: String(e) });
    }
  }
  return failures;
}
