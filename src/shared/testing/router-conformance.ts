// The Router conformance suite (plans/P0-foundation.md › P0.3). StubRouter and A3.2's GridRouter
// both run it. The scenario names cells in the implementation's own venue: `near` and `far` are
// reachable from `start` (near strictly closer), and `unreachable` is a cell the router must
// treat as unreachable (off the grid for the stub, walled in for the grid router).
import { DEFAULT_ALPHA_MM_PER_MINUTE, type Router } from "../interfaces/router";
import type { Hex } from "../types/primitives";
import { cellKey, inBounds, type CellRef, type RoutingTicket, type Venue } from "../types/venue";
import { expectEqual, expectThat, registerConformance, type Check } from "./conformance";

export type RouterConformanceScenario = {
  venue: Venue;
  start: CellRef;
  near: CellRef;
  far: CellRef;
  unreachable: CellRef;
};
export type RouterConformanceSubject = { router: Router; scenario: RouterConformanceScenario };

const key = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const ticket = (n: number, cell: CellRef, createdAtSeconds: bigint): RoutingTicket => ({
  key: key(n),
  cell,
  createdAtSeconds,
});
const T0 = 1_800_000_000n;
const ALPHA = DEFAULT_ALPHA_MM_PER_MINUTE;
const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
function distanceOf(s: RouterConformanceSubject, c: CellRef): number {
  const d = s.router.distances(s.scenario.venue, s.scenario.start).get(cellKey(c));
  if (d === undefined) throw new Error(`scenario cell ${cellKey(c)} is not reachable`);
  return d;
}

