import { describe, expect, it } from "vitest";
import {
  RulesManifestSchema,
  rulesVersionOf,
  sourceFileHash,
  type RulesManifest,
} from "../evidence/rules-version";

const manifest = (): RulesManifest => ({
  schemaVersion: 1,
  files: [
    { path: "src/rules/index.ts", hash: sourceFileHash("export {};\n") },
    { path: "src/shared/canonical.ts", hash: sourceFileHash("// canonical\n") },
  ],
  dependencies: [
    { name: "@noble/hashes", version: "2.4.0" },
    { name: "zod", version: "4.6.7" },
  ],
});

describe("RULES_VERSION manifest", () => {
  it("hashes deterministically and changes with any source byte or dependency", () => {
    const v = rulesVersionOf(manifest());
    expect(v).toMatch(/^0x[0-9a-f]{64}$/);
    expect(rulesVersionOf(manifest())).toBe(v);
    const edited = manifest();
    edited.files[0]!.hash = sourceFileHash("export const x = 1;\n");
    expect(rulesVersionOf(edited)).not.toBe(v);
    const bumped = manifest();
    bumped.dependencies[1]!.version = "4.6.8";
    expect(rulesVersionOf(bumped)).not.toBe(v);
  });

  it("normalizes line endings so a Windows checkout gives the same version", () => {
    expect(sourceFileHash("a\r\nb\r\n")).toBe(sourceFileHash("a\nb\n"));
    expect(sourceFileHash("a\rb")).toBe(sourceFileHash("a\nb"));
  });

  it.each([
    ["an absolute path", (m: RulesManifest) => (m.files[0]!.path = "/home/me/src/rules/index.ts")],
    ["a parent segment", (m: RulesManifest) => (m.files[0]!.path = "src/../rules/index.ts")],
    ["a Windows path", (m: RulesManifest) => (m.files[0]!.path = "src\\rules\\index.ts")],
    ["unsorted files", (m: RulesManifest) => m.files.reverse()],
    ["a duplicate file", (m: RulesManifest) => (m.files[1]!.path = m.files[0]!.path)],
    ["unsorted dependencies", (m: RulesManifest) => m.dependencies.reverse()],
    ["a version range", (m: RulesManifest) => (m.dependencies[0]!.version = "^2.4.0")],
    ["no files", (m: RulesManifest) => (m.files = [])],
  ])("rejects %s", (_name, mutate) => {
    const m = manifest();
    mutate(m);
    expect(() => RulesManifestSchema.parse(m)).toThrow();
    expect(() => rulesVersionOf(m)).toThrow();
  });
});
