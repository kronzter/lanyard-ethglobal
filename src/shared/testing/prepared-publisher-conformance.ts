import { emptyPublicationState, type PreparedResultsPublisher } from "../interfaces/results-publisher";
import { expectEqual, expectRejects, registerConformance, type Check } from "./conformance";
import { samplePublication, type PublisherHarness } from "./results-publisher-conformance";
export type PreparedPublisherHarness = Omit<PublisherHarness, "open" | "restart"> & {
  open(): PreparedResultsPublisher;
  restart(): PreparedResultsPublisher;
};
export const preparedPublisherChecks: Check<PreparedPublisherHarness>[] = [
  {
    name: "prepared bytes and nonce survive restart before broadcast",
    async run(h) {
      const p = h.open();
      const tx = await p.prepare({ kind: "setEventResults", input: samplePublication });
      expectEqual(await p.state(), emptyPublicationState(), "preparation has no publication effect");
      const restarted = h.restart();
      expectEqual(await restarted.preparedStatus(tx.txHash), "prepared", "saved intent");
      expectEqual(
        await restarted.prepare({ kind: "setEventResults", input: samplePublication }),
        tx,
        "same raw bytes/hash/nonce",
      );
      expectEqual(await restarted.pendingTransactions(), [tx.txHash], "pending inventory");
      await restarted.broadcastPrepared(tx);
      expectEqual((await h.restart().state()).eventResults, samplePublication, "published after restart");
    },
  },
  {
    name: "tampered prepared bytes are refused",
    async run(h) {
      const p = h.open();
      const tx = await p.prepare({ kind: "setEventResults", input: samplePublication });
      await expectRejects(() => p.broadcastPrepared({ ...tx, rawTransaction: "0x00" }), "tampered bytes");
      expectEqual(await p.state(), emptyPublicationState(), "unchanged publication");
    },
  },
  {
    name: "pending broadcasts require reconciliation instead of another submission",
    async run(h) {
      h.next("pending");
      const p = h.open();
      const tx = await p.prepare({ kind: "setEventResults", input: samplePublication });
      await expectRejects(() => p.broadcastPrepared(tx), "pending receipt");
      expectEqual(await h.restart().preparedStatus(tx.txHash), "pending", "pending status after restart");
      await expectRejects(() => h.restart().broadcastPrepared(tx), "no repeat broadcast");
      await h.settle(tx.txHash, "success");
      expectEqual(typeof (await h.restart().preparedStatus(tx.txHash)), "object", "canonical receipt");
    },
  },
];
export const runPreparedPublisherConformance = (name: string, factory: () => PreparedPublisherHarness) =>
  registerConformance(`${name} prepared publication`, preparedPublisherChecks, factory);
