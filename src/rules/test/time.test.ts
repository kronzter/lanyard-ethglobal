import { describe, expect, it } from "vitest";
import { EnsReadError } from "@/shared/interfaces/ens-reader";
import { createFixtureEnsReader, fixtureTimeline } from "@/shared/mocks/fixtures";
import { mapTimes, TimeMap, TimeMappingError, timeEntry } from "@/rules/time";

const timeline = fixtureTimeline();
const g = timeline.genesis;
const tsOf = (block: bigint) => g.timestamp + (block - g.block) * 12n;
const cutoff = { number: timeline.times.results.block };

describe("B2.1 time mapping", () => {
  it("maps a timestamp between two blocks to the earlier one", async () => {
    const reader = createFixtureEnsReader();
    const between = tsOf(9_021_700n) + 5n;
    const [entry] = await mapTimes([between], reader, cutoff);
    expect(entry).toEqual(timeEntry(between, 9_021_700n));
    expect(TimeMap.fromEntries([entry!]).blockAt(between)).toBe(9_021_700n);
  });

  it("maps a timestamp exactly on a block to that block", async () => {
    const [entry] = await mapTimes([tsOf(9_021_700n)], createFixtureEnsReader(), cutoff);
    expect(entry!.block).toBe(9_021_700n);
  });

  it("is independent of input order and deduplicates", async () => {
    const ts = [tsOf(9_030_000n), tsOf(9_021_601n) + 3n, tsOf(9_030_000n), tsOf(9_025_000n)];
    const a = await mapTimes(ts, createFixtureEnsReader(), cutoff);
    const b = await mapTimes([...ts].reverse(), createFixtureEnsReader(), cutoff);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it("fails on an unavailable (zero) timestamp instead of guessing", async () => {
    await expect(mapTimes([0n], createFixtureEnsReader(), cutoff)).rejects.toThrow(TimeMappingError);
  });

  it("propagates a reader failure", async () => {
    const reader = createFixtureEnsReader({ fail: (m) => m === "sepoliaBlockAt" });
    await expect(mapTimes([tsOf(9_021_700n)], reader, cutoff)).rejects.toThrow(EnsReadError);
  });

  it("refuses a timestamp that maps past the Sepolia cutoff", async () => {
    await expect(mapTimes([tsOf(cutoff.number + 1n)], createFixtureEnsReader(), cutoff)).rejects.toThrow(
      /past the cutoff/,
    );
  });

  it("refuses a reader that maps a later time to an earlier block", async () => {
    const broken = { sepoliaBlockAt: async (t: bigint) => (t === 2_000n ? 5n : 9n) };
    await expect(mapTimes([1_000n, 2_000n], broken, { number: 100n })).rejects.toThrow(/before/);
  });

  it("a lookup of an unprepared timestamp throws", () => {
    const map = TimeMap.fromEntries([timeEntry(10n, 1n)]);
    expect(() => map.blockAt(11n)).toThrow(TimeMappingError);
  });

  it("rejects conflicting or malformed entries", () => {
    expect(() => TimeMap.fromEntries([timeEntry(10n, 1n), timeEntry(10n, 2n)])).toThrow(/both/);
    expect(() => TimeMap.fromEntries([{ ...timeEntry(10n, 1n), key: "010" }])).toThrow(/malformed/);
    expect(() => TimeMap.fromEntries([{ ...timeEntry(10n, 1n), label: "x" }])).toThrow(/malformed/);
  });
});
