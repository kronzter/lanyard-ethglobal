// FakeArkiv (B1.1-R5): an in-memory Rabdi with the same ArkivReader/ArkivWriter surface as the real
// client, enforcing the native rules the spike measured (P0.6-S9/S10):
// - only the owner patches, extends (unless permissionlessExtension), deletes or transfers;
// - readonly entities reject patches but can still be deleted or transferred;
// - expiry is block-based, capped at MAX_LIFETIME, never moved earlier, and emits no event;
// - a batch is atomic and applies creates → patches → deletes → extensions → transfers;
// - queries are current-state only (no historical option), equality-only, ≤100 rows per page.
// Test hooks simulate pending transactions, wallet rejection, quiet deletion (capture gaps) and
// head movement between pages.
import { isArkivValue, MAX_LIFETIME, toValue, type ArkivValue, type Expiry } from "@arkiv-network/sdk";
import { encodePacked, keccak256 } from "viem";
import type { Address, Hex } from "@/shared/types/primitives";
import {
  MAX_PAGE,
  type ArkivBatch,
  type ArkivReader,
  type ArkivWriter,
  type BlockRef,
  type EntityEvent,
  type EntityEventType,
  type QueryFilter,
  type QueryPage,
  type StoredAttribute,
  type StoredEntity,
  type TxReceipt,
  type WriteResult,
} from "./api";

export const FAKE_BLOCK_SECONDS = 2n;

export type FakeErrorReason =
  | "not-owner"
  | "readonly"
  | "missing"
  | "earlier-expiry"
  | "invalid-expiry"
  | "schema"
  | "insufficient-funds"
  | "historical-query";

export class FakeArkivError extends Error {
  constructor(
    readonly reason: FakeErrorReason,
    detail: string,
  ) {
    super(`FakeArkiv ${reason}: ${detail}`);
    this.name = "FakeArkivError";
  }
}

/** Mirrors viem's UserRejectedRequestError shape (EIP-1193 code 4001). */
export class FakeUserRejection extends Error {
  readonly code = 4001;
  constructor() {
    super("User rejected the request.");
    this.name = "UserRejectedRequestError";
  }
}

type Tx = { hash: Hex; receipt: TxReceipt | null; held?: () => void };

const lower = (a: string) => a.toLowerCase() as Address;
// SDK values are primitives (bytes travel as 0x hex), so a case-insensitive string compare is exact.
const same = (a: ArkivValue, b: ArkivValue) =>
  a.type === b.type && String(a.value).toLowerCase() === String(b.value).toLowerCase();

export class FakeArkiv implements ArkivReader {
  private entities = new Map<Hex, StoredEntity>();
  private nonces = new Map<Address, bigint>();
  private balances = new Map<Address, bigint>();
  private txs = new Map<Hex, Tx>();
  private listeners = new Set<{ onEvent(e: EntityEvent): void; onError(e: Error): void }>();
  private headNumber: bigint;
  private txCounter = 0n;
  private hooks: { rejectNext: boolean; holdNext: boolean; loseNext: boolean; beforeQuery?: () => void } = {
    rejectNext: false,
    holdNext: false,
    loseNext: false,
  };

  constructor(
    private readonly genesisSeconds = 1_796_000_000n,
    startBlock = 1_000n,
    /** Block 0's hash, i.e. the reset identity capture checks (defaults to a synthetic hash). */
    private readonly genesisHash?: Hex,
  ) {
    this.headNumber = startBlock;
  }

