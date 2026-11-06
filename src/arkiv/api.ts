// The narrow Arkiv surface the rest of Lanyard uses (plans/B1-arkiv-data.md). Two implementations
// share it: the real SDK-backed client (client.ts) and the in-memory FakeArkiv (fake.ts) that
// tests and mock mode use. Live rows are current observations, never historical snapshots
// (plans/01-evidence-and-interfaces.md §1), so there is deliberately no "at block" read option.
import type { ArkivValue, CreateEntityParameters, Expiry, PatchEntityParameters } from "@arkiv-network/sdk";
import type { Address, Hex } from "@/shared/types/primitives";

export type BlockRef = { number: bigint; hash: Hex; timestamp: bigint };

export type StoredAttribute = { value: ArkivValue; indexed: boolean };

/** One entity as read now. `creator` never changes; `owner` controls mutation. */
export type StoredEntity = {
  key: Hex;
  owner: Address;
  creator: Address;
  createdAt: bigint;
  updatedAt: bigint;
  expiresAt: bigint;
  flags: { readonly: boolean; permissionlessExtension: boolean };
  attributes: Record<string, StoredAttribute>;
};

/** One atomic transaction, applied in order: creates → patches → deletes → extensions → transfers. */
export type ArkivBatch = {
  creates?: readonly CreateEntityParameters[];
  patches?: readonly PatchEntityParameters[];
  deletes?: readonly { entityKey: Hex }[];
  extensions?: readonly { entityKey: Hex; expiration: Expiry }[];
  ownershipChanges?: readonly { entityKey: Hex; newOwner: Address }[];
};

export type WriteResult = { txHash: Hex; created: Hex[] };

/**
 * Equality filters on indexed attributes (AND), optionally narrowed by creator/owner and paged by
 * ascending key. There is no inequality: the node rejects `!=`, so callers model status positively.
 */
export type QueryFilter = {
  equals: Record<string, ArkivValue>;
  creator?: Address;
  owner?: Address;
  /** Return keys strictly greater than this one (key-ordered paging that survives concurrent writes). */
  afterKey?: Hex;
  /** At most 100 rows per page (the node's cap). */
  limit?: number;
};

/** A page and the block it was read at; pages of one logical scan can report different blocks. */
export type QueryPage = { entities: StoredEntity[]; blockNumber: bigint };

export type EntityEventType = "created" | "patched" | "deleted" | "extended" | "transferred";
export type EntityEvent = { type: EntityEventType; entityKey: Hex; blockNumber: bigint; txHash: Hex };

export type TxReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  from: Address;
  to: Address | null;
  value: bigint;
};

export interface ArkivReader {
  get(key: Hex): Promise<StoredEntity | null>;
  query(filter: QueryFilter): Promise<QueryPage>;
  head(): Promise<BlockRef>;
  block(number: bigint): Promise<BlockRef>;
  balance(address: Address): Promise<bigint>;
  /** null while the transaction is unknown or still pending; never "failed" without evidence. */
  receipt(txHash: Hex): Promise<TxReceipt | null>;
  /** Events invalidate cached rows; they are not an archive. Returns the unsubscribe function. */
  watch(handlers: { onEvent(event: EntityEvent): void; onError(error: Error): void }): () => void;
}

export interface ArkivWriter {
  readonly account: Address;
  /** One transaction, one wallet approval. Resolves once the receipt is in. */
  write(batch: ArkivBatch): Promise<WriteResult>;
  /** A plain native transfer. Resolves with the hash as soon as the wallet returns it. */
  sendValue(to: Address, wei: bigint): Promise<Hex>;
}

export const MAX_PAGE = 100;

/** True when the wallet's user declined the request (EIP-1193 code 4001). */
export function isUserRejection(error: unknown): boolean {
  for (
    let e = error as { code?: unknown; name?: unknown; cause?: unknown } | undefined;
    e;
    e = e.cause as typeof e
  ) {
    if (e.code === 4001 || e.name === "UserRejectedRequestError") return true;
  }
  return false;
}
