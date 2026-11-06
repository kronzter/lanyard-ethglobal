import { describe, expect, it } from "vitest";
import {
  createMockPublisherHarness,
  createWritesAfterLockHarness,
  evaluateConformance,
  resultsPublisherChecks,
  runResultsPublisherConformance,
} from "../testing";

runResultsPublisherConformance("MockResultsPublisher", createMockPublisherHarness);

describe("ResultsPublisher conformance self-test", () => {
  it("the mock passes every check", async () => {
    expect(await evaluateConformance(resultsPublisherChecks, createMockPublisherHarness)).toEqual([]);
  });

  it("catches a publisher that accepts writes after the lock", async () => {
    const failures = await evaluateConformance(resultsPublisherChecks, createWritesAfterLockHarness);
    expect(failures.map((f) => f.name)).toEqual([
      "the lock covers the event pointer and every winner record",
    ]);
  });
});
