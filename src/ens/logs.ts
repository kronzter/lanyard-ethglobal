// Bounded log scans. Public and free-tier RPCs cap eth_getLogs ranges unpredictably (measured
// 2026-11-07 on publicnode Sepolia: 10k blocks usually works, 50k fails, and a 5k request once
// failed), so scans go in chunks and halve a chunk that fails. A chunk that still fails at the
// minimum span throws: a partial scan is never reported as "no events". Runtime-neutral (viem only).
export type LogRange = { fromBlock: bigint; toBlock: bigint };

export type ChunkOptions = { maxSpan?: bigint; minSpan?: bigint };

export const DEFAULT_MAX_SPAN = 5_000n;
export const DEFAULT_MIN_SPAN = 100n;

export class LogScanError extends Error {
  constructor(
    readonly range: LogRange,
    cause: unknown,
  ) {
    super(
      `log scan failed for blocks ${range.fromBlock}-${range.toBlock}: ${
        cause instanceof Error
          ? ((cause as { shortMessage?: string }).shortMessage ?? cause.message)
          : String(cause)
      }`,
    );
    this.name = "LogScanError";
  }
}

/** Calls `fetch` over `[from, to]` in chunks, in block order, and concatenates the results. */
export async function scanLogs<T>(
  from: bigint,
  to: bigint,
  fetch: (range: LogRange) => Promise<T[]>,
  opts: ChunkOptions = {},
): Promise<T[]> {
  const maxSpan = opts.maxSpan ?? DEFAULT_MAX_SPAN;
  const minSpan = opts.minSpan ?? DEFAULT_MIN_SPAN;
  if (maxSpan < 1n || minSpan < 1n || minSpan > maxSpan) throw new Error("bad log scan spans");
  const out: T[] = [];
  let start = from;
  let span = maxSpan;
  while (start <= to) {
    const end = start + span - 1n < to ? start + span - 1n : to;
    try {
      out.push(...(await fetch({ fromBlock: start, toBlock: end })));
      start = end + 1n;
      span = maxSpan;
    } catch (err) {
      if (span <= minSpan) throw new LogScanError({ fromBlock: start, toBlock: end }, err);
      span = span / 2n < minSpan ? minSpan : span / 2n;
    }
  }
  return out;
}
