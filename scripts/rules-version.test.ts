// RULES_VERSION and the rules vector stay in step with the source (B2.3-R1, R7).
// Run `pnpm rules:version` after changing anything the rules import.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, parseJsonStrict } from "../src/shared/canonical";
import { verifyEnvelope } from "../src/shared/evidence/bundle";
import { rulesVersionOf } from "../src/shared/evidence/rules-version";
import { eventConfig } from "../src/shared/event.config";
import { ENGINE, reproduce, RULES_VERSION } from "../src/rules";
import { ROOT, rulesManifest } from "./rules-manifest";
import { buildRulesVector, RULES_VECTOR_FILE } from "./rules-vector";

const vectorText = () => readFileSync(path.join(ROOT, RULES_VECTOR_FILE), "utf8");

describe("RULES_VERSION", () => {
  it("matches the current rules source manifest (run `pnpm rules:version`)", async () => {
    const manifest = await rulesManifest();
    expect(manifest.files.map((f) => f.path)).toContain("src/rules/engine.ts");
    expect(manifest.files.map((f) => f.path)).not.toContain("src/rules/version.generated.ts");
    expect(manifest.files.some((f) => f.path.includes("/test/"))).toBe(false);
    expect(RULES_VERSION).toBe(rulesVersionOf(manifest));
  });
});

describe("the rules vector bundle", () => {
  it("is exactly what the generator produces for this version", async () => {
    expect(vectorText()).toBe(`${canonicalJson(await buildRulesVector(RULES_VERSION))}\n`);
  });

  it("is signed by the configured results wallet and reproduces on Node", async () => {
    const envelope = parseJsonStrict(vectorText()) as Parameters<typeof verifyEnvelope>[0];
    const body = await verifyEnvelope(envelope, eventConfig.authorities.results);
    const r = reproduce(ENGINE, body);
    expect(r).toMatchObject({ match: true });
    expect(r.output.verdicts.map((v) => v.counts)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
  });
});
