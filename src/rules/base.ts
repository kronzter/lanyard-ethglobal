// Steps 1–4 of judging a record (plans/B2-rules-verifier.md › How a record is judged), shared by
// `prepare` (to know which reads to fetch) and `evaluate` (to decide), so the two cannot drift.
//
//   0. Evidence scope: captured on the evaluated network, observed by the Arkiv cutoff, a Lanyard
//      record for this event, decodable.
//   1. Writer: the kind has a rule and the creation flags match it.
//   2. Claimed badge: `by_label` is present and canonical.
//   3. Badge belonged to the writer: `EnsReader.owner` (never the address record) equals the
//      creator at the creation block. Authority-only kinds match frozen authority addresses.
//   4. Badge allowed it: unexpired at the creation timestamp, plus any registration-bound
//      permission note; optionally the same registration held through the cutoff.
import { PERMS_TEXT_KEY, grantsPermission } from "@/shared/ens/permission-envelope";
import type { CapturedObservation } from "@/shared/evidence/observation";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import { isCanonicalLabel } from "@/shared/labels";
import type { RulesConfig } from "./config";
import { decodeRecord, type DecodedRecord } from "./decode";
import type { EnsRead, EnsSnapshot } from "./snapshot";
import { reject, type KindRule, type RuleResult, type RuleSet, type Writer, type WriterMatch } from "./types";

export const APP = "lanyard";

export type Screened = { ok: true; record: DecodedRecord; rule: KindRule } | { ok: false; reason: string };

/** Steps 0–2: everything decidable without ENS. */
export function screen(obs: CapturedObservation, context: EvaluationContext, rules: RuleSet): Screened {
  const fail = (reason: string): Screened => ({ ok: false, reason });
  if (obs.network.chainId !== context.arkivChainId || obs.network.resetId !== context.arkivResetId)
    return fail("captured on a different Arkiv network or reset");
  if (obs.observedAtBlock > context.arkivCutoff.number)
    return fail(`first observed after the Arkiv cutoff (block ${context.arkivCutoff.number})`);
  if (obs.createdAtTimestamp > context.arkivCutoff.timestamp) return fail("created after the Arkiv cutoff");

  const decoded = decodeRecord(obs);
  if (!decoded.ok) return fail(decoded.reason);
  const record = decoded.record;
  const attr = (name: string) => {
    const v = record.attrs.get(name);
    return v?.type === "str" ? v.value : undefined;
  };
  if (attr("app") !== APP || attr("event") !== context.event || attr("kind") !== obs.kind)
    return fail(`not a ${APP} record for ${context.event}`);

  if (!Object.prototype.hasOwnProperty.call(rules, obs.kind))
    return fail(`no rule registered for kind '${obs.kind}'`);
  const rule = rules[obs.kind]!;
  if (
    obs.flags.readonly !== rule.flags.readonly ||
    obs.flags.permissionlessExtension !== rule.flags.permissionlessExtension
  ) {
    return fail(
      `created with readonly=${obs.flags.readonly}, permissionlessExtension=${obs.flags.permissionlessExtension}; ` +
        `${obs.kind} requires readonly=${rule.flags.readonly}, permissionlessExtension=${rule.flags.permissionlessExtension}`,
    );
  }

  if (record.byLabel === undefined) return fail("missing by_label");
  if (!isCanonicalLabel(record.byLabel))
    return fail(`by_label ${JSON.stringify(record.byLabel)} is not canonical`);
  return { ok: true, record, rule };
}

/** An authority writer path the creator matches outright, if any. Partners are tried in id order. */
export function authorityMatch(
  record: DecodedRecord,
  rule: KindRule,
  config: RulesConfig,
): WriterMatch | null {
  const creator = record.creator.toLowerCase();
  for (const w of rule.writers) {
    if (w.via === "authority") {
      const address = config.authorities[w.authority];
      if (address !== undefined && address.toLowerCase() === creator)
        return { via: "authority", authority: w.authority };
    } else if (w.via === "partner") {
      for (const id of Object.keys(config.authorities.partners).sort()) {
        if (config.authorities.partners[id]!.toLowerCase() === creator)
          return { via: "partner", partner: id };
      }
    }
  }
  return null;
}

