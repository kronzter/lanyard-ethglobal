import { describe, expect, it } from "vitest";
import {
  LockedError,
  PublicationPendingError,
  StateMismatchError,
  UnknownTransactionError,
} from "../interfaces/results-publisher";
import {
  MockResultsPublisher,
  PublisherCrashError,
  type ReceiptOutcome,
} from "../mocks/mock-results-publisher";
import { MemoryPublisherStore } from "../mocks/publisher-store";

const h = (c: string) => `0x${c.repeat(64)}` as const;
const input = {
  event: "mumbai2026",
  resultsKey: h("1"),
  resultsHash: h("2"),
  bundleHash: h("3"),
  bundleUri: "https://x.example/b.json",
};
const winner = (team: string) => ({ ...input, team, prizes: ["Arkiv 1st"] });

/** Await a rejection, assert its class and return its transaction hash. */
async function hashOf(
  promise: Promise<unknown>,
  kind: typeof PublicationPendingError | typeof PublisherCrashError,
): Promise<`0x${string}`> {
  const e = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(kind);
  return (e as PublicationPendingError).txHash;
}

function harness() {
  const store = new MemoryPublisherStore();
  const queue: ReceiptOutcome[] = [];
  const open = () => new MockResultsPublisher({ store, outcome: () => queue.shift() ?? "success" });
  return { open, queue };
}

describe("MockResultsPublisher", () => {
  it("publishes, declares and locks in order, with increasing mock blocks", async () => {
    const { open } = harness();
    const p = open();
    const a = await p.setEventResults(input);
    const b = await p.declareWinner(winner("zkpay"));
    const c = await p.lockResults(await p.state());
    expect([a.blockNumber, b.blockNumber, c.blockNumber]).toEqual([1n, 2n, 3n]);
    expect(await p.state()).toMatchObject({ locked: true, winners: { zkpay: winner("zkpay") } });
  });

  it("re-validates a pending transaction when it settles, so it can still revert", async () => {
    const { open, queue } = harness();
    const p = open();
    await p.setEventResults(input);
    queue.push("pending");
    const pending = await hashOf(p.declareWinner(winner("zkpay")), PublicationPendingError);
    await expect(p.lockResults(await p.state())).rejects.toThrow(/reconcile pending/);
    await p.settle(pending, "success");
    expect(await p.reconcile(pending)).toMatchObject({ txHash: pending });
  });

  it("rejects winners with no prize or a non-team label", async () => {
    const { open } = harness();
    const p = open();
    await p.setEventResults(input);
    await expect(p.declareWinner({ ...winner("zkpay"), prizes: [] })).rejects.toThrow(StateMismatchError);
    await expect(p.declareWinner(winner("judges"))).rejects.toThrow(StateMismatchError);
  });

  it("keeps a crashed broadcast for the next instance to reconcile", async () => {
    const { open, queue } = harness();
    queue.push("crash-after-broadcast");
    const hash = await hashOf(open().setEventResults(input), PublisherCrashError);
    expect(await open().reconcile(hash)).toMatchObject({ txHash: hash, blockNumber: 1n });
  });

  it("refuses every write once locked and unknown hashes always", async () => {
    const { open } = harness();
    const p = open();
    await p.setEventResults(input);
    await p.lockResults(await p.state());
    await expect(p.declareWinner(winner("zkpay"))).rejects.toThrow(LockedError);
    await expect(open().reconcile(h("f"))).rejects.toThrow(UnknownTransactionError);
  });
});