  // ── test controls ────────────────────────────────────────────────────────────────────────────
  /** Advance the head without any transaction (expiry is checked against the head). */
  advance(blocks: bigint): void {
    this.headNumber += blocks;
  }
  fund(address: Address, wei: bigint): void {
    this.balances.set(lower(address), (this.balances.get(lower(address)) ?? 0n) + wei);
  }
  /** The next wallet request is declined by the user (code 4001). */
  rejectNextRequest(): void {
    this.hooks.rejectNext = true;
  }
  /** The next native transfer returns its hash but stays pending until `mineHeld()`. */
  holdNextTransfer(): void {
    this.hooks.holdNext = true;
  }
  mineHeld(): void {
    for (const tx of this.txs.values()) tx.held?.();
  }
  /** Delete without an event: what a reader experiences when it misses an interval (capture gap). */
  deleteQuietly(key: Hex): void {
    this.entities.delete(key);
  }
  /** Run before every query page, e.g. to move the head between pages of one scan. */
  onBeforeQuery(fn: (() => void) | undefined): void {
    this.hooks.beforeQuery = fn;
  }
  /** Drop every watcher with an error, as a lost RPC connection would. */
  failWatchers(error = new Error("watch connection lost")): void {
    for (const l of [...this.listeners]) l.onError(error);
  }
  /** A signer for `account`. */
  /** The next write lands on chain, but its response is lost before the caller sees it. */
  loseNextResponse(): void {
    this.hooks.loseNext = true;
  }
  /** A signer for `account`; `onTxHash` sees each hash before the write resolves, like the real client. */
  writer(account: Address, onTxHash?: (hash: Hex) => void): ArkivWriter {
    const owner = lower(account);
    return {
      account: owner,
      write: (batch) => this.apply(owner, batch, onTxHash),
      sendValue: (to, wei) => this.transfer(owner, to, wei, onTxHash),
    };
  }

  // ── ArkivReader ──────────────────────────────────────────────────────────────────────────────
  async get(key: Hex): Promise<StoredEntity | null> {
    const e = this.live(key.toLowerCase() as Hex);
    return e ? structuredClone(e) : null;
  }

