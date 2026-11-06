// StubRouter (plans/P0-foundation.md › P0.3-R2): integer Manhattan distance in millimetres and
// straight-line display paths, ignoring walls entirely. It stands in for A3.2's GridRouter until
// I3 and passes the same runRouterConformance suite. Wall-aware checks live in A3.2.
import {
  RouterInputError,
  checkTicketInputs,
  compareKeys,
  ticketScore,
  uniqueStops,
  type Router,
} from "../interfaces/router";
import type { Hex } from "../types/primitives";
import {
  cellKey,
  inBounds,
  type Cell,
  type CellRef,
  type LocatedStop,
  type RoutingTicket,
  type Venue,
} from "../types/venue";

/** Orthogonal edge cost in mm: floor(1000 * cellSizeMm / 1000), i.e. one cell. */
const edgeMm = (v: Venue) => Math.floor((1000 * v.grid.cellSizeMm) / 1000);

function assertOnGrid(v: Venue, c: CellRef, what: string): void {
  if (!inBounds(c, v.grid))
    throw new RouterInputError(`${what} (${c.x}, ${c.y}) is outside the ${v.grid.cols}x${v.grid.rows} grid`);
}

const manhattanMm = (v: Venue, a: CellRef, b: CellRef) =>
  (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * edgeMm(v);

/** Cells on the straight line from `a` to `b` (Bresenham), both endpoints included. */
function straightLine(a: CellRef, b: CellRef): Cell[] {
  const cells: Cell[] = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push({ x, y });
    if (x === b.x && y === b.y) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export class StubRouter implements Router {
  path(v: Venue, from: CellRef, to: CellRef): Cell[] | null {
    assertOnGrid(v, from, "path start");
    return inBounds(to, v.grid) ? straightLine(from, to) : null;
  }

  distances(v: Venue, from: CellRef): Map<string, number> {
    assertOnGrid(v, from, "distance origin");
    const out = new Map<string, number>();
    for (let y = 0; y < v.grid.rows; y++) {
      for (let x = 0; x < v.grid.cols; x++) out.set(cellKey({ x, y }), manhattanMm(v, from, { x, y }));
    }
    return out;
  }

  nextTicket(
    v: Venue,
    from: CellRef,
    open: RoutingTicket[],
    atSeconds: bigint,
    alphaMmPerMinute: number,
  ): RoutingTicket | null {
    assertOnGrid(v, from, "helper position");
    checkTicketInputs(open, atSeconds, alphaMmPerMinute);
    let best: { ticket: RoutingTicket; score: bigint } | null = null;
    for (const ticket of open) {
      if (!inBounds(ticket.cell, v.grid)) continue; // unreachable
      const score = ticketScore(manhattanMm(v, from, ticket.cell), ticket, atSeconds, alphaMmPerMinute);
      if (
        !best ||
        score < best.score ||
        (score === best.score && compareKeys(ticket.key, best.ticket.key) < 0)
      ) {
        best = { ticket, score };
      }
    }
    return best?.ticket ?? null;
  }

  judgeRoute(v: Venue, start: CellRef, stops: LocatedStop[]): Hex[] {
    assertOnGrid(v, start, "judge start");
    const remaining = uniqueStops(stops);
    for (const s of remaining) assertOnGrid(v, s.cell, `stop ${s.projectKey}`);
    const order: Hex[] = [];
    let here = start;
    while (remaining.length > 0) {
      remaining.sort(
        (a, b) =>
          manhattanMm(v, here, a.cell) - manhattanMm(v, here, b.cell) ||
          a.cell.y - b.cell.y ||
          a.cell.x - b.cell.x ||
          compareKeys(a.projectKey, b.projectKey),
      );
      const next = remaining.shift()!;
      order.push(next.projectKey);
      here = next.cell;
    }
    return order;
  }
}
