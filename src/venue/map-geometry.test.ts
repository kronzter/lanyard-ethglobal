import { describe, expect, it } from "vitest";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { decodeWalkable, isWalkable } from "@/shared/types/venue";
import { cellCenterPx, mapMarkers, pathPoints, walkableRects } from "./map-geometry";

const venue = fixtureVenue();
const size = venue.grid.cellSizePx;

describe("cellCenterPx", () => {
  it("puts a cell's centre half a cell in from its corner", () => {
    expect(cellCenterPx(venue, { x: 0, y: 0 })).toEqual({ x: size / 2, y: size / 2 });
    expect(cellCenterPx(venue, { x: 2, y: 3 })).toEqual({ x: 2.5 * size, y: 3.5 * size });
  });

  it("offsets by the grid origin on the image", () => {
    const shifted = { ...venue, grid: { ...venue.grid, originPx: { x: 7, y: 11 } } };
    expect(cellCenterPx(shifted, { x: 1, y: 1 })).toEqual({ x: 7 + 1.5 * size, y: 11 + 1.5 * size });
  });
});

describe("walkableRects", () => {
  const rects = walkableRects(venue);
  const mask = decodeWalkable(venue.walkable, venue.grid.cols, venue.grid.rows);

  it("covers exactly the walkable cells", () => {
    const area = rects.reduce((sum, r) => sum + (r.width / size) * (r.height / size), 0);
    expect(area).toBe(mask.reduce((sum, v) => sum + v, 0));
    for (const r of rects) {
      for (let x = r.x / size; x < (r.x + r.width) / size; x++) {
        expect(isWalkable(venue, { x, y: r.y / size }, mask)).toBe(true);
      }
    }
  });

  it("merges each row's neighbouring cells, so the fixture's walls split rows into a few stretches", () => {
    expect(rects.length).toBeLessThan(mask.reduce((sum, v) => sum + v, 0));
    for (const r of rects) expect(r.height).toBe(size);
  });
});

describe("pathPoints", () => {
  it("joins cell centres in order", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(pathPoints(venue, path)).toBe(`20,20 60,20 60,60`);
  });

  it.each([null, undefined, [], [{ x: 3, y: 3 }]])("draws nothing for %j", (path) => {
    expect(pathPoints(venue, path)).toBe("");
  });
});

describe("mapMarkers", () => {
  it("lists every POI and seat once, POIs first so seats draw on top", () => {
    const markers = mapMarkers(venue);
    expect(markers).toHaveLength(venue.pois.length + venue.seats.length);
    expect(markers.slice(0, venue.pois.length).every((m) => m.kind === "poi")).toBe(true);
    expect(new Set(markers.map((m) => `${m.kind}:${m.id}`)).size).toBe(markers.length);
  });

  it("highlights the requested seats and POIs and ignores unknown IDs", () => {
    const seat = venue.seats[0]!.id;
    const poi = venue.pois[0]!.id;
    const on = mapMarkers(venue, [seat, poi, "no-such-id"]).filter((m) => m.highlighted);
    expect(on.map((m) => m.id).sort()).toEqual([poi, seat].sort());
  });

  it("labels POIs by name and seats by ID", () => {
    const markers = mapMarkers(venue);
    expect(markers.find((m) => m.id === venue.pois[0]!.id)?.label).toBe(venue.pois[0]!.name);
    expect(markers.find((m) => m.id === venue.seats[0]!.id)?.label).toBe(venue.seats[0]!.id);
  });
});
