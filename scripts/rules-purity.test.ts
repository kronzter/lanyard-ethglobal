// Backstop for the lint rules (B2.2-R6, bug hunt: grep src/rules for Date.now, Math.random, fetch
// and Node built-ins). Scans every non-test source file under src/rules.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../src/rules");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "test" ? [] : files(p);
    return p.endsWith(".ts") ? [p] : [];
  });

const BANNED = [
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bMath\.random\b/,
  /\bfetch\s*\(/,
  /\bset(Timeout|Interval|Immediate)\s*\(/,
  /\bperformance\./,
  /\bcrypto\.getRandomValues\b/,
  /from\s+["'](node:)?(fs|path|os|crypto|child_process|http|https|net|url|worker_threads)(\/[^"']*)?["']/,
  /\bprocess\./,
];

describe("src/rules purity", () => {
  it.each(files(ROOT).map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
    for (const re of BANNED) expect(text, `${re}`).not.toMatch(re);
  });
});
