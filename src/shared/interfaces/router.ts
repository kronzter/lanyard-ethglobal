// Routing over the venue grid (plans/01-evidence-and-interfaces.md §4). StubRouter stands in
// until A3.2's GridRouter; both must pass runRouterConformance. Callers resolve tickets and
// projects to cells and filter eligibility; the router never reads Arkiv or the clock.
import type { Hex } from "../types/primitives";
import type { Cell, CellRef, LocatedStop, RoutingTicket, Venue } from "../types/venue";

export interface Router {
  /** Display path from `from` to `to`, both included; null when `to` is unreachable. */
  path(v: Venue, from: CellRef, to: CellRef): Cell[] | null;
  /** Integer millimetres from `from` to every reachable cell, keyed by `cellKey`. */
  distances(v: Venue, from: CellRef): Map<string, number>;
  /**
   * The best open ticket for a helper at `from`: lowest
   * `distanceMm - alphaMmPerMinute * floor((atSeconds - createdAtSeconds) / 60)`, ties by key.
   * Unreachable tickets are skipped; null when none remain.
   */
  nextTicket(
    v: Venue,
    from: CellRef,
    open: RoutingTicket[],
    atSeconds: bigint,
    alphaMmPerMinute: number,
  ): RoutingTicket | null;
  /** Project keys in visiting order, each unique located stop exactly once. */
  judgeRoute(v: Venue, start: CellRef, stops: LocatedStop[]): Hex[];
}

/** Default waiting discount: 5 m of walking per minute waited. */
export const DEFAULT_ALPHA_MM_PER_MINUTE = 5_000;

export class RouterInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterInputError";
  }
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Ticket score every router uses: distance minus the waiting discount at an explicit time. */
export function ticketScore(
  distanceMm: number,
  ticket: RoutingTicket,
  atSeconds: bigint,
  alphaMmPerMinute: number,
): bigint {
  if (!Number.isSafeInteger(alphaMmPerMinute) || alphaMmPerMinute < 0) {
    throw new RouterInputError(`alpha must be a non-negative safe integer, got ${alphaMmPerMinute}`);
  }
  if (!Number.isSafeInteger(distanceMm) || distanceMm < 0)
    throw new RouterInputError(`bad distance ${distanceMm}`);
  const age = atSeconds - ticket.createdAtSeconds;
  if (age < 0n)
    throw new RouterInputError(`ticket ${ticket.key} was created ${-age}s after the evaluation time`);
  const discount = BigInt(alphaMmPerMinute) * (age / 60n);
  const score = BigInt(distanceMm) - discount;
  if (discount > SAFE || score > SAFE || score < -SAFE) {
    throw new RouterInputError(`score for ${ticket.key} is outside safe integer bounds`);
  }
  return score;
}

/** Validate a whole ticket list up front so bad input fails even when no ticket is reachable. */
export function checkTicketInputs(open: RoutingTicket[], atSeconds: bigint, alphaMmPerMinute: number): void {
  for (const t of open) ticketScore(0, t, atSeconds, alphaMmPerMinute);
}

/** Lowercase key comparison used for every tie-break. */
export const compareKeys = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Deduplicate located stops by project key; conflicting cells for one key are an error. */
export function uniqueStops(stops: LocatedStop[]): LocatedStop[] {
  const byKey = new Map<string, LocatedStop>();
  for (const s of stops) {
    const key = s.projectKey.toLowerCase();
    const seen = byKey.get(key);
    if (seen && (seen.cell.x !== s.cell.x || seen.cell.y !== s.cell.y)) {
      throw new RouterInputError(`project ${s.projectKey} is located at two different cells`);
    }
    if (!seen) byKey.set(key, { projectKey: key as Hex, cell: s.cell });
  }
  return [...byKey.values()];
}
