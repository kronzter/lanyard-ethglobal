// `prepare(records, ensReader, context, config)` (B2.2-R5): fetch every historical ENS read the
// rules will need, deduplicated, and return them as sorted bundle entries.
//
// It runs in two passes so a forged record cannot create required dependencies:
//   1. Map creation timestamps to Sepolia blocks, then fetch the badge reads (owner, expiry,
//      registration ID, permission note, cutoff continuity) for records that passed the
//      ENS-free screen and claim a badge writer path.
//   2. Re-run the writer checks against those reads; only records that pass may declare their
//      kind's extra reads (e.g. a seat assignment's hacker label).
// Any read failure throws (EnsReadError): a missing historical read is never replaced by current
// state or treated as "no name". This module calls the injected reader only; it never touches a
// clock or the network directly.
import { compareEnsEntries, type PreparedEnsEntry } from "@/shared/evidence/bundle";
import { dedupeObservations, type CapturedObservation } from "@/shared/evidence/observation";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import { isCanonicalLabel } from "@/shared/labels";
import { authorityMatch, badgeReads, badgeWriters, resolveWriter, screen } from "./base";
import { rulesConfigOf } from "./config";
import { checkContext, type Engine } from "./engine";
import { encodeResult, entryCoordinates, EnsSnapshot, readId, type EnsRead } from "./snapshot";
import { mapTimes, TimeMap } from "./time";

export type PrepareStats = {
  /** Reads the rules declared, before deduplication. */
  declared: number;
  /** Distinct reads actually sent to the reader (excluding time mapping). */
  fetched: number;
  /** Declared reads answered from an earlier identical read. */
  cacheHits: number;
  /** Distinct timestamps mapped through `sepoliaBlockAt`. */
  timeMappings: number;
  byQuery: Record<string, number>;
};

export type Prepared = { ens: PreparedEnsEntry[]; stats: PrepareStats };

class ReadBatch {
  private readonly pending = new Map<string, EnsRead>();
  private readonly done = new Map<string, PreparedEnsEntry>();
  declared = 0;

  add(reads: Iterable<EnsRead>): void {
    for (const r of reads) {
      this.declared++;
      if (r.label !== "" && !isCanonicalLabel(r.label))
        throw new Error(`a rule declared a read of non-canonical label ${JSON.stringify(r.label)}`);
      const id = readId(r);
      if (!this.done.has(id)) this.pending.set(id, r);
    }
  }

  async flush(reader: EnsReader): Promise<void> {
    const batch = [...this.pending];
    this.pending.clear();
    for (const [id, r] of batch) {
      const value = await fetchRead(reader, r);
      this.done.set(id, { ...entryCoordinates(r), result: encodeResult(r, value) });
    }
  }

  entries(): PreparedEnsEntry[] {
    return [...this.done.values()];
  }
}

function fetchRead(reader: EnsReader, r: EnsRead) {
  switch (r.query) {
    case "owner":
      return reader.owner(r.label, { sepoliaBlock: r.block });
    case "address":
      return reader.address(r.label, { sepoliaBlock: r.block });
    case "expiry":
      return reader.expiry(r.label, { sepoliaBlock: r.block });
    case "registrationId":
      return reader.registrationId(r.label, { sepoliaBlock: r.block });
    case "text":
      return reader.text(r.label, r.key, { sepoliaBlock: r.block });
    case "unregisteredBetween":
      return reader.unregisteredBetween(r.label, r.from, r.to);
  }
}

export async function prepareWith(
  engine: Engine,
  records: readonly CapturedObservation[],
  reader: EnsReader,
  context: EvaluationContext,
  frozenConfig: unknown,
): Promise<Prepared> {
  const config = rulesConfigOf(frozenConfig, context.configHash);
  checkContext(context, config);
  const cutoffBlock = context.sepoliaCutoff.number;
  const screened = dedupeObservations([...records])
    .map((obs) => screen(obs, context, engine.rules))
    .flatMap((s) => (s.ok ? [s] : []));

  const timeEntries = await mapTimes(
    screened.map((s) => s.record.obs.createdAtTimestamp),
    reader,
    context.sepoliaCutoff,
  );
  const time = TimeMap.fromEntries(timeEntries);

  // Pass 1: badge reads for records that are not authority-written.
  const batch = new ReadBatch();
  for (const { record, rule } of screened) {
    if (authorityMatch(record, rule, config)) continue;
    const block = time.blockAt(record.obs.createdAtTimestamp);
    for (const w of badgeWriters(record, rule)) batch.add(badgeReads(record.byLabel!, w, block, cutoffBlock));
  }
  await batch.flush(reader);

  // Pass 2: kind-specific reads, only for records whose writer checked out.
  const ens = EnsSnapshot.from(batch.entries());
  for (const { record, rule } of screened) {
    if (!rule.reads) continue;
    const creationBlock = time.blockAt(record.obs.createdAtTimestamp);
    const writer = resolveWriter(record, rule, config, ens, creationBlock, context);
    if (!writer.ok) continue;
    batch.add(rule.reads({ record, writer: writer.writer, creationBlock, cutoffBlock, config }));
  }
  await batch.flush(reader);

  const fetched = batch.entries();
  const byQuery: Record<string, number> = {};
  for (const e of fetched) byQuery[e.query] = (byQuery[e.query] ?? 0) + 1;
  return {
    ens: [...timeEntries, ...fetched].sort(compareEnsEntries),
    stats: {
      declared: batch.declared,
      fetched: fetched.length,
      cacheHits: batch.declared - fetched.length,
      timeMappings: timeEntries.length,
      byQuery,
    },
  };
}
