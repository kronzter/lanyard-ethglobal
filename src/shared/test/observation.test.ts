import { describe, expect, it } from "vitest";
import {
  ConflictingCaptureError,
  CapturedObservationSchema,
  dedupeObservations,
  sortRecords,
  type CapturedObservation,
} from "../evidence/observation";

const h = (c: string) => `0x${c.repeat(64)}`;
const raw = (patch: Record<string, unknown> = {}) => ({
  key: h("a"),
  kind: "final_score",
  creator: "0x00000000000000000000000000000000000000c1",
  owner: "0x00000000000000000000000000000000000000c1",
  flags: { readonly: true, permissionlessExtension: false },
  createdAtBlock: "100",
  updatedAtBlock: "100",
  expiresAtBlock: "5000",
  createdAtTimestamp: "1796500000",
  observedAtBlock: "120",
  observedAtBlockHash: h("b"),
  network: { chainId: 7794095, resetId: h("c") },
  attributes: [
    { name: "app", type: "str", indexed: true, value: "lanyard" },
    { name: "kind", type: "str", indexed: true, value: "final_score" },
  ],
  payload: "0xdeadbeef",
  ...patch,
});
const obs = (patch: Record<string, unknown> = {}): CapturedObservation =>
  CapturedObservationSchema.parse(raw(patch));

describe("CapturedObservation", () => {
  it("parses JSON block numbers into bigints and lowercases hex", () => {
    const o = obs({ key: h("A") });
    expect(o.createdAtBlock).toBe(100n);
    expect(o.key).toBe(h("a"));
  });

  it.each([
    ["a readonly entity that was updated", { updatedAtBlock: "110" }, /readonly/],
    ["an observation before its creation", { observedAtBlock: "99" }, /observed before/],
    ["an expiry before creation", { expiresAtBlock: "100" }, /expires before/],
    ["a deletion before observation", { deletedAtBlock: "120" }, /deleted at or before/],
    [
      "unsorted attributes",
      {
        attributes: [
          { name: "z", type: "str", indexed: false, value: "" },
          { name: "a", type: "str", indexed: false, value: "" },
        ],
      },
      /sorted/,
    ],
    [
      "an unknown attribute type",
      { attributes: [{ name: "a", type: "float", indexed: false, value: "1" }] },
      /type/,
    ],
    ["an unknown field", { resultsKey: h("d") }, /Unrecognized|unrecognized/],
  ])("rejects %s", (_name, patch, message) => {
    expect(() => obs(patch)).toThrow(message);
  });

  it("keeps a deleted source usable when its bytes were retained", () => {
    expect(obs({ deletedAtBlock: "300" }).deletedAtBlock).toBe(300n);
  });
});

describe("ordering and deduplication", () => {
  it("orders by creation block, then key", () => {
    const records = [
      obs({ key: h("b"), createdAtBlock: "50", updatedAtBlock: "50" }),
      obs({ key: h("c") }),
      obs({ key: h("1") }),
    ];
    expect(sortRecords(records).map((r) => r.key)).toEqual([h("b"), h("1"), h("c")]);
  });

  it("keeps the earliest of repeated identical captures", () => {
    const out = dedupeObservations([obs({ observedAtBlock: "200" }), obs({ observedAtBlock: "150" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.observedAtBlock).toBe(150n);
  });

  it("refuses conflicting captures of one readonly key", () => {
    expect(() => dedupeObservations([obs(), obs({ observedAtBlock: "130", payload: "0x00" })])).toThrow(
      ConflictingCaptureError,
    );
  });

  it("does not treat a later owner change as a conflict", () => {
    const moved = obs({ observedAtBlock: "130", owner: "0x00000000000000000000000000000000000000c2" });
    expect(dedupeObservations([obs(), moved])).toHaveLength(1);
  });
});
