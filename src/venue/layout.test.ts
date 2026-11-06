import { describe, expect, it } from "vitest";
import { decodeWalkable, isWalkable, parseVenue } from "@/shared/types/venue";
import { type Layout, buildVenue, scaleLayout } from "./layout";

// A 12 × 9 hall: one seating area (x 1–10, y 1–7) and a counter in its top-left corner.
const base: Layout = {
  id: "tiny",
  name: "Tiny hall",
  cols: 12,
  rows: 9,
  cellSizeMm: 1000,
  image: { uri: "tiny.png", widthPx: 240, heightPx: 180 },
  cellSizePx: 20,
  zones: [{ id: "hall", name: "Hall" }],
  seating: [{ name: "Seats", rect: { x0: 1, y0: 1, x1: 10, y1: 7 }, zone: "hall", crossAisleEvery: 5 }],
  blocked: [{ name: "Counter", rect: { x0: 2, y0: 2, x1: 3, y1: 2 } }],
  pois: [{ id: "desk", kind: "help-desk", name: "Desk", cell: { x: 0, y: 8 }, zone: "hall" }],
};
const seatsAt = (v: ReturnType<typeof buildVenue>) => new Set(v.seats.map((s) => `${s.cell.x},${s.cell.y}`));

describe("buildVenue", () => {
  const v = buildVenue(base);

  it("produces a valid venue", () => {
    expect(() => parseVenue(v)).not.toThrow();
  });

  it("lays seat · table · seat rows inside an aisle ring, with cross aisles", () => {
    const seats = seatsAt(v);
    const mask = decodeWalkable(v.walkable, v.grid.cols, v.grid.rows);
    // Ring: walkable, never seats.
    for (const c of [
      { x: 1, y: 1 },
      { x: 10, y: 4 },
      { x: 5, y: 7 },
    ]) {
      expect(isWalkable(v, c, mask)).toBe(true);
      expect(seats.has(`${c.x},${c.y}`)).toBe(false);
    }
    // Inner rows from y = 2 in column 5: seat, table, seat, seat, table.
    expect(seats.has("5,2")).toBe(true);
    expect(isWalkable(v, { x: 5, y: 3 }, mask)).toBe(false);
    expect(seats.has("5,4")).toBe(true);
    expect(seats.has("5,5")).toBe(true);
    expect(isWalkable(v, { x: 5, y: 6 }, mask)).toBe(false);
  });

  it("opens a cross aisle every crossAisleEvery columns", () => {
    const mask = decodeWalkable(v.walkable, v.grid.cols, v.grid.rows);
    const seats = seatsAt(v);
    // Counting from x = 2, every fifth column is an aisle: x = 6 is walkable through table rows.
    expect(isWalkable(v, { x: 6, y: 3 }, mask)).toBe(true);
    expect(isWalkable(v, { x: 6, y: 6 }, mask)).toBe(true);
    expect(seats.has("6,2")).toBe(false);
  });

  it("removes seats under blocked items and numbers the rest in reading order", () => {
    const seats = seatsAt(v);
    expect(seats.has("2,2")).toBe(false);
    expect(seats.has("3,2")).toBe(false);
    expect(v.seats[0]).toEqual({ id: "s001", cell: { x: 4, y: 2 }, zone: "hall" });
    const ids = v.seats.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("cuts the bottom-right corner off a seating area", () => {
    const cut = buildVenue({ ...base, seating: [{ ...base.seating[0]!, cutCorner: 3 }] });
    const mask = decodeWalkable(cut.walkable, cut.grid.cols, cut.grid.rows);
    // Cut where (10 - x) + (7 - y) < 3.
    expect(isWalkable(cut, { x: 10, y: 7 }, mask)).toBe(false);
    expect(isWalkable(cut, { x: 9, y: 6 }, mask)).toBe(false);
    expect(isWalkable(cut, { x: 8, y: 7 }, mask)).toBe(false);
    expect(isWalkable(cut, { x: 7, y: 7 }, mask)).toBe(true);
  });

  it("moves a POI off a blocked cell to the nearest walkable one, and drops a seat there", () => {
    const moved = buildVenue({
      ...base,
      pois: [...base.pois, { id: "snack", kind: "food", name: "Snack", cell: { x: 2, y: 2 }, zone: "hall" }],
    });
    const snack = moved.pois.find((p) => p.id === "snack")!;
    expect(snack.cell).toEqual({ x: 1, y: 1 });
    expect(() => parseVenue(moved)).not.toThrow();
  });
});

describe("scaleLayout", () => {
  it("grows the grid, rectangles and POIs by the factor", () => {
    const big = scaleLayout(base, 2);
    expect([big.cols, big.rows]).toEqual([24, 18]);
    expect(big.image).toMatchObject({ widthPx: 480, heightPx: 360 });
    expect(big.seating[0]!.rect).toEqual({ x0: 2, y0: 2, x1: 21, y1: 15 });
    expect(big.blocked[0]!.rect).toEqual({ x0: 4, y0: 4, x1: 7, y1: 5 });
    expect(big.pois[0]!.cell).toEqual({ x: 1, y: 17 });
    expect(buildVenue(big).seats.length).toBeGreaterThan(v0Seats() * 3);
  });
});

const v0Seats = () => buildVenue(base).seats.length;
