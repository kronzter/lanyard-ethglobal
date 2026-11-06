// The per-device, per-account write queue (B1.3-R1/R2).
//
// Every write is journaled before the wallet is asked: `prepared` → (hash arrives) `submitted` →
// `confirmed` (receipt) → `verified` (every created key read back). A wallet rejection is dropped
// with a message and never retried. Anything that cannot be settled stays `uncertain` and blocks
// the account's next signature until it is reconciled by its transaction hash; an empty readback
// or a missing receipt never counts as failure, and nothing is ever resent automatically. The
// journal is per device: two devices signing for one wallet are not coordinated (disclosed).
import { isUserRejection, type ArkivBatch, type ArkivReader, type ArkivWriter } from "./api";
import type { KeyValueStore } from "./store";
import type { Address, Hex } from "@/shared/types/primitives";

export type IntentStatus = "prepared" | "submitted" | "confirmed" | "verified" | "uncertain" | "failed";

export type Intent = {
  id: string;
  account: Address;
  /** What the user is doing, in their words: "Clock Ravi in", "Raise a Wi-Fi ticket". */
  label: string;
  status: IntentStatus;
  txHash?: Hex;
  created?: Hex[];
  expectedCreates: number;
  detail?: string;
  createdAtMs: number;
};

export type SubmitResult =
  | { status: "verified" | "confirmed"; intent: Intent; created: Hex[]; txHash: Hex }
  | { status: "rejected"; message: string }
  | { status: "blocked"; pending: Intent[]; message: string }
  | { status: "uncertain" | "failed"; intent: Intent; message: string };

/** SDK validation errors are thrown before anything is signed or sent. */
const PRE_SEND = new Set([
  "WriteRejected",
  "InvalidValueError",
  "InvalidExpiryError",
  "EntityTooLargeError",
  "TooManyAttributesError",
  "SchemaMismatchError",
  "MissingValueError",
  "EmptyPatchError",
  "ConflictingMutationError",
  "InvalidAttributeNameError",
  "FakeArkivError",
]);

const INDEX = "queue:index";

