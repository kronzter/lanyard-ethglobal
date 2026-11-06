#!/usr/bin/env node
// Writes arkiv/schema.md from src/arkiv/kinds.ts (B1.2-R5). `pnpm arkiv:schema`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderSchemaMarkdown } from "../src/arkiv/schema-doc";

const file = path.resolve(import.meta.dirname, "..", "arkiv", "schema.md");
writeFileSync(file, renderSchemaMarkdown(), "utf8");
console.log(`wrote ${path.relative(process.cwd(), file)}`);
