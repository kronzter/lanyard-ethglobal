import { describe, expect, it } from "vitest";
import mumbaiJson from "../../fixtures/venue.mumbai.json";
import { DEFAULT_ALPHA_MM_PER_MINUTE, RouterInputError } from "../shared/interfaces/router";
import { fixtureVenue } from "../shared/mocks/fixtures";
import { runRouterConformance } from "../shared/testing";
import type { Hex } from "../shared/types/primitives";
import {
  cellIndex,
  cellKey,
  decodeWalkable,
  encodeWalkable,
  parseVenue,
  type CellRef,
  type LocatedStop,
  type Venue,
} from "../shared/types/venue";
import { GridRouter, nearestWalkableCell } from "./grid-router";

const router = new GridRouter();
const mumbai = parseVenue(mumbaiJson);
const key = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const T0 = 1_800_000_000n;

/** A venue built from an ASCII map: '.' walkable, '#' blocked. */
function ascii(rows: string[], cellSizeMm = 1000): Venue {
  const cols = rows[0]!.length;
  const mask = new Uint8Array(cols * rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (mask[y * cols + x] = ch === "." ? 1 : 0)));
  return {
    schemaVersion: 1,
    id: "ascii",
    name: "ascii",
    image: { uri: "x.png", widthPx: cols * 10, heightPx: rows.length * 10 },
    grid: { cols, rows: rows.length, cellSizeMm, originPx: { x: 0, y: 0 }, cellSizePx: 10 },
    walkable: encodeWalkable(mask),
    zones: [{ id: "z", name: "Z" }],
    seats: [],
    pois: [],
  };
}

/** The venue with every neighbour of `c` blocked, leaving `c` itself walkable but isolated. */
function wallIn(v: Venue, c: CellRef): Venue {
  const { cols, rows } = v.grid;
  const mask = decodeWalkable(v.walkable, cols, rows);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      if ((dx || dy) && x >= 0 && y >= 0 && x < cols && y < rows) mask[cellIndex({ x, y }, cols)] = 0;
    }
  return { ...v, walkable: encodeWalkable(mask) };
}

runRouterConformance("GridRouter on venue.small.json", () => ({
  router,
  scenario: {
    venue: fixtureVenue(),
    start: { x: 1, y: 10 },
    near: { x: 2, y: 10 },
    far: { x: 11, y: 10 },
    unreachable: { x: 16, y: 9 }, // the walled-in seat
  },
}));

const mumbaiSeat = mumbai.seats[0]!.cell;
const mumbaiWalled = wallIn(mumbai, mumbaiSeat);
const poi = (id: string) => mumbai.pois.find((p) => p.id === id)!.cell;
const deskCell = poi("help-desk");
runRouterConformance("GridRouter on venue.mumbai.json", () => ({
  router,
  scenario: {
    venue: mumbaiWalled,
    start: deskCell,
    near: poi("registration"),
    far: poi("help-east"),
    unreachable: mumbaiSeat,
  },
}));

