import { describe, expect, it } from "vitest";
import { SCORE_CIPHER_SUITE } from "../config/schema";
import {
  ENVELOPE_VERSION,
  newScoreSecret,
  openScore,
  operatorKeyMatches,
  scoreAad,
  ScoreCipherError,
  scoreKeyId,
  scorePublicKey,
  sealScore,
  type ScoreContext,
} from "../crypto/score-cipher";
import type { Hex } from "../types/primitives";
import { checkCipherVectors, type CipherVectors } from "./vectors/check-vectors";
import vectors from "./vectors/score-cipher-vectors.json";

const pinned = vectors as CipherVectors;
const ctx: ScoreContext = {
  event: "mumbai2026",
  submission: `0x${"5".repeat(64)}`,
  judge: "ana.judges.arkiv.partners",
  rubric: `0x${"7".repeat(64)}`,
  assignment: `0x${"9".repeat(64)}`,
};
const text = (s: string) => new TextEncoder().encode(s);
const reasonOf = (f: () => unknown) => {
  try {
    f();
    return "opened";
  } catch (e) {
    return e instanceof ScoreCipherError ? e.reason : `other: ${String(e)}`;
  }
};

describe("score cipher vectors on Node", () => {
  it("pin the configured suite", () => {
    expect(pinned.suite).toBe(SCORE_CIPHER_SUITE);
  });

  it("reproduce every seal byte for byte and reject every tampered case with its reason", () => {
    expect(pinned.seals.length).toBeGreaterThanOrEqual(3);
    expect(pinned.rejects.length).toBeGreaterThanOrEqual(10);
    expect(checkCipherVectors(pinned)).toEqual([]);
  });

  it("report a mismatch instead of passing silently", () => {
    const broken = {
      ...pinned,
      seals: [{ ...pinned.seals[0]!, nonce: `0x${"00".repeat(12)}` as Hex }],
      rejects: [],
    };
    expect(checkCipherVectors(broken).length).toBeGreaterThan(0);
  });
});

describe("score cipher", () => {
  const secret = newScoreSecret();
  const pub = scorePublicKey(secret);

  it("round-trips with fresh randomness, and two seals of the same score differ", () => {
    const a = sealScore(pub, text('{"impact":750}'), scoreAad(ctx));
    const b = sealScore(pub, text('{"impact":750}'), scoreAad(ctx));
    expect(a).not.toBe(b);
    expect(new TextDecoder().decode(openScore(secret, a, scoreAad(ctx)))).toBe('{"impact":750}');
    expect(parseInt(a.slice(2, 4), 16)).toBe(ENVELOPE_VERSION);
  });

  it("binds the whole context: any changed field fails authentication", () => {
    const env = sealScore(pub, text("x"), scoreAad(ctx));
    for (const changed of [
      { ...ctx, event: "other" },
      { ...ctx, judge: "ben.judges.arkiv.partners" },
      { ...ctx, submission: `0x${"6".repeat(64)}` as Hex },
      { ...ctx, rubric: `0x${"8".repeat(64)}` as Hex },
      { ...ctx, assignment: `0x${"a".repeat(64)}` as Hex },
    ]) {
      expect(reasonOf(() => openScore(secret, env, scoreAad(changed)))).toBe("authentication");
    }
  });

  it("treats key and address case as the same context", () => {
    const env = sealScore(pub, text("x"), scoreAad(ctx));
    const upper = { ...ctx, submission: ctx.submission.toUpperCase().replace("0X", "0x") as Hex };
    expect(reasonOf(() => openScore(secret, env, scoreAad(upper)))).toBe("opened");
  });

  it("fails authentication for the wrong secret and reports malformed input", () => {
    const env = sealScore(pub, text("x"), scoreAad(ctx));
    expect(reasonOf(() => openScore(newScoreSecret(), env, scoreAad(ctx)))).toBe("authentication");
    expect(reasonOf(() => openScore(secret, "0x01", scoreAad(ctx)))).toBe("malformed");
    expect(reasonOf(() => openScore(secret, "0xzz" as Hex, scoreAad(ctx)))).toBe("malformed");
  });

  it("checks that the operator key matches the configured public key", () => {
    expect(operatorKeyMatches(secret, pub)).toBe(true);
    expect(operatorKeyMatches(secret, pub.toUpperCase().replace("0X", "0x") as Hex)).toBe(true);
    expect(operatorKeyMatches(newScoreSecret(), pub)).toBe(false);
  });

  it("derives a short stable key ID", () => {
    expect(scoreKeyId(pub)).toMatch(/^x25519:[0-9a-f]{16}$/);
    expect(scoreKeyId(pub)).toBe(scoreKeyId(pub));
    expect(scoreKeyId(scorePublicKey(newScoreSecret()))).not.toBe(scoreKeyId(pub));
  });
});
