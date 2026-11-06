import { ExpirationTime, MAX_LIFETIME } from "@arkiv-network/sdk";
import { defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { describe, expect, it } from "vitest";
import { isUserRejection } from "../api";
import { FakeArkiv, FakeArkivError } from "../fake";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const S = defineSchema({ app: str().indexed(), kind: str().indexed(), n: u64().indexed(), note: str() });
const vals = (n: bigint) =>
  ({ app: "lanyard", kind: "probe", n: { type: "u64", value: n }, note: "x" }) as never;
const create = (flags = {}, expiration = ExpirationTime.fromMinutes(10)) => ({
  schema: S,
  values: vals(1n),
  expiration,
  flags,
});
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof FakeArkivError ? e.reason : String(e);
  }
};

describe("FakeArkiv native rules", () => {
  it("records creator and owner, and only the owner patches", async () => {
    const f = new FakeArkiv();
    const { created } = await f.writer(A).write({ creates: [create()] });
    const e = (await f.get(created[0]!))!;
    expect(e.creator).toBe(A);
    expect(e.owner).toBe(A);
    expect(
      await reason(f.writer(B).write({ patches: [{ schema: S, entityKey: e.key, set: { note: "y" } }] })),
    ).toBe("not-owner");
    await f.writer(A).write({ patches: [{ schema: S, entityKey: e.key, set: { note: "y" } }] });
    expect((await f.get(e.key))!.attributes.note!.value.value).toBe("y");
  });

  it("rejects patching a readonly entity but allows its deletion and transfer", async () => {
    const f = new FakeArkiv();
    const [k1, k2] = (
      await f.writer(A).write({ creates: [create({ readonly: true }), create({ readonly: true })] })
    ).created;
    expect(
      await reason(f.writer(A).write({ patches: [{ schema: S, entityKey: k1!, set: { note: "y" } }] })),
    ).toBe("readonly");
    await f.writer(A).write({ deletes: [{ entityKey: k1! }] });
    expect(await f.get(k1!)).toBeNull();
    await f.writer(A).write({ ownershipChanges: [{ entityKey: k2!, newOwner: B }] });
    const moved = (await f.get(k2!))!;
    expect([moved.owner, moved.creator]).toEqual([B, A]);
  });

  it("never moves expiry earlier, and lets anyone extend only with permissionlessExtension", async () => {
    const f = new FakeArkiv();
    const [mine, open] = (
      await f.writer(A).write({ creates: [create(), create({ permissionlessExtension: true })] })
    ).created;
    const longer = ExpirationTime.fromMinutes(60);
    expect(
      await reason(
        f.writer(A).write({ extensions: [{ entityKey: mine!, expiration: ExpirationTime.fromMinutes(1) }] }),
      ),
    ).toBe("earlier-expiry");
    expect(await reason(f.writer(B).write({ extensions: [{ entityKey: mine!, expiration: longer }] }))).toBe(
      "not-owner",
    );
    await f.writer(B).write({ extensions: [{ entityKey: open!, expiration: longer }] });
    expect((await f.get(open!))!.expiresAt).toBeGreaterThan((await f.get(mine!))!.expiresAt);
  });

  it("expires by block with no event, and caps lifetimes at MAX_LIFETIME", async () => {
    const f = new FakeArkiv();
    const events: string[] = [];
    f.watch({ onEvent: (e) => events.push(e.type), onError: () => {} });
    const [k] = (await f.writer(A).write({ creates: [create({}, ExpirationTime.fromBlocks(5))] })).created;
    f.advance(10n);
    expect(await f.get(k!)).toBeNull();
    expect(events).toEqual(["created"]);
    expect(
      await reason(
        f.writer(A).write({ creates: [create({}, ExpirationTime.fromBlocks(Number(MAX_LIFETIME) + 1))] }),
      ),
    ).toBe("invalid-expiry");
  });

  it("applies a batch atomically: one failing operation leaves nothing behind", async () => {
    const f = new FakeArkiv();
    const [ro] = (await f.writer(A).write({ creates: [create({ readonly: true })] })).created;
    const before = (await f.query({ equals: { kind: { type: "str", value: "probe" } } as never })).entities
      .length;
    expect(
      await reason(
        f
          .writer(A)
          .write({ creates: [create()], patches: [{ schema: S, entityKey: ro!, set: { note: "z" } }] }),
      ),
    ).toBe("readonly");
    expect(
      (await f.query({ equals: { kind: { type: "str", value: "probe" } } as never })).entities.length,
    ).toBe(before);
  });

  it("queries current state by indexed equality, in key order, at most 100 per page, never historically", async () => {
    const f = new FakeArkiv();
    await f.writer(A).write({ creates: Array.from({ length: 105 }, () => create()) });
    const first = await f.query({ equals: { kind: { type: "str", value: "probe" } } as never, limit: 500 });
    expect(first.entities).toHaveLength(100);
    expect(first.entities.map((e) => e.key)).toEqual([...first.entities.map((e) => e.key)].sort());
    const rest = await f.query({
      equals: { kind: { type: "str", value: "probe" } } as never,
      afterKey: first.entities.at(-1)!.key,
    });
    expect(rest.entities).toHaveLength(5);
    expect((await f.query({ equals: { note: { type: "str", value: "x" } } as never })).entities).toHaveLength(
      0,
    ); // unindexed
    expect(await reason(f.query({ equals: {}, atBlock: 1n } as never))).toBe("historical-query");
  });

  it("models page drift, quiet deletions and a lost watcher", async () => {
    const f = new FakeArkiv();
    const [k] = (await f.writer(A).write({ creates: [create(), create()] })).created;
    f.onBeforeQuery(() => f.advance(3n));
    const p1 = await f.query({ equals: { kind: { type: "str", value: "probe" } } as never, limit: 1 });
    const p2 = await f.query({
      equals: { kind: { type: "str", value: "probe" } } as never,
      afterKey: p1.entities[0]!.key,
    });
    expect(p2.blockNumber).toBeGreaterThan(p1.blockNumber);
    const events: string[] = [];
    let err = "";
    f.watch({ onEvent: (e) => events.push(e.type), onError: (e) => (err = e.message) });
    f.deleteQuietly(k!);
    expect(await f.get(k!)).toBeNull();
    expect(events).toEqual([]);
    f.failWatchers();
    expect(err).toMatch(/lost/);
  });

  it("reports a wallet rejection as code 4001", async () => {
    const f = new FakeArkiv();
    f.rejectNextRequest();
    const e = await f
      .writer(A)
      .write({ creates: [create()] })
      .catch((x: unknown) => x);
    expect(isUserRejection(e)).toBe(true);
  });
});
