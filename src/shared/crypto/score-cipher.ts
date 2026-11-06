// Sealed judge scores (plans/01-evidence-and-interfaces.md §2, B4.2-R3; spike P0.6-S11).
//
// Suite `x25519-hkdf-sha256-aes-256-gcm`, envelope v1:
//   0x01 ‖ ephemeral X25519 public key (32) ‖ GCM nonce (12) ‖ ciphertext ‖ GCM tag (16)
// key = HKDF-SHA256(ikm = X25519(ephemeral, recipient), salt = ephemeralPub ‖ recipientPub,
//                   info = "lanyard/score-cipher/v1", 32 bytes)
// The associated data binds event, submission, judge, rubric and assignment, so a ciphertext
// copied onto another sheet fails authentication. Pure TypeScript over the audited noble
// libraries (Cure53, 2022/2024), so it runs unchanged on Node, in browsers and on Hermes.
import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "../canonical";
import type { Hex } from "../types/primitives";

export const ENVELOPE_VERSION = 0x01;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KEY_BYTES + NONCE_BYTES;
const INFO = utf8ToBytes("lanyard/score-cipher/v1");

export type ScoreCipherFailure = "malformed" | "unsupported-version" | "low-order" | "authentication";

/** A deterministic, per-record reason; freeze rejects that candidate without stopping. */
export class ScoreCipherError extends Error {
  constructor(
    readonly reason: ScoreCipherFailure,
    detail: string,
  ) {
    super(`score cipher: ${reason}: ${detail}`);
    this.name = "ScoreCipherError";
  }
}

/** The fields every sealed score is bound to (B4.2-R3). */
export type ScoreContext = {
  event: string;
  submission: Hex;
  judge: string;
  rubric: Hex;
  assignment: Hex;
};

/** Associated data: the canonical JSON bytes of the context. */
export const scoreAad = (ctx: ScoreContext): Uint8Array =>
  utf8ToBytes(
    canonicalJson({
      assignment: ctx.assignment.toLowerCase(),
      event: ctx.event,
      judge: ctx.judge,
      rubric: ctx.rubric.toLowerCase(),
      submission: ctx.submission.toLowerCase(),
    }),
  );

const fromHex = (h: Hex | Uint8Array): Uint8Array => (typeof h === "string" ? hexToBytes(h.slice(2)) : h);
const toHex = (b: Uint8Array): Hex => `0x${bytesToHex(b)}`;

function randomBytes(n: number): Uint8Array {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues !== "function")
    throw new Error("score cipher: no crypto.getRandomValues in this runtime");
  return source.getRandomValues(new Uint8Array(n));
}

function sharedKey(secret: Uint8Array, peer: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array) {
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secret, peer);
  } catch (e) {
    throw new ScoreCipherError("low-order", (e as Error).message);
  }
  if (shared.every((b) => b === 0)) throw new ScoreCipherError("low-order", "all-zero shared secret");
  return hkdf(sha256, shared, concatBytes(ephemeralPub, recipientPub), INFO, KEY_BYTES);
}

/** The X25519 public key for a 32-byte secret. */
export const scorePublicKey = (secret: Hex | Uint8Array): Hex => toHex(x25519.getPublicKey(fromHex(secret)));

/** A short, stable identifier for a public key: `x25519:` + 8 bytes of keccak256(pub). */
export const scoreKeyId = (publicKey: Hex): string =>
  `x25519:${bytesToHex(keccak_256(fromHex(publicKey))).slice(0, 16)}`;

/** True when the operator's secret belongs to the configured public key (freeze precondition). */
export const operatorKeyMatches = (secret: Hex | Uint8Array, publicKey: Hex): boolean =>
  scorePublicKey(secret) === publicKey.toLowerCase();

/** A fresh secret for a new event key. */
export const newScoreSecret = (): Hex => toHex(randomBytes(KEY_BYTES));

/**
 * Seal `plaintext` to `recipientPublicKey`. `deterministic` fixes the ephemeral secret and nonce
 * and exists only for pinned test vectors; real seals always use fresh randomness.
 */
export function sealScore(
  recipientPublicKey: Hex,
  plaintext: Uint8Array,
  aad: Uint8Array,
  deterministic?: { ephemeralSecret: Hex; nonce: Hex },
): Hex {
  const recipient = fromHex(recipientPublicKey);
  if (recipient.length !== KEY_BYTES)
    throw new ScoreCipherError("malformed", "recipient key must be 32 bytes");
  const ephemeralSecret = deterministic ? fromHex(deterministic.ephemeralSecret) : randomBytes(KEY_BYTES);
  const nonce = deterministic ? fromHex(deterministic.nonce) : randomBytes(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new ScoreCipherError("malformed", "nonce must be 12 bytes");
  const ephemeralPub = x25519.getPublicKey(ephemeralSecret);
  const key = sharedKey(ephemeralSecret, recipient, ephemeralPub, recipient);
  const sealed = gcm(key, nonce, aad).encrypt(plaintext);
  return toHex(concatBytes(new Uint8Array([ENVELOPE_VERSION]), ephemeralPub, nonce, sealed));
}

/** Open an envelope with the event secret. Throws `ScoreCipherError` with a fixed reason. */
export function openScore(secret: Hex | Uint8Array, envelope: Hex | Uint8Array, aad: Uint8Array): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromHex(envelope);
  } catch {
    throw new ScoreCipherError("malformed", "envelope is not hex");
  }
  if (bytes.length < HEADER_BYTES + TAG_BYTES) throw new ScoreCipherError("malformed", "envelope too short");
  if (bytes[0] !== ENVELOPE_VERSION) throw new ScoreCipherError("unsupported-version", `version ${bytes[0]}`);
  const ephemeralPub = bytes.subarray(1, 1 + KEY_BYTES);
  const nonce = bytes.subarray(1 + KEY_BYTES, HEADER_BYTES);
  const sealed = bytes.subarray(HEADER_BYTES);
  const sk = fromHex(secret);
  const key = sharedKey(sk, ephemeralPub, ephemeralPub, x25519.getPublicKey(sk));
  try {
    return gcm(key, nonce, aad).decrypt(sealed);
  } catch {
    throw new ScoreCipherError("authentication", "tag check failed (wrong key, context or tampered bytes)");
  }
}
