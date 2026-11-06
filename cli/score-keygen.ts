// `lanyard score-keygen`: create the edition's score-encryption keypair (P0.6-S11).
// The secret is written once to a git-ignored, owner-only file and never printed; only the public
// key and key ID are printed, for src/shared/event.config.ts. Move the secret into the operator's
// .env as SCORE_DECRYPTION_KEY, then delete the file.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { newScoreSecret, scoreKeyId, scorePublicKey } from "../src/shared/crypto/score-cipher";
import { eventConfig } from "../src/shared/event.config";

export function scoreKeygen(root: string, edition = eventConfig.edition) {
  const dir = path.join(root, ".lanyard", "secrets");
  const file = path.join(dir, `score-key.${edition}.hex`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const secret = newScoreSecret();
  // "wx": refuse to overwrite an existing key; 0600: readable by its owner only.
  writeFileSync(file, `${secret}\n`, { flag: "wx", mode: 0o600 });
  const publicKey = scorePublicKey(secret);
  return { file: path.relative(root, file), publicKey, keyId: scoreKeyId(publicKey) };
}

export function runScoreKeygen(root: string): number {
  try {
    const { file, publicKey, keyId } = scoreKeygen(root);
    console.log(`score key written to ${file} (owner-only; not printed)`);
    console.log(`publicKey ${publicKey}`);
    console.log(`keyId     ${keyId}`);
    console.log("Move the secret into .env as SCORE_DECRYPTION_KEY, then delete the file.");
    return 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      console.error("lanyard score-keygen: a key already exists for this edition; refusing to overwrite it.");
      return 1;
    }
    throw e;
  }
}
