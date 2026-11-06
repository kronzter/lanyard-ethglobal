// The StubRouter scenario on fixtures/venue.small.json: start at the west help desk; the stub
// ignores walls, so its only unreachable cells are off the grid.
import { fixtureVenue } from "../mocks/fixtures";
import type { RouterConformanceScenario } from "./router-conformance";

export const fixtureRouterScenario = (): RouterConformanceScenario => ({
  venue: fixtureVenue(),
  start: { x: 1, y: 10 },
  near: { x: 2, y: 10 },
  far: { x: 11, y: 10 },
  unreachable: { x: 25, y: 3 },
});
