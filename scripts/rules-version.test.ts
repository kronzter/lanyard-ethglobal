// RULES_VERSION stays in step with the source (B2.3-R1).
// Run `pnpm rules:version` after changing anything the rules import.
import { describe, expect, it } from "vitest";
import { rulesVersionOf } from "../src/shared/evidence/rules-version";
import { RULES_VERSION } from "../src/rules";
import { rulesManifest } from "./rules-manifest";

describe("RULES_VERSION", () => {
  it("matches the current rules source manifest (run `pnpm rules:version`)", async () => {
    const manifest = await rulesManifest();
    expect(manifest.files.map((f) => f.path)).toContain("src/rules/engine.ts");
    expect(manifest.files.map((f) => f.path)).not.toContain("src/rules/version.generated.ts");
    expect(manifest.files.some((f) => f.path.includes("/test/"))).toBe(false);
    expect(RULES_VERSION).toBe(rulesVersionOf(manifest));
  });
});
