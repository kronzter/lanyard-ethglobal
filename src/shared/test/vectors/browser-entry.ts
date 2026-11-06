// Bundled by scripts/vectors-browser.mjs and run in a headless browser.
import { checkVectors, type CanonicalVector } from "./check-vectors";
import vectors from "./canonical-vectors.json";

const failures = checkVectors(vectors as CanonicalVector[]);
document.body.textContent = `VECTORS:${JSON.stringify({ count: vectors.length, failures, userAgent: navigator.userAgent })}:END`;
