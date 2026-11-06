// The ResultsPublisher conformance suite (plans/P0-foundation.md › P0.3). A harness drives one
// fresh publication "chain" per check: it opens publishers, restarts them (a new instance over
// the same persisted chain, as after a CLI restart), chooses the next receipt outcome and settles
// pending transactions. The mock implements it in memory-backed serialized form; A4.2 can
// implement it against anvil.
import type {
  ConfirmedTx,
  PublicationInput,
  PublicationState,
  ResultsPublisher,
  WinnerInput,
} from "../interfaces/results-publisher";
import type { Hex } from "../types/primitives";
import { expectEqual, expectRejects, expectThat, registerConformance, show, type Check } from "./conformance";

export type HarnessOutcome = "success" | "revert" | "pending" | "crash-after-broadcast";

export type PublisherHarness = {
  open(): ResultsPublisher;
  /** A new publisher instance over the same persisted chain. */
  restart(): ResultsPublisher;
  /** The receipt outcome of the next submitted transaction. */
  next(outcome: HarnessOutcome): void;
  settle(txHash: Hex, outcome: "success" | "revert"): Promise<void>;
};

const h = (c: string) => `0x${c.repeat(64)}` as Hex;
export const samplePublication: PublicationInput = {
  event: "mumbai2026",
  resultsKey: h("1"),
  resultsHash: h("2"),
  bundleHash: h("3"),
  bundleUri: "https://evidence.example/mumbai2026/bundle.json",
};
const winner = (team: string, prizes = ["Arkiv track, 1st"]): WinnerInput => ({
  ...samplePublication,
  team,
  prizes,
});

/** Await a call that must fail and return the transaction hash its error carries. */
async function failedTx(call: Promise<unknown>, what: string): Promise<Hex> {
  const err = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expectThat(err !== null, `${what}: expected the call to throw`);
  const hash = (err as { txHash?: unknown }).txHash;
  expectThat(
    typeof hash === "string" && /^0x[0-9a-f]{64}$/.test(hash),
    `${what}: the error carries the transaction hash`,
  );
  return hash as Hex;
}

function expectConfirmed(tx: unknown, what: string): asserts tx is ConfirmedTx {
  const c = tx as ConfirmedTx;
  expectThat(typeof c === "object" && c !== null, `${what}: a confirmed receipt`);
  expectThat(
    /^0x[0-9a-f]{64}$/.test(c.txHash) && /^0x[0-9a-f]{64}$/.test(c.blockHash),
    `${what}: hashes are 32-byte hex`,
  );
  expectThat(typeof c.blockNumber === "bigint" && c.blockNumber > 0n, `${what}: a block number`);
}

const empty: PublicationState = { eventResults: null, winners: {}, locked: false };

