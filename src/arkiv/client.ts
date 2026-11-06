// The real Arkiv client over @arkiv-network/sdk 1.0.1 (B1.1-R1/R2). Reads go to the Rabdi RPC.
// The app signs through the AppKit EIP-1193 provider (the actor's own wallet); only Node scripts
// and the CLI sign with a local key from their own .env. A routing transport sends signing and
// chain-selection methods to the wallet and every read to the RPC, so writes never depend on how
// a wallet routes reads for a custom chain. `onTxHash` fires the moment a transaction hash exists,
// before the SDK waits for its receipt, so a write queue can journal it (B1.3-R1).
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { and, asc, eq, gt } from "@arkiv-network/sdk/query";
import { addr, key } from "@arkiv-network/sdk/schema";
import { custom, http, TransactionReceiptNotFoundError, type EIP1193Provider, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@/shared/types/primitives";
import {
  MAX_PAGE,
  type ArkivBatch,
  type ArkivReader,
  type ArkivWriter,
  type EntityEventType,
  type QueryFilter,
  type StoredAttribute,
  type StoredEntity,
} from "./api";
import { rabdiChain, rabdiRpcUrl, type RabdiAccess } from "./chain";

const WALLET_METHODS = new Set([
  "eth_sendTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
]);

const EVENT_TYPES: Record<string, EntityEventType> = {
  EntityCreated: "created",
  EntityPatched: "patched",
  EntityDeleted: "deleted",
  ExpiryExtended: "extended",
  OwnershipTransferred: "transferred",
};

const SELECT_ALL = {
  $key: true,
  $owner: true,
  $creator: true,
  $createdAt: true,
  $updatedAt: true,
  $expiresAt: true,
  $creationFlags: true,
  $attributes: true,
  $attributeSchema: true,
} as const;

type Row = {
  $key?: Hex;
  $owner?: Hex;
  $creator?: Hex;
  $createdAt?: bigint;
  $updatedAt?: bigint;
  $expiresAt?: bigint;
  $creationFlags?: { readonly: boolean; permissionlessExtension: boolean };
  $attributes?: Record<string, unknown>;
  $attributeSchema?: Record<string, { indexed?: boolean }>;
};

function toStored(row: Row): StoredEntity {
  const schema = row.$attributeSchema ?? {};
  const attributes: Record<string, StoredAttribute> = {};
  for (const [name, value] of Object.entries(row.$attributes ?? {}))
    attributes[name] = { value: value as StoredAttribute["value"], indexed: !!schema[name]?.indexed };
  return {
    key: row.$key!.toLowerCase() as Hex,
    owner: row.$owner!.toLowerCase() as Address,
    creator: row.$creator!.toLowerCase() as Address,
    createdAt: row.$createdAt!,
    updatedAt: row.$updatedAt!,
    expiresAt: row.$expiresAt!,
    flags: {
      readonly: !!row.$creationFlags?.readonly,
      permissionlessExtension: !!row.$creationFlags?.permissionlessExtension,
    },
    attributes,
  };
}

export function createArkivReader(access: RabdiAccess = {}): ArkivReader {
  const pub = createPublicClient({ chain: rabdiChain(access), transport: http(rabdiRpcUrl(access)) });

  const query = async (filter: QueryFilter) => {
    const preds = Object.entries(filter.equals).map(([name, value]) => eq(name, value as never));
    if (filter.creator) preds.push(eq("$creator", addr(filter.creator)) as never);
    if (filter.afterKey) preds.push(gt("$key", key(filter.afterKey)) as never);
    if (preds.length === 0) throw new Error("an Arkiv query needs at least one filter");
    let q = pub.select(SELECT_ALL).where(preds.length === 1 ? preds[0]! : and(...preds));
    if (filter.owner) q = q.ownedBy(filter.owner);
    const page = await q
      .orderBy(asc("$key"))
      .limit(Math.min(filter.limit ?? MAX_PAGE, MAX_PAGE))
      .fetch();
    return { entities: (page.entities as unknown as Row[]).map(toStored), blockNumber: page.blockNumber };
  };

  return {
    query,
    async get(k) {
      const page = await query({ equals: { $key: key(k) }, limit: 1 });
      return page.entities[0] ?? null;
    },
    async head() {
      const b = await pub.getBlock({ blockTag: "latest" });
      return { number: b.number, hash: b.hash, timestamp: b.timestamp };
    },
    async block(number) {
      const b = await pub.getBlock({ blockNumber: number });
      return { number: b.number, hash: b.hash, timestamp: b.timestamp };
    },
    balance: (address) => pub.getBalance({ address }),
    async receipt(txHash) {
      try {
        const [r, tx] = await Promise.all([
          pub.getTransactionReceipt({ hash: txHash }),
          pub.getTransaction({ hash: txHash }),
        ]);
        return {
          status: r.status,
          blockNumber: r.blockNumber,
          from: r.from.toLowerCase() as Address,
          to: r.to ? (r.to.toLowerCase() as Address) : null,
          value: tx.value,
        };
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null;
        if ((e as Error).name === "TransactionNotFoundError") return null;
        throw e;
      }
    },
    watch(handlers) {
      return pub.watchEntityEvents({
        onEvent: (e) =>
          handlers.onEvent({
            type: EVENT_TYPES[e.type] ?? "patched",
            entityKey: e.entityKey.toLowerCase() as Hex,
            blockNumber: e.blockNumber,
            txHash: e.transactionHash,
          }),
        onError: handlers.onError,
      });
    },
  };
}

/** Wraps a transport so a transaction hash is reported as soon as the node or wallet returns it. */
function observed(
  route: (method: string, params: unknown) => Promise<unknown>,
  onTxHash?: (hash: Hex) => void,
): Transport {
  return custom({
    async request({ method, params }) {
      const result = await route(method, params);
      if (
        (method === "eth_sendTransaction" || method === "eth_sendRawTransaction") &&
        typeof result === "string"
      )
        onTxHash?.(result as Hex);
      return result;
    },
  });
}

function writerOver(wallet: ReturnType<typeof createWalletClient>, account: Address): ArkivWriter {
  return {
    account: account.toLowerCase() as Address,
    async write(batch: ArkivBatch) {
      const r = await wallet.executeBatch(batch as never);
      return { txHash: r.txHash, created: r.createdEntities.map((k) => k.toLowerCase() as Hex) };
    },
    sendValue: (to, wei) =>
      wallet.sendTransaction({ to, value: wei, account: wallet.account!, chain: wallet.chain } as never),
  };
}

/** The app's writer: the connected wallet signs every action (B1.1-R2). */
export function createWalletWriter(
  provider: EIP1193Provider,
  address: Address,
  access: RabdiAccess = {},
  onTxHash?: (hash: Hex) => void,
): ArkivWriter {
  const chain = rabdiChain(access);
  const reads = createPublicClient({ chain, transport: http(rabdiRpcUrl(access)) });
  const transport = observed(
    (method, params) =>
      WALLET_METHODS.has(method) || method.startsWith("wallet_")
        ? provider.request({ method, params } as never)
        : reads.request({ method, params } as never),
    onTxHash,
  );
  return writerOver(createWalletClient({ chain, transport, account: address }) as never, address);
}

/** A Node-only writer for local scripts and the CLI; the key comes from that machine's .env. */
export function createKeyWriter(
  privateKey: Hex,
  access: RabdiAccess = {},
  onTxHash?: (hash: Hex) => void,
): ArkivWriter {
  const account = privateKeyToAccount(privateKey);
  const chain = rabdiChain(access);
  const reads = createPublicClient({ chain, transport: http(rabdiRpcUrl(access)) });
  const transport = observed((method, params) => reads.request({ method, params } as never), onTxHash);
  return writerOver(createWalletClient({ chain, transport, account }) as never, account.address);
}
