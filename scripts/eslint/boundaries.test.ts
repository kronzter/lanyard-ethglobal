import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const eslint = new ESLint({ cwd: root });

async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === "lanyard/boundaries").map((m) => m.message);
}

describe("lanyard/boundaries", () => {
  it("rejects a Track B module importing Track A code", async () => {
    const errors = await boundaryErrors(
      "src/rules/onDuty.ts",
      'import { x } from "@/ens/reader";\nexport { x };\n',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/trackB code must not import trackA/);
  });

  it("rejects Track A importing Track B through a relative path", async () => {
    const errors = await boundaryErrors(
      "src/venue/grid.ts",
      'import { x } from "../arkiv/writers";\nexport { x };\n',
    );
    expect(errors[0]).toMatch(/trackA code must not import trackB/);
  });

  it("allows the composition root to wire both tracks", async () => {
    const code =
      'import { a } from "@/ens/reader";\nimport { b } from "@/arkiv/writers";\nexport { a, b };\n';
    expect(await boundaryErrors("src/providers.ts", code)).toEqual([]);
  });

  it("allows any track to import src/shared", async () => {
    expect(
      await boundaryErrors("src/arkiv/writers.ts", 'import { l } from "@/shared/labels";\nexport { l };\n'),
    ).toEqual([]);
  });

  it("rejects src/shared importing a track or the shell", async () => {
    expect(
      await boundaryErrors("src/shared/labels.ts", 'import { r } from "../rules";\nexport { r };\n'),
    ).toHaveLength(1);
    expect(
      await boundaryErrors("src/shared/labels.ts", 'import { s } from "@/shell/WebOnly";\nexport { s };\n'),
    ).toHaveLength(1);
  });

  it("rejects Node built-ins and platform packages in runtime-pure code", async () => {
    expect(
      (await boundaryErrors("src/shared/hash.ts", 'import fs from "node:fs";\nexport { fs };\n'))[0],
    ).toMatch(/must run on Hermes/);
    expect(
      await boundaryErrors(
        "src/rules/core.ts",
        'import { Platform } from "react-native";\nexport { Platform };\n',
      ),
    ).toHaveLength(1);
    expect(
      await boundaryErrors("src/rules/core.ts", 'import c from "crypto";\nexport { c };\n'),
    ).toHaveLength(1);
  });

  it("rejects app code importing the Node-only CLI, even from the composition root", async () => {
    expect(
      await boundaryErrors(
        "app/organizer/index.tsx",
        'import { freeze } from "../../cli/freeze";\nexport { freeze };\n',
      ),
    ).toHaveLength(1);
    expect(
      await boundaryErrors("src/providers.ts", 'import { p } from "../cli/providers";\nexport { p };\n'),
    ).toHaveLength(1);
  });

  it("lets the CLI use Node built-ins", async () => {
    expect(await boundaryErrors("cli/index.ts", 'import fs from "node:fs";\nexport { fs };\n')).toEqual([]);
  });

  it("bans ne() and not() from the Arkiv SDK everywhere", async () => {
    const errors = await boundaryErrors(
      "src/arkiv/readers.ts",
      'import { eq, ne } from "@arkiv-network/sdk/query";\nexport { eq, ne };\n',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/rejects '!='/);
  });
});
