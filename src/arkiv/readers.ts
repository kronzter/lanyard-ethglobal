// Typed readers (B1.3-R4/R6/R7). Every reader filters on the indexed `app`/`event`/`kind` columns,
// pages by ascending key with an explicit page budget, records the block each page was read at,
// and says whether the scan was complete; an exhausted budget is never reported as complete.
// Records that do not decode as their kind (anyone can write `app: "lanyard"`) are skipped and
// counted, never crash a screen. Status is modeled positively: there is no `!=` (the node rejects
// it), so an "open" ticket is one with no resolution record, computed here, not filtered there.
// These are current observations; whether a record counts is decided by the rules (B2).
import type { ArkivValue } from "@arkiv-network/sdk";
import type { Venue } from "@/shared/types/venue";
import type { Address, Hex } from "@/shared/types/primitives";
import { MAX_PAGE, type ArkivReader, type QueryFilter, type StoredEntity } from "./api";
import { APP, KINDS, type Kind } from "./kinds";

export type PageInfo = { blockNumber: bigint; count: number };
export type Scan<T> = { records: T[]; skipped: number; pages: PageInfo[]; complete: boolean };

/** A decoded record: system fields plus the kind's columns as plain values. */
export type LanyardRecord = {
  key: Hex;
  kind: Kind;
  creator: Address;
  owner: Address;
  createdAt: bigint;
  updatedAt: bigint;
  expiresAt: bigint;
  flags: StoredEntity["flags"];
  byLabel: string;
  values: Record<string, string | bigint>;
};

const str = (value: string): ArkivValue => ({ type: "str", value }) as ArkivValue;

const plain = (v: ArkivValue): string | bigint =>
  v.type === "u64" || v.type === "u256" || v.type === "i32"
    ? BigInt(v.value as never)
    : typeof v.value === "string"
      ? v.type === "str"
        ? v.value
        : v.value.toLowerCase()
      : String(v.value);

/** Decode one entity as `kind`, or null if it does not fit (wrong app/kind, missing or mistyped column). */
export function decodeRecord(e: StoredEntity, kind: Kind): LanyardRecord | null {
  const a = e.attributes;
  if (
    a.app?.value.value !== APP ||
    a.kind?.value.value !== kind ||
    typeof a.by_label?.value.value !== "string"
  )
    return null;
  const values: Record<string, string | bigint> = {};
  const columns = KINDS[kind].schema.columns as Record<string, { type: string; isOptional: boolean }>;
  for (const [name, col] of Object.entries(columns)) {
    const got = a[name];
    if (!got) {
      if (col.isOptional) continue;
      return null;
    }
    if (got.value.type !== col.type) return null;
    values[name] = plain(got.value);
  }
  return {
    key: e.key,
    kind,
    creator: e.creator,
    owner: e.owner,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    expiresAt: e.expiresAt,
    flags: e.flags,
    byLabel: a.by_label!.value.value as string,
    values,
  };
}

export type ScanOptions = { maxPages?: number; pageSize?: number };

/** All live records matching `filter`, key-ordered, within a page budget. */
export async function scan(
  reader: ArkivReader,
  filter: QueryFilter,
  opts: ScanOptions = {},
): Promise<Scan<StoredEntity>> {
  const maxPages = opts.maxPages ?? 50;
  const limit = Math.min(opts.pageSize ?? MAX_PAGE, MAX_PAGE);
  const records: StoredEntity[] = [];
  const pages: PageInfo[] = [];
  let afterKey = filter.afterKey;
  for (let i = 0; i < maxPages; i++) {
    const page = await reader.query({ ...filter, afterKey, limit });
    pages.push({ blockNumber: page.blockNumber, count: page.entities.length });
    records.push(...page.entities);
    if (page.entities.length < limit) return { records, skipped: 0, pages, complete: true };
    afterKey = page.entities.at(-1)!.key;
  }
  return { records, skipped: 0, pages, complete: false };
}

/** Every live record of `kind` in the edition (optionally narrowed by more indexed equalities). */
export async function scanKind(
  reader: ArkivReader,
  edition: string,
  kind: Kind,
  equals: Record<string, ArkivValue> = {},
  opts: ScanOptions & { creator?: Address } = {},
): Promise<Scan<LanyardRecord>> {
  const raw = await scan(
    reader,
    { equals: { app: str(APP), event: str(edition), kind: str(kind), ...equals }, creator: opts.creator },
    opts,
  );
  const records = raw.records.map((e) => decodeRecord(e, kind)).filter((r): r is LanyardRecord => r !== null);
  return { ...raw, records, skipped: raw.records.length - records.length };
}

/** Every live Lanyard record of the edition, any kind (capture and the organizer record list). */
export const allRecordsForEvent = (reader: ArkivReader, edition: string, opts: ScanOptions = {}) =>
  scan(reader, { equals: { app: str(APP), event: str(edition) } }, opts);

/** A volunteer's shifts, newest first. */
export async function myShifts(
  reader: ArkivReader,
  edition: string,
  volunteer: string,
  opts: ScanOptions = {},
) {
  const s = await scanKind(reader, edition, "shift", { volunteer: str(volunteer) }, opts);
  return {
    ...s,
    records: [...s.records].sort((a, b) =>
      a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0,
    ),
  };
}

/**
 * Tickets raised from seats in `zone` that have no resolution record yet. This is the candidate
 * list a helper's screen starts from; ticket validity, the 4 h lifetime, claim leases and badge
 * checks are applied by the rules (B2/B3) at an explicit evaluation time.
 */
export async function ticketsOpenInZone(
  reader: ArkivReader,
  edition: string,
  venue: Pick<Venue, "seats">,
  zone: string,
  opts: ScanOptions = {},
) {
  const seats = new Set(venue.seats.filter((s) => s.zone === zone).map((s) => s.id));
  const [tickets, resolutions] = await Promise.all([
    scanKind(reader, edition, "ticket", {}, opts),
    scanKind(reader, edition, "ticket_resolution", {}, opts),
  ]);
  const resolved = new Set(resolutions.records.map((r) => r.values.ticket as string));
  return {
    records: tickets.records.filter((t) => seats.has(t.values.seat as string) && !resolved.has(t.key)),
    skipped: tickets.skipped + resolutions.skipped,
    complete: tickets.complete && resolutions.complete,
  };
}

/** A judge's assignments with the submissions they point at (missing submissions are listed). */
export async function projectsForJudge(
  reader: ArkivReader,
  edition: string,
  judge: string,
  opts: ScanOptions = {},
) {
  const assignments = await scanKind(reader, edition, "judge_assignment", { judge: str(judge) }, opts);
  const items = await Promise.all(
    assignments.records.map(async (assignment) => {
      const e = await reader.get(assignment.values.submission as Hex);
      return { assignment, submission: e ? decodeRecord(e, "submission") : null };
    }),
  );
  return { items, skipped: assignments.skipped, complete: assignments.complete };
}

/** The live inputs of judging: submissions, acceptances, rubrics, assignments, finals and recusals. */
export async function leaderboardInputs(reader: ArkivReader, edition: string, opts: ScanOptions = {}) {
  const kinds = ["submission", "acceptance", "rubric", "judge_assignment", "final_score", "recusal"] as const;
  const scans = await Promise.all(kinds.map((k) => scanKind(reader, edition, k, {}, opts)));
  return {
    byKind: Object.fromEntries(kinds.map((k, i) => [k, scans[i]!.records])) as Record<
      (typeof kinds)[number],
      LanyardRecord[]
    >,
    skipped: scans.reduce((n, s) => n + s.skipped, 0),
    complete: scans.every((s) => s.complete),
  };
}
