// The pure rules engine (B2.2-R1, R2, R4): `evaluate(records, ensSnapshot, context, config,
// ruleVersion)` decides, for every captured record, whether it counts and why not.
//
// Pure: no clock, randomness or network. Every historical fact comes from the prepared snapshot
// and every present-tense decision from the explicit context. Records are deduplicated and put in
// evidence order (creation block, then key) first, so input order never matters. Records that
// fail stay in the output with a reason; nothing is hidden.
import { dedupeObservations, type CapturedObservation } from "@/shared/evidence/observation";
import type { PreparedEnsEntry } from "@/shared/evidence/bundle";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import { aggregateRankings } from "./rankings";
import { processScores, type DecryptionMaterial } from "./scores";
import { resolveWriter, screen } from "./base";
import { rulesConfigOf, type RulesConfig } from "./config";
import type { DecodedRecord } from "./decode";
import { EnsSnapshot } from "./snapshot";
import { TimeMap } from "./time";
import type { KindRule, RuleCtx, RuleSet, RulesOutput, Verdict } from "./types";

export class RulesVersionError extends Error {
  constructor(requested: string, available: string) {
    super(`rules version ${requested} is unavailable; this build implements ${available}`);
    this.name = "RulesVersionError";
  }
}

export class ContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextError";
  }
}

/** The context must name this edition's chains and commit to this config. */
export function checkContext(context: EvaluationContext, config: RulesConfig): void {
  if (context.event !== config.edition)
    throw new ContextError(`context is for ${context.event}, not ${config.edition}`);
  if (
    context.arkivChainId !== config.chains.rabdi.chainId ||
    context.arkivResetId !== config.chains.rabdi.resetId
  )
    throw new ContextError("context names a different Arkiv chain or reset than the config");
  if (context.sepoliaChainId !== config.chains.sepolia.chainId)
    throw new ContextError("context names a different Sepolia chain than the config");
  if (context.sepoliaCutoff.timestamp > context.arkivCutoff.timestamp)
    throw new ContextError("the Sepolia cutoff must not be later than the Arkiv cutoff");
}

export type Engine = {
  rules: RuleSet;
  /** The rules version this build implements (RULES_VERSION for the shipped engine). */
  version: Hex;
};

export function evaluateWith(
  engine: Engine,
  records: readonly CapturedObservation[],
  ensSnapshot: readonly PreparedEnsEntry[],
  context: EvaluationContext,
  frozenConfig: unknown,
  ruleVersion: Hex,
  decryption?: DecryptionMaterial,
): RulesOutput {
  if (ruleVersion.toLowerCase() !== engine.version) throw new RulesVersionError(ruleVersion, engine.version);
  const config = rulesConfigOf(frozenConfig, context.configHash);
  checkContext(context, config);
  const ens = EnsSnapshot.from(ensSnapshot);
  const time = TimeMap.fromEntries(ensSnapshot);
  const sorted = dedupeObservations([...records]);

  const screened = sorted.map((obs) => ({ obs, s: screen(obs, context, engine.rules) }));
  const decoded: DecodedRecord[] = screened.flatMap(({ s }) => (s.ok ? [s.record] : []));
  const verdicts = new Map<Hex, Verdict>();
  const verdictOf = (key: Hex) => verdicts.get(key);

  const out: Verdict[] = [];
  for (const { obs, s } of screened) {
    const v = s.ok
      ? judge(s.record, s.rule, { config, context, ens, time, records: decoded, verdictOf })
      : { counts: false as const, reason: s.reason };
    const verdict: Verdict = v.counts
      ? { key: obs.key, kind: obs.kind, counts: true }
      : { key: obs.key, kind: obs.kind, counts: false, reason: v.reason };
    verdicts.set(obs.key, verdict);
    out.push(verdict);
  }
  const scored = processScores(
    decoded,
    {
      schemaVersion: 1,
      event: context.event,
      ruleVersion: engine.version,
      configHash: context.configHash,
      verdicts: out,
    },
    config,
    frozenConfig,
    context,
    decryption,
  );
  const rankings = aggregateRankings(decoded, scored, config);
  return rankings ? { ...scored, rankings } : scored;
}

function judge(
  record: DecodedRecord,
  rule: KindRule,
  base: Pick<RuleCtx, "config" | "context" | "ens" | "time" | "records" | "verdictOf">,
) {
  const creationBlock = base.time.blockAt(record.obs.createdAtTimestamp);
  const writer = resolveWriter(record, rule, base.config, base.ens, creationBlock, base.context);
  if (!writer.ok) return { counts: false as const, reason: writer.reason };
  return rule.check(record, {
    ...base,
    record,
    writer: writer.writer,
    creationBlock,
    cutoffBlock: base.context.sepoliaCutoff.number,
  });
}
