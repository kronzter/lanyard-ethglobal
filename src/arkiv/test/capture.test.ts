import { describe, expect, it } from "vitest";
import { ConflictingCaptureError } from "@/shared/evidence/observation";
import { eventConfig } from "@/shared/event.config";
import type { Hex } from "@/shared/types/primitives";
import {
  CaptureError,
  captureForEvent,
  decodeLines,
  encodeLine,
  memoryObservationStore,
  type ObservationStore,
} from "../capture";
import { FakeArkiv } from "../fake";
import { buildCreate, type WriteContext } from "../writers";

const T = eventConfig.times;
const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;
const K = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const ctx = (byLabel: string): WriteContext => ({ edition: eventConfig.edition, byLabel, times: T });
const content = { page: { title: "zkPay", description: "", members: ["Person A"], links: {} } };

async function setup() {
  const f = new FakeArkiv(T.eventStart - 10_000n);
  const network = { chainId: 7794095, resetId: (await f.block(0n)).hash };
  const store = memoryObservationStore();
  const run = (s: ObservationStore = store, maxPages?: number) =>
    captureForEvent({ reader: f, edition: eventConfig.edition, network, store: s, maxPages });
  return { f, network, store, run };
}

describe("captureForEvent", () => {
  it("retains readonly records with observation metadata and excludes mutable drafts", async () => {
    const { f, store, run } = await setup();
    await f.writer(A).write({
      creates: [
        buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
        buildCreate("project", ctx("zkpay"), { team: "zkpay", track: "main", content }),
      ],
    });
    const r = await run();
    expect(r).toMatchObject({ complete: true, gaps: [], newlyRetained: 1, excludedMutable: 1 });
    const [o] = (await store.load()).observations;
    expect(o!.kind).toBe("ticket");
    expect(o!.observedAtBlock).toBe(r.pages[0]!.blockNumber);
    expect(o!.createdAtTimestamp).toBe((await f.block(o!.createdAtBlock)).timestamp);
    expect(o!.attributes.map((a) => a.name)).toEqual([...o!.attributes.map((a) => a.name)].sort());
  });

  it("keeps deleted records usable, marks them gone once, and accepts a transferred readonly record", async () => {
    const { f, store, run } = await setup();
    const [t, u] = (
      await f.writer(A).write({
        creates: [
          buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
          buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "power" }),
        ],
      })
    ).created;
    await run();
    await f
      .writer(A)
      .write({ deletes: [{ entityKey: t! }], ownershipChanges: [{ entityKey: u!, newOwner: B }] });
    const r = await run();
    expect(r.newlyGone).toEqual([{ key: t, atBlock: r.pages[0]!.blockNumber, reason: "deleted" }]);
    expect((await run()).newlyGone).toEqual([]);
    expect((await store.load()).observations.map((o) => o.key).sort()).toEqual([t, u].sort());
  });

  it("fails closed on an exhausted budget, a reset chain and conflicting readonly bytes", async () => {
    const { f, network, store, run } = await setup();
    await f.writer(A).write({
      creates: Array.from({ length: 101 }, () =>
        buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
      ),
    });
    const partial = await run(memoryObservationStore(), 1);
    expect(partial.complete).toBe(false);
    expect(partial.gaps[0]).toMatch(/budget/);
    expect(partial.newlyGone).toEqual([]);
    await expect(
      captureForEvent({
        reader: f,
        edition: eventConfig.edition,
        network: { ...network, resetId: K(7) },
        store,
      }),
    ).rejects.toThrow(CaptureError);
    await run();
    const [first] = (await store.load()).observations;
    const forged: ObservationStore = {
      ...store,
      load: async () => ({
        observations: [
          {
            ...first!,
            attributes: first!.attributes.map((a) => (a.name === "category" ? { ...a, value: "food" } : a)),
          },
        ],
        gone: [],
      }),
    };
    await expect(run(forged)).rejects.toThrow(ConflictingCaptureError);
  });

  it("round-trips its JSONL lines", async () => {
    const { f, store, run } = await setup();
    await f.writer(A).write({
      creates: [
        buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
      ],
    });
    await run();
    const { observations } = await store.load();
    const text = [
      encodeLine({ type: "observation", observation: observations[0]! }),
      encodeLine({ type: "gone", key: K(5), atBlock: 9n, reason: "expired" }),
    ].join("\n");
    const back = decodeLines(text);
    expect(back.observations).toEqual(observations);
    expect(back.gone).toEqual([{ key: K(5), atBlock: 9n, reason: "expired" }]);
  });
});
