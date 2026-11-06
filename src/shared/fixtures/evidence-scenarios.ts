// fixtures/evidence-scenarios.json (plans/P0-foundation.md › P0.4-R5): the Arkiv-side and
// publication edge cases the capture, rules and freeze code must handle. Each scenario carries a
// `note` saying what it proves.
import { z } from "zod";
import { CapturedObservationSchema } from "../evidence/observation";
import { Bytes32Schema } from "../types/primitives";

const big = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((v) => BigInt(v));
const note = z.string().min(1);
const PublicationInputSchema = z
  .object({
    event: z.string(),
    resultsKey: Bytes32Schema,
    resultsHash: Bytes32Schema,
    bundleHash: Bytes32Schema,
    bundleUri: z.string(),
  })
  .strict();

export const EvidenceScenariosSchema = z
  .object({
    schemaVersion: z.literal(1),
    deletedCapturedFinal: z.object({ note, observation: CapturedObservationSchema }).strict(),
    deletedUncapturedFinal: z
      .object({
        note,
        key: Bytes32Schema,
        kind: z.string(),
        inInventorySinceBlock: big,
        missingSinceBlock: big,
        retained: z.null(),
      })
      .strict(),
    expiredLeaseRetainedClaim: z
      .object({
        note,
        ticket: CapturedObservationSchema,
        claim: CapturedObservationSchema,
        leaseSeconds: z.number().int().positive(),
        evaluatedAtTimestamp: big,
      })
      .strict(),
    publicationRestart: z
      .object({
        note,
        broadcast: z.object({ kind: z.literal("setEventResults"), input: PublicationInputSchema }).strict(),
        outcome: z.literal("crash-after-broadcast"),
      })
      .strict(),
    cutoffs: z.array(z.object({ note, timestamp: big, inWindow: z.boolean() }).strict()).min(4),
  })
  .strict();

export type EvidenceScenarios = z.output<typeof EvidenceScenariosSchema>;
export const parseEvidenceScenarios = (value: unknown): EvidenceScenarios =>
  EvidenceScenariosSchema.parse(value);

/** The `by` label an observation carries, if any. */
export const byLabelOf = (o: { attributes: { name: string; value: string }[] }): string | undefined =>
  o.attributes.find((a) => a.name === "by")?.value;
