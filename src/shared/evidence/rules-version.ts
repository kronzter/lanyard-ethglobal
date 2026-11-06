// RULES_VERSION (plans/01-evidence-and-interfaces.md §2): the hash of a reproducible manifest of
// the rules source and everything it runs with. Each file entry is a repo-relative path and the
// keccak256 of its LF-normalized bytes; dependencies are the resolved runtime versions from the
// lockfile. Build output, absolute paths and timestamps never appear. Reading files from disk is
// the CLI's job (B2.3); this module only defines and hashes the manifest.
import { z } from "zod";
import { canonicalHash, keccak256 } from "../canonical";
import { Bytes32Schema, type Hex } from "../types/primitives";

const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !/^[A-Za-z]:/.test(p) &&
      !p.includes("\\") &&
      !p.split("/").some((s) => s === ".." || s === "." || s === ""),
    "paths must be repo-relative, forward-slashed and free of . or .. segments",
  );

export const RulesManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z.array(z.object({ path: relativePath, hash: Bytes32Schema }).strict()).min(1),
    dependencies: z.array(
      z
        .object({
          name: z.string().min(1),
          version: z.string().regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, "exact versions only"),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((m, ctx) => {
    const strictlySorted = (xs: string[]) => xs.every((x, i) => i === 0 || xs[i - 1]! < x);
    if (!strictlySorted(m.files.map((f) => f.path)))
      ctx.addIssue({ code: "custom", message: "files must be sorted by path and unique" });
    if (!strictlySorted(m.dependencies.map((d) => d.name)))
      ctx.addIssue({ code: "custom", message: "dependencies must be sorted by name and unique" });
  });

export type RulesManifest = z.output<typeof RulesManifestSchema>;

/** Hash of a source file's bytes after normalizing CRLF/CR line endings to LF. */
export function sourceFileHash(text: string): Hex {
  return keccak256(new TextEncoder().encode(text.replace(/\r\n?/g, "\n")));
}

/** RULES_VERSION: keccak256 of the canonical manifest. */
export const rulesVersionOf = (manifest: RulesManifest): Hex =>
  canonicalHash(RulesManifestSchema.parse(manifest));
