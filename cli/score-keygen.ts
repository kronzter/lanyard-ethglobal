// `lanyard score-keygen`: create the edition's score-encryption keypair (P0.6-S11).
// Prints only the public key and key ID, for src/shared/event.config.ts. Move the secret into the
// operator's .env as SCORE_DECRYPTION_KEY, then delete the file.
import { newScoreSecret, scoreKeyId, scorePublicKey } from "../src/shared/crypto/score-cipher";
import { eventConfig } from "../src/shared/event.config";
import { runKeygen, writeSecretOnce } from "./keygen";

export function scoreKeygen(root: string, edition = eventConfig.edition) {
  const secret = newScoreSecret();
  const file = writeSecretOnce(root, "score-key", edition, secret);
  const publicKey = scorePublicKey(secret);
  return { file, publicKey, keyId: scoreKeyId(publicKey) };
}

export const runScoreKeygen = (root: string): number =>
  runKeygen("score-keygen", () => {
    const { file, publicKey, keyId } = scoreKeygen(root);
    return [
      `score key written to ${file} (owner-only; not printed)`,
      `publicKey ${publicKey}`,
      `keyId     ${keyId}`,
      "Move the secret into .env as SCORE_DECRYPTION_KEY, then delete the file.",
    ];
  });
