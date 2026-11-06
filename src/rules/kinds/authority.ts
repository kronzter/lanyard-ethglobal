// Organizer-only and results-key kinds (B2.2-R3). Their writers are independently configured
// authority wallets, so their `by_label` is descriptive and needs no badge.
//
//   venue              organizer only, and its payload must be a valid venue.json (B3.3-R6)
//   acceptance         organizer only
//   seat_assignment    organizer only, and `hacker_label` owned by `hacker_address` at creation
//   rubric             organizer (any track; the only writer for `main`), or a partner for its own track
//   results            the results wallet only
//   drip               the configured desk wallet only
import { isCanonicalLabel } from "@/shared/labels";
import { addr, ref, str } from "../decode";
import { venuePayload } from "../state";
import { ok, reject, type KindRule, type RuleCtx } from "../types";

const READONLY = { readonly: true, permissionlessExtension: false } as const;
const READONLY_OPEN = { readonly: true, permissionlessExtension: true } as const;

const trackOf = (ctx: RuleCtx, id: string | undefined) =>
  id === undefined ? undefined : ctx.config.tracks.find((t) => t.id === id);

const isHackerLabel = (label: string) => {
  const parts = label.split(".");
  return parts.length === 2 && parts[1] === "hackers" && isCanonicalLabel(label);
};

export const venue: KindRule = {
  flags: READONLY,
  writers: [{ via: "authority", authority: "organizer" }],
  check: (r) => {
    const v = venuePayload(r);
    return typeof v === "string" ? reject(v) : ok;
  },
};

export const acceptance: KindRule = {
  flags: READONLY,
  writers: [{ via: "authority", authority: "organizer" }],
  check: (r, ctx) => {
    if (ref(r, "submission") === undefined) return reject("acceptance names no submission");
    const track = str(r, "track");
    if (!trackOf(ctx, track)) return reject(`acceptance names unknown track ${JSON.stringify(track)}`);
    return ok;
  },
};

export const seat_assignment: KindRule = {
  flags: READONLY,
  writers: [{ via: "authority", authority: "organizer" }],
  // Declared only once the organizer check passed, and only for a well-formed hackers label, so a
  // forged record cannot make preparation read arbitrary names.
  reads: ({ record, creationBlock }) => {
    const label = str(record, "hacker_label");
    return label !== undefined && isHackerLabel(label)
      ? [{ query: "owner", label, block: creationBlock }]
      : [];
  },
  check: (r, ctx) => {
    const label = str(r, "hacker_label");
    const address = addr(r, "hacker_address");
    if (label === undefined || !isHackerLabel(label))
      return reject(`hacker_label ${JSON.stringify(label)} is not a hackers badge label`);
    if (address === undefined) return reject("seat assignment names no hacker_address");
    if (str(r, "seat") === undefined || ref(r, "venue") === undefined)
      return reject("seat assignment names no seat or venue");
    const owner = ctx.ens.owner(label, ctx.creationBlock);
    if (owner === null) return reject(`${label} is not registered at Sepolia block ${ctx.creationBlock}`);
    if (owner !== address)
      return reject(
        `${label} is owned by ${owner} at Sepolia block ${ctx.creationBlock}, not hacker_address ${address}`,
      );
    return ok;
  },
};

export const rubric: KindRule = {
  flags: READONLY,
  writers: [{ via: "authority", authority: "organizer" }, { via: "partner" }],
  check: (r, ctx) => {
    const id = str(r, "track");
    const track = trackOf(ctx, id);
    if (!track) return reject(`rubric names unknown track ${JSON.stringify(id)}`);
    if (ctx.writer.via === "partner" && track.partner !== ctx.writer.partner)
      return reject(`partner ${ctx.writer.partner} may only write its own track's rubric, not ${track.id}`);
    return ok;
  },
};

export const results: KindRule = {
  flags: READONLY_OPEN,
  writers: [{ via: "authority", authority: "results" }],
  check: () => ok,
};

export const drip: KindRule = {
  flags: READONLY,
  writers: [{ via: "authority", authority: "desk" }],
  check: (r) => (addr(r, "recipient") === undefined ? reject("drip names no recipient") : ok),
};
