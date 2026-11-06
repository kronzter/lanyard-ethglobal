import { describe, expect, it } from "vitest";
import { StubRouter } from "../mocks/stub-router";
import {
  evaluateConformance,
  fixtureRouterScenario,
  ignoresEvaluationTime,
  routerChecks,
  runRouterConformance,
} from "../testing";

const subject = () => ({ router: new StubRouter(), scenario: fixtureRouterScenario() });

runRouterConformance("StubRouter", subject);

describe("Router conformance self-test", () => {
  it("the stub passes every check", async () => {
    expect(await evaluateConformance(routerChecks, subject)).toEqual([]);
  });

  it("catches a router that ignores the evaluation time", async () => {
    const failures = await evaluateConformance(routerChecks, () => ({
      ...subject(),
      router: ignoresEvaluationTime(new StubRouter()),
    }));
    expect(failures.map((f) => f.name)).toEqual(
      expect.arrayContaining(["the waiting discount is applied at the explicit evaluation time"]),
    );
  });
});
