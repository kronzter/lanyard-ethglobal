// Build a venue.json from a description of its areas instead of painting cells by hand. The
// A3.1 editor can load and adjust the result; this keeps a traced floor plan reviewable and
// easy to rebuild when the plan changes.
import { type Poi, type Venue, type Zone, cellIndex, encodeWalkable } from "@/shared/types/venue";

/** Inclusive cell rectangle. */
export type CellRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * A hacking space: a walkable aisle round the edge, then rows of seat · table · seat inside,
 * with a cross aisle every `crossAisleEvery` columns. Seats are walkable, so seat rows double
 * as walkways; tables are blocked.
 */
export type SeatingArea = {
  name: string;
  rect: CellRect;
  zone: string;
  crossAisleEvery: number;
  /** Cells this close to the bottom-right corner (by x + y distance) are outside the space. */
  cutCorner?: number;
};

export type Layout = {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cellSizeMm: number;
  image: Venue["image"];
  cellSizePx: number;
  zones: Zone[];
  seating: SeatingArea[];
  /** Rooms, counters, stage, furniture: everything people walk around. */
  blocked: { name: string; rect: CellRect }[];
  pois: Poi[];
};

const inRect = (r: CellRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

export function buildVenue(layout: Layout): Venue {
  const { cols, rows } = layout;
  const walkable = new Uint8Array(cols * rows).fill(1);
  const seatZone = new Map<number, string>();
  const idx = (x: number, y: number) => cellIndex({ x, y }, cols);

  for (const area of layout.seating) {
    const { x0, y0, x1, y1 } = area.rect;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (area.cutCorner !== undefined && x1 - x + (y1 - y) < area.cutCorner) {
          walkable[idx(x, y)] = 0;
          continue;
        }
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        const crossAisle = (x - x0 - 1) % area.crossAisleEvery === area.crossAisleEvery - 1;
        if (edge || crossAisle) continue; // aisle
        if ((y - y0 - 1) % 3 === 1)
          walkable[idx(x, y)] = 0; // table row
        else seatZone.set(idx(x, y), area.zone);
      }
    }
  }
  for (const b of layout.blocked) {
    for (let y = b.rect.y0; y <= b.rect.y1; y++) {
      for (let x = b.rect.x0; x <= b.rect.x1; x++) {
        walkable[idx(x, y)] = 0;
        seatZone.delete(idx(x, y));
      }
    }
  }
  // A traced POI that lands on a blocked cell (scaling rounds edges) moves to the nearest
  // walkable cell within 2, in a fixed order; one further away stays put and fails validation.
  const pois = layout.pois.map((p) => {
    const ok = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < cols && y < rows && walkable[idx(x, y)] === 1;
    if (ok(p.cell.x, p.cell.y)) return p;
    for (let d = 1; d <= 2; d++) {
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          if (ok(p.cell.x + dx, p.cell.y + dy)) return { ...p, cell: { x: p.cell.x + dx, y: p.cell.y + dy } };
        }
      }
    }
    return p;
  });
  for (const p of pois) seatZone.delete(idx(p.cell.x, p.cell.y));

  // Number seats zone by zone, then row by row, so IDs read in walking order.
  const zoneOrder = new Map(layout.zones.map((z, i) => [z.id, i]));
  const seats = [...seatZone.entries()]
    .map(([i, zone]) => ({ x: i % cols, y: Math.floor(i / cols), zone }))
    .sort((a, b) => zoneOrder.get(a.zone)! - zoneOrder.get(b.zone)! || a.y - b.y || a.x - b.x)
    .map((s, n) => ({ id: `s${String(n + 1).padStart(3, "0")}`, cell: { x: s.x, y: s.y }, zone: s.zone }));

  return {
    schemaVersion: 1,
    id: layout.id,
    name: layout.name,
    image: layout.image,
    grid: {
      cols,
      rows,
      cellSizeMm: layout.cellSizeMm,
      originPx: { x: 0, y: 0 },
      cellSizePx: layout.cellSizePx,
    },
    walkable: encodeWalkable(walkable),
    zones: layout.zones,
    seats,
    pois,
  };
}

/**
 * Enlarge a layout traced at one size to the real hall size: every rectangle keeps its share of
 * the hall and every POI moves with the area it belongs to. Seating patterns are re-laid at
 * the new size, so seat counts grow with area.
 */
export function scaleLayout(layout: Layout, factor: number): Layout {
  const lo = (v: number) => Math.floor(v * factor);
  const hi = (v: number) => Math.floor((v + 1) * factor) - 1;
  const rect = (q: CellRect): CellRect => ({ x0: lo(q.x0), y0: lo(q.y0), x1: hi(q.x1), y1: hi(q.y1) });
  const cols = Math.round(layout.cols * factor);
  const rows = Math.round(layout.rows * factor);
  return {
    ...layout,
    cols,
    rows,
    image: { ...layout.image, widthPx: cols * layout.cellSizePx, heightPx: rows * layout.cellSizePx },
    seating: layout.seating.map((s) => ({ ...s, rect: rect(s.rect) })),
    blocked: layout.blocked.map((b) => ({ ...b, rect: rect(b.rect) })),
    pois: layout.pois.map((p) => ({
      ...p,
      cell: { x: Math.floor((p.cell.x + 0.5) * factor), y: Math.floor((p.cell.y + 0.5) * factor) },
    })),
  };
}

/** Name of the seating area or blocked item covering a cell, for error messages and checks. */
export function whatIsAt(layout: Layout, x: number, y: number): string | null {
  return (
    layout.blocked.find((b) => inRect(b.rect, x, y))?.name ??
    layout.seating.find((s) => inRect(s.rect, x, y))?.name ??
    null
  );
}