export const routerChecks: Check<RouterConformanceSubject>[] = [
  {
    name: "a path covers the requested endpoints in adjacent on-grid steps",
    run: async ({ router, scenario: { venue, start, far } }) => {
      const p = router.path(venue, start, far);
      expectThat(p !== null && p.length > 0, "path to a reachable cell exists");
      expectEqual(cellKey(p![0]!), cellKey(start), "first cell");
      expectEqual(cellKey(p!.at(-1)!), cellKey(far), "last cell");
      p!.forEach((c, i) => {
        expectThat(inBounds(c, venue.grid), `cell ${cellKey(c)} is on the grid`);
        if (i > 0) {
          const prev = p![i - 1]!;
          const step = Math.max(Math.abs(c.x - prev.x), Math.abs(c.y - prev.y));
          expectEqual(step, 1, `step ${i} is to an adjacent cell`);
        }
      });
    },
  },
  {
    name: "the path to the start itself is just the start",
    run: async ({ router, scenario: { venue, start } }) => {
      expectEqual(router.path(venue, start, start), [start], "path to self");
    },
  },
  {
    name: "an unreachable cell has no path and no distance",
    run: async ({ router, scenario: { venue, start, unreachable } }) => {
      expectEqual(router.path(venue, start, unreachable), null, "path to the unreachable cell");
      expectThat(
        !router.distances(venue, start).has(cellKey(unreachable)),
        "no distance for the unreachable cell",
      );
    },
  },
  {
    name: "distances are integer millimetres, zero at the start",
    run: async (s) => {
      const d = s.router.distances(s.scenario.venue, s.scenario.start);
      for (const [k, mm] of d)
        expectThat(Number.isSafeInteger(mm) && mm >= 0, `distance to ${k} is a non-negative integer`);
      expectEqual(d.get(cellKey(s.scenario.start)), 0, "distance to the start");
      expectThat(distanceOf(s, s.scenario.near) < distanceOf(s, s.scenario.far), "near is closer than far");
    },
  },
  {
    name: "no tickets, or only unreachable ones, offers nothing",
    run: async ({ router, scenario: { venue, start, unreachable } }) => {
      expectEqual(router.nextTicket(venue, start, [], T0, ALPHA), null, "empty list");
      expectEqual(
        router.nextTicket(venue, start, [ticket(1, unreachable, T0)], T0, ALPHA),
        null,
        "unreachable only",
      );
    },
  },
  {
    name: "at equal age the nearer ticket wins",
    run: async ({ router, scenario: { venue, start, near, far } }) => {
      const picked = router.nextTicket(
        venue,
        start,
        [ticket(1, far, T0), ticket(2, near, T0)],
        T0 + 600n,
        ALPHA,
      );
      expectEqual(picked?.key, key(2), "picked ticket");
    },
  },
  {
    name: "the waiting discount is applied at the explicit evaluation time",
    run: async (s) => {
      const { router, scenario } = s;
      const gap = distanceOf(s, scenario.far) - distanceOf(s, scenario.near);
      const minutes = BigInt(Math.floor(gap / ALPHA) + 1); // enough waiting to outweigh the extra distance
      const near = ticket(2, scenario.near, T0);
      const far = ticket(1, scenario.far, T0 - minutes * 60n);
      expectEqual(
        router.nextTicket(scenario.venue, scenario.start, [near, far], T0, ALPHA)?.key,
        far.key,
        "long-waiting far ticket",
      );
      expectEqual(
        router.nextTicket(scenario.venue, scenario.start, [near, far], T0, 0)?.key,
        near.key,
        "with no discount",
      );
    },
  },
  {
    name: "equal scores fall back to the lowest key",
    run: async ({ router, scenario: { venue, start, near } }) => {
      const picked = router.nextTicket(
        venue,
        start,
        [ticket(9, near, T0), ticket(4, near, T0), ticket(7, near, T0)],
        T0,
        ALPHA,
      );
      expectEqual(picked?.key, key(4), "picked ticket");
    },
  },
  {
    name: "a future ticket or an invalid alpha is rejected",
    run: async ({ router, scenario: { venue, start, near } }) => {
      expectThat(
        throws(() => router.nextTicket(venue, start, [ticket(1, near, T0 + 1n)], T0, ALPHA)),
        "ticket created after the evaluation time",
      );
      expectThat(
        throws(() => router.nextTicket(venue, start, [ticket(1, near, T0)], T0, -1)),
        "negative alpha",
      );
      expectThat(
        throws(() => router.nextTicket(venue, start, [ticket(1, near, T0)], T0, 1.5)),
        "fractional alpha",
      );
    },
  },
  {
    name: "a judge route visits each unique located stop once",
    run: async ({ router, scenario: { venue, start, near, far } }) => {
      const route = router.judgeRoute(venue, start, [
        { projectKey: key(1), cell: far },
        { projectKey: key(2), cell: near },
        { projectKey: key(1), cell: far },
      ]);
      expectEqual([...route].sort(), [key(1), key(2)], "stops visited");
      expectEqual(route.length, 2, "route length");
      expectEqual(router.judgeRoute(venue, start, []), [], "no stops");
    },
  },
  {
    name: "a project located at two different cells fails",
    run: async ({ router, scenario: { venue, start, near, far } }) => {
      expectThat(
        throws(() =>
          router.judgeRoute(venue, start, [
            { projectKey: key(1), cell: near },
            { projectKey: key(1), cell: far },
          ]),
        ),
        "conflicting duplicate stop",
      );
    },
  },
  {
    name: "routing is deterministic",
    run: async ({ router, scenario: { venue, start, near, far } }) => {
      const tickets = [ticket(1, far, T0), ticket(2, near, T0)];
      const stops = [
        { projectKey: key(1), cell: far },
        { projectKey: key(2), cell: near },
      ];
      expectEqual(router.path(venue, start, far), router.path(venue, start, far), "path");
      expectEqual(
        router.nextTicket(venue, start, tickets, T0, ALPHA),
        router.nextTicket(venue, start, [...tickets].reverse(), T0, ALPHA),
        "next ticket regardless of input order",
      );
      expectEqual(
        router.judgeRoute(venue, start, stops),
        router.judgeRoute(venue, start, [...stops].reverse()),
        "judge route regardless of input order",
      );
    },
  },
];

export function runRouterConformance(
  name: string,
  factory: () => RouterConformanceSubject | Promise<RouterConformanceSubject>,
): void {
  registerConformance(`Router conformance: ${name}`, routerChecks, factory);
}

/** A router that ignores the evaluation time and scores every ticket as if it had just arrived. */
export function ignoresEvaluationTime(inner: Router): Router {
  return {
    path: (v, a, b) => inner.path(v, a, b),
    distances: (v, a) => inner.distances(v, a),
    nextTicket: (v, from, open, at, alpha) =>
      inner.nextTicket(
        v,
        from,
        open.map((t) => ({ ...t, createdAtSeconds: at })),
        at,
        alpha,
      ),
    judgeRoute: (v, s, stops) => inner.judgeRoute(v, s, stops),
  };
}
