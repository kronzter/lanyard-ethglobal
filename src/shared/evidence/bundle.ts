// The signed evidence bundle and the compact results summary
// (plans/01-evidence-and-interfaces.md §1–2). The envelope is `{ body, bundleHash, signature }`:
// bundleHash = keccak256(canonical(body)), signed by the results wallet as the EIP-191 message
// `Lanyard evidence v1\n<bundleHash>`. resultsHash = keccak256(canonical(resultsBody)). Neither
// hash domain includes the later Arkiv results entity key, and the bundle never contains the
// results record itself.
import { recoverMessageAddress } from "viem";
import { z } from "zod";
import { canonicalBytes, canonicalHash } from "../canonical";
import { EventTimesSchema } from "../config/schema";
import { isCutoffInWindow } from "../config/validate";
import { AddressSchema, Bytes32Schema, HexSchema, type Address, type Hex } from "../types/primitives";
import { parseWebUrl } from "../url";
import { CapturedObservationSchema, dedupeObservations, sortRecords } from "./observation";

const big = z.union([z.bigint(), z.string().regex(/^(0|[1-9][0-9]*)$/)]).transform((v) => BigInt(v));
const BlockRefSchema = z.object({ number: big, hash: Bytes32Schema, timestamp: big }).strict();

export const EvaluationContextSchema = z
  .object({
    event: z.string().min(1),
    arkivChainId: z.number().int().positive(),
    arkivResetId: Bytes32Schema,
    sepoliaChainId: z.number().int().positive(),
    arkivCutoff: BlockRefSchema,
    sepoliaCutoff: BlockRefSchema,
    configHash: Bytes32Schema,
  })
  .strict();

export const ENS_QUERIES = [
  "owner",
  "address",
  "text",
  "expiry",
  "registrationId",
  "unregisteredBetween",
] as const;

/** One prepared historical ENS read, as `prepare` fetched it (operator-attested offline). */
export const PreparedEnsEntrySchema = z
  .object({
    label: z.string(),
    block: big,
    query: z.enum(ENS_QUERIES),
    /** Text key, or the interval end block for unregisteredBetween; "" when unused. */
    key: z.string(),
    result: z.union([z.string(), z.boolean(), z.null()]),
  })
  .strict();

const IntervalSchema = z.object({ fromBlock: big, toBlock: big }).strict();
export const CaptureDiagnosticsSchema = z
  .object({
    intervals: z.array(IntervalSchema),
    gaps: z.array(IntervalSchema.extend({ reason: z.string().min(1) }).strict()),
    knownKeys: z.number().int().nonnegative(),
  })
  .strict();

export const EvidenceBodySchema = z
  .object({
    schemaVersion: z.literal(1),
    event: z.string().min(1),
    context: EvaluationContextSchema,
    /** The frozen event config; its canonical hash must equal `context.configHash`. */
    config: z.record(z.string(), z.unknown()),
    ruleVersion: Bytes32Schema,
    records: z.array(CapturedObservationSchema),
    ens: z.array(PreparedEnsEntrySchema),
    diagnostics: CaptureDiagnosticsSchema,
    /** Published at freeze so anyone can re-derive the eligible scores. */
    decryption: z
      .object({ keyId: z.string().min(1), suite: z.string().min(1), privateKey: Bytes32Schema })
      .strict(),
    prizes: z.array(
      z.object({ team: z.string().min(1), prizes: z.array(z.string().min(1)).min(1) }).strict(),
    ),
    /** The canonical rules output this bundle claims. */
    output: z.unknown(),
    bundleUri: z
      .string()
      .refine((u) => parseWebUrl(u)?.scheme === "https", "bundleUri must be an absolute https URL"),
  })
  .strict();

export type EvidenceBody = z.output<typeof EvidenceBodySchema>;
export type EvidenceEnvelope = { body: EvidenceBody; bundleHash: Hex; signature: Hex };

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

const compareEns = (
  a: z.output<typeof PreparedEnsEntrySchema>,
  b: z.output<typeof PreparedEnsEntrySchema>,
): number =>
  a.label < b.label
    ? -1
    : a.label > b.label
      ? 1
      : a.block < b.block
        ? -1
        : a.block > b.block
          ? 1
          : a.query < b.query
            ? -1
            : a.query > b.query
              ? 1
              : a.key < b.key
                ? -1
                : a.key > b.key
                  ? 1
                  : 0;

