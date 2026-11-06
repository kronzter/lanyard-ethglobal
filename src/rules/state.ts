// Derived state over evidence (B3): venues, seats, shifts, sessions and tickets.
//
// Kind rules call these while judging a record, seeing only records earlier in evidence order
// (an earlier record's verdict is known; a later one's is not), so the outcome never depends on
// input order and equal-block ties go to the lowest key. Views call the same functions after
// evaluation with every verdict known. Times are retained Arkiv creation timestamps (seconds);
// intervals are half-open.
import { parseJsonStrict } from "@/shared/canonical";
import { parseVenue, type Venue } from "@/shared/types/venue";
import type { Address, Hex } from "@/shared/types/primitives";
import { addr, bytes, ref, str, u64, type DecodedRecord } from "./decode";
import type { RuleCtx } from "./types";

/** Self clock-in window around shift start (B3.1-R1), claim lease and ticket life (B3.2-R3). */
export const SELF_START_BEFORE = 3600n;
export const SELF_START_AFTER = 900n;
export const LEASE_SECONDS = 900n;
export const TICKET_LIFE_SECONDS = 14_400n;
export const MAX_OPEN_TICKETS = 3;

const FOREVER = (1n << 64n) - 1n;

/** Records grouped for cross-record rules, built once per evaluation. */
export type Index = {
  byKey: ReadonlyMap<Hex, DecodedRecord>;
  position: ReadonlyMap<Hex, number>;
  byKind(kind: string): readonly DecodedRecord[];
  /** Records of `kind` whose `attr` references `key`, in evidence order. */
  referencing(kind: string, attr: string, key: Hex): readonly DecodedRecord[];
};

const indexes = new WeakMap<readonly DecodedRecord[], Index>();

export function indexOf(records: readonly DecodedRecord[]): Index {
  const cached = indexes.get(records);
  if (cached) return cached;
  const byKey = new Map<Hex, DecodedRecord>();
  const position = new Map<Hex, number>();
  const kinds = new Map<string, DecodedRecord[]>();
  const refs = new Map<string, DecodedRecord[]>();
  records.forEach((r, i) => {
    byKey.set(r.key, r);
    position.set(r.key, i);
    (kinds.get(r.kind) ?? kinds.set(r.kind, []).get(r.kind)!).push(r);
    for (const [name, v] of r.attrs) {
      if (v.type !== "key") continue;
      const id = `${r.kind}\u0000${name}\u0000${v.value}`;
      (refs.get(id) ?? refs.set(id, []).get(id)!).push(r);
    }
  });
  const index: Index = {
    byKey,
    position,
    byKind: (kind) => kinds.get(kind) ?? [],
    referencing: (kind, attr, key) => refs.get(`${kind}\u0000${attr}\u0000${key}`) ?? [],
  };
  indexes.set(records, index);
  return index;
}

/** What a derivation may know: the index and which records count (so far, inside a rule). */
export type Facts = { idx: Index; counted(key: Hex): boolean };

/** Rule-time facts: only records before this one in evidence order are known to count. */
export const factsOf = (ctx: Pick<RuleCtx, "records" | "verdictOf">): Facts => ({
  idx: indexOf(ctx.records),
  counted: (key) => ctx.verdictOf(key)?.counts === true,
});

export const createdAt = (r: DecodedRecord): bigint => r.obs.createdAtTimestamp;

// ── Venue and seats ──────────────────────────────────────────────────────────────────────────

const venues = new WeakMap<DecodedRecord, Venue | string>();

/** The venue a `venue` record publishes, or why its payload is not one. */
export function venuePayload(r: DecodedRecord): Venue | string {
  const cached = venues.get(r);
  if (cached !== undefined) return cached;
  let out: Venue | string;
  const hex = bytes(r, "payload");
  if (hex === undefined || hex === "0x") out = "venue record carries no payload";
  else {
    try {
      // Strict UTF-8: decodeURIComponent throws on malformed sequences.
      const text = decodeURIComponent(hex.slice(2).replace(/(..)/g, "%$1"));
      out = parseVenue(parseJsonStrict(text));
    } catch (e) {
      out = `venue payload is not a valid venue.json (${(e as Error).message.split("\n")[0]})`;
    }
  }
  venues.set(r, out);
  return out;
}

/** The latest counted record of `kind` created at or before `t` that `match`es; ties: lowest key. */
function latestAt(
  f: Facts,
  kind: string,
  t: bigint,
  match: (r: DecodedRecord) => boolean = () => true,
): DecodedRecord | undefined {
  let best: DecodedRecord | undefined;
  for (const r of f.idx.byKind(kind)) {
    if (createdAt(r) > t || !f.counted(r.key) || !match(r)) continue;
    // Evidence order is block then key, so a strictly later block replaces; a tie keeps the lower key.
    if (!best || r.obs.createdAtBlock > best.obs.createdAtBlock) best = r;
  }
  return best;
}