type BadgeWriter = Extract<Writer, { via: "badge" }>;

export const badgeWriters = (record: DecodedRecord, rule: KindRule): BadgeWriter[] =>
  rule.writers.filter((w): w is BadgeWriter => w.via === "badge" && w.applies(record.byLabel!));

/** The historical reads a badge writer path needs. */
export function badgeReads(
  label: string,
  w: BadgeWriter,
  creationBlock: bigint,
  cutoffBlock: bigint,
): EnsRead[] {
  const reads: EnsRead[] = [
    { query: "owner", label, block: creationBlock },
    { query: "expiry", label, block: creationBlock },
  ];
  if (w.permission !== undefined)
    reads.push(
      { query: "registrationId", label, block: creationBlock },
      { query: "text", label, block: creationBlock, key: PERMS_TEXT_KEY },
    );
  if (w.continuousToCutoff)
    reads.push(
      { query: "owner", label, block: cutoffBlock },
      { query: "expiry", label, block: cutoffBlock },
      { query: "unregisteredBetween", label, from: creationBlock + 1n, to: cutoffBlock },
    );
  return reads;
}

function checkBadge(
  record: DecodedRecord,
  w: BadgeWriter,
  ens: EnsSnapshot,
  creationBlock: bigint,
  context: EvaluationContext,
): RuleResult {
  const label = record.byLabel!;
  const creator = record.creator.toLowerCase();
  const owner = ens.owner(label, creationBlock);
  if (owner === null)
    return reject(`${label} is not a registered, unexpired name at Sepolia block ${creationBlock}`);
  if (owner !== creator)
    return reject(`${label} is owned by ${owner} at Sepolia block ${creationBlock}, not the creator`);
  const expiry = ens.expiry(label, creationBlock);
  if (expiry === null || record.obs.createdAtTimestamp >= expiry)
    return reject(`${label} had expired by the record's creation time (${record.obs.createdAtTimestamp})`);
  if (w.permission !== undefined) {
    const note = ens.text(label, PERMS_TEXT_KEY, creationBlock);
    const registrationId = ens.registrationId(label, creationBlock);
    if (!grantsPermission(note, { registrationId, owner }, w.permission))
      return reject(
        `${label} has no ${w.permission} note bound to its registration and holder at Sepolia block ${creationBlock}`,
      );
  }
  if (w.continuousToCutoff) {
    const cutoff = context.sepoliaCutoff;
    if (ens.unregisteredBetween(label, creationBlock + 1n, cutoff.number))
      return reject(
        `${label} was unregistered between Sepolia blocks ${creationBlock + 1n} and the cutoff ${cutoff.number}`,
      );
    if (ens.owner(label, cutoff.number) !== creator)
      return reject(`${label} is not held by the creator at the cutoff (Sepolia block ${cutoff.number})`);
    const later = ens.expiry(label, cutoff.number);
    if (later === null || cutoff.timestamp >= later) return reject(`${label} had expired by the cutoff`);
  }
  return { counts: true };
}

const describeWriter = (w: Writer): string =>
  w.via === "authority" ? `the ${w.authority} wallet` : w.via === "partner" ? "a partner wallet" : w.describe;

export type WriterOutcome = { ok: true; writer: WriterMatch } | { ok: false; reason: string };

/** Steps 3–4: the first writer path that fully checks out, or the reason none did. */
export function resolveWriter(
  record: DecodedRecord,
  rule: KindRule,
  config: RulesConfig,
  ens: EnsSnapshot,
  creationBlock: bigint,
  context: EvaluationContext,
): WriterOutcome {
  const authority = authorityMatch(record, rule, config);
  if (authority) return { ok: true, writer: authority };
  const candidates = badgeWriters(record, rule);
  let firstFailure: string | undefined;
  for (const w of candidates) {
    const r = checkBadge(record, w, ens, creationBlock, context);
    if (r.counts) return { ok: true, writer: { via: "badge", label: record.byLabel! } };
    firstFailure ??= r.reason;
  }
  return {
    ok: false,
    reason:
      firstFailure ??
      `creator ${record.creator.toLowerCase()} is not ${rule.writers.map(describeWriter).join(" or ")}`,
  };
}