/** Parse and check a bundle body: ordering, capture consistency, config hash and the freeze window. */
export function parseEvidenceBody(value: unknown): EvidenceBody {
  const body = EvidenceBodySchema.parse(value);
  const sorted = sortRecords(body.records);
  if (sorted.some((r, i) => r.key !== body.records[i]!.key))
    throw new EvidenceError("records must be sorted by creation block, then key");
  if (dedupeObservations(body.records).length !== body.records.length)
    throw new EvidenceError("records must hold one observation per key");
  for (let i = 1; i < body.ens.length; i++) {
    if (compareEns(body.ens[i - 1]!, body.ens[i]!) >= 0)
      throw new EvidenceError(
        "ENS entries must be sorted by label, block, query and key, without duplicates",
      );
  }
  if (canonicalHash(body.config) !== body.context.configHash)
    throw new EvidenceError("config does not match context.configHash");
  const times = EventTimesSchema.safeParse(body.config.times);
  if (!times.success) throw new EvidenceError("config.times is missing or malformed");
  for (const cutoff of ["arkivCutoff", "sepoliaCutoff"] as const) {
    if (!isCutoffInWindow(body.context[cutoff].timestamp, times.data)) {
      throw new EvidenceError(`${cutoff} timestamp is outside the freeze window [results, freezeDeadline)`);
    }
  }
  if (body.context.sepoliaCutoff.timestamp > body.context.arkivCutoff.timestamp) {
    throw new EvidenceError("the Sepolia cutoff must not be later than the Arkiv cutoff");
  }
  for (const e of body.ens) {
    if (e.block > body.context.sepoliaCutoff.number)
      throw new EvidenceError(`ENS read for ${e.label} at ${e.block} is past the Sepolia cutoff`);
  }
  return body;
}

export const bundleHashOf = (body: EvidenceBody): Hex => canonicalHash(body);

/** The exact EIP-191 message the results wallet signs. */
export const evidenceSigningMessage = (bundleHash: Hex): string =>
  `Lanyard evidence v1\n${bundleHash.toLowerCase()}`;

/**
 * Check an envelope against an independently configured results wallet: the body parses, its
 * hash equals `bundleHash`, and the signature recovers to `expectedSigner`. Throws otherwise.
 */
export async function verifyEnvelope(
  envelope: { body: unknown; bundleHash: string; signature: string },
  expectedSigner: Address,
): Promise<EvidenceBody> {
  const body = parseEvidenceBody(envelope.body);
  const hash = bundleHashOf(body);
  if (hash !== envelope.bundleHash.toLowerCase())
    throw new EvidenceError("bundleHash does not match the body");
  const signature = HexSchema.parse(envelope.signature);
  let signer: Address;
  try {
    signer = (
      await recoverMessageAddress({ message: evidenceSigningMessage(hash), signature })
    ).toLowerCase() as Address;
  } catch {
    throw new EvidenceError("the signature is malformed");
  }
  if (signer !== AddressSchema.parse(expectedSigner))
    throw new EvidenceError(`bundle signed by ${signer}, not the configured results wallet`);
  return body;
}

export const ResultsBodySchema = z
  .object({
    schemaVersion: z.literal(1),
    event: z.string().min(1),
    rankings: z.unknown(),
    outputHash: Bytes32Schema,
    ruleVersion: Bytes32Schema,
    configHash: Bytes32Schema,
    bundleHash: Bytes32Schema,
    bundleUri: z.string().min(1),
    bundleSignature: HexSchema,
    context: EvaluationContextSchema,
  })
  .strict();
export type ResultsBody = z.output<typeof ResultsBodySchema>;

/** Build the results summary from a verified envelope; `rankings` are derived from its output. */
export function resultsBodyOf(envelope: EvidenceEnvelope, rankings: unknown): ResultsBody {
  const { body } = envelope;
  return ResultsBodySchema.parse({
    schemaVersion: 1,
    event: body.event,
    rankings,
    outputHash: canonicalHash(body.output),
    ruleVersion: body.ruleVersion,
    configHash: body.context.configHash,
    bundleHash: envelope.bundleHash,
    bundleUri: body.bundleUri,
    bundleSignature: envelope.signature,
    context: body.context,
  });
}

export const resultsHashOf = (resultsBody: ResultsBody): Hex =>
  canonicalHash(ResultsBodySchema.parse(resultsBody));

/** Arkiv's payload limit: a summary larger than this is rejected before any publication. */
export const MAX_SUMMARY_BYTES = 128 * 1024;

export function assertSummaryFits(value: unknown, limit = MAX_SUMMARY_BYTES): number {
  const size = canonicalBytes(value).length;
  if (size > limit)
    throw new EvidenceError(
      `results summary is ${size} bytes, over the ${limit}-byte limit; nothing was published`,
    );
  return size;
}