export class WriteQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(
    private readonly deps: {
      store: KeyValueStore;
      reader: ArkivReader;
      /** Builds the account's writer; `onTxHash` must fire as soon as a hash exists. */
      writer: (onTxHash: (hash: Hex) => void) => ArkivWriter;
      account: Address;
      now?: () => number;
    },
  ) {}

  private key = (id: string) => `queue:intent:${id}`;
  private now = () => (this.deps.now ?? Date.now)();

  private async ids(): Promise<string[]> {
    return JSON.parse((await this.deps.store.get(INDEX)) ?? "[]") as string[];
  }
  private async save(i: Intent): Promise<void> {
    await this.deps.store.set(this.key(i.id), JSON.stringify(i));
    const ids = await this.ids();
    if (!ids.includes(i.id)) await this.deps.store.set(INDEX, JSON.stringify([...ids, i.id]));
  }
  private async drop(id: string): Promise<void> {
    await this.deps.store.delete(this.key(id));
    await this.deps.store.set(INDEX, JSON.stringify((await this.ids()).filter((x) => x !== id)));
  }

  /** Every journaled intent for this account that has not settled, oldest first. */
  async pending(): Promise<Intent[]> {
    const out: Intent[] = [];
    for (const id of await this.ids()) {
      const raw = await this.deps.store.get(this.key(id));
      if (!raw) continue;
      const i = JSON.parse(raw) as Intent;
      if (
        i.account === this.deps.account &&
        i.status !== "verified" &&
        i.status !== "confirmed" &&
        i.status !== "failed"
      )
        out.push(i);
    }
    return out.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  /** Settled history kept for display (confirmed/verified/failed); the caller may `dismiss` it. */
  async history(): Promise<Intent[]> {
    const out: Intent[] = [];
    for (const id of await this.ids()) {
      const raw = await this.deps.store.get(this.key(id));
      if (raw) out.push(JSON.parse(raw) as Intent);
    }
    return out.filter((i) => i.account === this.deps.account).sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  async dismiss(id: string): Promise<void> {
    await this.drop(id);
  }

  /**
   * Settle what the journal knows (on start, on foreground, and before every new signature).
   * A hash with a receipt becomes confirmed or failed; without a receipt it stays uncertain.
   * A prepared intent with no hash is uncertain: the wallet may or may not have sent it.
   */
  async reconcile(): Promise<Intent[]> {
    for (const i of await this.pending()) {
      if (i.txHash) {
        const r = await this.deps.reader.receipt(i.txHash);
        if (!r)
          await this.save({ ...i, status: "uncertain", detail: "no receipt yet; checking again later" });
        else if (r.status === "reverted")
          await this.save({ ...i, status: "failed", detail: "the transaction reverted" });
        else await this.save({ ...i, status: "confirmed", detail: `confirmed in block ${r.blockNumber}` });
      } else if (i.status === "prepared") {
        await this.save({
          ...i,
          status: "uncertain",
          detail:
            "the app stopped before the wallet returned a transaction; check your wallet's activity before trying again",
        });
      }
    }
    return this.pending();
  }

  /** Queue one batch (one wallet approval). Writes for this account run one at a time. */
  submit(label: string, batch: ArkivBatch): Promise<SubmitResult> {
    const run = this.chain.then(() => this.run(label, batch));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async run(label: string, batch: ArkivBatch): Promise<SubmitResult> {
    const blocking = await this.reconcile();
    if (blocking.length > 0)
      return {
        status: "blocked",
        pending: blocking,
        message: `Checking whether "${blocking[0]!.label}" went through before sending anything new`,
      };

    let intent: Intent = {
      id: `${this.now()}-${++this.seq}`,
      account: this.deps.account,
      label,
      status: "prepared",
      expectedCreates: batch.creates?.length ?? 0,
      createdAtMs: this.now(),
    };
    await this.save(intent);
    let hashSaved: Promise<void> = Promise.resolve();
    const writer = this.deps.writer((txHash) => {
      intent = { ...intent, status: "submitted", txHash };
      hashSaved = this.save(intent);
    });

    try {
      const result = await writer.write(batch);
      await hashSaved;
      intent = { ...intent, status: "confirmed", txHash: result.txHash, created: result.created };
      if (result.created.length !== intent.expectedCreates) {
        intent = {
          ...intent,
          status: "uncertain",
          detail: `expected ${intent.expectedCreates} created keys, got ${result.created.length}`,
        };
        await this.save(intent);
        return { status: "uncertain", intent, message: intent.detail! };
      }
      await this.save(intent);
      // Read back; an empty readback is not a failure (indexing can lag), only "not yet verified".
      const seen = await Promise.all(result.created.map((k) => this.deps.reader.get(k).catch(() => null)));
      if (seen.every((e) => e !== null)) {
        intent = { ...intent, status: "verified" };
        await this.save(intent);
        return { status: "verified", intent, created: result.created, txHash: result.txHash };
      }
      return { status: "confirmed", intent, created: result.created, txHash: result.txHash };
    } catch (e) {
      await hashSaved;
      if (isUserRejection(e)) {
        await this.drop(intent.id);
        return { status: "rejected", message: "You cancelled this in your wallet. Nothing was sent." };
      }
      const name = (e as Error).name;
      if (!intent.txHash && PRE_SEND.has(name)) {
        await this.drop(intent.id);
        return { status: "failed", intent: { ...intent, status: "failed" }, message: (e as Error).message };
      }
      const message = (e as Error).message.split("\n")[0]!;
      if (intent.txHash && /revert/i.test(message)) {
        intent = { ...intent, status: "failed", detail: message };
        await this.save(intent);
        return { status: "failed", intent, message };
      }
      intent = { ...intent, status: "uncertain", detail: message };
      await this.save(intent);
      return { status: "uncertain", intent, message: `Checking whether "${label}" went through` };
    }
  }
}
