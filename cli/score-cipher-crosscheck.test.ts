// Independent check of the pinned score-cipher vectors with Node's own crypto (OpenSSL), not the
// noble libraries the app uses: X25519 agreement, HKDF-SHA256 and AES-256-GCM must agree on every
// sealed envelope. Lives under cli/ because src/shared may not import Node built-ins.
import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scoreAad } from "../src/shared/crypto/score-cipher";
import vectors from "../src/shared/test/vectors/score-cipher-vectors.json";
import type { CipherVectors } from "../src/shared/test/vectors/check-vectors";

const pinned = vectors as CipherVectors;
const buf = (h: string) => Buffer.from(h.slice(2), "hex");
// PKCS#8 / SPKI DER prefixes for raw X25519 keys (RFC 8410).
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

describe("score cipher vectors against Node's crypto", () => {
  it.each(pinned.seals.map((s) => [s.name, s] as const))("%s opens with OpenSSL", (_name, s) => {
    const env = buf(s.envelope);
    expect(env[0]).toBe(1);
    const ephemeralPub = env.subarray(1, 33);
    const nonce = env.subarray(33, 45);
    const body = env.subarray(45, env.length - 16);
    const tag = env.subarray(env.length - 16);
    const recipientPub = buf(s.recipientPublic);

    const privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_X25519, buf(s.recipientScalar)]),
      format: "der",
      type: "pkcs8",
    });
    const derivedPub = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12);
    expect(Buffer.from(derivedPub).equals(recipientPub)).toBe(true);

    const shared = diffieHellman({
      privateKey,
      publicKey: createPublicKey({
        key: Buffer.concat([SPKI_X25519, ephemeralPub]),
        format: "der",
        type: "spki",
      }),
    });
    const key = Buffer.from(
      hkdfSync("sha256", shared, Buffer.concat([ephemeralPub, recipientPub]), "lanyard/score-cipher/v1", 32),
    );
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(scoreAad(s.context)));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    expect(`0x${plain.toString("hex")}`).toBe(s.plaintext);
  });
});
