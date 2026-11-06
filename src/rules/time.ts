// Arkiv-to-Sepolia time mapping (B2.1; plans/01-evidence-and-interfaces.md §2).
//
// A record's "moment" is its retained Arkiv creation timestamp. The Sepolia block for that moment
// is the latest block at or before it (`EnsReader.sepoliaBlockAt`, floor), and historical ENS reads
// happen at that block. The mapping is prepared outside the rules and retained in the bundle as
// `sepoliaBlockAt` entries, so evaluation stays pure and a verifier can re-derive it. A missing
// timestamp is an error: there is no fallback that guesses a time from an Arkiv block number.
import { compareEnsEntries, type PreparedEnsEntry } from "@/shared/evidence/bundle";
import type { EnsReader } from "@/shared/interfaces/ens-reader";

export class TimeMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeMappingError";
  }
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** The prepared entry recording `sepoliaBlockAt(timestamp) = sepoliaBlock`. */
export const timeEntry = (timestamp: bigint, sepoliaBlock: bigint): PreparedEnsEntry => ({
  label: "",
  block: sepoliaBlock,
  query: "sepoliaBlockAt",
  key: timestamp.toString(),
  result: null,
});

/** A pure lookup over prepared time entries. Unknown timestamps throw; nothing is interpolated. */
export class TimeMap {
  private constructor(private readonly byTimestamp: ReadonlyMap<bigint, bigint>) {}

  /** Build from prepared entries, ignoring non-time queries. Malformed or inconsistent entries throw. */
  static fromEntries(entries: readonly PreparedEnsEntry[]): TimeMap {
    const map = new Map<bigint, bigint>();
    for (const e of entries) {
      if (e.query !== "sepoliaBlockAt") continue;
      if (e.label !== "" || e.result !== null || !DECIMAL.test(e.key))
        throw new TimeMappingError(`malformed sepoliaBlockAt entry ${JSON.stringify(e.key)}`);
      const ts = BigInt(e.key);
      const seen = map.get(ts);
      if (seen !== undefined && seen !== e.block)
        throw new TimeMappingError(`timestamp ${ts} maps to both block ${seen} and ${e.block}`);
      map.set(ts, e.block);
    }
    assertMonotonic(map);
    return new TimeMap(map);
  }

  /** The Sepolia block prepared for this exact timestamp. */
  blockAt(timestamp: bigint): bigint {
    const block = this.byTimestamp.get(timestamp);
    if (block === undefined)
      throw new TimeMappingError(`no prepared Sepolia block for timestamp ${timestamp}`);
    return block;
  }

  has(timestamp: bigint): boolean {
    return this.byTimestamp.has(timestamp);
  }

  get size(): number {
    return this.byTimestamp.size;
  }
}

/** A later timestamp can never map to an earlier block; a reader that says otherwise is broken. */
function assertMonotonic(map: ReadonlyMap<bigint, bigint>): void {
  const sorted = [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    const [t0, b0] = sorted[i - 1]!;
    const [t1, b1] = sorted[i]!;
    if (b1 < b0)
      throw new TimeMappingError(`timestamp ${t1} maps to block ${b1}, before ${t0}'s block ${b0}`);
  }
}

/**
 * Map each distinct timestamp through `sepoliaBlockAt` and return sorted prepared entries.
 * Throws on a zero (unavailable) timestamp, any reader failure, a block past the Sepolia cutoff or
 * a non-monotonic answer.
 */
export async function mapTimes(
  timestamps: Iterable<bigint>,
  reader: Pick<EnsReader, "sepoliaBlockAt">,
  sepoliaCutoff: { number: bigint },
): Promise<PreparedEnsEntry[]> {
  const distinct = [...new Set(timestamps)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries: PreparedEnsEntry[] = [];
  for (const ts of distinct) {
    if (ts <= 0n) throw new TimeMappingError(`timestamp ${ts} is unavailable evidence`);
    const block = await reader.sepoliaBlockAt(ts);
    if (block > sepoliaCutoff.number)
      throw new TimeMappingError(
        `timestamp ${ts} maps to Sepolia block ${block}, past the cutoff ${sepoliaCutoff.number}`,
      );
    entries.push(timeEntry(ts, block));
  }
  TimeMap.fromEntries(entries); // monotonicity check
  return entries.sort(compareEnsEntries);
}
