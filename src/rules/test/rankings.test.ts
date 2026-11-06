import { describe, expect, it } from "vitest";
import { bytesToHex } from "viem";
import { canonicalBytes } from "@/shared/canonical";
import { decodeRecord, type DecodedRecord } from "../decode";
import { aggregateRankings } from "../rankings";
import { rulesConfigOf } from "../config";
import type { RulesOutput } from "../types";
import { context, frozen, key, obs, persona, RULES_VERSION } from "./harness";
function scenario(values: number[][], weights = [1], scale = 10) {
  const records: DecodedRecord[] = [];
  const add = (kind: string, n: bigint, attrs: Parameters<typeof obs>[0]["attrs"]) => {
    const d = decodeRecord(
      obs({
        kind,
        key: key(n),
        creator: persona("organizer").address,
        byLabel: "organizer",
        at: 9_022_000n,
        attrs,
      }),
    );
    if (!d.ok) throw new Error(d.reason);
    records.push(d.record);
    return d.record;
  };
  const rubric = add("rubric", 1n, {
    track: ["str", "main"],
    payload: [
      "bytes",
      bytesToHex(
        canonicalBytes({
          criteria: weights.map((weight, i) => ({ id: `c${i}`, name: `C${i}`, weight })),
          scale,
        }),
      ),
    ],
  });
  const scores: NonNullable<RulesOutput["scores"]> = [];
  values.forEach((judgeValues, index) => {
    const s = add("submission", BigInt(index * 100 + 10), {
      team: ["str", `team-${index}`],
      track: ["str", "main"],
    });
    add("acceptance", BigInt(index * 100 + 11), { submission: ["key", s.key] });
    judgeValues.forEach((value, j) => {
      const f = add("final_score", BigInt(index * 100 + j + 20), {
        submission: ["key", s.key],
        rubric: ["key", rubric.key],
      });
      scores.push({ key: f.key, values: Object.fromEntries(weights.map((_, i) => [`c${i}`, value + i])) });
    });
  });
  const output: RulesOutput = {
    schemaVersion: 1,
    event: frozen.edition,
    ruleVersion: RULES_VERSION,
    configHash: context().configHash,
    verdicts: records.map((r) => ({ key: r.key, kind: r.kind, counts: true })),
    scores,
  };
  const config = rulesConfigOf(frozen, context().configHash);
  return {
    records,
    output,
    config,
    rank: () => aggregateRankings(records, output, config)!.find((r) => r.track === "main")!.projects,
  };
}
describe("exact per-track raw weighted means", () => {
  it("uses all weights and judge counts without rounding before comparison", () => {
    const s = scenario(
      [
        [700, 801],
        [750, 751],
      ],
      [2, 3],
    );
    const ranked = s.rank();
    expect(ranked[0]).toMatchObject({
      team: "team-0",
      numerator: 7511n,
      denominator: 10n,
      displayHundredths: 751n,
    });
    expect(ranked[1]).toMatchObject({ team: "team-1", numerator: 7511n, denominator: 10n });
  });
  it("orders rational differences hidden by floor display", () => {
    const s = scenario([
      [750, 751, 751],
      [751, 751, 750, 750],
    ]);
    const ranked = s.rank();
    expect(ranked.map((r) => r.team)).toEqual(["team-0", "team-1"]);
    expect(ranked.map((r) => r.displayHundredths)).toEqual([750n, 750n]);
  });
  it("breaks exact ties by submission block then key and leaves zero-judge projects unranked", () => {
    const s = scenario([[750], [750], []]);
    expect(s.rank().map((p) => [p.team, p.rank, p.judgeCount])).toEqual([
      ["team-0", 1, 1],
      ["team-1", 2, 1],
      ["team-2", undefined, 0],
    ]);
    expect(s.rank()[2]!.numerator).toBeUndefined();
    s.records.reverse();
    expect(s.rank()[0]!.team).toBe("team-0");
  });
  it("flags spreads strictly over thirty percent, never for one judge", () => {
    const s = scenario([[400, 700], [399, 700], [100]]);
    expect(s.rank().find((p) => p.team === "team-0")?.spread).toBe(false);
    expect(s.rank().find((p) => p.team === "team-1")?.spread).toBe(true);
    expect(s.rank().find((p) => p.team === "team-2")?.spread).toBe(false);
  });
  it("does not return numeric rankings before decryption", () => {
    const s = scenario([[750]]);
    delete s.output.scores;
    expect(aggregateRankings(s.records, s.output, s.config)).toBeUndefined();
  });
});