export const resultsPublisherChecks: Check<PublisherHarness>[] = [
  {
    name: "a new publisher starts empty and unlocked",
    run: async (h) => expectEqual(await h.open().state(), empty, "initial state"),
  },
  {
    name: "confirmed event results are visible and survive a restart",
    run: async (h) => {
      const tx = await h.open().setEventResults(samplePublication);
      expectConfirmed(tx, "setEventResults");
      const after = h.restart();
      expectEqual((await after.state()).eventResults, samplePublication, "event pointer after restart");
      expectEqual(await after.reconcile(tx.txHash), tx, "reconcile returns the same receipt");
    },
  },
  {
    name: "a second event publication is refused, matching or conflicting",
    run: async (h) => {
      await h.open().setEventResults(samplePublication);
      await expectRejects(() => h.restart().setEventResults(samplePublication), "matching re-publication");
      await expectRejects(
        () => h.restart().setEventResults({ ...samplePublication, resultsHash: `0x${"9".repeat(64)}` }),
        "conflicting publication",
      );
      expectEqual((await h.restart().state()).eventResults, samplePublication, "the original pointer stays");
    },
  },
  {
    name: "a winner needs the published event and identical publication fields",
    run: async (h) => {
      const p = h.open();
      await expectRejects(() => p.declareWinner(winner("zkpay")), "declaration before the event results");
      await p.setEventResults(samplePublication);
      await expectRejects(
        () => p.declareWinner({ ...winner("zkpay"), bundleHash: `0x${"8".repeat(64)}` }),
        "declaration with another bundle",
      );
      expectConfirmed(await p.declareWinner(winner("zkpay")), "matching declaration");
      expectEqual(
        (await h.restart().state()).winners,
        { zkpay: winner("zkpay") },
        "winner record after restart",
      );
    },
  },
  {
    name: "a duplicate declaration is refused, even after a restart",
    run: async (h) => {
      const p = h.open();
      await p.setEventResults(samplePublication);
      await p.declareWinner(winner("zkpay"));
      await expectRejects(
        () => h.restart().declareWinner(winner("zkpay", ["ENS track, 2nd"])),
        "second declaration for zkpay",
      );
    },
  },
  {
    name: "a reverted receipt throws and leaves the state unchanged",
    run: async (h) => {
      h.next("revert");
      const hash = await failedTx(h.open().setEventResults(samplePublication), "reverted publication");
      expectEqual(await h.restart().state(), empty, "state after the revert");
      expectEqual(await h.restart().reconcile(hash), "reverted", "reconcile");
    },
  },
  {
    name: "a pending transaction blocks resends, stays pending until it settles, then applies",
    run: async (h) => {
      h.next("pending");
      const hash = await failedTx(h.open().setEventResults(samplePublication), "pending publication");
      expectEqual(await h.restart().reconcile(hash), "pending", "reconcile while pending");
      expectEqual((await h.restart().state()).eventResults, null, "no effect while pending");
      await expectRejects(() => h.restart().setEventResults(samplePublication), "resend while pending");
      await h.settle(hash, "success");
      expectConfirmed(await h.restart().reconcile(hash), "reconcile after settling");
      expectEqual((await h.restart().state()).eventResults, samplePublication, "effect after settling");
    },
  },
  {
    name: "a crash after broadcast is reconciled by a new instance without a resend",
    run: async (h) => {
      h.next("crash-after-broadcast");
      const hash = await failedTx(h.open().setEventResults(samplePublication), "crashed publication");
      const after = h.restart();
      expectConfirmed(await after.reconcile(hash), "receipt found after restart");
      expectEqual((await after.state()).eventResults, samplePublication, "the broadcast took effect");
      await expectRejects(() => after.setEventResults(samplePublication), "resend after the crash");
    },
  },
  {
    name: "locking against a stale expected state is refused",
    run: async (h) => {
      const p = h.open();
      await p.setEventResults(samplePublication);
      const stale = await p.state();
      await p.declareWinner(winner("zkpay"));
      await expectRejects(() => p.lockResults(stale), "lock with a state that misses a winner");
      expectEqual((await p.state()).locked, false, "still unlocked");
    },
  },
  {
    name: "the lock covers the event pointer and every winner record",
    run: async (h) => {
      const p = h.open();
      await p.setEventResults(samplePublication);
      await p.declareWinner(winner("zkpay"));
      expectConfirmed(await p.lockResults(await p.state()), "lock");
      const after = h.restart();
      const state = await after.state();
      expectThat(state.locked, "locked after restart");
      await expectRejects(
        () => after.setEventResults({ ...samplePublication, resultsHash: `0x${"7".repeat(64)}` }),
        "event pointer write after lock",
      );
      await expectRejects(() => after.declareWinner(winner("chainchat")), "winner write after lock");
      await expectRejects(() => after.lockResults(state), "second lock");
      expectEqual(await after.state(), state, `state unchanged after refused writes: ${show(state.winners)}`);
    },
  },
  {
    name: "an unknown transaction hash is an error, not a pending result",
    run: async (h) => {
      await expectRejects(() => h.open().reconcile(`0x${"e".repeat(64)}`), "reconcile an unknown hash");
    },
  },
];

export function runResultsPublisherConformance(
  name: string,
  factory: () => PublisherHarness | Promise<PublisherHarness>,
): void {
  registerConformance(`ResultsPublisher conformance: ${name}`, resultsPublisherChecks, factory);
}
