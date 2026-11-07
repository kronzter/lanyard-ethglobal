// A4.2-R4: SepoliaResultsPublisher is for the local freeze CLI only. No module under app/ or src/
// (other than the publisher and its own tests) may import it. The same holds for its Node-only
// durable file journal (I4), which imports node:fs.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SELF = /^src\/ens\/sepolia-results-publisher(\.[a-z]+)*\.ts$/;
const IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'][^"']*sepolia-results-publisher(?:\.ts|\.js)?["']/;
const JOURNAL_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'][^"']*sepolia-results-publisher\.journal(?:\.ts|\.js)?["']/;

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts)$/.test(e.name)) yield p;
  }
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const top of ["app", "src"])
    for (const f of files(join(ROOT, top))) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (SELF.test(rel)) continue;
      if (pattern.test(readFileSync(f, "utf8"))) found.push(rel);
    }
  return found;
}

describe("SepoliaResultsPublisher import boundary", () => {
  it("is imported by no app/ or src/ module", () => {
    expect(offenders(IMPORT)).toEqual([]);
  });

  it("keeps the durable file journal out of every app/ and src/ module too", () => {
    expect(offenders(JOURNAL_IMPORT)).toEqual([]);
  });

  it("recognises the import forms it guards against", () => {
    for (const line of [
      `import { SepoliaResultsPublisher } from "../ens/sepolia-results-publisher";`,
      `const m = await import("@/ens/sepolia-results-publisher.ts");`,
      `import "./sepolia-results-publisher";`,
    ])
      expect(IMPORT.test(line)).toBe(true);
    expect(IMPORT.test(`import { x } from "./sepolia-results-publisher-notes";`)).toBe(false);
    for (const line of [
      `import { fileJournal } from "../src/ens/sepolia-results-publisher.journal";`,
      `const m = await import("@/ens/sepolia-results-publisher.journal.ts");`,
      `require("./sepolia-results-publisher.journal.js");`,
    ])
      expect(JOURNAL_IMPORT.test(line)).toBe(true);
    expect(JOURNAL_IMPORT.test(`import { x } from "./sepolia-results-publisher.journal-notes";`)).toBe(false);
  });
});
