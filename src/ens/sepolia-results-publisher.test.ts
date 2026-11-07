import { describe, expect, it } from "vitest";
import type { PublicationState, WinnerInput } from "../shared/interfaces/results-publisher";
import { samplePublication } from "../shared/testing/results-publisher-conformance";
import { prizeProblem } from "./sepolia-results-publisher";
import { compareLabelBytes, declarationHashOf, eventHashOf, stateHashOf } from "./winner-registrar-abi";

const win = (team: string, prizes: string[]): WinnerInput => ({ ...samplePublication, team, prizes });

describe("prizeProblem", () => {
  it("accepts the canonical subsets of the two prizes", () => {
    for (const p of [["winner"], ["runner-up"], ["runner-up", "winner"]]) expect(prizeProblem(p)).toBeNull();
  });
  it("rejects empty, unknown, unsorted and duplicate lists instead of reordering them", () => {
    expect(prizeProblem([])).toMatch(/at least one/);
    expect(prizeProblem(["first"])).toMatch(/unknown/);
    expect(prizeProblem(["winner,runner-up"])).toMatch(/unknown/);
    expect(prizeProblem(["winner", "runner-up"])).toMatch(/sorted/);
    expect(prizeProblem(["winner", "winner"])).toMatch(/sorted/);
  });
});

describe("publication hashes", () => {
  it("orders teams by label bytes, independent of record order", () => {
    expect(compareLabelBytes("chainchat", "zkpay")).toBeLessThan(0);
    expect(compareLabelBytes("ab", "a")).toBeGreaterThan(0);
    const a: PublicationState = {
      eventResults: samplePublication,
      winners: { zkpay: win("zkpay", ["winner"]), chainchat: win("chainchat", ["runner-up"]) },
      locked: false,
    };
    const b: PublicationState = {
      ...a,
      winners: { chainchat: a.winners.chainchat!, zkpay: a.winners.zkpay! },
    };
    expect(stateHashOf(a)).toBe(stateHashOf(b));
    expect(stateHashOf({ ...a, locked: true })).toBe(stateHashOf(a));
  });
  it("commits to every field", () => {
    expect(eventHashOf({ ...samplePublication, bundleUri: `${samplePublication.bundleUri}?` })).not.toBe(
      eventHashOf(samplePublication),
    );
    expect(declarationHashOf(win("zkpay", ["winner"]))).not.toBe(
      declarationHashOf(win("zkpay", ["runner-up"])),
    );
  });
});