describe("GridRouter paths and distances", () => {
  it("uses 1000/1414 costs scaled by cellSizeMm, floored", () => {
    const open = ascii(["...", "...", "..."]);
    const d = router.distances(open, { x: 0, y: 0 });
    expect(d.get("1,0")).toBe(1000);
    expect(d.get("1,1")).toBe(1414);
    expect(d.get("2,1")).toBe(2414);
    expect(d.get("2,2")).toBe(2828);
    const big = router.distances(ascii(["...", "...", "..."], 1500), { x: 0, y: 0 });
    expect(big.get("1,1")).toBe(2121); // floor(1414 * 1.5)
    expect(big.get("1,0")).toBe(1500);
  });

  it("path cost equals the Dijkstra distance", () => {
    const v = ascii(["........", ".######.", "........", ".#.####.", "........"]);
    const from = { x: 0, y: 0 };
    const d = router.distances(v, from);
    for (const to of [
      { x: 7, y: 4 },
      { x: 2, y: 3 },
      { x: 4, y: 2 },
    ]) {
      const p = router.path(v, from, to)!;
      let cost = 0;
      for (let i = 1; i < p.length; i++)
        cost += p[i]!.x !== p[i - 1]!.x && p[i]!.y !== p[i - 1]!.y ? 1414 : 1000;
      expect(cost).toBe(d.get(cellKey(to)));
    }
  });

  it("never cuts a blocked corner", () => {
    const v = ascii([".#", "#."]);
    expect(router.path(v, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(router.distances(v, { x: 0, y: 0 }).has("1,1")).toBe(false);
    const half = ascii([".#", ".."]);
    expect(router.path(half, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it("random maps: paths stay on walkable cells with no corner cuts", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let run = 0; run < 200; run++) {
      const rows = Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => (rnd() < 0.3 ? "#" : ".")).join(""),
      );
      const v = ascii(rows);
      const mask = decodeWalkable(v.walkable, 10, 10);
      const ok = (x: number, y: number) => mask[y * 10 + x] === 1;
      const from = { x: Math.floor(rnd() * 10), y: Math.floor(rnd() * 10) };
      const to = { x: Math.floor(rnd() * 10), y: Math.floor(rnd() * 10) };
      const p = router.path(v, from, to);
      expect(p === null).toBe(!router.distances(v, from).has(cellKey(to)));
      p?.forEach((c, i) => {
        expect(ok(c.x, c.y)).toBe(true);
        if (i > 0) {
          const q = p[i - 1]!;
          if (c.x !== q.x && c.y !== q.y) {
            expect(ok(c.x, q.y)).toBe(true);
            expect(ok(q.x, c.y)).toBe(true);
          }
        }
      });
    }
  });

  it("breaks equal-cost ties deterministically", () => {
    const v = ascii(["...", "...", "..."]);
    expect(router.path(v, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    const sq = ascii(["....", "....", "....", "...."]);
    const first = new GridRouter().path(sq, { x: 0, y: 0 }, { x: 3, y: 2 });
    for (let i = 0; i < 5; i++)
      expect(new GridRouter().path(sq, { x: 0, y: 0 }, { x: 3, y: 2 })).toEqual(first);
    expect(first).toHaveLength(4); // two diagonals and one straight step, in a fixed arrangement
  });

  it("treats a blocked or off-grid target as unreachable and rejects an off-grid start", () => {
    const v = ascii(["..#"]);
    expect(router.path(v, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(router.path(v, { x: 0, y: 0 }, { x: 9, y: 0 })).toBeNull();
    expect(() => router.path(v, { x: 9, y: 0 }, { x: 0, y: 0 })).toThrow(RouterInputError);
  });

  it("returns null for a walled-in target on Mumbai well within 50 ms", () => {
    router.path(mumbaiWalled, deskCell, deskCell); // warm up
    const t = performance.now();
    const p = router.path(mumbaiWalled, deskCell, mumbaiSeat);
    const ms = performance.now() - t;
    console.log(`unreachable target on Mumbai: ${ms.toFixed(2)} ms`);
    expect(p).toBeNull();
    expect(ms).toBeLessThan(50);
  });
});

describe("nearestWalkableCell (A3.2-R2)", () => {
  const v = ascii(["#.#", "###", "#.#"]);
  it("returns the nearest walkable cell to a point", () => {
    expect(nearestWalkableCell(v, { x: 1.5, y: 0.5 })).toEqual({ x: 1, y: 0 });
    expect(nearestWalkableCell(v, { x: 1.5, y: 1.6 })).toEqual({ x: 1, y: 2 });
    expect(nearestWalkableCell(v, { x: 99, y: -5 })).toEqual({ x: 1, y: 0 });
  });
  it("breaks ties by row then column, and is null on a fully blocked map", () => {
    expect(nearestWalkableCell(v, { x: 1.5, y: 1.5 })).toEqual({ x: 1, y: 0 });
    expect(nearestWalkableCell(ascii(["##"]), { x: 0, y: 0 })).toBeNull();
    expect(() => nearestWalkableCell(v, { x: NaN, y: 0 })).toThrow(RouterInputError);
  });
});

describe("GridRouter.nextTicket", () => {
  const v = ascii(["..........", "..........", ".#########", ".........."]);
  const from = { x: 0, y: 0 };
  const t = (n: number, cell: CellRef, created: bigint) => ({ key: key(n), cell, createdAtSeconds: created });

  it("rejects future-created tickets even when unreachable", () => {
    expect(() => router.nextTicket(v, from, [t(1, { x: 5, y: 0 }, T0 + 1n)], T0, 0)).toThrow(
      RouterInputError,
    );
    const walled = ascii(["..#.", "..#."]);
    expect(() => router.nextTicket(walled, from, [t(1, { x: 3, y: 0 }, T0 + 1n)], T0, 0)).toThrow(
      RouterInputError,
    );
  });

  it("scores distance minus alpha per whole minute waited", () => {
    const near = t(1, { x: 3, y: 0 }, T0); // 3000 mm
    const far = t(2, { x: 9, y: 0 }, T0 - 119n); // 9000 mm, 1 whole minute waited
    expect(router.nextTicket(v, from, [near, far], T0, 5000)?.key).toBe(near.key); // 4000 > 3000
    const longer = t(2, { x: 9, y: 0 }, T0 - 120n); // 2 whole minutes: -1000 < 3000
    expect(router.nextTicket(v, from, [near, longer], T0, 5000)?.key).toBe(longer.key);
    expect(router.nextTicket(v, from, [near, longer], T0, 0)?.key).toBe(near.key);
    expect(router.nextTicket(v, from, [near, longer], T0, 1_000_000)?.key).toBe(longer.key);
  });

  it("uses walking distance, not straight-line, and ties go to the lowest key", () => {
    const behindWall = t(1, { x: 5, y: 3 }, T0); // through the gap at x = 0
    const open = t(2, { x: 3, y: 0 }, T0);
    expect(router.nextTicket(v, from, [behindWall, open], T0, DEFAULT_ALPHA_MM_PER_MINUTE)?.key).toBe(
      open.key,
    );
    const a = t(7, { x: 2, y: 0 }, T0);
    const b = t(3, { x: 2, y: 0 }, T0);
    expect(router.nextTicket(v, from, [a, b], T0, 0)?.key).toBe(b.key);
  });
});

describe("GridRouter.judgeRoute", () => {
  const v = ascii(["..........", "..........", ".#########", ".........."]);
  const from = { x: 0, y: 0 };

  it("goes nearest-next by walking distance with cell and key ties", () => {
    const stops = [
      { projectKey: key(1), cell: { x: 8, y: 0 } },
      { projectKey: key(2), cell: { x: 2, y: 0 } },
      { projectKey: key(3), cell: { x: 5, y: 0 } },
    ];
    expect(router.judgeRoute(v, from, stops)).toEqual([key(2), key(3), key(1)]);
    const tie = [
      { projectKey: key(9), cell: { x: 1, y: 0 } },
      { projectKey: key(4), cell: { x: 0, y: 1 } },
    ];
    expect(router.judgeRoute(v, from, tie)).toEqual([key(9), key(4)]); // equal 1000 mm: lower (y, x) first
  });

  it("fails on unlocated items and conflicting duplicates", () => {
    expect(() => router.judgeRoute(v, from, [{ projectKey: key(1) } as unknown as LocatedStop])).toThrow();
    expect(() =>
      router.judgeRoute(v, from, [
        { projectKey: key(1), cell: { x: 1, y: 0 } },
        { projectKey: key(1), cell: { x: 2, y: 0 } },
      ]),
    ).toThrow(RouterInputError);
  });

  it("visits unreachable stops last, exactly once", () => {
    const walled = ascii(["..#.", "..#."]);
    const stops = [
      { projectKey: key(1), cell: { x: 3, y: 0 } },
      { projectKey: key(2), cell: { x: 1, y: 1 } },
    ];
    expect(router.judgeRoute(walled, from, stops)).toEqual([key(2), key(1)]);
  });
});
