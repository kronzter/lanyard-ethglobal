// Locally signed Arkiv summary transactions, prepared without broadcast and journaled by freeze.
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk";
import { createPublicClient, type TransactionSerialized } from "viem";
import { sendRawTransaction } from "viem/actions";
import {
  http,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  decodeEventLog,
  TransactionReceiptNotFoundError,
  TransactionNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyWriter, createArkivReader } from "../src/arkiv/client";
import { rabdiChain, rabdiRpcUrl, type RabdiAccess } from "../src/arkiv/chain";
import { buildCreate } from "../src/arkiv/writers";
import { decodeRecord } from "../src/arkiv/readers";
import { parseJsonStrict } from "../src/shared/canonical";
import { ResultsBodySchema, type ResultsBody } from "../src/shared/evidence/bundle";
import { requireMeasured } from "../src/shared/config/unmeasured";
import type { EventConfig } from "../src/shared/config/schema";
import type { PreparedPublication } from "../src/shared/interfaces/results-publisher";
import type { Hex } from "../src/shared/types/primitives";
import type { SummaryTransport } from "./freeze-core";
const ARKIV = "0x4400000000000000000000000000000000000044";
export function summaryTransport(config: EventConfig, secret: Hex, access: RabdiAccess): SummaryTransport {
  const chain = rabdiChain(access);
  const client = createPublicClient({ chain, transport: http(rabdiRpcUrl(access)) });
  const reader = createArkivReader(access);
  const signer = privateKeyToAccount(secret).address.toLowerCase();
  const confirmations = requireMeasured(config.chains.rabdi.confirmations, "Rabdi confirmations");
  async function check(tx: PreparedPublication) {
    const parsed = parseTransaction(tx.rawTransaction);
    if (
      keccak256(tx.rawTransaction) !== tx.txHash ||
      BigInt(parsed.nonce ?? -1) !== tx.nonce ||
      parsed.chainId !== config.chains.rabdi.chainId ||
      parsed.to?.toLowerCase() !== ARKIV ||
      (
        await recoverTransactionAddress({ serializedTransaction: tx.rawTransaction as TransactionSerialized })
      ).toLowerCase() !== signer
    )
      throw new Error("Saved signed summary transaction identity/hash/nonce differs");
  }
  const reconcile: SummaryTransport["reconcile"] = async (tx) => {
    await check(tx);
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: tx.txHash });
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError))
        throw new Error("Summary receipt RPC is unavailable", { cause: e });
      try {
        await client.getTransaction({ hash: tx.txHash });
        return "pending";
      } catch (inner) {
        if (inner instanceof TransactionNotFoundError) return "unknown";
        throw new Error("Summary transaction RPC is unavailable", { cause: inner });
      }
    }
    if (receipt.status !== "success") return "reverted";
    const head = await client.getBlockNumber();
    if (head < receipt.blockNumber + BigInt(confirmations) - 1n) return "pending";
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) throw new Error("Summary receipt is not canonical");
    if (receipt.from.toLowerCase() !== signer || receipt.to?.toLowerCase() !== ARKIV)
      throw new Error("Summary receipt signer/destination differs");
    const keys: Hex[] = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ARKIV) continue;
      try {
        const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data, topics: log.topics });
        if (event.eventName === "EntityCreated" && event.args.owner.toLowerCase() === signer)
          keys.push(event.args.entityKey);
      } catch {
        continue;
      }
    }
    if (keys.length !== 1) throw new Error("Summary receipt must create exactly one owned entity");
    return {
      txHash: tx.txHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      resultsKey: keys[0]!,
    };
  };
  return {
    async prepare(body: ResultsBody) {
      const head = await reader.head();
      let prepared: PreparedPublication | null = null;
      const writer = createKeyWriter(secret, access, undefined, async (raw) => {
        const parsed = parseTransaction(raw);
        prepared = { rawTransaction: raw, txHash: keccak256(raw), nonce: BigInt(parsed.nonce!) };
        throw new Error("Prepared transaction captured; broadcast deliberately withheld");
      });
      try {
        await writer.write({
          creates: [
            buildCreate(
              "results",
              { edition: config.edition, byLabel: "results", times: config.times, head },
              { summary: body },
            ),
          ],
        });
      } catch {
        if (!prepared)
          throw new Error("Could not prepare the signed summary transaction; no broadcast attempted");
      }
      if (!prepared) throw new Error("Summary writer did not expose prepared bytes");
      await check(prepared);
      return prepared;
    },
    async broadcast(tx) {
      await check(tx);
      const hash = await sendRawTransaction(client, {
        serializedTransaction: tx.rawTransaction as TransactionSerialized,
      });
      if (hash !== tx.txHash) throw new Error("Summary broadcast hash differs");
      await client.waitForTransactionReceipt({ hash, confirmations, timeout: 120_000 });
      const result = await reconcile(tx);
      if (typeof result === "string") throw new Error(`Summary ${result}; resume this saved job`);
      return result;
    },
    reconcile,
    async read(key) {
      const entity = await reader.get(key);
      if (!entity) return null;
      const decoded = decodeRecord(entity, "results");
      if (
        !decoded ||
        decoded.creator !== signer ||
        !entity.flags.readonly ||
        !entity.flags.permissionlessExtension
      )
        throw new Error("Summary readback has invalid provenance/flags");
      const raw = String(decoded.values.summary);
      const bytes = Uint8Array.from(raw.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));
      return ResultsBodySchema.parse(
        parseJsonStrict(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    },
  };
}
