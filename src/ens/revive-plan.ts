// A2.3: argument parsing and decisions for scripts/ens/revoke.ts and revive.ts, plus the history record.
// Pure, so it is tested without a chain. The registry and registrar enforce the real policy; this only
// keeps typos and doomed transactions from being sent.
import { keccak256, toHex, type Hex } from "viem";
import { normalizeLabel } from "../shared/labels";
import { ArgError, parseArgs } from "./cli-args";

export const BOOKS = ["hackers", "judges", "volunteers"] as const;
export const SUBS = ["judges", "staff"] as const;

/** Where a badge lives: a global book, or a partner's sub-book. */
export type Target =
  | { kind: "book"; book: (typeof BOOKS)[number]; label: string }
  | { kind: "partner"; partner: string; sub: (typeof SUBS)[number]; label: string };

export type RevokeRequest = { target: Target; as: "organizer" | "other"; fork: boolean; dryRun: boolean };
export type ReviveRequest = { target: Target; expiry: bigint | null; fork: boolean; dryRun: boolean };

export const REVOKE_USAGE =
  "usage: revoke.ts (--book <hackers|judges|volunteers> | --partner <p> --sub <judges|staff>) --label <l> [--as organizer|other] [--fork] [--dry-run]";
export const REVIVE_USAGE =
  "usage: revive.ts (--book <hackers|judges|volunteers> | --partner <p> --sub <judges|staff>) --label <l> [--expiry <unix>] [--fork] [--dry-run]";

function parseTarget(values: Map<string, string>): Target {
  const book = values.get("--book");
  const partner = values.get("--partner");
  const sub = values.get("--sub");
  const label = values.get("--label");
  if (label === undefined) throw new ArgError("--label is required");
  if (label === "" || label.includes(".")) throw new ArgError("a badge label is one label: no dots");
  try {
    normalizeLabel(label);
  } catch (e) {
    throw new ArgError(e instanceof Error ? e.message : String(e));
  }
  if ((book === undefined) === (partner === undefined))
    throw new ArgError("give exactly one of --book or --partner");
  if (book !== undefined) {
    if (sub !== undefined) throw new ArgError("--sub only goes with --partner");
    if (!(BOOKS as readonly string[]).includes(book))
      throw new ArgError(`unknown book ${JSON.stringify(book)}; expected one of ${BOOKS.join(", ")}`);
    return { kind: "book", book: book as (typeof BOOKS)[number], label };
  }
  if (sub === undefined || !(SUBS as readonly string[]).includes(sub))
    throw new ArgError(`--partner needs --sub <${SUBS.join("|")}>`);
  if (partner === "" || partner!.includes(".")) throw new ArgError("a partner is one label: no dots");
  try {
    normalizeLabel(partner!);
  } catch (e) {
    throw new ArgError(e instanceof Error ? e.message : String(e));
  }
  return { kind: "partner", partner: partner!, sub: sub as (typeof SUBS)[number], label };
}

const TARGET_VALUES = ["--book", "--partner", "--sub", "--label"] as const;

export function parseRevokeArgs(argv: readonly string[]): RevokeRequest {
  const { flags, values } = parseArgs(argv, {
    flags: ["--fork", "--dry-run"],
    values: [...TARGET_VALUES, "--as"],
  });
  const as = values.get("--as") ?? "other";
  if (as !== "organizer" && as !== "other") throw new ArgError("--as is organizer or other");
  return { target: parseTarget(values), as, fork: flags.has("--fork"), dryRun: flags.has("--dry-run") };
}

export function parseReviveArgs(argv: readonly string[]): ReviveRequest {
  const { flags, values } = parseArgs(argv, {
    flags: ["--fork", "--dry-run"],
    values: [...TARGET_VALUES, "--expiry"],
  });
  const raw = values.get("--expiry");
  if (raw !== undefined && !/^[0-9]{1,19}$/.test(raw))
    throw new ArgError("--expiry is a unix time in seconds");
  const expiry = raw === undefined ? null : BigInt(raw);
  if (expiry !== null && expiry > (1n << 64n) - 1n) throw new ArgError("--expiry does not fit a uint64");
  return { target: parseTarget(values), expiry, fork: flags.has("--fork"), dryRun: flags.has("--dry-run") };
}

export const labelId = (label: string): bigint => BigInt(keccak256(toHex(label)));
export const partyHash = (s: string): Hex => keccak256(toHex(s));

/** The badge's name relative to the edition, e.g. `priya.hackers` or `kai.staff.arkiv.partners`. */
export const targetName = (t: Target): string =>
  t.kind === "book" ? `${t.label}.${t.book}` : `${t.label}.${t.sub}.${t.partner}.partners`;

/** Registry status 2 = registered (see the ENSv2 registry). Expired, reserved or unissued is not. */
const REGISTERED = 2;

export type Decision =
  { action: "act" } | { action: "skip"; reason: string } | { action: "blocked"; reason: string };

export function decideRevoke(o: { status: number }): Decision {
  if (o.status !== REGISTERED)
    return { action: "skip", reason: "not registered (never issued, expired or already unregistered)" };
  return { action: "act" };
}

export type ReviveObservation = {
  status: number;
  /** The current registry expiry of the label (0 when never issued). */
  currentExpiry: bigint;
  /** True when the registry still remembers an owner (expired badges do; unregistered ones do not). */
  hasOwner: boolean;
  namespaceExpiry: bigint;
  now: bigint;
};

export function decideRevive(o: ReviveObservation, target: bigint, explicit: boolean): Decision {
  if (!o.hasOwner)
    return {
      action: "blocked",
      reason: "no badge to revive (never issued, or unregistered): reissue it instead",
    };
  if (target > o.namespaceExpiry)
    return { action: "blocked", reason: `expiry ${target} is above namespaceExpiry ${o.namespaceExpiry}` };
  if (target <= o.now)
    return { action: "blocked", reason: `expiry ${target} is not in the future (now ${o.now})` };
  if (target === o.currentExpiry && o.status === REGISTERED)
    return { action: "skip", reason: "already expires then" };
  if (target < o.currentExpiry) {
    if (!explicit && o.status === REGISTERED)
      return { action: "skip", reason: `already valid until ${o.currentExpiry}, past the policy expiry` };
    return { action: "blocked", reason: `expiry ${target} would reduce the current ${o.currentExpiry}` };
  }
  return { action: "act" };
}

export type HistoryEvent = {
  action: "revoke" | "revive";
  name: string;
  label: string;
  book?: string;
  partner?: string;
  sub?: string;
  block: string;
  txHash: Hex;
  at: string;
};

export function historyEvent(
  action: HistoryEvent["action"],
  t: Target,
  block: bigint,
  txHash: Hex,
  at: Date,
): HistoryEvent {
  return {
    action,
    name: targetName(t),
    label: t.label,
    ...(t.kind === "book" ? { book: t.book } : { partner: t.partner, sub: t.sub }),
    block: block.toString(),
    txHash,
    at: at.toISOString(),
  };
}

/** The history file is a JSON array of events, oldest first. */
export function appendHistory(existing: unknown, event: HistoryEvent): HistoryEvent[] {
  if (existing === undefined) return [event];
  if (!Array.isArray(existing)) throw new Error("history file is not a JSON array; refusing to overwrite it");
  return [...(existing as HistoryEvent[]), event];
}
