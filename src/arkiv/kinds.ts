// Lanyard's Arkiv record kinds (plans/B1-arkiv-data.md › Record kinds; B1.2-R1/R2).
//
// Every record carries four common indexed attributes: `app`, `event`, `kind` and `by_label` (the
// writer's relative ENS label; Arkiv reserves `by`). Schemas are untagged (`defineSchema(columns)`),
// so no `arkiv.schema` attribute takes one of the 32 slots; readers filter on the explicit
// `app`/`event`/`kind` columns instead (plans/01-evidence-and-interfaces.md §1).
//
// Column types: labels and IDs `str` (≤128 bytes), times `u64` Unix seconds, references to other
// records `key`, wallet addresses `addr`, and JSON snapshots / ciphertext / payloads unindexed
// `bytes`. Retention is physical expiry only: tickets, leases and duty use logical deadlines from
// the creation timestamp, and extending retention never extends a business deadline.
import { ExpirationTime, type Expiry } from "@arkiv-network/sdk";
import { addr, bytes, defineSchema, key, str, u64 } from "@arkiv-network/sdk/schema";
import type { EventTimes } from "@/shared/config/schema";
import { SECONDS_PER_DAY } from "@/shared/config/validate";

export const APP = "lanyard";

export const commonColumns = {
  app: str().indexed(),
  event: str().indexed(),
  kind: str().indexed(),
  by_label: str().indexed(),
} as const;

export const days = (n: number) => BigInt(n) * SECONDS_PER_DAY;

/** Retention until an absolute Unix time, placed against the chain's current block when sent. */
export const retainUntil = (unixSeconds: bigint): Expiry =>
  ExpirationTime.atDate(new Date(Number(unixSeconds) * 1000));

/** How long a kind is kept, as a function of the event's times, plus a human description. */
type Retention = { at: (t: EventTimes) => Expiry; describe: string; until?: (t: EventTimes) => bigint };

const until = (describe: string, f: (t: EventTimes) => bigint): Retention => ({
  at: (t) => retainUntil(f(t)),
  until: f,
  describe,
});
const maximum: Retention = {
  at: () => ExpirationTime.max(),
  describe: "maximum (≈182.5 days, extendable by anyone)",
};

const EVENT_END_7 = until("event end + 7 days", (t) => t.eventEnd + days(7));
const EVENT_END_30 = until("event end + 30 days", (t) => t.eventEnd + days(30));
const RESULTS_30 = until("results + 30 days", (t) => t.results + days(30));
const JUDGING_END_2 = until("judging end + 2 days", (t) => t.judgingEnd + days(2));

const READONLY = { readonly: true } as const;
const MUTABLE = { readonly: false } as const;
const READONLY_OPEN = { readonly: true, permissionlessExtension: true } as const;

type KindDef = {
  schema: ReturnType<typeof defineSchema>;
  flags: { readonly: boolean; permissionlessExtension?: boolean };
  retention: Retention;
  /** Who writes it (documentation and the B2 rules' authority policy). */
  writer: string;
  /** What the record means, one line. */
  about: string;
};

const ref = () => key().indexed();
const label = () => str().indexed();
const time = () => u64().indexed();

