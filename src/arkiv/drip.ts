// First-time gas from the desk wallet (B1.1-R7/R8, desk-wallet funding profile chosen by P0.6-S6).
//
// The desk sends `dripWei` tGLM to a new wallet, then writes a readonly `drip {recipient, tx}`
// record from the desk wallet. It refuses before sending when a drip record by the configured desk
// wallet already exists for that address (records by anyone else are ignored), and it journals
// intent before any send so a crash or lost receipt is reconciled by its transaction hash instead
// of being resent. This is desk-side policy, not an on-chain once-per-address guarantee.
import { addr } from "@arkiv-network/sdk/schema";
import type { EventTimes } from "@/shared/config/schema";
import { isAddress, type Address, type Hex } from "@/shared/types/primitives";
import { isUserRejection, type ArkivReader, type ArkivWriter, type StoredEntity } from "./api";
import { APP, KINDS } from "./kinds";
import type { KeyValueStore } from "./store";

export const DESK_LABEL = "desk";

export type DripDeps = {
  reader: ArkivReader;
  desk: ArkivWriter;
  /** The configured desk wallet from deployments/rabdi.json; only its drip records count. */
  deskWallet: Address;
  dripWei: bigint;
  edition: string;
  times: EventTimes;
  journal: KeyValueStore;
  receiptTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type Intent = { status: "prepared" | "sent" | "recorded"; txHash?: Hex; recordKey?: Hex };

export type DripOutcome =
  | { status: "sent"; recipient: Address; txHash: Hex; recordKey: Hex; resumed: boolean }
  | {
      status: "refused";
      reason: "invalid-address" | "not-desk-wallet" | "self" | "already-dripped";
      detail: string;
    }
  | { status: "uncertain"; recipient: Address; txHash?: Hex; detail: string }
  | { status: "rejected"; detail: string }
  | { status: "failed"; txHash: Hex; detail: string };

const journalKey = (edition: string, recipient: Address) => `drip:${edition}:${recipient}`;

/** Drip records written by the configured desk wallet for this recipient (others are ignored). */
export async function findDrips(
  reader: ArkivReader,
  deskWallet: Address,
  edition: string,
  recipient: Address,
): Promise<StoredEntity[]> {
  const page = await reader.query({
    equals: {
      app: { type: "str", value: APP },
      event: { type: "str", value: edition },
      kind: { type: "str", value: "drip" },
      recipient: addr(recipient),
    } as never,
    creator: deskWallet,
  });
  return page.entities;
}

/** Forget an uncertain intent after checking the explorer by hand; never called automatically. */
export const forgetDripIntent = (journal: KeyValueStore, edition: string, recipient: Address) =>
  journal.delete(journalKey(edition, recipient.toLowerCase() as Address));

export async function drip(deps: DripDeps, recipientInput: string): Promise<DripOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const raw = recipientInput.trim();
  if (!isAddress(raw))
    return { status: "refused", reason: "invalid-address", detail: `"${raw}" is not an address` };
  const recipient = raw.toLowerCase() as Address;
  const desk = deps.deskWallet.toLowerCase() as Address;
  if (deps.desk.account !== desk)
    return {
      status: "refused",
      reason: "not-desk-wallet",
      detail: `connected ${deps.desk.account} is not the configured desk wallet ${desk}`,
    };
  if (recipient === desk)
    return { status: "refused", reason: "self", detail: "the desk wallet cannot drip itself" };

  const jkey = journalKey(deps.edition, recipient);
  const saved = await deps.journal.get(jkey);
  const intent: Intent | null = saved ? (JSON.parse(saved) as Intent) : null;
  const save = (i: Intent) => deps.journal.set(jkey, JSON.stringify(i));

  if (intent?.status === "recorded")
    return { status: "refused", reason: "already-dripped", detail: `recorded in ${intent.recordKey}` };
  if (intent?.status === "prepared")
    return {
      status: "uncertain",
      recipient,
      detail:
        "an earlier send was prepared but its transaction hash was never recorded; check the explorer before clearing it",
    };

  const existing = await findDrips(deps.reader, desk, deps.edition, recipient);
  if (existing.length > 0) {
    await save({ status: "recorded", recordKey: existing[0]!.key });
    return { status: "refused", reason: "already-dripped", detail: `drip record ${existing[0]!.key}` };
  }

  const waitReceipt = async (hash: Hex) => {
    const deadline = Date.now() + (deps.receiptTimeoutMs ?? 120_000);
    for (;;) {
      const r = await deps.reader.receipt(hash);
      if (r || Date.now() >= deadline) return r;
      await sleep(deps.pollMs ?? 2_000);
    }
  };

  let txHash: Hex;
  let resumed = false;
  if (intent?.status === "sent" && intent.txHash) {
    // Reconcile the earlier transfer by its hash; never send a second one while it is unresolved.
    const r = await deps.reader.receipt(intent.txHash);
    if (!r)
      return {
        status: "uncertain",
        recipient,
        txHash: intent.txHash,
        detail: "the earlier transfer has no receipt yet",
      };
    if (r.status === "reverted") {
      await deps.journal.delete(jkey); // reverted: nothing moved, so a fresh send is safe
    } else {
      txHash = intent.txHash;
      resumed = true;
    }
  }

  if (!resumed) {
    await save({ status: "prepared" });
    try {
      txHash = await deps.desk.sendValue(recipient, deps.dripWei);
    } catch (e) {
      await deps.journal.delete(jkey);
      if (isUserRejection(e)) return { status: "rejected", detail: "the desk wallet declined the transfer" };
      throw e;
    }
    await save({ status: "sent", txHash });
    const r = await waitReceipt(txHash);
    if (!r)
      return {
        status: "uncertain",
        recipient,
        txHash,
        detail: "no receipt before the timeout; run the drip again to reconcile",
      };
    if (r.status === "reverted") {
      await deps.journal.delete(jkey);
      return { status: "failed", txHash, detail: "the transfer reverted" };
    }
  }

  const kind = KINDS.drip;
  const written = await deps.desk
    .write({
      creates: [
        {
          schema: kind.schema,
          values: {
            app: APP,
            event: deps.edition,
            kind: "drip",
            by_label: DESK_LABEL,
            recipient: addr(recipient),
            tx: txHash!,
          } as never,
          expiration: kind.retention(deps.times),
          flags: kind.flags,
        },
      ],
    })
    .catch(async (e: unknown) => {
      // The tGLM already moved; keep the "sent" intent so the next run writes only the record.
      if (isUserRejection(e)) return null;
      throw e;
    });
  if (!written)
    return {
      status: "uncertain",
      recipient,
      txHash: txHash!,
      detail: "tGLM sent; the drip record was declined, run again to record it",
    };
  const recordKey = written.created[0]!;
  await save({ status: "recorded", txHash: txHash!, recordKey });
  return { status: "sent", recipient, txHash: txHash!, recordKey, resumed };
}
