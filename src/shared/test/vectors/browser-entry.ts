// Bundled by scripts/vectors-browser.mjs and run in a headless browser.
import { checkCipherVectors, checkVectors, type CanonicalVector, type CipherVectors } from "./check-vectors";
import vectors from "./canonical-vectors.json";
import cipherVectors from "./score-cipher-vectors.json";

const cipher = cipherVectors as CipherVectors;
const failures = [...checkVectors(vectors as CanonicalVector[]), ...checkCipherVectors(cipher)];
document.body.textContent = `VECTORS:${JSON.stringify({
  count: vectors.length,
  cipherCount: cipher.seals.length + cipher.rejects.length,
  failures,
  userAgent: navigator.userAgent,
})}:END`;
