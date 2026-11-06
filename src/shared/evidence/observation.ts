// A captured Arkiv observation (plans/01-evidence-and-interfaces.md §1): what the local capture
// CLI retains for each readonly record while it is available. Raw typed values, creator, current
// owner, creation flags, creation/update/expiry blocks, creation timestamp, the block it was
// observed at and the network identity. An observation is never relabelled as the state at an
// earlier block; a later deletion keeps the retained bytes usable.
import { z } from "zod";
import { canonicalJson } from "../canonical";
import { AddressSchema, Bytes32Schema, HexSchema } from "../types/primitives";

const big = z.union([z.bigint(), z.string().regex(/^(0|[1-9][0-9]*)$/)]).transform((v) => BigInt(v));

export const ATTRIBUTE_TYPES = ["str", "u64", "u256", "i32", "bool", "addr", "key", "bytes", "dec"] as const;

/** One attribute exactly as read: its Arkiv type tag and canonical string value. */
export const CapturedAttributeSchema = z
  .object({ name: z.string().min(1), type: z.enum(ATTRIBUTE_TYPES), indexed: z.boolean(), value: z.string() })
  .strict();

export const CapturedObservationSchema = z
  .object({
    key: Bytes32Schema,
    kind: z.string().min(1),
    creator: AddressSchema,
    /** Owner when observed; null if the entity no longer had one. */
    owner: AddressSchema.nullable(),
    flags: z.object({ readonly: z.boolean(), permissionlessExtension: z.boolean() }).strict(),
    createdAtBlock: big,
    updatedAtBlock: big,
    expiresAtBlock: big,
    createdAtTimestamp: big,
    observedAtBlock: big,
    observedAtBlockHash: Bytes32Schema,
    network: z.object({ chainId: z.number().int().positive(), resetId: Bytes32Schema }).strict(),
    attributes: z.array(CapturedAttributeSchema),
    payload: HexSchema,
    /** First block at which a later scan found the source gone; the retained bytes stay usable. */
    deletedAtBlock: big.optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message: `${o.key}: ${message}` });
    if (o.updatedAtBlock < o.createdAtBlock) issue("updated before it was created");
    if (o.observedAtBlock < o.updatedAtBlock) issue("observed before its last update");
    if (o.expiresAtBlock <= o.createdAtBlock) issue("expires before it was created");
    // No "readonly ⇒ never updated" rule: on Rabdi an ownership transfer of a readonly entity bumps
    // $updatedAt (measured 2026-11-06, B1.3). Readonly content is held fixed by dedupeObservations,
    // which compares attributes, creator, flags and creation data and throws on any difference.
    if (o.deletedAtBlock !== undefined && o.deletedAtBlock <= o.observedAtBlock)
      issue("deleted at or before its observation");
    const names = o.attributes.map((a) => a.name);
    if (names.some((n, i) => i > 0 && n <= names[i - 1]!))
      issue("attributes must be sorted by name and unique");
  });

export type CapturedObservation = z.output<typeof CapturedObservationSchema>;

export class ConflictingCaptureError extends Error {
  constructor(readonly key: string) {
    super(`readonly entity ${key} was captured with different contents; automatic freeze must stop`);
    this.name = "ConflictingCaptureError";
  }
}

/** Evidence order: creation block, then lowercase entity key (plans/01-evidence-and-interfaces.md §2). */
export const compareRecords = (a: CapturedObservation, b: CapturedObservation): number =>
  a.createdAtBlock < b.createdAtBlock
    ? -1
    : a.createdAtBlock > b.createdAtBlock
      ? 1
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0;

export const sortRecords = (records: CapturedObservation[]): CapturedObservation[] =>
  [...records].sort(compareRecords);

/** The fields a readonly entity can never change; two captures must agree on all of them. */
const immutableView = (o: CapturedObservation) => ({
  key: o.key,
  kind: o.kind,
  creator: o.creator,
  flags: o.flags,
  createdAtBlock: o.createdAtBlock,
  createdAtTimestamp: o.createdAtTimestamp,
  network: o.network,
  attributes: o.attributes,
  payload: o.payload,
});

/**
 * Collapse repeated observations of one key to the earliest, after checking that every capture
 * of a readonly key agrees on its immutable contents. Conflicting bytes throw.
 */
export function dedupeObservations(records: CapturedObservation[]): CapturedObservation[] {
  const byKey = new Map<string, CapturedObservation>();
  for (const o of [...records].sort((a, b) =>
    a.observedAtBlock < b.observedAtBlock ? -1 : a.observedAtBlock > b.observedAtBlock ? 1 : 0,
  )) {
    const seen = byKey.get(o.key);
    if (!seen) byKey.set(o.key, o);
    else if (
      (seen.flags.readonly || o.flags.readonly) &&
      canonicalJson(immutableView(seen)) !== canonicalJson(immutableView(o))
    ) {
      throw new ConflictingCaptureError(o.key);
    }
  }
  return sortRecords([...byKey.values()]);
}
