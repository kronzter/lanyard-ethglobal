import { describe, expect, it } from "vitest";
import {
  cellIndex,
  cellKey,
  decodeWalkable,
  parseVenue,
  type CellRef,
  type Venue,
} from "@/shared/types/venue";
import raw from "../venue.small.json";

const venue = parseVenue(raw);

/** Cells reachable from `start` through 8-neighbour walkable steps. */
function reachable(v: Venue, start: CellRef): Set<string> {
  const { cols, rows } = v.grid;
  const mask = decodeWalkable(v.walkable, cols, rows);
  const seen = new Set([cellKey(start)]);
  const queue = [start];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: c.x + dx, y: c.y + dy };
        if (n.x < 0 || n.y < 0 || n.x >= cols || n.y >= rows || mask[cellIndex(n, cols)] !== 1) continue;
        if (!seen.has(cellKey(n))) {
          seen.add(cellKey(n));
          queue.push(n);
        }
      }
    }
  }
  return seen;
}

describe("venue.small.json (P0.4-R2)", () => {
  it("is a 20x12 grid with 12 seats, 2 zones and 3 points of interest", () => {
    expect([venue.grid.cols, venue.grid.rows]).toEqual([20, 12]);
    expect(venue.seats).toHaveLength(12);
    expect(venue.zones.map((z) => z.id)).toEqual(["west", "east"]);
    expect(venue.pois).toHaveLength(3);
  });

  it("has a help desk in each zone plus a stage", () => {
    expect(
      venue.pois
        .filter((p) => p.kind === "help-desk")
        .map((p) => p.zone)
        .sort(),
    ).toEqual(["east", "west"]);
    expect(venue.pois.filter((p) => p.kind === "stage")).toHaveLength(1);
  });

  it("walls in exactly one seat, unreachable from both help desks", () => {
    const desks = venue.pois.filter((p) => p.kind === "help-desk");
    const unreachable = venue.seats.filter((s) =>
      desks.every((d) => !reachable(venue, d.cell).has(cellKey(s.cell))),
    );
    expect(unreachable.map((s) => s.id)).toEqual(["e6-walled"]);
  });

  it("lets every other seat and POI reach both help desks", () => {
    const fromWest = reachable(venue, venue.pois.find((p) => p.id === "desk-west")!.cell);
    for (const p of [...venue.seats.filter((s) => s.id !== "e6-walled"), ...venue.pois]) {
      expect(fromWest.has(cellKey(p.cell)), p.id).toBe(true);
    }
  });

  it("uses the config's 1 m cells", () => {
    expect(venue.grid.cellSizeMm).toBe(1000);
  });
});
