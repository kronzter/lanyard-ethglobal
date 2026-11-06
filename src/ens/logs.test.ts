import { describe, expect, it } from "vitest";
import { LogScanError, scanLogs } from "./logs";

describe("scanLogs", () => {
  it("covers the range in order, inclusive, in bounded chunks", async () => {
    const seen: [bigint, bigint][] = [];
    const out = await scanLogs(
      10n,
      34n,
      async (r) => {
        seen.push([r.fromBlock, r.toBlock]);
        return [r.fromBlock];
      },
      { maxSpan: 10n, minSpan: 1n },
    );
    expect(seen).toEqual([
      [10n, 19n],
      [20n, 29n],
      [30n, 34n],
    ]);
    expect(out).toEqual([10n, 20n, 30n]);
  });

  it("halves a failing chunk and keeps going", async () => {
    const seen: bigint[] = [];
    await scanLogs(
      0n,
      7n,
      async (r) => {
        if (r.toBlock - r.fromBlock >= 4n) throw new Error("range too large");
        seen.push(r.fromBlock, r.toBlock);
        return [];
      },
      { maxSpan: 8n, minSpan: 1n },
    );
    expect(seen).toEqual([0n, 3n, 4n, 7n]);
  });

  it("throws, never returns a partial scan, when the minimum span still fails", async () => {
    await expect(
      scanLogs(0n, 9n, async () => Promise.reject(new Error("rpc down")), { maxSpan: 4n, minSpan: 2n }),
    ).rejects.toBeInstanceOf(LogScanError);
  });

  it("returns nothing for an empty range", async () => {
    expect(await scanLogs(5n, 4n, async () => [1])).toEqual([]);
  });
});
