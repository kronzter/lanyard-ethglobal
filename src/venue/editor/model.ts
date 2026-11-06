// Pure editing model for the A3.1 venue editor: no React, no I/O. Every operation returns a new
// state; `History` adds undo on top. Walkable cells reuse the P0.2 RLE helpers.
import {
  type CellRef,
  type Poi,
  type PoiKind,
  type Seat,
  type Venue,
  type Zone,
  cellIndex,
  decodeWalkable,
  encodeWalkable,
  inBounds,
} from "@/shared/types/venue";

export type EditorMeta = Pick<Venue, "id" | "name" | "image"> & {
  cellSizeMm: number;
  cellSizePx: number;
  originPx: { x: number; y: number };
};

export type EditorState = {
  meta: EditorMeta;
  cols: number;
  rows: number;
  /** Row-major, 1 = walkable. */
  mask: Uint8Array;
  /** Row-major zone index + 1 per cell (0 = no zone); an editing aid, not exported. */
  zoneMap: Uint8Array;
  zones: Zone[];
  seats: Seat[];
  pois: Poi[];
  /** Highest seat number ever issued, so deleted IDs are not reused (R5). */
  seatCounter: number;
};

const SEAT_RE = /^s(\d+)$/;
// venue.json ids are lowercase (VenueSchema), so seats read s001, s002, ...
export const seatId = (n: number): string => `s${String(n).padStart(3, "0")}`;

export function createState(meta: EditorMeta, cols: number, rows: number, zones: Zone[] = []): EditorState {
  return {
    meta,
    cols,
    rows,
    mask: new Uint8Array(cols * rows),
    zoneMap: new Uint8Array(cols * rows),
    zones,
    seats: [],
    pois: [],
    seatCounter: 0,
  };
}

/** Load an existing venue.json. Zone cells are not stored in venue.json, so the zone map starts
 *  empty; seats and POIs keep their zones. */
export function fromVenue(v: Venue): EditorState {
  const { cols, rows } = v.grid;
  const maxSeat = Math.max(0, ...v.seats.map((s) => Number(SEAT_RE.exec(s.id)?.[1] ?? 0)));
  return {
    meta: {
      id: v.id,
      name: v.name,
      image: { ...v.image },
      cellSizeMm: v.grid.cellSizeMm,
      cellSizePx: v.grid.cellSizePx,
      originPx: { ...v.grid.originPx },
    },
    cols,
    rows,
    mask: decodeWalkable(v.walkable, cols, rows),
    zoneMap: new Uint8Array(cols * rows),
    zones: v.zones.map((z) => ({ ...z })),
    seats: v.seats.map((s) => ({ ...s, cell: { ...s.cell } })),
    pois: v.pois.map((p) => ({ ...p, cell: { ...p.cell } })),
    seatCounter: maxSeat,
  };
}

export function toVenue(s: EditorState): Venue {
  return {
    schemaVersion: 1,
    id: s.meta.id,
    name: s.meta.name,
    image: { ...s.meta.image },
    grid: {
      cols: s.cols,
      rows: s.rows,
      cellSizeMm: s.meta.cellSizeMm,
      originPx: { ...s.meta.originPx },
      cellSizePx: s.meta.cellSizePx,
    },
    walkable: encodeWalkable(s.mask),
    zones: s.zones.map((z) => ({ ...z })),
    seats: s.seats.map((x) => ({ ...x, cell: { ...x.cell } })),
    pois: s.pois.map((p) => ({ ...p, cell: { ...p.cell } })),
  };
}

const same = (a: CellRef, b: CellRef) => a.x === b.x && a.y === b.y;

/** Paint (or erase) a square brush of `size` cells around `c`. */
export function paintWalkable(s: EditorState, c: CellRef, walkable: boolean, size = 1): EditorState {
  const lo = Math.floor((size - 1) / 2);
  return paintRect(
    s,
    { x: c.x - lo, y: c.y - lo },
    { x: c.x - lo + size - 1, y: c.y - lo + size - 1 },
    walkable,
  );
}

