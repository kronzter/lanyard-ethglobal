// Present-tense views over one evaluation (B3.1-R2): who is on duty, which shifts and sessions a
// volunteer has, the current venue. Pure, like the rules: every answer comes from the evaluated
// records, their verdicts and the prepared ENS snapshot, at an explicit time.
//
// `at` defaults to the evaluation cutoff. A badge check at another time uses the reads prepared for
// that moment (a record's own creation); a moment nothing was prepared for throws rather than
// guessing.
import type { PreparedEnsEntry } from "@/shared/evidence/bundle";
import { dedupeObservations, type CapturedObservation } from "@/shared/evidence/observation";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import { decodeRecord, str, type DecodedRecord } from "./decode";
import { holderOf } from "./kinds/duty";
import { EnsSnapshot } from "./snapshot";
import {
  activeSessions,
  effectiveEnd,
  indexOf,
  sessionsOfShift,
  shiftsOf,
  venueAt,
  type Facts,
  type Session,
  type ShiftInfo,
  type VenueAt,
} from "./state";
import { TimeMap } from "./time";
import type { RulesOutput, Verdict } from "./types";

export type ShiftView = ShiftInfo & {
  /** When the shift stops covering (ends_at, or a replacement's creation). */
  effectiveEnd: bigint;
  sessions: Session[];
  /** A counted lead-written duty pass for this shift, if any (display only). */
  pass?: DecodedRecord;
};

export type EvaluationView = {
  /** The evaluation moment: the Arkiv cutoff timestamp. */
  readonly now: bigint;
  verdict(key: Hex): Verdict | undefined;
  records(kind: string): readonly DecodedRecord[];
  /** Badge valid at `at` and at least one active session (in `zone`, when given). */
  onDuty(volunteer: string, at?: bigint, zone?: string): boolean;
  /** Sessions active at `at`, badge permitting. */
  sessionsOf(volunteer: string, at?: bigint, zone?: string): Session[];
  /** Every counted shift of a volunteer, earliest first. */
  shiftsOf(volunteer: string): ShiftView[];
  venueAt(at?: bigint): VenueAt | undefined;
  facts: Facts;
};

export function evaluationView(
  records: readonly CapturedObservation[],
  ensSnapshot: readonly PreparedEnsEntry[],
  context: EvaluationContext,
  output: RulesOutput,
): EvaluationView {
  const verdicts = new Map(output.verdicts.map((v) => [v.key, v]));
  const decoded = dedupeObservations([...records]).flatMap((o) => {
    const d = decodeRecord(o);
    return d.ok ? [d.record] : [];
  });
  const facts: Facts = { idx: indexOf(decoded), counted: (k) => verdicts.get(k)?.counts === true };
  const ens = EnsSnapshot.from(ensSnapshot);
  const time = TimeMap.fromEntries(ensSnapshot);
  const now = context.arkivCutoff.timestamp;
  const blockAt = (at: bigint) => (at === now ? context.sepoliaCutoff.number : time.blockAt(at));

  const badgeHeld = (s: ShiftInfo, at: bigint) => {
    const block = blockAt(at);
    const owner = ens.owner(s.volunteer, block);
    const expiry = ens.expiry(s.volunteer, block);
    return owner !== null && owner === holderOf(ens, time, s) && expiry !== null && at < expiry;
  };
  const sessionsOf = (volunteer: string, at = now, zone?: string) =>
    activeSessions(facts, volunteer, at, zone).filter((x) => badgeHeld(x.shift, at));

  return {
    now,
    verdict: (k) => verdicts.get(k),
    records: (kind) => facts.idx.byKind(kind),
    onDuty: (volunteer, at = now, zone) => sessionsOf(volunteer, at, zone).length > 0,
    sessionsOf,
    shiftsOf: (volunteer) =>
      shiftsOf(facts, volunteer).map((s) => {
        const pass = facts.idx
          .referencing("duty_pass", "shift", s.record.key)
          .find((p) => facts.counted(p.key) && str(p, "volunteer") === volunteer);
        return {
          ...s,
          effectiveEnd: effectiveEnd(facts, s),
          sessions: sessionsOfShift(facts, s),
          ...(pass ? { pass } : {}),
        };
      }),
    venueAt: (at = now) => venueAt(facts, at),
    facts,
  };
}