export type VenueAt = { record: DecodedRecord; venue: Venue };

/** The latest valid venue at `t` (B3.3-R6). */
export function venueAt(f: Facts, t: bigint): VenueAt | undefined {
  const record = latestAt(f, "venue", t);
  if (!record) return undefined;
  const venue = venuePayload(record);
  return typeof venue === "string" ? undefined : { record, venue };
}

/** The latest valid seat assignment for a hacker address at `t` (B3.3-R6). */
export function seatAssignmentAt(f: Facts, hacker: Address, t: bigint): DecodedRecord | undefined {
  const h = hacker.toLowerCase();
  return latestAt(f, "seat_assignment", t, (r) => addr(r, "hacker_address") === h);
}

// ── Shifts and sessions ──────────────────────────────────────────────────────────────────────

export type ShiftInfo = {
  record: DecodedRecord;
  volunteer: string;
  zone: string;
  startsAt: bigint;
  endsAt: bigint;
  supersedes?: Hex;
};

export function shiftInfo(r: DecodedRecord): ShiftInfo | undefined {
  const volunteer = str(r, "volunteer");
  const zone = str(r, "zone");
  const startsAt = u64(r, "starts_at");
  const endsAt = u64(r, "ends_at");
  if (volunteer === undefined || zone === undefined || startsAt === undefined || endsAt === undefined)
    return undefined;
  const supersedes = ref(r, "supersedes");
  return { record: r, volunteer, zone, startsAt, endsAt, ...(supersedes ? { supersedes } : {}) };
}

/** True when `a` wins over a competing replacement `b` of the same shift: later block, then lower key. */
const wins = (a: DecodedRecord, b: DecodedRecord) =>
  a.obs.createdAtBlock > b.obs.createdAtBlock ||
  (a.obs.createdAtBlock === b.obs.createdAtBlock && a.key < b.key);

/**
 * When a counted shift stops covering: its `ends_at`, or earlier when a counted replacement lands
 * (prospectively, from the replacement's creation). A competing replacement of the same parent
 * that wins the tie-break also cuts it.
 */
export function effectiveEnd(f: Facts, s: ShiftInfo): bigint {
  let end = s.endsAt;
  const cut = (r: DecodedRecord) => {
    if (f.counted(r.key) && createdAt(r) < end) end = createdAt(r);
  };
  for (const r of f.idx.referencing("shift", "supersedes", s.record.key)) cut(r);
  if (s.supersedes)
    for (const r of f.idx.referencing("shift", "supersedes", s.supersedes))
      if (r.key !== s.record.key && wins(r, s.record)) cut(r);
  return end;
}

export type Session = {
  shift: ShiftInfo;
  /** The counted clock-in that opened it. */
  clockIn: DecodedRecord;
  /** When duty starts: the clock-in, but never before the shift starts. */
  start: bigint;
  /** When it ends: a counted clock-out, the shift's effective end, whichever is first. */
  end: bigint;
};

/** Sessions of one shift from its counted clocks created at or before `t`. */
export function sessionsOfShift(f: Facts, s: ShiftInfo, t: bigint = FOREVER): Session[] {
  const shiftEnd = effectiveEnd(f, s);
  const out: Session[] = [];
  let open: DecodedRecord | undefined;
  for (const c of f.idx.referencing("clock", "shift", s.record.key)) {
    if (!f.counted(c.key) || createdAt(c) > t) continue;
    const action = str(c, "action");
    if (action === "in" && !open) open = c;
    else if (action === "out" && open) {
      out.push(session(s, open, createdAt(c), shiftEnd));
      open = undefined;
    }
  }
  if (open) out.push(session(s, open, FOREVER, shiftEnd));
  return out;
}

const session = (shift: ShiftInfo, clockIn: DecodedRecord, outAt: bigint, shiftEnd: bigint): Session => {
  const start = createdAt(clockIn) > shift.startsAt ? createdAt(clockIn) : shift.startsAt;
  const end = outAt < shiftEnd ? outAt : shiftEnd;
  return { shift, clockIn, start, end };
};

/** The open session of one shift at `t` (a clock-in not yet closed and the shift still covering). */
export function openSession(f: Facts, s: ShiftInfo, t: bigint): Session | undefined {
  return sessionsOfShift(f, s, t).find((x) => x.end > t && createdAt(x.clockIn) <= t);
}

/** Counted shifts for a volunteer created at or before `t`. */
export function shiftsOf(f: Facts, volunteer: string, t: bigint = FOREVER): ShiftInfo[] {
  return f.idx
    .byKind("shift")
    .filter((r) => createdAt(r) <= t && f.counted(r.key) && str(r, "volunteer") === volunteer)
    .map((r) => shiftInfo(r)!)
    .filter(Boolean);
}

/**
 * Sessions active at `t` (B3.1-R2's on-duty, minus the badge check, which callers make at their
 * own action time): duty started, not ended, optionally in one zone.
 */
