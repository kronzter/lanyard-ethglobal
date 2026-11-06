// Help tickets, claims, resolutions and confirmations (B3.2-R1–R3; B3.3-R3 for partner tickets).
//
//   ticket               a hackers badge, at a seat of the venue current at creation, in a
//                        configured category; logical life [created, created+4 h)
//   ticket_claim         the earliest eligible claim of an open ticket wins a 15 min lease; claims
//                        during a winning lease lose for good. General: on duty in the ticket's zone;
//                        partner categories: that partner's staff badge at the action, no shift.
//   ticket_resolution    the winning claimer, before both lease end and ticket close, at its seat;
//                        it closes the ticket for good
//   ticket_confirmation  the ticket's hacker, for that ticket's resolution
//
// Every decision is at the record's own block time, from records earlier in evidence order.
import { ticketCategory } from "@/shared/config/tickets";
import { roleOfLabel } from "@/shared/ens/roles";
import { isCanonicalLabel } from "@/shared/labels";
import { ref, str, type DecodedRecord } from "../decode";
import { holderOf, isVolunteerLabel, VOLUNTEER } from "./duty";
import {
  activeSessions,
  createdAt,
  factsOf,
  LEASE_SECONDS,
  ticketInfo,
  ticketState,
  TICKET_LIFE_SECONDS,
  venueAt,
  type Facts,
  type TicketInfo,
} from "../state";
import { ok, reject, type KindRule, type RuleCtx, type RuleResult, type Writer } from "../types";

const READONLY = { readonly: true, permissionlessExtension: false } as const;

export const isHackerBadge = (label: string): boolean => {
  const parts = label.split(".");
  return parts.length === 2 && parts[1] === "hackers" && isCanonicalLabel(label);
};

export const HACKER: Writer = { via: "badge", applies: isHackerBadge, describe: "a hackers badge" };

/** The partner of a `<name>.staff.<partner>.partners` badge, else undefined (judges are not staff). */
export const staffPartnerOf = (label: string): string | undefined => {
  if (!isCanonicalLabel(label)) return undefined;
  const role = roleOfLabel(label);
  return role.startsWith("partner-staff:") ? role.slice("partner-staff:".length) : undefined;
};

/** Partner booth staff answer their own partner's tickets, without shifts (B3.3-R3). */
export const STAFF: Writer = {
  via: "badge",
  applies: (label) => staffPartnerOf(label) !== undefined,
  describe: "a partner staff badge",
};

/** The counted ticket a record references, with its bound zone, or a reason. */
function referencedTicket(r: DecodedRecord, f: Facts): TicketInfo | string {
  const key = ref(r, "ticket");
  if (key === undefined) return `${r.kind} names no ticket`;
  const t = f.idx.byKey.get(key);
  if (!t || t.kind !== "ticket") return `references ticket ${key}, which is not in the captured evidence`;
  if (!f.counted(key)) return `ticket ${key} does not count`;
  return ticketInfo(f, t);
}

/**
 * May this writer help with this ticket at the record's time? General tickets need an on-duty
 * volunteer in the ticket's zone; partner tickets need that partner's staff badge, which the writer
 * check already found owned and unexpired at this very action (B3.3-R3).
 */
function eligible(r: DecodedRecord, t: TicketInfo, ctx: RuleCtx, f: Facts): RuleResult {
  const category = ticketCategory(ctx.config, t.category);
  if (category?.partner)
    return staffPartnerOf(r.byLabel!) === category.partner
      ? ok
      : reject(`${category.name} tickets are answered only by ${category.partner} staff`);
  if (ctx.writer.via !== "badge" || !isVolunteerLabel(r.byLabel!))
    return reject("a general ticket is answered by an on-duty volunteer");
  const at = createdAt(r);
  const sessions = activeSessions(f, r.byLabel!, at, t.zone).filter(
    (x) => holderOf(ctx.ens, ctx.time, x.shift) === r.creator.toLowerCase(),
  );
  return sessions.length > 0 ? ok : reject(`${r.byLabel} is not on duty in zone ${t.zone} at this time`);
}

