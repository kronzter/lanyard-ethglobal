#!/usr/bin/env node
// Usage: node scripts/secret-scan/cli.mjs --staged   (pre-commit: scans the index)
//        node scripts/secret-scan/cli.mjs --all      (CI: scans every tracked file)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseAllowlist, redact, scanPath, scanText } from "./scan.mjs";

const mode = process.argv[2];
if (mode !== "--staged" && mode !== "--all") {
  console.error("usage: secret-scan --staged | --all");
  process.exit(2);
}

const git = (args, opts = {}) => execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024, ...opts });
const root = git(["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const allowFile = path.join(root, ".secretscan-allow");
const allow = existsSync(allowFile) ? parseAllowlist(readFileSync(allowFile, "utf8")) : new Set();

const list = (args) => git(args, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);

const files =
  mode === "--staged"
    ? list(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    : list(["ls-files", "-z"]);

const findings = [];
for (const file of files) {
  findings.push(...scanPath(file));
  let content;
  if (mode === "--staged") {
    content = git(["show", `:${file}`], { cwd: root });
  } else {
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    content = readFileSync(abs);
  }
  findings.push(...scanText(file, content.toString("utf8"), allow));
}

if (findings.length > 0) {
  console.error(`secret-scan: ${findings.length} finding(s); commit rejected.\n`);
  for (const f of findings) {
    console.error(`  ${f.path}${f.line ? `:${f.line}` : ""}  ${f.rule}  ${redact(f.value)}`);
  }
  console.error(
    "\nNever commit keys or mnemonics (plans/00-git-workflow.md). If this is public test material,\n" +
      "add it to .secretscan-allow, or mark the line with `secret-scan: allow`.",
  );
  process.exit(1);
}
console.log(`secret-scan: ${files.length} file(s) clean.`);
