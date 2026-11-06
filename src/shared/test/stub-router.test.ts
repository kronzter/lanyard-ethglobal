import { describe, expect, it } from "vitest";
import { RouterInputError } from "../interfaces/router";
import { fixtureVenue } from "../mocks/fixtures";
import { StubRouter } from "../mocks/stub-router";
import type { Hex } from "../types/primitives";

const router = new StubRouter();
const venue = fixtureVenue();
const key = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const deskWest = { x: 1, y: 10 };

describe("StubRouter", () => {
  it("measures integer Manhattan millimetres and ignores walls", () => {
    const d = router.distances(venue, deskWest);
    expect(d.size).toBe(20 * 12);
    expect(d.get("1,10")).toBe(0);
    expect(d.get("4,6")).toBe((3 + 4) * 1000); // a wall cell still gets a distance
    expect(d.get("16,9")).toBe((15 + 1) * 1000); // so does the walled-in seat
  });

  it("draws a straight line including both endpoints", () => {
    expect(router.path(venue, { x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(router.path(venue, { x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
    expect(router.path(venue, { x: 0, y: 0 }, { x: 25, y: 0 })).toBeNull();
  });

  it("offers the nearest ticket until the waiting discount outweighs the extra distance", () => {
    // near is 1 m from the desk, far is 10 m: far needs more than 9 m of discount (two minutes at 5 m/min).
    const near = { key: key(2), cell: { x: 2, y: 10 }, createdAtSeconds: 1_000n };
    const far = (waitedSeconds: bigint) => ({
      key: key(1),
      cell: { x: 11, y: 10 },
      createdAtSeconds: 1_000n - waitedSeconds,
    });
    expect(router.nextTicket(venue, deskWest, [far(0n), near], 1_000n, 5_000)).toEqual(near);
    expect(router.nextTicket(venue, deskWest, [far(60n), near], 1_000n, 5_000)).toEqual(near); // 10 - 5 = 5 m > 1 m
    expect(router.nextTicket(venue, deskWest, [far(120n), near], 1_000n, 5_000)).toEqual(far(120n)); // 10 - 10 = 0 m < 1 m
    expect(router.nextTicket(venue, deskWest, [far(120n), near], 1_000n, 0)).toEqual(near); // no discount
  });

  it("breaks equal scores by the lowest key", () => {
    const a = { key: key(9), cell: { x: 2, y: 10 }, createdAtSeconds: 0n };
    const b = { key: key(4), cell: { x: 0, y: 10 }, createdAtSeconds: 0n };
    expect(router.nextTicket(venue, deskWest, [a, b], 0n, 5_000)).toEqual(b);
  });

  it("skips off-grid tickets and validates every input", () => {
    const off = { key: key(3), cell: { x: 99, y: 0 }, createdAtSeconds: 0n };
    expect(router.nextTicket(venue, deskWest, [off], 0n, 5_000)).toBeNull();
    expect(router.nextTicket(venue, deskWest, [], 0n, 5_000)).toBeNull();
    expect(() => router.nextTicket(venue, deskWest, [{ ...off, createdAtSeconds: 10n }], 0n, 5_000)).toThrow(
      RouterInputError,
    );
    expect(() => router.nextTicket(venue, { x: -1, y: 0 }, [], 0n, 5_000)).toThrow(RouterInputError);
  });

  it("visits each judge stop once, nearest first", () => {
    const stops = [
      { projectKey: key(3), cell: { x: 14, y: 2 } },
      { projectKey: key(1), cell: { x: 2, y: 2 } },
      { projectKey: key(2), cell: { x: 6, y: 2 } },
      { projectKey: key(1), cell: { x: 2, y: 2 } },
    ];
    expect(router.judgeRoute(venue, { x: 0, y: 2 }, stops)).toEqual([key(1), key(2), key(3)]);
    expect(router.judgeRoute(venue, { x: 0, y: 2 }, [])).toEqual([]);
    expect(() =>
      router.judgeRoute(venue, { x: 0, y: 2 }, [{ projectKey: key(4), cell: { x: 40, y: 2 } }]),
    ).toThrow(RouterInputError);
  });
});
