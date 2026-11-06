#!/usr/bin/env node
// `pnpm rules:version`: recompute RULES_VERSION from the rules source manifest and write
// src/rules/version.generated.ts.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { rulesVersionOf } from "../src/shared/evidence/rules-version";
import { ROOT, rulesManifest, VERSION_FILE, versionFileText } from "./rules-manifest";

void (async () => {
  const version = rulesVersionOf(await rulesManifest());
  writeFileSync(path.join(ROOT, VERSION_FILE), versionFileText(version), "utf8");
  console.log(`RULES_VERSION ${version}\nwrote ${VERSION_FILE}`);
})().catch((e: unknown) => {
  console.error(`rules:version: ${(e as Error).message}`);
  process.exit(1);
});