export const ticket: KindRule = {
  flags: READONLY,
  writers: [HACKER],
  check: (r, ctx) => {
    const f = factsOf(ctx);
    const info = ticketInfo(f, r);
    if (typeof info === "string") return reject(info);
    const current = venueAt(f, createdAt(r));
    if (current?.record.key !== info.venue.record.key)
      return reject("ticket names a venue that was not the current one at creation");
    if (!ticketCategory(ctx.config, info.category))
      return reject(`unknown ticket category ${JSON.stringify(info.category)}`);
    return ok;
  },
};

export const ticket_claim: KindRule = {
  flags: READONLY,
  writers: [VOLUNTEER, STAFF],
  check: (r, ctx) => {
    const f = factsOf(ctx);
    const t = referencedTicket(r, f);
    if (typeof t === "string") return reject(t);
    const at = createdAt(r);
    const s = ticketState(f, t.record, at);
    switch (s.state) {
      case "claimed":
        return reject(`lost to claim ${s.claim.key} (lease until ${s.leaseEnd})`);
      case "over-capacity":
        return reject("the ticket is beyond its hacker's three open tickets");
      case "open":
        return eligible(r, t, ctx, f);
      default:
        return reject(`the ticket is ${s.state}`);
    }
  },
};

export const ticket_resolution: KindRule = {
  flags: READONLY,
  writers: [VOLUNTEER, STAFF],
  check: (r, ctx) => {
    const f = factsOf(ctx);
    const t = referencedTicket(r, f);
    if (typeof t === "string") return reject(t);
    const claimKey = ref(r, "claim");
    if (claimKey === undefined) return reject("resolution names no claim");
    const claim = f.idx.byKey.get(claimKey);
    if (!claim)
      return reject(`references claim ${claimKey}, which is not in the captured evidence (unverifiable)`);
    if (claim.kind !== "ticket_claim" || ref(claim, "ticket") !== t.record.key || !f.counted(claim.key))
      return reject(`claim ${claimKey} is not a winning claim for this ticket`);
    if (claim.creator.toLowerCase() !== r.creator.toLowerCase() || claim.byLabel !== r.byLabel)
      return reject("only the winning claimer may resolve the ticket");
    const at = createdAt(r);
    if (at >= createdAt(claim) + LEASE_SECONDS)
      return reject("resolved after the claim's 15 min lease ended");
    if (at >= createdAt(t.record) + TICKET_LIFE_SECONDS) return reject("resolved after the ticket closed");
    if (str(r, "seat") !== t.seat) return reject(`resolution seat is not the ticket's seat ${t.seat}`);
    const earlier = f.idx
      .referencing("ticket_resolution", "ticket", t.record.key)
      .find((x) => x.key !== r.key && f.counted(x.key));
    if (earlier) return reject(`ticket already resolved by ${earlier.key}`);
    return eligible(r, t, ctx, f);
  },
};

export const ticket_confirmation: KindRule = {
  flags: READONLY,
  writers: [HACKER],
  check: (r, ctx) => {
    const f = factsOf(ctx);
    const t = referencedTicket(r, f);
    if (typeof t === "string") return reject(t);
    if (t.record.creator.toLowerCase() !== r.creator.toLowerCase())
      return reject("only the hacker who raised the ticket may confirm it");
    const resKey = ref(r, "resolution");
    if (resKey === undefined) return reject("confirmation names no resolution");
    const res = f.idx.byKey.get(resKey);
    if (!res)
      return reject(`references resolution ${resKey}, which is not in the captured evidence (unverifiable)`);
    if (res.kind !== "ticket_resolution" || ref(res, "ticket") !== t.record.key || !f.counted(res.key))
      return reject(`resolution ${resKey} does not count for this ticket`);
    const earlier = f.idx
      .referencing("ticket_confirmation", "ticket", t.record.key)
      .find((x) => x.key !== r.key && f.counted(x.key));
    return earlier ? reject(`ticket already confirmed by ${earlier.key}`) : ok;
  },
};
