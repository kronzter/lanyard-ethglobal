// Pure layout math for drawing a venue (P0.5-R5). Everything is in floor-plan image pixels, so a
// map can use the image size as its SVG viewBox and scale freely. A3.3's real map reuses this.
import { type Cell, type CellRef, type Venue, decodeWalkable } from "@/shared/types/venue";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Marker = {
  id: string;
  kind: "seat" | "poi";
  label: string;
  at: Point;
  highlighted: boolean;
};

/** Centre of a grid cell. */
export function cellCenterPx(venue: Venue, c: CellRef): Point {
  const { originPx, cellSizePx } = venue.grid;
  return { x: originPx.x + (c.x + 0.5) * cellSizePx, y: originPx.y + (c.y + 0.5) * cellSizePx };
}

/** Walkable cells merged into one rectangle per horizontal stretch of a row. */
export function walkableRects(venue: Venue): Rect[] {
  const { cols, rows, originPx, cellSizePx } = venue.grid;
  const mask = decodeWalkable(venue.walkable, cols, rows);
  const rects: Rect[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y * cols + x]) continue;
      const start = x;
      while (x + 1 < cols && mask[y * cols + x + 1]) x++;
      rects.push({
        x: originPx.x + start * cellSizePx,
        y: originPx.y + y * cellSizePx,
        width: (x - start + 1) * cellSizePx,
        height: cellSizePx,
      });
    }
  }
  return rects;
}

/** SVG polyline points joining cell centres in order; empty when there is nothing to draw. */
export function pathPoints(venue: Venue, path: readonly Cell[] | null | undefined): string {
  if (!path || path.length < 2) return "";
  return path
    .map((c) => cellCenterPx(venue, c))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

/** Every seat and POI with its position and whether it is highlighted. */
export function mapMarkers(venue: Venue, highlight: readonly string[] = []): Marker[] {
  const on = new Set(highlight);
  return [
    ...venue.pois.map((p) => ({
      id: p.id,
      kind: "poi" as const,
      label: p.name,
      at: cellCenterPx(venue, p.cell),
      highlighted: on.has(p.id),
    })),
    ...venue.seats.map((s) => ({
      id: s.id,
      kind: "seat" as const,
      label: s.id,
      at: cellCenterPx(venue, s.cell),
      highlighted: on.has(s.id),
    })),
  ];
}