export function activeSessions(f: Facts, volunteer: string, t: bigint, zone?: string): Session[] {
  return shiftsOf(f, volunteer, t)
    .filter((s) => zone === undefined || s.zone === zone)
    .flatMap((s) => sessionsOfShift(f, s, t))
    .filter((x) => x.start <= t && t < x.end);
}

// ── Tickets ──────────────────────────────────────────────────────────────────────────────────

export type TicketInfo = {
  record: DecodedRecord;
  seat: string;
  category: string;
  /** The venue record the ticket bound at creation, and the seat's zone in it. */
  venue: VenueAt;
  zone: string;
};

/** A ticket's bound venue and zone, or why it has none. Later venues never move it (B3.3-R6). */
export function ticketInfo(f: Facts, r: DecodedRecord): TicketInfo | string {
  const seat = str(r, "seat");
  const category = str(r, "category");
  const venueKey = ref(r, "venue");
  if (seat === undefined || category === undefined || venueKey === undefined)
    return "ticket needs seat, venue and category";
  const v = f.idx.byKey.get(venueKey);
  if (!v || v.kind !== "venue" || !f.counted(v.key))
    return `ticket names venue ${venueKey}, which is not a counted venue`;
  const venue = venuePayload(v);
  if (typeof venue === "string") return venue;
  const s = venue.seats.find((x) => x.id === seat);
  if (!s) return `seat ${JSON.stringify(seat)} is not in the ticket's venue`;
  return { record: r, seat, category, venue: { record: v, venue }, zone: s.zone };
}

export type TicketState =
  | { state: "open" }
  | { state: "claimed"; claim: DecodedRecord; leaseEnd: bigint }
  | { state: "resolved"; resolution: DecodedRecord }
  | { state: "confirmed"; resolution: DecodedRecord; confirmation: DecodedRecord }
  | { state: "closed" }
  | { state: "over-capacity" }
  | { state: "unverifiable"; reason: string };

const firstCounted = (f: Facts, rs: readonly DecodedRecord[], t: bigint) =>
  rs.find((r) => createdAt(r) <= t && f.counted(r.key));

/** Known later evidence that points at something missing from the capture (B3.2 › Reopen). */
function missingEvidence(f: Facts, ticket: Hex, t: bigint): string | undefined {
  for (const r of f.idx.referencing("ticket_resolution", "ticket", ticket)) {
    const claim = ref(r, "claim");
    if (createdAt(r) <= t && claim && !f.idx.byKey.has(claim))
      return `resolution ${r.key} references claim ${claim}, which is not in the captured evidence`;
  }
  for (const r of f.idx.referencing("ticket_confirmation", "ticket", ticket)) {
    const res = ref(r, "resolution");
    if (createdAt(r) <= t && res && !f.idx.byKey.has(res))
      return `confirmation ${r.key} references resolution ${res}, which is not in the captured evidence`;
  }
  return undefined;
}

/** Resolved, unverifiable or past its 4 h life at `t`; capacity and claims aside. */
function settled(f: Facts, ticket: DecodedRecord, t: bigint): TicketState | undefined {
  const resolution = firstCounted(f, f.idx.referencing("ticket_resolution", "ticket", ticket.key), t);
  if (resolution) {
    const confirmation = firstCounted(f, f.idx.referencing("ticket_confirmation", "ticket", ticket.key), t);
    return confirmation
      ? { state: "confirmed", resolution, confirmation }
      : { state: "resolved", resolution };
  }
  const missing = missingEvidence(f, ticket.key, t);
  if (missing) return { state: "unverifiable", reason: missing };
  if (t >= createdAt(ticket) + TICKET_LIFE_SECONDS) return { state: "closed" };
  return undefined;
}

/**
 * A counted ticket's state at `t` (B3.2-R1, R3): resolutions close it for good, even after their
 * claim's lease; only the hacker's earliest three otherwise-open tickets are live; a claim holds
 * it for [claim, claim+900).
 */
export function ticketState(f: Facts, ticket: DecodedRecord, t: bigint): TicketState {
  const done = settled(f, ticket, t);
  if (done) return done;
  const creator = ticket.creator.toLowerCase();
  const live = f.idx
    .byKind("ticket")
    .filter(
      (x) =>
        x.creator.toLowerCase() === creator &&
        createdAt(x) <= t &&
        f.counted(x.key) &&
        settled(f, x, t) === undefined,
    );
  if (!live.slice(0, MAX_OPEN_TICKETS).some((x) => x.key === ticket.key)) return { state: "over-capacity" };
  for (const c of f.idx.referencing("ticket_claim", "ticket", ticket.key)) {
    if (!f.counted(c.key) || createdAt(c) > t) continue;
    const leaseEnd = createdAt(c) + LEASE_SECONDS;
    if (t < leaseEnd) return { state: "claimed", claim: c, leaseEnd };
  }
  return { state: "open" };
}
