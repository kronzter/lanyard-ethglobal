import { describe, expect, it } from "vitest";
import { cellKey, decodeWalkable, encodeWalkable, isWalkable, parseVenue, type Venue } from "../types/venue";

// 4×3 grid; row 1 is a wall except x=3.
//   y0: . . . .
//   y1: # # # .
//   y2: . . . .
const mask = [1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1];
const base = (): Venue => ({
  schemaVersion: 1,
  id: "tiny",
  name: "Tiny hall",
  image: { uri: "tiny.png", widthPx: 400, heightPx: 300 },
  grid: { cols: 4, rows: 3, cellSizeMm: 1000, originPx: { x: 0, y: 0 }, cellSizePx: 100 },
  walkable: encodeWalkable(mask),
  zones: [{ id: "north", name: "North" }],
  seats: [{ id: "s1", cell: { x: 0, y: 2 }, zone: "north" }],
  pois: [
    { id: "desk", kind: "help-desk", name: "Help desk", cell: { x: 0, y: 0 }, zone: "north" },
    {
      id: "arkiv-table",
      kind: "partner-table",
      name: "Arkiv",
      cell: { x: 3, y: 0 },
      zone: "north",
      partner: "arkiv",
    },
  ],
});

describe("walkable run-length encoding", () => {
  it("round-trips a mask", () => {
    expect(encodeWalkable(mask)).toEqual([
      [0, 4],
      [7, 5],
    ]);
    expect([...decodeWalkable(encodeWalkable(mask), 4, 3)]).toEqual(mask);
  });

  it("handles empty and full grids", () => {
    expect(encodeWalkable([0, 0, 0])).toEqual([]);
    expect(encodeWalkable([1, 1, 1])).toEqual([[0, 3]]);
  });

  it("answers walkability by cell", () => {
    const v = base();
    expect(isWalkable(v, { x: 3, y: 1 })).toBe(true);
    expect(isWalkable(v, { x: 1, y: 1 })).toBe(false);
    expect(isWalkable(v, { x: 9, y: 9 })).toBe(false);
    expect(cellKey({ x: 3, y: 1 })).toBe("3,1");
  });
});

describe("VenueSchema", () => {
  it("accepts a valid venue", () => {
    expect(parseVenue(base()).pois).toHaveLength(2);
  });

  const rejects = (mutate: (v: Venue) => void, message: RegExp) => {
    const v = base();
    mutate(v);
    expect(() => parseVenue(v)).toThrow(message);
  };

  it("requires a partner on partner-table POIs", () =>
    rejects((v) => delete v.pois[1]!.partner, /needs a partner/));
  it("forbids a partner on other POIs", () =>
    rejects((v) => (v.pois[0]!.partner = "ens"), /only partner-table/));
  it("rejects a seat on a wall", () =>
    rejects((v) => (v.seats[0]!.cell = { x: 1, y: 1 }), /not on a walkable cell/));
  it("rejects a seat outside the grid", () =>
    rejects((v) => (v.seats[0]!.cell = { x: 4, y: 0 }), /outside the grid/));
  it("rejects an unknown zone", () => rejects((v) => (v.seats[0]!.zone = "south"), /unknown zone/));
  it("rejects duplicate ids", () => rejects((v) => (v.seats[0]!.id = "desk"), /unique/));
  it("rejects overlapping runs", () =>
    rejects(
      (v) =>
        (v.walkable = [
          [0, 4],
          [3, 2],
        ]),
      /sorted, non-overlapping/,
    ));
  it("rejects runs past the grid", () => rejects((v) => (v.walkable = [[10, 5]]), /exceeds the grid/));
  it("rejects an unknown POI kind", () =>
    rejects((v) => ((v.pois[0] as { kind: string }).kind = "mentor-desk"), /kind/));
});
