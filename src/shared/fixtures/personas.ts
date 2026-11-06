// fixtures/personas.json format (plans/P0-foundation.md › P0.4-R1).
// Every demo actor with their `by` label, ENS labels, address and the env var NAME that holds
// their key for local seed/e2e scripts. Keys themselves never appear in fixtures.
import { z } from "zod";
import { isCanonicalLabel } from "../labels";
import { AddressSchema } from "../types/primitives";

export const PERSONA_ROLES = [
  "organizer",
  "results",
  "desk",
  "coordinator",
  "head-judge",
  "partner",
  "partner-staff",
  "lead",
  "volunteer",
  "partner-judge",
  "global-judge",
  "hacker",
] as const;
export type PersonaRole = (typeof PERSONA_ROLES)[number];

/** Roles that act through configured authority or grants and hold no badge of their own. */
export const AUTHORITY_ROLES: readonly PersonaRole[] = [
  "organizer",
  "results",
  "desk",
  "coordinator",
  "head-judge",
];

const label = z.string().refine((l) => l !== "" && isCanonicalLabel(l), "expected a canonical label");

export const PersonaSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    displayName: z.string().min(1),
    role: z.enum(PERSONA_ROLES),
    /** The `by` label this persona writes on Arkiv records (descriptive for authorities). */
    by: label,
    /** ENS labels (relative to the edition) this persona owns: badges and, for leads, the team name. */
    labels: z.array(label),
    address: AddressSchema,
    /** Derivation index on the public `test … junk` mnemonic (mock addresses only). */
    hdIndex: z.number().int().nonnegative(),
    /** Name of the env var holding this persona's key in a local .env. Never the key. */
    keyEnv: z.string().regex(/^LANYARD_KEY_[A-Z0-9_]+$/),
    team: label.optional(),
    partner: label.optional(),
    zone: z.string().optional(),
  })
  .strict();

export const PersonasFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    mnemonic: z.literal("test test test test test test test test test test test junk"),
    personas: z.array(PersonaSchema),
  })
  .strict()
  .superRefine((f, ctx) => {
    const dup = (values: (string | number)[], what: string) => {
      const seen = new Set<string | number>();
      for (const v of values) {
        if (seen.has(v)) ctx.addIssue({ code: "custom", message: `duplicate ${what} ${v}` });
        seen.add(v);
      }
    };
    dup(
      f.personas.map((p) => p.id),
      "id",
    );
    dup(
      f.personas.map((p) => p.by),
      "by label",
    );
    dup(
      f.personas.flatMap((p) => p.labels),
      "ENS label",
    );
    dup(
      f.personas.map((p) => p.address),
      "address",
    );
    dup(
      f.personas.map((p) => p.hdIndex),
      "hdIndex",
    );
    dup(
      f.personas.map((p) => p.keyEnv),
      "keyEnv",
    );
    for (const p of f.personas) {
      const authority = AUTHORITY_ROLES.includes(p.role);
      if (authority && p.labels.length > 0)
        ctx.addIssue({ code: "custom", message: `${p.id}: authorities hold no badge` });
      if (!authority && !p.labels.includes(p.by))
        ctx.addIssue({ code: "custom", message: `${p.id}: by must be one of its labels` });
    }
  });

export type Persona = z.output<typeof PersonaSchema>;
export type PersonasFile = z.output<typeof PersonasFileSchema>;

export const parsePersonas = (value: unknown): PersonasFile => PersonasFileSchema.parse(value);

/** Labels a record may legitimately carry in `by`: persona `by` labels and owned ENS labels. */
export const knownByLabels = (file: PersonasFile): Set<string> =>
  new Set(file.personas.flatMap((p) => [p.by, ...p.labels]));

/** Throw listing every `by` label that no persona accounts for (fixture and seed checks). */
export function assertByLabelsKnown(
  byLabels: Iterable<string>,
  file: PersonasFile,
  source = "fixture",
): void {
  const known = knownByLabels(file);
  const unknown = [...new Set(byLabels)].filter((l) => !known.has(l)).sort();
  if (unknown.length > 0) throw new Error(`${source} uses by labels with no persona: ${unknown.join(", ")}`);
}
