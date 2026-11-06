// Structural and temporal checks on the event config (plans/01-evidence-and-interfaces.md §2).
import { isCanonicalLabel, RESERVED_LABELS } from "../labels";
import { ZERO_ADDRESS } from "../types/primitives";
import { EventConfigSchema, type EventConfig, type EventTimes } from "./schema";

export const SECONDS_PER_DAY = 86_400n;
export const NAMESPACE_GRACE_SECONDS = 30n * SECONDS_PER_DAY;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid event config:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Ordering issues for a set of event times (empty when valid). */
export function timeOrderingIssues(t: EventTimes): string[] {
  const issues: string[] = [];
  const need = (ok: boolean, msg: string) => ok || issues.push(msg);
  need(t.eventStart < t.submissionDeadline, "eventStart must be before submissionDeadline");
  need(t.submissionDeadline <= t.judgingEnd, "submissionDeadline must not be after judgingEnd");
  need(t.judgingEnd <= t.results, "judgingEnd must not be after results");
  need(t.results < t.freezeDeadline, "results must be before freezeDeadline");
  need(t.eventEnd >= t.judgingEnd, "eventEnd must not be before judgingEnd");
  return issues;
}

/** Parse and validate; throws ConfigError listing every problem. */
export function validateEventConfig(input: unknown): EventConfig {
  const parsed = EventConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`));
  }
  const cfg = parsed.data;
  const issues: string[] = [];
  const single = (label: string) => isCanonicalLabel(label) && label !== "" && !label.includes(".");

  if (!single(cfg.edition)) issues.push(`edition ${JSON.stringify(cfg.edition)} must be one canonical label`);
  if (!cfg.baseName.split(".").every(single))
    issues.push(`baseName ${JSON.stringify(cfg.baseName)} is not canonical`);

  const partnerIds = cfg.partners.map((p) => p.id);
  if (partnerIds.length === 0) issues.push("at least one partner is required");
  if (new Set(partnerIds).size !== partnerIds.length) issues.push("partner ids must be unique");
  for (const id of partnerIds) {
    if (!single(id) || RESERVED_LABELS.includes(id))
      issues.push(`partner id ${JSON.stringify(id)} must be a canonical, unreserved label`);
  }

  const trackIds = cfg.tracks.map((t) => t.id);
  if (new Set(trackIds).size !== trackIds.length) issues.push("track ids must be unique");
  const openTracks = cfg.tracks.filter((t) => t.partner === null);
  if (openTracks.length !== 1) issues.push("exactly one non-partner track is required");
  if (openTracks.length === 1 && openTracks[0]!.id !== "main")
    issues.push('the non-partner track must have id "main"');
  for (const id of partnerIds) {
    if (cfg.tracks.filter((t) => t.partner === id).length !== 1)
      issues.push(`partner ${id} needs exactly one track`);
  }
  for (const t of cfg.tracks) {
    if (!single(t.id)) issues.push(`track id ${JSON.stringify(t.id)} must be one canonical label`);
    if (t.partner !== null && !partnerIds.includes(t.partner))
      issues.push(`track ${t.id} names unknown partner ${t.partner}`);
  }

  issues.push(...timeOrderingIssues(cfg.times));

  const authority = [
    ["organizer", cfg.authorities.organizer],
    ["results", cfg.authorities.results],
    ...partnerIds.map((id) => [`partners.${id}`, cfg.authorities.partners[id]] as const),
  ] as const;
  for (const [name, address] of authority) {
    if (address === undefined) issues.push(`authorities.${name} is missing`);
    else if (address === ZERO_ADDRESS) issues.push(`authorities.${name} is the zero address`);
  }
  for (const extra of Object.keys(cfg.authorities.partners)) {
    if (!partnerIds.includes(extra)) issues.push(`authorities.partners.${extra} is not a configured partner`);
  }
  const addresses = authority.map(([, a]) => a).filter((a) => a !== undefined);
  if (new Set(addresses).size !== addresses.length)
    issues.push("authority wallets must be independent (distinct)");

  if (issues.length > 0) throw new ConfigError(issues);
  return cfg;
}

/** Structural names and their ancestors must live at least this long. */
export const namespaceExpiry = (t: EventTimes): bigint =>
  (t.eventEnd > t.freezeDeadline ? t.eventEnd : t.freezeDeadline) + NAMESPACE_GRACE_SECONDS;

/** Judge badges (global and partner) last until the freeze deadline. */
export const judgeBadgeExpiry = (t: EventTimes): bigint => t.freezeDeadline;

/** Volunteer and partner-staff badges end with the event. */
export const staffBadgeExpiry = (t: EventTimes): bigint => t.eventEnd;

/** True when a freeze cutoff timestamp lies in `[results, freezeDeadline)`. */
export const isCutoffInWindow = (cutoff: bigint, t: EventTimes): boolean =>
  cutoff >= t.results && cutoff < t.freezeDeadline;

export function assertCutoffInWindow(cutoff: bigint, t: EventTimes): void {
  if (!isCutoffInWindow(cutoff, t)) {
    throw new ConfigError([
      `cutoff ${cutoff} is outside the freeze window [${t.results}, ${t.freezeDeadline})`,
    ]);
  }
}

/**
 * Reject a deployment whose structural ancestors (base name, edition, books, partner names
 * and sub-books, team names) expire before `namespaceExpiry`.
 */
export function checkAncestorLifetimes(t: EventTimes, expiries: { name: string; expiry: bigint }[]): void {
  const required = namespaceExpiry(t);
  const short = expiries
    .filter((e) => e.expiry < required)
    .map((e) => `${e.name} expires at ${e.expiry}, needs ≥ ${required}`);
  if (short.length > 0) throw new ConfigError(short);
}