  async query(filter: QueryFilter): Promise<QueryPage> {
    if ("atBlock" in (filter as object) || "blockNumber" in (filter as object))
      throw new FakeArkivError("historical-query", "Arkiv reads are current state only");
    this.hooks.beforeQuery?.();
    const limit = Math.min(filter.limit ?? MAX_PAGE, MAX_PAGE);
    const after = filter.afterKey?.toLowerCase();
    const rows = [...this.entities.values()]
      .filter((e) => e.expiresAt > this.headNumber)
      .filter((e) => !filter.creator || e.creator === lower(filter.creator))
      .filter((e) => !filter.owner || e.owner === lower(filter.owner))
      .filter((e) => !after || e.key > after)
      .filter((e) =>
        Object.entries(filter.equals).every(([name, want]) => {
          const got = e.attributes[name];
          return got !== undefined && got.indexed && same(got.value, want);
        }),
      )
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, limit);
    return { entities: rows.map((r) => structuredClone(r)), blockNumber: this.headNumber };
  }

  async head(): Promise<BlockRef> {
    return this.block(this.headNumber);
  }
  async block(number: bigint): Promise<BlockRef> {
    if (number > this.headNumber) throw new Error(`block ${number} is in the future`);
    return {
      number,
      hash:
        number === 0n && this.genesisHash
          ? this.genesisHash
          : keccak256(encodePacked(["string", "uint256"], ["fake-block", number])),
      timestamp: this.genesisSeconds + number * FAKE_BLOCK_SECONDS,
    };
  }
  async balance(address: Address): Promise<bigint> {
    return this.balances.get(lower(address)) ?? 0n;
  }
  async receipt(txHash: Hex): Promise<TxReceipt | null> {
    return this.txs.get(txHash)?.receipt ?? null;
  }
  watch(handlers: { onEvent(event: EntityEvent): void; onError(error: Error): void }): () => void {
    this.listeners.add(handlers);
    return () => this.listeners.delete(handlers);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────
  private live(key: Hex): StoredEntity | undefined {
    const e = this.entities.get(key);
    return e && e.expiresAt > this.headNumber ? e : undefined;
  }

  private consumeRejection(): void {
    if (this.hooks.rejectNext) {
      this.hooks.rejectNext = false;
      throw new FakeUserRejection();
    }
  }

  private nextTxHash(): Hex {
    this.txCounter += 1n;
    return keccak256(encodePacked(["string", "uint256"], ["fake-tx", this.txCounter]));
  }

  private resolveExpiry(exp: Expiry, atBlock: bigint): bigint {
    let deadline: bigint;
    if (exp.expiresAt instanceof Date) {
      const seconds = BigInt(Math.ceil(exp.expiresAt.getTime() / 1000));
      const now = this.genesisSeconds + atBlock * FAKE_BLOCK_SECONDS;
      const delta = seconds > now ? seconds - now : 0n;
      deadline = atBlock + (delta + FAKE_BLOCK_SECONDS - 1n) / FAKE_BLOCK_SECONDS;
    } else {
      deadline = exp.expiresAt;
    }
    const floor = exp.minLifetime > 0n ? atBlock + exp.minLifetime : 0n;
    const target = deadline > floor ? deadline : floor;
    if (target <= atBlock) throw new FakeArkivError("invalid-expiry", "the entity would be dead on arrival");
    if (target - atBlock > MAX_LIFETIME)
      throw new FakeArkivError(
        "invalid-expiry",
        `lifetime ${target - atBlock} exceeds ${MAX_LIFETIME} blocks`,
      );
    return target;
  }

  private attributesOf(
    schema: {
      columns: Record<
        string,
        { type: string; isIndexed: boolean; isOptional: boolean; defaultValue?: ArkivValue }
      >;
      tag?: ArkivValue;
    },
    values: Record<string, unknown>,
  ): Record<string, StoredAttribute> {
    const out: Record<string, StoredAttribute> = {};
    for (const name of Object.keys(values))
      if (!(name in schema.columns)) throw new FakeArkivError("schema", `"${name}" is not a column`);
    for (const [name, col] of Object.entries(schema.columns)) {
      const raw = values[name] ?? col.defaultValue;
      if (raw === undefined) {
        if (col.isOptional) continue;
        throw new FakeArkivError("schema", `"${name}" is required`);
      }
      const value = isArkivValue(raw) ? raw : toValue(raw as never, name);
      if (value.type !== col.type)
        throw new FakeArkivError("schema", `"${name}" is ${col.type}, got ${value.type}`);
      out[name] = { value, indexed: col.isIndexed };
    }
    if (schema.tag) out["arkiv.schema"] = { value: schema.tag, indexed: true };
    if (Object.keys(out).length > 32) throw new FakeArkivError("schema", "more than 32 attributes");
    return out;
  }

  private async apply(
    owner: Address,
    batch: ArkivBatch,
    onTxHash?: (hash: Hex) => void,
  ): Promise<WriteResult> {
    this.consumeRejection();
    const block = this.headNumber + 1n;
    const staged = new Map(this.entities);
    const nonces = new Map(this.nonces);
    const events: EntityEventType[] = [];
    const keysFor: Hex[] = [];
    const created: Hex[] = [];
    const mustOwn = (key: Hex, op: string): StoredEntity => {
      const e = staged.get(key.toLowerCase() as Hex);
      if (!e || e.expiresAt <= this.headNumber)
        throw new FakeArkivError("missing", `${op}: no live entity ${key}`);
      if (e.owner !== owner) throw new FakeArkivError("not-owner", `${op}: ${owner} does not own ${key}`);
      return e;
    };
    const touch = (e: StoredEntity, change: Partial<StoredEntity>) =>
      staged.set(e.key, { ...e, ...change, updatedAt: block });

    for (const c of batch.creates ?? []) {
      const nonce = nonces.get(owner) ?? 0n;
      nonces.set(owner, nonce + 1n);
      const salt = typeof c.salt === "bigint" ? c.salt : BigInt(this.txCounter * 1000n + nonce);
      const key = keccak256(
        encodePacked(["address", "uint64", "uint128"], [owner, nonce, salt]),
      ).toLowerCase() as Hex;
      staged.set(key, {
        key,
        owner,
        creator: owner,
        createdAt: block,
        updatedAt: block,
        expiresAt: this.resolveExpiry(c.expiration, block),
        flags: { readonly: !!c.flags?.readonly, permissionlessExtension: !!c.flags?.permissionlessExtension },
        attributes: this.attributesOf(c.schema as never, c.values as Record<string, unknown>),
      });
      created.push(key);
      events.push("created");
      keysFor.push(key);
    }
    for (const p of batch.patches ?? []) {
      const e = mustOwn(p.entityKey, "patch");
      if (e.flags.readonly) throw new FakeArkivError("readonly", `entity ${e.key} was created readonly`);
      const next = { ...e.attributes };
      const set = this.attributesOf(
        {
          columns: Object.fromEntries(
            Object.entries(p.schema.columns).map(([n, c]) => [
              n,
              { ...c, isOptional: true, defaultValue: undefined },
            ]),
          ),
        },
        (p.set ?? {}) as Record<string, unknown>,
      );
      Object.assign(next, set);
      for (const name of (p.unset ?? []) as string[]) delete next[name];
      touch(e, { attributes: next });
      events.push("patched");
      keysFor.push(e.key);
    }
    for (const d of batch.deletes ?? []) {
      const e = mustOwn(d.entityKey, "delete");
      staged.delete(e.key);
      events.push("deleted");
      keysFor.push(e.key);
    }
    for (const x of batch.extensions ?? []) {
      const e = staged.get(x.entityKey.toLowerCase() as Hex);
      if (!e || e.expiresAt <= this.headNumber)
        throw new FakeArkivError("missing", `extend: no live entity ${x.entityKey}`);
      if (e.owner !== owner && !e.flags.permissionlessExtension)
        throw new FakeArkivError("not-owner", `extend: ${owner} does not own ${e.key}`);
      const target = this.resolveExpiry(x.expiration, block);
      if (target < e.expiresAt)
        throw new FakeArkivError(
          "earlier-expiry",
          `${e.key} already expires at ${e.expiresAt}, not ${target}`,
        );
      staged.set(e.key, { ...e, expiresAt: target });
      events.push("extended");
      keysFor.push(e.key);
    }
    for (const t of batch.ownershipChanges ?? []) {
      const e = mustOwn(t.entityKey, "transfer");
      touch(e, { owner: lower(t.newOwner) });
      events.push("transferred");
      keysFor.push(e.key);
    }
    if (events.length === 0) throw new Error("No operations to perform");

    // Commit atomically, mine one block, then notify.
    this.entities = staged;
    this.nonces = nonces;
    this.headNumber = block;
    const hash = this.nextTxHash();
    this.txs.set(hash, {
      hash,
      receipt: {
        status: "success",
        blockNumber: block,
        from: owner,
        to: "0x4400000000000000000000000000000000000044",
        value: 0n,
      },
    });
    onTxHash?.(hash);
    events.forEach((type, i) =>
      [...this.listeners].forEach((l) =>
        l.onEvent({ type, entityKey: keysFor[i]!, blockNumber: block, txHash: hash }),
      ),
    );
    if (this.hooks.loseNext) {
      this.hooks.loseNext = false;
      throw new Error("connection lost after the transaction was sent");
    }
    return { txHash: hash, created };
  }

  private async transfer(
    from: Address,
    to: Address,
    wei: bigint,
    onTxHash?: (hash: Hex) => void,
  ): Promise<Hex> {
    this.consumeRejection();
    const balance = this.balances.get(from) ?? 0n;
    if (balance < wei) throw new FakeArkivError("insufficient-funds", `${from} has ${balance}, needs ${wei}`);
    const hash = this.nextTxHash();
    const mine = () => {
      this.headNumber += 1n;
      this.balances.set(from, (this.balances.get(from) ?? 0n) - wei);
      this.balances.set(lower(to), (this.balances.get(lower(to)) ?? 0n) + wei);
      tx.receipt = { status: "success", blockNumber: this.headNumber, from, to: lower(to), value: wei };
      delete tx.held;
    };
    const tx: Tx = { hash, receipt: null };
    this.txs.set(hash, tx);
    onTxHash?.(hash);
    if (this.hooks.holdNext) {
      this.hooks.holdNext = false;
      tx.held = mine;
    } else mine();
    return hash;
  }
}
