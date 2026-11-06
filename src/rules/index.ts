/**
 * Pure rules engine: runs unchanged on Hermes, in the browser and on Node.
 *
 * Owner: Track B (@arnavmahajan630). B2 ships the engine, `prepare` and the authority-only kinds;
 * B3 and B4 add their kinds to `RULES`. A kind without a rule never counts.
 */
import type { PreparedEnsEntry } from "@/shared/evidence/bundle";
import type { CapturedObservation } from "@/shared/evidence/observation";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import { evaluateWith, type Engine } from "./engine";
import * as authority from "./kinds/authority";
import * as judging from "./kinds/judging";
import * as duty from "./kinds/duty";
import * as tickets from "./kinds/tickets";
import { prepareWith, type Prepared } from "./prepare";
import type { RuleSet, RulesOutput } from "./types";
import { RULES_VERSION } from "./version.generated";

export { RULES_VERSION };

/** Every registered kind rule. Explicit, so import order can never change a result. */
export const RULES: RuleSet = Object.freeze({
  venue: authority.venue,
  seat_assignment: authority.seat_assignment,
  acceptance: judging.acceptance,
  submission: judging.submission,
  judge_assignment: judging.judge_assignment,
  rubric: judging.rubric,
  results: authority.results,
  drip: authority.drip,
  shift: duty.shift,
  clock: duty.clock,
  duty_pass: duty.duty_pass,
  ticket: tickets.ticket,
  ticket_claim: tickets.ticket_claim,
  ticket_resolution: tickets.ticket_resolution,
  ticket_confirmation: tickets.ticket_confirmation,
});

export const ENGINE: Engine = Object.freeze({ rules: RULES, version: RULES_VERSION });

/** Decide which records count (plans/01-evidence-and-interfaces.md §2). Pure. */
export const evaluate = (
  records: readonly CapturedObservation[],
  ensSnapshot: readonly PreparedEnsEntry[],
  context: EvaluationContext,
  config: unknown,
  ruleVersion: Hex,
): RulesOutput => evaluateWith(ENGINE, records, ensSnapshot, context, config, ruleVersion);

/** Fetch every historical ENS read `evaluate` will need. Read failures throw. */
export const prepare = (
  records: readonly CapturedObservation[],
  ensReader: EnsReader,
  context: EvaluationContext,
  config: unknown,
): Promise<Prepared> => prepareWith(ENGINE, records, ensReader, context, config);

export { evaluateWith, checkContext, ContextError, RulesVersionError, type Engine } from "./engine";
export { prepareWith, type Prepared, type PrepareStats } from "./prepare";
export { rulesConfigOf, RulesConfigError, type RulesConfig } from "./config";
export { addr, bytes, decodeRecord, ref, str, u64, type DecodedRecord } from "./decode";
export { EnsSnapshot, UnpreparedRead, MalformedSnapshot, type EnsRead } from "./snapshot";
export { mapTimes, TimeMap, TimeMappingError, timeEntry } from "./time";
export * from "./types";
export * from "./state";
export { staffPartnerOf } from "./kinds/tickets";
export { evaluationView, type EvaluationView, type ShiftView, type TicketView } from "./views";
export {
  assembleBody,
  firstDifference,
  outputHashOf,
  parseBundleText,
  rankingsOf,
  reproduce,
  signBody,
  type BodyInput,
  type Reproduction,
} from "./bundle";
