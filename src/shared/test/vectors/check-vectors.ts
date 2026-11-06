// Runtime-neutral canonical-encoding vector check: the same code runs under vitest on Node, in a
// headless browser (scripts/vectors-browser.mjs) and later on Hermes (spike S11). Inputs are
// tagged JSON so bigints, bytes and maps survive the trip: {"$bigint": "…"}, {"$bytes": "0x…"},
// {"$map": [[key, value], …]}.
import { canonicalHash, canonicalJson } from "../../canonical";
import {
  openScore,
  scoreAad,
  ScoreCipherError,
  scorePublicKey,
  sealScore,
  type ScoreCipherFailure,
  type ScoreContext,
} from "../../crypto/score-cipher";
import type { Hex } from "../../types/primitives";

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

// Score-cipher vectors (spike S11): the same seals must come out byte for byte, open to the same
// plaintext, and every tampered case must fail with its pinned reason, in every runtime.
export type CipherSealVector = {
  name: string;
  recipientScalar: Hex;
  recipientPublic: Hex;
  ephemeralScalar: Hex;
  nonce: Hex;
  context: ScoreContext;
  plaintext: Hex;
  envelope: Hex;
};
export type CipherRejectVector = {
  name: string;
  envelope: Hex;
  context: ScoreContext;
  scalar: Hex;
  reason: ScoreCipherFailure;
};
export type CipherVectors = { suite: string; seals: CipherSealVector[]; rejects: CipherRejectVector[] };

const hexOf = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

/** Every mismatch between this runtime's cipher and the pinned vectors (empty when they agree). */
export function checkCipherVectors(v: CipherVectors): VectorFailure[] {
  const failures: VectorFailure[] = [];
  const fail = (name: string, field: VectorFailure["field"], expected: string, actual: string) =>
    failures.push({ name: `cipher: ${name}`, field, expected, actual });
  for (const s of v.seals) {
    try {
      if (scorePublicKey(s.recipientScalar) !== s.recipientPublic)
        fail(s.name, "canonical", s.recipientPublic, scorePublicKey(s.recipientScalar));
      const aad = scoreAad(s.context);
      const plaintext = decodeTagged({ $bytes: s.plaintext }) as Uint8Array;
      const sealed = sealScore(s.recipientPublic, plaintext, aad, {
        ephemeralSecret: s.ephemeralScalar,
        nonce: s.nonce,
      });
      if (sealed !== s.envelope) fail(s.name, "canonical", s.envelope, sealed);
      const opened = hexOf(openScore(s.recipientScalar, s.envelope, aad));
      if (opened !== s.plaintext) fail(s.name, "canonical", s.plaintext, opened);
    } catch (e) {
      fail(s.name, "error", "no error", String(e));
    }
  }
  for (const r of v.rejects) {
    try {
      openScore(r.scalar, r.envelope, scoreAad(r.context));
      fail(r.name, "error", `rejected: ${r.reason}`, "opened");
    } catch (e) {
      const reason = e instanceof ScoreCipherError ? e.reason : String(e);
      if (reason !== r.reason) fail(r.name, "error", r.reason, reason);
    }
  }
  return failures;
}
