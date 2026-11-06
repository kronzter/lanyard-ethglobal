import { describe, expect, it } from "vitest";
import { createFixtureEnsReader } from "../mocks/fixtures";
import {
  ensReaderChecks,
  evaluateConformance,
  fixtureEnsScenario,
  ownerIgnoresBlock,
  runEnsReaderConformance,
  swallowsFailures,
} from "../testing";

const subject = () => ({
  reader: createFixtureEnsReader(),
  failing: createFixtureEnsReader({ fail: () => true }),
  scenario: fixtureEnsScenario(),
});

runEnsReaderConformance("MockEnsReader", subject);

describe("EnsReader conformance self-test", () => {
  it("the fixture mock passes every check", async () => {
    expect(await evaluateConformance(ensReaderChecks, subject)).toEqual([]);
  });

  it("catches a reader whose owner ignores the requested block", async () => {
    const failures = await evaluateConformance(ensReaderChecks, () => ({
      ...subject(),
      reader: ownerIgnoresBlock(createFixtureEnsReader()),
    }));
    expect(failures.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        "a registration is honoured until the block it is unregistered",
        "a name is invalid at exactly its expiry",
      ]),
    );
  });

  it("catches a reader that turns RPC failures into no name", async () => {
    const failures = await evaluateConformance(ensReaderChecks, () => ({
      ...subject(),
      failing: swallowsFailures(createFixtureEnsReader({ fail: () => true })),
    }));
    expect(failures.map((f) => f.name)).toEqual(["RPC failures throw instead of returning no name"]);
  });
});
