import { describe, expect, it } from "vitest";
import { emptyPublicationState, samePublicationState } from "../interfaces/results-publisher";
import {
  MemoryPublisherStore,
  createSerializedStore,
  deserializePublisher,
  serializePublisher,
  type PersistedPublisher,
} from "../mocks/publisher-store";

const h = (c: string) => `0x${c.repeat(64)}` as const;
const input = {
  event: "mumbai2026",
  resultsKey: h("1"),
  resultsHash: h("2"),
  bundleHash: h("3"),
  bundleUri: "https://x.example/b.json",
};
const persisted = (): PersistedPublisher => ({
  schemaVersion: 1,
  state: {
    eventResults: input,
    winners: { zkpay: { ...input, team: "zkpay", prizes: ["Arkiv 1st"] } },
    locked: false,
  },
  txs: [
    {
      hash: h("a"),
      seq: 0,
      op: { kind: "setEventResults", input },
      status: "confirmed",
      blockNumber: 12n,
      blockHash: h("b"),
    },
  ],
  nextSeq: 1,
  nextBlock: 13n,
});

describe("publisher persistence", () => {
  it("round-trips through canonical text, bigints included", () => {
    const text = serializePublisher(persisted());
    expect(text).toContain('"nextBlock":"13"');
    expect(deserializePublisher(text)).toEqual(persisted());
  });

  it("rejects corrupt or tampered text", () => {
    expect(() => deserializePublisher("{")).toThrow();
    expect(() =>
      deserializePublisher(serializePublisher(persisted()).replace('"locked":false', '"locked":"no"')),
    ).toThrow();
    const dup = serializePublisher(persisted()).replace('{"nextBlock"', '{"nextBlock":"1","nextBlock"');
    expect(() => deserializePublisher(dup)).toThrow(/duplicate/);
  });

  it("persists through caller-supplied IO, as a file would", async () => {
    let file: string | null = null;
    const io = { read: async () => file, write: async (t: string) => void (file = t) };
    expect(await createSerializedStore(io).load()).toBeNull();
    await createSerializedStore(io).save(persisted());
    expect(await createSerializedStore(io).load()).toEqual(persisted()); // a new store over the same "file"
  });

  it("keeps the in-memory store isolated from later mutation", async () => {
    const store = new MemoryPublisherStore();
    const p = persisted();
    await store.save(p);
    p.state.locked = true;
    expect((await store.load())!.state.locked).toBe(false);
  });

  it("compares publication states canonically", () => {
    const a = {
      ...emptyPublicationState(),
      winners: { a: { ...input, team: "a", prizes: [] }, b: { ...input, team: "b", prizes: [] } },
    };
    const b = { ...emptyPublicationState(), winners: { b: a.winners.b, a: a.winners.a } };
    expect(samePublicationState(a, b)).toBe(true);
    expect(samePublicationState(a, emptyPublicationState())).toBe(false);
  });
});
