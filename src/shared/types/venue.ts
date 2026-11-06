// Venue grid and routing shapes (plans/P0-foundation.md › P0.2-R2, 01-evidence-and-interfaces.md §4).
// This is the `venue.json` format A3.1 exports and B3.3 publishes as a readonly Arkiv record.
import { z } from "zod";
import type { Hex } from "./primitives";

/** Integer grid coordinates; x is the column, y the row, origin top-left. */
export type CellRef = { x: number; y: number };
/** A cell on a returned path (always walkable). */
export type Cell = CellRef;

export const POI_KINDS = [
  "help-desk",
  "partner-table",
  "stage",
  "entrance",
  "food",
  "restroom",
  "other",
] as const;
export type PoiKind = (typeof POI_KINDS)[number];

export type Zone = { id: string; name: string };
export type Seat = { id: string; cell: CellRef; zone: string };
export type Poi = { id: string; kind: PoiKind; name: string; cell: CellRef; zone: string; partner?: string };

/** Walkable cells as `[startIndex, length]` runs over row-major indices `y * cols + x`. */
export type WalkableRuns = [number, number][];

export type Venue = {
  schemaVersion: 1;
  id: string;
  name: string;
  /** Floor-plan image and how the grid sits on it, in image pixels. */
  image: { uri: string; widthPx: number; heightPx: number };
  grid: {
    cols: number;
    rows: number;
    cellSizeMm: number;
    originPx: { x: number; y: number };
    cellSizePx: number;
  };
  walkable: WalkableRuns;
  zones: Zone[];
  seats: Seat[];
  pois: Poi[];
};

/** An open ticket as the router sees it: callers resolve seat → cell and filter eligibility. */
export type RoutingTicket = { key: Hex; cell: CellRef; createdAtSeconds: bigint };
/** A judge stop: project resolved to its team lead's seat cell by the caller. */
export type LocatedStop = { projectKey: Hex; cell: CellRef };

export const cellKey = (c: CellRef): string => `${c.x},${c.y}`;
export const cellIndex = (c: CellRef, cols: number): number => c.y * cols + c.x;
export const inBounds = (c: CellRef, grid: { cols: number; rows: number }): boolean =>
  Number.isInteger(c.x) &&
  Number.isInteger(c.y) &&
  c.x >= 0 &&
  c.y >= 0 &&
  c.x < grid.cols &&
  c.y < grid.rows;

/** Expand runs into a row-major mask (1 = walkable). */
export function decodeWalkable(runs: WalkableRuns, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  for (const [start, length] of runs) mask.fill(1, start, start + length);
  return mask;
}

/** Compress a row-major mask into sorted, non-adjacent runs. */
export function encodeWalkable(mask: ArrayLike<number | boolean>): WalkableRuns {
  const runs: WalkableRuns = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const start = i;
    while (i + 1 < mask.length && mask[i + 1]) i++;
    runs.push([start, i - start + 1]);
  }
  return runs;
}

export const isWalkable = (venue: Venue, c: CellRef, mask?: Uint8Array): boolean =>
  inBounds(c, venue.grid) &&
  (mask ?? decodeWalkable(venue.walkable, venue.grid.cols, venue.grid.rows))[
    cellIndex(c, venue.grid.cols)
  ] === 1;

const int = z.number().int();
const pos = int.positive();
const CellRefSchema = z.object({ x: int.nonnegative(), y: int.nonnegative() }).strict();
const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase [a-z0-9-]");

export const VenueSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1),
    image: z.object({ uri: z.string().min(1), widthPx: pos, heightPx: pos }).strict(),
    grid: z
      .object({
        cols: pos,
        rows: pos,
        cellSizeMm: pos,
        originPx: z.object({ x: int, y: int }).strict(),
        cellSizePx: pos,
      })
      .strict(),
    walkable: z.array(z.tuple([int.nonnegative(), pos])),
    zones: z.array(z.object({ id, name: z.string().min(1) }).strict()).min(1),
    seats: z.array(z.object({ id, cell: CellRefSchema, zone: id }).strict()),
    pois: z.array(
      z
        .object({
          id,
          kind: z.enum(POI_KINDS),
          name: z.string().min(1),
          cell: CellRefSchema,
          zone: id,
          partner: id.optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    const { cols, rows } = v.grid;
    let prevEnd = -1;
    v.walkable.forEach(([start, length], i) => {
      if (start <= prevEnd)
        issue("walkable runs must be sorted, non-overlapping and non-adjacent", ["walkable", i]);
      if (start + length > cols * rows) issue("walkable run exceeds the grid", ["walkable", i]);
      prevEnd = start + length;
    });
    const mask = decodeWalkable(v.walkable, cols, rows);
    const unique = (list: { id: string }[], what: string) => {
      const ids = list.map((x) => x.id);
      if (new Set(ids).size !== ids.length) issue(`${what} ids must be unique`, [what]);
    };
    unique(v.zones, "zones");
    unique([...v.seats, ...v.pois], "seats/pois");
    const zones = new Set(v.zones.map((z) => z.id));
    const place = (list: { id: string; cell: CellRef; zone: string }[], what: string) =>
      list.forEach((p, i) => {
        if (!inBounds(p.cell, v.grid)) issue(`${what} ${p.id} is outside the grid`, [what, i, "cell"]);
        else if (mask[cellIndex(p.cell, cols)] !== 1)
          issue(`${what} ${p.id} is not on a walkable cell`, [what, i, "cell"]);
        if (!zones.has(p.zone)) issue(`${what} ${p.id} names unknown zone ${p.zone}`, [what, i, "zone"]);
      });
    place(v.seats, "seats");
    place(v.pois, "pois");
    v.pois.forEach((p, i) => {
      if (p.kind === "partner-table" && p.partner === undefined)
        issue(`partner-table ${p.id} needs a partner`, ["pois", i]);
      if (p.kind !== "partner-table" && p.partner !== undefined)
        issue(`only partner-table POIs name a partner`, ["pois", i]);
    });
  });

/** Parse and validate a `venue.json` value. */
export const parseVenue = (value: unknown): Venue => VenueSchema.parse(value) as Venue;
