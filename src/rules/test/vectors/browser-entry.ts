// Bundled by scripts/vectors-browser.mjs after the shared vectors: re-runs the rules on the signed
// vector bundle in the browser and reports whether the recomputed output byte-matches Node's.
import { eventConfig } from "@/shared/event.config";
import { verifyEnvelope } from "@/shared/evidence/bundle";
import { ENGINE, reproduce, RULES_VERSION } from "@/rules";
import vector from "./rules-bundle.json";

const report = (r: object) => (document.body.textContent += ` RULES:${JSON.stringify(r)}:END`);

verifyEnvelope(vector as Parameters<typeof verifyEnvelope>[0], eventConfig.authorities.results)
  .then((body) => {
    const r = reproduce(ENGINE, body);
    report({
      match: r.match,
      outputHash: r.outputHash,
      ruleVersion: RULES_VERSION,
      records: body.records.length,
    });
  })
  .catch((e: unknown) => report({ match: false, error: (e as Error).message }));
