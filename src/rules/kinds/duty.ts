// Shifts, clocks and duty passes (B3.1-R1; plans/B3-volunteers-tickets.md › How on-duty works).
//
//   shift      a lead (volunteer badge + registration-bound shift-manager note) schedules a volunteer;
//              `supersedes` replaces an earlier shift of the same volunteer, prospectively
//   clock      a lead clocks in during the shift or clocks out an open session; a volunteer may
//              only clock themselves in, within [starts_at-3600, starts_at+900]
//   duty_pass  lead-written display evidence whose ends_at equals the shift end
//
// A scheduled shift alone never puts anyone on duty; duty needs a counted clock-in for that exact
// shift, starts no earlier than the shift and ends at its effective end or a clock-out.
import { SHIFT_MANAGER } from "@/shared/ens/permission-envelope";
import { isCanonicalLabel } from "@/shared/labels";
import type { Address } from "@/shared/types/primitives";
import { ref, str, u64, type DecodedRecord } from "../decode";
import type { EnsSnapshot } from "../snapshot";
import {
  createdAt,
  effectiveEnd,
  factsOf,
  openSession,
  SELF_START_AFTER,
  SELF_START_BEFORE,
  shiftInfo,
  venueAt,
  type ShiftInfo,
} from "../state";
import type { TimeMap } from "../time";
import { ok, reject, type KindRule, type RuleCtx, type Writer } from "../types";

const READONLY = { readonly: true, permissionlessExtension: false } as const;

export const isVolunteerLabel = (label: string): boolean => {
  const parts = label.split(".");
  return parts.length === 2 && parts[1] === "volunteers" && isCanonicalLabel(label);
};

export const LEAD: Writer = {
  via: "badge",
  applies: isVolunteerLabel,
  describe: "a lead (a volunteer badge with a shift-manager note)",
  permission: SHIFT_MANAGER,
};
export const VOLUNTEER: Writer = { via: "badge", applies: isVolunteerLabel, describe: "a volunteer badge" };

/** Who held the scheduled volunteer's badge when the shift was written (the session holder). */
export const holderOf = (ens: EnsSnapshot, time: TimeMap, s: ShiftInfo): Address | null =>
  ens.owner(s.volunteer, time.blockAt(createdAt(s.record)));

/** The counted shift a clock or pass references, for the same volunteer. */
function referencedShift(r: DecodedRecord, ctx: RuleCtx): ShiftInfo | string {
  const key = ref(r, "shift");
  const volunteer = str(r, "volunteer");
  if (key === undefined || volunteer === undefined) return `${r.kind} names no shift or volunteer`;
  const target = factsOf(ctx).idx.byKey.get(key);
  if (!target || target.kind !== "shift") return `references shift ${key}, which is not in the evidence`;
  if (ctx.verdictOf(key)?.counts !== true) return `references shift ${key}, which does not count`;
  const s = shiftInfo(target)!;
  if (s.volunteer !== volunteer) return `shift ${key} is for ${s.volunteer}, not ${volunteer}`;
  return s;
}

export const shift: KindRule = {
  flags: READONLY,
  writers: [LEAD],
  // The scheduled volunteer's badge at creation (the session holder) and at the cutoff (present tense).
  reads: ({ record, creationBlock, cutoffBlock }) => {
    const v = str(record, "volunteer");
    if (v === undefined || !isVolunteerLabel(v)) return [];
    return [creationBlock, cutoffBlock].flatMap((block) => [
      { query: "owner" as const, label: v, block },
      { query: "expiry" as const, label: v, block },
    ]);
  },
  check: (r, ctx) => {
    const s = shiftInfo(r);
    if (!s) return reject("shift needs volunteer, zone, starts_at and ends_at");
    if (!isVolunteerLabel(s.volunteer))
      return reject(`volunteer ${JSON.stringify(s.volunteer)} is not a volunteers badge label`);
    if (s.endsAt <= s.startsAt) return reject("shift ends before it starts");
    const holder = ctx.ens.owner(s.volunteer, ctx.creationBlock);
    const expiry = ctx.ens.expiry(s.volunteer, ctx.creationBlock);
    if (holder === null || expiry === null || createdAt(r) >= expiry)
      return reject(`${s.volunteer} is not a registered, unexpired badge when the shift is written`);
    const f = factsOf(ctx);
    const venue = venueAt(f, createdAt(r));
    if (!venue) return reject("no venue was published before this shift");
    if (!venue.venue.zones.some((z) => z.id === s.zone))
      return reject(`zone ${JSON.stringify(s.zone)} is not in the current venue`);
    if (s.supersedes) {
      const parent = f.idx.byKey.get(s.supersedes);
      if (!parent || parent.kind !== "shift")
        return reject(`supersedes ${s.supersedes}, which is not a shift in the evidence`);
      if (!f.counted(parent.key)) return reject(`supersedes shift ${s.supersedes}, which does not count`);
      if (str(parent, "volunteer") !== s.volunteer)
        return reject(`supersedes a shift for ${str(parent, "volunteer")}, not ${s.volunteer}`);
    }
    return ok;
  },
};

export const clock: KindRule = {
  flags: READONLY,
  writers: [LEAD, VOLUNTEER],
  check: (r, ctx) => {
    const s = referencedShift(r, ctx);
    if (typeof s === "string") return reject(s);
    const action = str(r, "action");
    if (action !== "in" && action !== "out")
      return reject(`clock action ${JSON.stringify(action)} is not in/out`);
    const f = factsOf(ctx);
    const t = createdAt(r);
    const end = effectiveEnd(f, s);
    const open = openSession(f, s, t);
    const lead = ctx.writer.via === "badge" && ctx.writer.permission === SHIFT_MANAGER;

    if (lead) {
      if (action === "out") return open ? ok : reject("no open session for this shift; clock-out ignored");
      if (t < s.startsAt || t >= end)
        return reject("a lead clocks in only while the shift covers the moment");
      return open ? reject("already clocked in for this shift") : ok;
    }
    if (r.byLabel !== s.volunteer) return reject(`only a lead may clock in ${s.volunteer}`);
    if (action !== "in") return reject("a volunteer can only clock themselves in; ask a lead to clock out");
    if (holderOf(ctx.ens, ctx.time, s) !== r.creator.toLowerCase())
      return reject(`${s.volunteer} was held by someone else when this shift was written`);
    if (t < s.startsAt - SELF_START_BEFORE || t > s.startsAt + SELF_START_AFTER)
      return reject("outside the self-start window (60 min before to 15 min after start); ask a lead");
    if (t >= end) return reject("the shift has ended or was replaced");
    return open ? reject("already clocked in for this shift") : ok;
  },
};

export const duty_pass: KindRule = {
  flags: READONLY,
  writers: [LEAD],
  check: (r, ctx) => {
    const s = referencedShift(r, ctx);
    if (typeof s === "string") return reject(s);
    return u64(r, "ends_at") === s.endsAt ? ok : reject("duty pass ends_at does not equal the shift end");
  },
};
