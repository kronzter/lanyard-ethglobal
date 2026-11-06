import { describe, expect, it } from "vitest";
import {
  RouterInputError,
  checkTicketInputs,
  compareKeys,
  ticketScore,
  uniqueStops,
} from "../interfaces/router";
import type { Hex } from "../types/primitives";

const key = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const ticket = (created: bigint, n = 1) => ({ key: key(n), cell: { x: 0, y: 0 }, createdAtSeconds: created });

describe("ticketScore", () => {
  it("discounts whole minutes waited", () => {
    expect(ticketScore(10_000, ticket(0n), 0n, 5_000)).toBe(10_000n);
    expect(ticketScore(10_000, ticket(0n), 59n, 5_000)).toBe(10_000n);
    expect(ticketScore(10_000, ticket(0n), 60n, 5_000)).toBe(5_000n);
    expect(ticketScore(10_000, ticket(0n), 300n, 5_000)).toBe(-15_000n);
  });

  it.each([
    ["a future ticket", () => ticketScore(0, ticket(61n), 60n, 5_000)],
    ["a negative alpha", () => ticketScore(0, ticket(0n), 60n, -1)],
    ["a fractional alpha", () => ticketScore(0, ticket(0n), 60n, 1.5)],
    ["a fractional distance", () => ticketScore(0.5, ticket(0n), 60n, 1)],
    ["a score outside safe bounds", () => ticketScore(0, ticket(0n), 10n ** 15n, Number.MAX_SAFE_INTEGER)],
  ])("rejects %s", (_name, call) => {
    expect(call).toThrow(RouterInputError);
  });

  it("validates a whole list up front", () => {
    expect(() => checkTicketInputs([ticket(0n), ticket(100n, 2)], 50n, 5_000)).toThrow(RouterInputError);
  });
});

describe("uniqueStops and compareKeys", () => {
  it("collapses duplicates and rejects a project at two cells", () => {
    const a = { projectKey: key(1), cell: { x: 1, y: 1 } };
    expect(
      uniqueStops([a, { ...a, projectKey: key(1).toUpperCase().replace("0X", "0x") as Hex }]),
    ).toHaveLength(1);
    expect(() => uniqueStops([a, { projectKey: key(1), cell: { x: 2, y: 1 } }])).toThrow(
      /two different cells/,
    );
  });

  it("orders keys case-insensitively", () => {
    expect([key(2), key(10), key(1)].sort(compareKeys)).toEqual([key(1), key(2), key(10)]);
    expect(compareKeys("0xAB", "0xab")).toBe(0);
  });
});
