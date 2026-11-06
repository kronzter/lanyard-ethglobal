// Persistence for MockResultsPublisher. The mock's "chain" (publication state plus every
// transaction it has seen) lives in a store so a new publisher instance, e.g. after a CLI
// restart, sees exactly what the previous one left. createSerializedStore writes canonical JSON
// through caller-supplied read/write functions; the CLI backs it with a file. MemoryPublisherStore
// exists only for isolated unit tests (plans/P0-foundation.md › P0.3-R3).
import { z } from "zod";
import { canonicalJson, parseJsonStrict } from "../canonical";
import type { PublicationInput, PublicationState, WinnerInput } from "../interfaces/results-publisher";
import { Bytes32Schema, type Hex } from "../types/primitives";

export type PublisherOp =
  | { kind: "setEventResults"; input: PublicationInput }
  | { kind: "declareWinner"; input: WinnerInput }
  | { kind: "lockResults"; expected: PublicationState };

export type MockTx = {
  hash: Hex;
  seq: number;
  op: PublisherOp;
  status: "pending" | "confirmed" | "reverted";
  blockNumber: bigint | null;
  blockHash: Hex | null;
};

export type PersistedPublisher = {
  schemaVersion: 1;
  state: PublicationState;
  txs: MockTx[];
  nextSeq: number;
  nextBlock: bigint;
};

export interface PublisherStore {
  load(): Promise<PersistedPublisher | null>;
  save(data: PersistedPublisher): Promise<void>;
}

const big = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((v) => BigInt(v));
const PublicationInputSchema = z
  .object({
    event: z.string(),
    resultsKey: Bytes32Schema,
    resultsHash: Bytes32Schema,
    bundleHash: Bytes32Schema,
    bundleUri: z.string(),
  })
  .strict();
const WinnerInputSchema = PublicationInputSchema.extend({
  team: z.string(),
  prizes: z.array(z.string()),
}).strict();
const StateSchema = z
  .object({
    eventResults: PublicationInputSchema.nullable(),
    winners: z.record(z.string(), WinnerInputSchema),
    locked: z.boolean(),
  })
  .strict();
const PersistedSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: StateSchema,
    txs: z.array(
      z
        .object({
          hash: Bytes32Schema,
          seq: z.number().int().nonnegative(),
          op: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("setEventResults"), input: PublicationInputSchema }).strict(),
            z.object({ kind: z.literal("declareWinner"), input: WinnerInputSchema }).strict(),
            z.object({ kind: z.literal("lockResults"), expected: StateSchema }).strict(),
          ]),
          status: z.enum(["pending", "confirmed", "reverted"]),
          blockNumber: big.nullable(),
          blockHash: Bytes32Schema.nullable(),
        })
        .strict(),
    ),
    nextSeq: z.number().int().nonnegative(),
    nextBlock: big,
  })
  .strict();

/** Canonical text for a persisted publisher (bigints as base-10 strings). */
export const serializePublisher = (data: PersistedPublisher): string => canonicalJson(data);

/** Strictly parse persisted text back; corrupt or tampered files fail loudly. */
export const deserializePublisher = (text: string): PersistedPublisher =>
  PersistedSchema.parse(parseJsonStrict(text)) as PersistedPublisher;

export function createSerializedStore(io: {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}): PublisherStore {
  return {
    async load() {
      const text = await io.read();
      return text === null ? null : deserializePublisher(text);
    },
    async save(data) {
      await io.write(serializePublisher(data));
    },
  };
}

/** For isolated unit tests only: never use it where a restart must be survived across processes. */
export class MemoryPublisherStore implements PublisherStore {
  private text: string | null = null;
  async load() {
    return this.text === null ? null : deserializePublisher(this.text);
  }
  async save(data: PersistedPublisher) {
    this.text = serializePublisher(data);
  }
}
