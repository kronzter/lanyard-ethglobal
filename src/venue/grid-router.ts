// GridRouter (plans/A3-venue-routing.md › A3.2): A* paths, one-Dijkstra distances, ticket scoring
// and nearest-next judge routes over the venue walkable grid. Pure TypeScript, no Node imports, so
// it runs on Hermes. Costs are integers: floor(base * cellSizeMm / 1000) with base 1000
// orthogonal and 1414 diagonal; neighbours are visited in a fixed order, heap ties break by
// cell index (row-major, so y then x), and diagonals never cut a blocked corner.
import {
  RouterInputError,
  checkTicketInputs,
  compareKeys,
  ticketScore,
  uniqueStops,
  type Router,
} from "../shared/interfaces/router";
import type { Hex } from "../shared/types/primitives";
import {
  cellKey,
  decodeWalkable,
  inBounds,
  type Cell,
  type CellRef,
  type LocatedStop,
  type RoutingTicket,
  type Venue,
} from "../shared/types/venue";

export const ORTHOGONAL_BASE_COST = 1000;
export const DIAGONAL_BASE_COST = 1414;

/** Fixed neighbour order: N, W, E, S, then NW, NE, SW, SE. */
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const costsOf = (v: Venue) => ({
  ortho: Math.floor((ORTHOGONAL_BASE_COST * v.grid.cellSizeMm) / 1000),
  diag: Math.floor((DIAGONAL_BASE_COST * v.grid.cellSizeMm) / 1000),
});

/** Binary min-heap ordered by (priority, tiebreak). */
class MinHeap {
  private pri: number[] = [];
  private tie: number[] = [];
  private idx: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  private less(a: number, b: number): boolean {
    return this.pri[a]! < this.pri[b]! || (this.pri[a] === this.pri[b] && this.tie[a]! < this.tie[b]!);
  }
  private swap(a: number, b: number): void {
    for (const arr of [this.pri, this.tie, this.idx]) {
      const t = arr[a]!;
      arr[a] = arr[b]!;
      arr[b] = t;
    }
  }
  push(priority: number, tiebreak: number, index: number): void {
    this.pri.push(priority);
    this.tie.push(tiebreak);
    this.idx.push(index);
    let i = this.idx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.idx[0]!;
    const last = this.idx.length - 1;
    this.swap(0, last);
    this.pri.pop();
    this.tie.pop();
    this.idx.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < last && this.less(l, m)) m = l;
      if (r < last && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

function assertOnGrid(v: Venue, c: CellRef, what: string): void {
  if (!inBounds(c, v.grid))
    throw new RouterInputError(`${what} (${c.x}, ${c.y}) is outside the ${v.grid.cols}x${v.grid.rows} grid`);
}

/**
 * Shared search: Dijkstra when `target` is null, otherwise A* with the octile heuristic, which is
 * admissible and consistent for these floored integer costs. Every cell closes at most once, so
 * the loop is bounded by the cell count and never hangs.
 */
function search(
  v: Venue,
  mask: Uint8Array,
  from: CellRef,
  target: CellRef | null,
): { dist: Float64Array; prev: Int32Array; reached: boolean } {
  const { cols, rows } = v.grid;
  const { ortho, diag } = costsOf(v);
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = from.y * cols + from.x;
  const goal = target ? target.y * cols + target.x : -1;
  const h = (i: number): number => {
    if (!target) return 0;
    const dx = Math.abs((i % cols) - target.x);
    const dy = Math.abs(Math.floor(i / cols) - target.y);
    return diag * Math.min(dx, dy) + ortho * (Math.max(dx, dy) - Math.min(dx, dy));
  };
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(h(start), start, start);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) return { dist, prev, reached: true };
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (!mask[ni] || closed[ni]) continue;
      const isDiag = dx !== 0 && dy !== 0;
      if (isDiag && (!mask[cy * cols + nx] || !mask[ny * cols + cx])) continue; // no corner-cutting
      const g = dist[cur]! + (isDiag ? diag : ortho);
      if (g < dist[ni]!) {
        dist[ni] = g;
        prev[ni] = cur;
        heap.push(g + h(ni), ni, ni);
      }
    }
  }
  return { dist, prev, reached: false };
}

const walkableAt = (v: Venue, mask: Uint8Array, c: CellRef): boolean =>
  inBounds(c, v.grid) && mask[c.y * v.grid.cols + c.x] === 1;

/**
 * A3.2-R2: the walkable cell nearest to a point given in (possibly fractional) cell coordinates,
 * where cell (x, y) is centred at (x + 0.5, y + 0.5). Ties break by (y, x). Null when nothing
 * is walkable.
 */
export function nearestWalkableCell(v: Venue, point: { x: number; y: number }): Cell | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RouterInputError(`point (${point.x}, ${point.y}) is not finite`);
  const { cols, rows } = v.grid;
  const mask = decodeWalkable(v.walkable, cols, rows);
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let y = 0; y < rows; y++) {
    const dy = y + 0.5 - point.y;
    for (let x = 0; x < cols; x++) {
      if (!mask[y * cols + x]) continue;
      const dx = x + 0.5 - point.x;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

export class GridRouter implements Router {
  path(v: Venue, from: CellRef, to: CellRef): Cell[] | null {
    assertOnGrid(v, from, "path start");
    const { cols, rows } = v.grid;
    const mask = decodeWalkable(v.walkable, cols, rows);
    if (!walkableAt(v, mask, from) || !walkableAt(v, mask, to)) return null;
    const { reached, prev } = search(v, mask, from, to);
    if (!reached) return null;
    const out: Cell[] = [];
    for (let i = to.y * cols + to.x; i !== -1; i = prev[i]!)
      out.push({ x: i % cols, y: Math.floor(i / cols) });
    return out.reverse();
  }

  distances(v: Venue, from: CellRef): Map<string, number> {
    assertOnGrid(v, from, "distance origin");
    const { cols, rows } = v.grid;
    const mask = decodeWalkable(v.walkable, cols, rows);
    const out = new Map<string, number>();
    if (!walkableAt(v, mask, from)) return out;
    const { dist } = search(v, mask, from, null);
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] !== Infinity) out.set(cellKey({ x: i % cols, y: Math.floor(i / cols) }), dist[i]!);
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
    const dist = this.distances(v, from);
    let best: { ticket: RoutingTicket; score: bigint } | null = null;
    for (const ticket of open) {
      const d = dist.get(cellKey(ticket.cell));
      if (d === undefined) continue; // off-grid, blocked or walled in
      const score = ticketScore(d, ticket, atSeconds, alphaMmPerMinute);
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
      const dist = this.distances(v, here);
      const mm = (s: LocatedStop) => dist.get(cellKey(s.cell)) ?? Infinity; // unreachable go last
      remaining.sort(
        (a, b) =>
          (mm(a) === mm(b) ? 0 : mm(a) < mm(b) ? -1 : 1) ||
          a.cell.y - b.cell.y ||
          a.cell.x - b.cell.x ||
          compareKeys(a.projectKey, b.projectKey),
      );
      const next = remaining.shift()!;
      order.push(next.projectKey);
      if (mm(next) !== Infinity) here = next.cell; // stay put when the rest are unreachable
    }
    return order;
  }
}
