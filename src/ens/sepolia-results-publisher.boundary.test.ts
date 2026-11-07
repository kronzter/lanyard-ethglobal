// A4.2-R4: SepoliaResultsPublisher is for the local freeze CLI only. No module under app/ or src/
// (other than the publisher and its own tests) may import it.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SELF = /^src\/ens\/sepolia-results-publisher(\.[a-z]+)*\.ts$/;
const IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'][^"']*sepolia-results-publisher(?:\.ts|\.js)?["']/;

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts)$/.test(e.name)) yield p;
  }
}

describe("SepoliaResultsPublisher import boundary", () => {
  it("is imported by no app/ or src/ module", () => {
    const offenders: string[] = [];
    for (const top of ["app", "src"])
      for (const f of files(join(ROOT, top))) {
        const rel = relative(ROOT, f).replace(/\\/g, "/");
        if (SELF.test(rel)) continue;
        if (IMPORT.test(readFileSync(f, "utf8"))) offenders.push(rel);
      }
    expect(offenders).toEqual([]);
  });

  it("recognises the import forms it guards against", () => {
    for (const line of [
      `import { SepoliaResultsPublisher } from "../ens/sepolia-results-publisher";`,
      `const m = await import("@/ens/sepolia-results-publisher.ts");`,
      `import "./sepolia-results-publisher";`,
    ])
      expect(IMPORT.test(line)).toBe(true);
    expect(IMPORT.test(`import { x } from "./sepolia-results-publisher-notes";`)).toBe(false);
  });
});