export const KINDS = {
  venue: {
    schema: defineSchema({ ...commonColumns, version: str().indexed(), payload: bytes() }),
    flags: READONLY,
    retention: EVENT_END_30,
    writer: "organizer",
    about: "A published venue.json (grid, seats, POIs, zones), one record per version",
  },
  seat_assignment: {
    schema: defineSchema({
      ...commonColumns,
      hacker_address: addr().indexed(),
      hacker_label: label(),
      seat: label(),
      venue: ref(),
    }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "organizer",
    about: "Which seat a hacker sits in, by wallet address and `hackers` badge label",
  },
  shift: {
    schema: defineSchema({
      ...commonColumns,
      volunteer: label(),
      zone: label(),
      starts_at: time(),
      ends_at: time(),
      supersedes: ref().optional(),
    }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "lead",
    about: "A volunteer's shift in a zone; a change is a new shift that supersedes the old one",
  },
  clock: {
    schema: defineSchema({
      ...commonColumns,
      volunteer: label(),
      shift: ref(),
      action: label(),
      stated_at: u64().optional(),
    }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "lead, or the volunteer for a self clock-in",
    about: "Clock `in`/`out` for one shift; effective time is the block time, `stated_at` is display only",
  },
  duty_pass: {
    schema: defineSchema({ ...commonColumns, volunteer: label(), shift: ref(), ends_at: time() }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "lead",
    about: "Display evidence of a lead clock-in, with the logical shift-end deadline",
  },
  ticket: {
    schema: defineSchema({ ...commonColumns, seat: label(), venue: ref(), category: label() }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "hacker",
    about: "A help request from a seat; logical lifetime 4 h from creation",
  },
  ticket_claim: {
    schema: defineSchema({ ...commonColumns, ticket: ref() }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "on-duty volunteer, or that partner's staff for partner tickets",
    about: "A claim on a ticket; the earliest eligible claim holds a 15-minute logical lease",
  },
  ticket_resolution: {
    schema: defineSchema({ ...commonColumns, ticket: ref(), claim: ref(), seat: label() }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "the winning claim's helper",
    about: "Resolution bound to the winning claim; it stays valid after the lease ends",
  },
  ticket_confirmation: {
    schema: defineSchema({ ...commonColumns, ticket: ref(), resolution: ref() }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "the ticket's hacker",
    about: "The hacker confirms a resolution; nothing is mutated",
  },
  project: {
    schema: defineSchema({ ...commonColumns, team: label(), track: label(), content: bytes() }),
    flags: MUTABLE,
    retention: RESULTS_30,
    writer: "team lead",
    about: "Editable project draft (team-page content); never judging evidence",
  },
  submission: {
    schema: defineSchema({
      ...commonColumns,
      project: ref(),
      team: label(),
      track: label(),
      content_hash: label(),
      snapshot: bytes(),
    }),
    flags: READONLY_OPEN,
    retention: maximum,
    writer: "team lead",
    about: "Immutable snapshot of the project, team, track and lead address, bound by `content_hash`",
  },
  acceptance: {
    schema: defineSchema({ ...commonColumns, submission: ref(), track: label() }),
    flags: READONLY,
    retention: RESULTS_30,
    writer: "organizer",
    about: "The organizer accepts a submission into a track",
  },
  rubric: {
    schema: defineSchema({ ...commonColumns, track: label(), payload: bytes() }),
    flags: READONLY,
    retention: RESULTS_30,
    writer: "organizer (any track; the only writer for `main`), or a partner for its own track",
    about: "A track's criteria, weights and scale; the earliest valid one before the deadline is frozen",
  },
  judge_assignment: {
    schema: defineSchema({ ...commonColumns, judge: label(), submission: ref(), rubric: ref() }),
    flags: READONLY,
    retention: RESULTS_30,
    writer: "organizer, a partner for its track, or the head judge for `main`",
    about: "Assigns a judge to a submission under a rubric",
  },
  score_sheet: {
    schema: defineSchema({
      ...commonColumns,
      submission: ref(),
      judge: label(),
      rubric: ref(),
      assignment: ref(),
      ciphertext: bytes(),
    }),
    flags: MUTABLE,
    retention: JUDGING_END_2,
    writer: "judge",
    about: "Encrypted mirror of a device-local editable draft",
  },
  final_score: {
    schema: defineSchema({
      ...commonColumns,
      submission: ref(),
      judge: label(),
      rubric: ref(),
      assignment: ref(),
      ciphertext: bytes(),
    }),
    flags: READONLY,
    retention: RESULTS_30,
    writer: "judge",
    about: "Sealed final score: authenticated ciphertext, opened only at freeze",
  },
  recusal: {
    schema: defineSchema({ ...commonColumns, submission: ref(), judge: label() }),
    flags: READONLY,
    retention: RESULTS_30,
    writer: "the target judge (self only), or the organizer",
    about: "Removes one judge from one submission",
  },
  results: {
    schema: defineSchema({ ...commonColumns, summary: bytes() }),
    flags: READONLY_OPEN,
    retention: maximum,
    writer: "results key",
    about: "Compact rankings, results/bundle/config hashes, bundle URI, signature, cutoffs, rule version",
  },
  drip: {
    schema: defineSchema({ ...commonColumns, recipient: addr().indexed(), tx: str() }),
    flags: READONLY,
    retention: EVENT_END_7,
    writer: "desk wallet (desk-wallet funding profile)",
    about: "One first-time tGLM send; the desk refuses a second send to the same address",
  },
} satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;
export const KIND_NAMES: readonly Kind[] = Object.freeze(Object.keys(KINDS) as Kind[]);