/** Fill the inclusive rectangle between two corner cells. */
export function paintRect(s: EditorState, a: CellRef, b: CellRef, walkable: boolean): EditorState {
  const mask = s.mask.slice();
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++)
      if (inBounds({ x, y }, s)) mask[cellIndex({ x, y }, s.cols)] = walkable ? 1 : 0;
  return { ...s, mask };
}

export function addZone(s: EditorState, zone: Zone): EditorState {
  if (s.zones.some((z) => z.id === zone.id) || s.zones.length >= 255) return s;
  return { ...s, zones: [...s.zones, zone] };
}

/** Paint a zone over cells (null clears); seats and POIs on those cells move to the zone. */
export function paintZone(s: EditorState, cells: CellRef[], zoneId: string | null): EditorState {
  const idx = zoneId === null ? 0 : s.zones.findIndex((z) => z.id === zoneId) + 1;
  if (zoneId !== null && idx === 0) return s;
  const zoneMap = s.zoneMap.slice();
  const hit = new Set<number>();
  for (const c of cells)
    if (inBounds(c, s)) {
      zoneMap[cellIndex(c, s.cols)] = idx;
      hit.add(cellIndex(c, s.cols));
    }
  const move = <T extends { cell: CellRef; zone: string }>(list: T[]): T[] =>
    zoneId === null
      ? list
      : list.map((p) => (hit.has(cellIndex(p.cell, s.cols)) ? { ...p, zone: zoneId } : p));
  return { ...s, zoneMap, seats: move(s.seats), pois: move(s.pois) };
}

export const zoneAt = (s: EditorState, c: CellRef): string | undefined => {
  const i = s.zoneMap[cellIndex(c, s.cols)];
  return i ? s.zones[i - 1]?.id : undefined;
};

/** Place a seat (no-op if one is there). New seats get the next number; existing IDs never
 *  change (R5). Zone: the painted zone at the cell, else `fallbackZone`. */
export function placeSeat(s: EditorState, c: CellRef, fallbackZone?: string): EditorState {
  const zone = zoneAt(s, c) ?? fallbackZone;
  if (!inBounds(c, s) || zone === undefined || s.seats.some((x) => same(x.cell, c))) return s;
  const n = s.seatCounter + 1;
  return { ...s, seats: [...s.seats, { id: seatId(n), cell: { ...c }, zone }], seatCounter: n };
}

export function removeSeatAt(s: EditorState, c: CellRef): EditorState {
  return { ...s, seats: s.seats.filter((x) => !same(x.cell, c)) };
}

export function placePoi(
  s: EditorState,
  c: CellRef,
  kind: PoiKind,
  name: string,
  opts: { partner?: string; zone?: string } = {},
): EditorState {
  const zone = zoneAt(s, c) ?? opts.zone;
  if (!inBounds(c, s) || zone === undefined) return s;
  const used = new Set(s.pois.map((p) => p.id));
  let n = 1;
  while (used.has(`${kind}-${n}`)) n++;
  const poi: Poi = { id: `${kind}-${n}`, kind, name, cell: { ...c }, zone };
  if (kind === "partner-table" && opts.partner !== undefined) poi.partner = opts.partner;
  return { ...s, pois: [...s.pois, poi] };
}

export function removePoiAt(s: EditorState, c: CellRef): EditorState {
  return { ...s, pois: s.pois.filter((p) => !same(p.cell, c)) };
}

/** Undo history over immutable states. */
export type History = { past: EditorState[]; present: EditorState };
export const newHistory = (present: EditorState): History => ({ past: [], present });
export function commit(h: History, next: EditorState): History {
  return next === h.present ? h : { past: [...h.past.slice(-99), h.present], present: next };
}
export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  return prev ? { past: h.past.slice(0, -1), present: prev } : h;
}
