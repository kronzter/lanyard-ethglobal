import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const A = ["@kronzter"];
const B = ["@arnavmahajan630"];
const BOTH = ["@kronzter", "@arnavmahajan630"];

type Rule = { pattern: string; owners: string[] };
const rules: Rule[] = readFileSync(path.join(root, ".github/CODEOWNERS"), "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*$/, "").trim())
  .filter(Boolean)
  .map((l) => {
    const [pattern = "", ...owners] = l.split(/\s+/);
    return { pattern, owners };
  });

// The subset of GitHub CODEOWNERS semantics this file uses: `*`, anchored files, anchored dirs.
function matches(pattern: string, file: string): boolean {
  if (pattern === "*") return true;
  const p = pattern.replace(/^\//, "");
  return p.endsWith("/") ? file.startsWith(p) : file === p || file.startsWith(`${p}/`);
}
const ownersOf = (file: string) => rules.filter((r) => matches(r.pattern, file)).at(-1)?.owners ?? [];

// One representative path per row of plans/00-README.md › Ownership of paths.
const table: [string, string[]][] = [
  ["src/shared/labels.ts", BOTH],
  ["fixtures/personas.json", BOTH],
  ["app/_layout.tsx", BOTH],
  ["src/shell/WebOnly.tsx", BOTH],
  ["src/flags.ts", BOTH],
  ["src/providers.ts", BOTH],
  ["app.json", BOTH],
  ["eas.json", BOTH],
  ["package.json", BOTH],
  ["README.md", BOTH],
  ["contracts/foundry.toml", BOTH],
  ["contracts/src/ens/LanyardRegistrar.sol", A],
  ["contracts/test/ens/LanyardRegistrar.t.sol", A],
  ["src/ens/sepoliaEnsReader.ts", A],
  ["src/venue/gridRouter.ts", A],
  ["src/components/venue/VenueMap.tsx", A],
  ["app/admin/ens/index.tsx", A],
  ["app/venue/editor.tsx", A],
  ["src/arkiv/writers.ts", B],
  ["contracts/src/faucet/Faucet.sol", B],
  ["src/rules/onDuty.ts", B],
  ["cli/index.ts", B],
  ["arkiv/friction.md", B],
  ...["volunteer", "lead", "tickets", "judge", "team", "teams", "organizer"].map(
    (r) => [`app/${r}/index.tsx`, B] as [string, string[]],
  ),
  ["deployments/sepolia.json", A],
  ["deployments/rabdi.json", B],
  ["plans/TRACKER.md", BOTH],
  ["plans/B1-arkiv-data.md", BOTH],
  ["e2e/i1.test.ts", BOTH],
];

describe("CODEOWNERS", () => {
  it.each(table)("%s is owned as in the ownership table", (file, owners) => {
    expect(ownersOf(file)).toEqual(owners);
  });

  it("gives every rule at least one owner", () => {
    for (const r of rules) expect(r.owners.length, r.pattern).toBeGreaterThan(0);
  });

  it("leaves no tracked file unowned", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(files.filter((f) => ownersOf(f).length === 0)).toEqual([]);
  });
});
