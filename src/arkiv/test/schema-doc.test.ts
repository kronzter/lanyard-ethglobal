import { readFileSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import { renderSchemaMarkdown } from "../schema-doc";

describe("arkiv/schema.md", () => {
  it("matches the kind definitions (run `pnpm arkiv:schema` after changing kinds.ts)", async () => {
    const file = path.resolve(import.meta.dirname, "../../../arkiv/schema.md");
    const options = (await resolveConfig(file)) ?? {};
    const expected = await format(renderSchemaMarkdown(), { ...options, filepath: file });
    expect(readFileSync(file, "utf8")).toBe(expected);
  });
});
