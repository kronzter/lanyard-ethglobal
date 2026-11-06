import { describe, expect, it } from "vitest";
import mumbaiJson from "../../../fixtures/venue.mumbai.json";
import { eventConfig } from "@/shared/event.config";
import { type CellRef, type Venue, cellIndex, decodeWalkable, parseVenue } from "@/shared/types/venue";
import { buildVenue } from "../layout";
import { mumbaiLayout } from "./mumbai";

const venue = parseVenue(mumbaiJson);

/** Cells reachable on foot from `from`, moving between edge-adjacent walkable cells. */
function reachable(v: Venue, from: CellRef): Uint8Array {
  const { cols, rows } = v.grid;
  const mask = decodeWalkable(v.walkable, cols, rows);
  const seen = new Uint8Array(cols * rows);
  const queue = [from];
  seen[cellIndex(from, cols)] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (n.x < 0 || n.y < 0 || n.x >= cols || n.y >= rows) continue;
      const i = cellIndex(n, cols);
      if (mask[i] && !seen[i]) {
        seen[i] = 1;
        queue.push(n);
      }
    }
  }
  return seen;
}

describe("fixtures/venue.mumbai.json", () => {
  it("is exactly what the layout builds (run pnpm venue:mumbai after changing the layout)", () => {
    expect(venue).toEqual(parseVenue(buildVenue(mumbaiLayout)));
  });

  it("is a ~96 × 60 m hall of 1 m cells holding about 800 seats", () => {
    expect(venue.grid).toMatchObject({ cols: 96, rows: 60, cellSizeMm: 1000 });
    expect(venue.seats.length).toBeGreaterThanOrEqual(750);
    expect(venue.seats.length).toBeLessThanOrEqual(850);
    expect(venue.seats.map((s) => s.id)).toEqual(
      venue.seats.map((_, i) => `s${String(i + 1).padStart(3, "0")}`),
    );
  });

  it("fits an Arkiv record with room to spare (A3.1-R4)", () => {
    expect(new TextEncoder().encode(JSON.stringify(venue)).length).toBeLessThan(120 * 1024);
  });

  it("gives every zone a help desk (A3.1-R6)", () => {
    for (const z of venue.zones)
      expect(
        venue.pois.some((p) => p.kind === "help-desk" && p.zone === z.id),
        z.id,
      ).toBe(true);
  });

  it("has a table for every configured partner and none for unknown partners (A3.1-R7)", () => {
    const tables = venue.pois.filter((p) => p.kind === "partner-table").map((p) => p.partner);
    const partners = eventConfig.partners.map((p) => p.id);
    for (const id of partners) expect(tables, id).toContain(id);
    for (const id of tables) expect(partners).toContain(id);
  });

  it("keeps 8 partner booths, placeholders included, so new partners need no redraw", () => {
    expect(venue.pois.filter((p) => p.id.startsWith("booth-"))).toHaveLength(8);
  });

  it("lets every seat be reached from its zone's help desk, and every POI from the entry", () => {
    const { cols } = venue.grid;
    for (const z of venue.zones) {
      const desk = venue.pois.find((p) => p.kind === "help-desk" && p.zone === z.id)!;
      const seen = reachable(venue, desk.cell);
      const stranded = venue.seats.filter((s) => s.zone === z.id && !seen[cellIndex(s.cell, cols)]);
      expect(
        stranded.map((s) => s.id),
        z.id,
      ).toEqual([]);
    }
    const fromEntry = reachable(venue, venue.pois.find((p) => p.id === "entry")!.cell);
    expect(venue.pois.filter((p) => !fromEntry[cellIndex(p.cell, cols)]).map((p) => p.id)).toEqual([]);
  });
});
