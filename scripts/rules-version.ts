#!/usr/bin/env node
// `pnpm rules:version`: recompute RULES_VERSION from the rules source manifest, write
// src/rules/version.generated.ts, and regenerate the signed cross-runtime vector bundle.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "../src/shared/canonical";
import { rulesVersionOf } from "../src/shared/evidence/rules-version";
import { ROOT, rulesManifest, VERSION_FILE, versionFileText } from "./rules-manifest";
import { buildRulesVector, RULES_VECTOR_FILE } from "./rules-vector";

void (async () => {
  const version = rulesVersionOf(await rulesManifest());
  writeFileSync(path.join(ROOT, VERSION_FILE), versionFileText(version), "utf8");
  const vector = await buildRulesVector(version);
  mkdirSync(path.dirname(path.join(ROOT, RULES_VECTOR_FILE)), { recursive: true });
  writeFileSync(path.join(ROOT, RULES_VECTOR_FILE), `${canonicalJson(vector)}\n`, "utf8");
  console.log(`RULES_VERSION ${version}\nwrote ${VERSION_FILE} and ${RULES_VECTOR_FILE}`);
})().catch((e: unknown) => {
  console.error(`rules:version: ${(e as Error).message}`);
  process.exit(1);
});
