// Deterministic score preparation: metadata/recusals first, decryption second, selection last.
import { assertScoreCipherWorks } from "@/shared/crypto/score-self-test";
import { z } from "zod";
import { canonicalJson, parseJsonStrict } from "@/shared/canonical";
import { isCutoffInWindow } from "@/shared/config/validate";
import {
  openScore,
  operatorKeyMatches,
  scoreAad,
  scoreKeyId,
  ScoreCipherError,
} from "@/shared/crypto/score-cipher";
import type { EvidenceBody } from "@/shared/evidence/bundle";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import type { RulesConfig } from "./config";
import { bytes, ref, str, type DecodedRecord } from "./decode";
import { payload, RubricSchema } from "./kinds/judging";
import type { RulesOutput } from "./types";

export type DecryptionMaterial = EvidenceBody["decryption"];
export type ScoreDecision = { key: Hex; values?: Record<string, number>; reason?: string };
export type ScoreValues = Record<string, number>;
export function scoreValues(raw: unknown, rubric: z.infer<typeof RubricSchema>): ScoreValues {
  const parsed = z
    .object({ schemaVersion: z.literal(1), values: z.record(z.string(), z.number().int().nonnegative()) })
    .strict()
    .parse(raw);
  if (
    canonicalJson(Object.keys(parsed.values).sort()) !==
      canonicalJson(rubric.criteria.map((c) => c.id).sort()) ||
    Object.values(parsed.values).some((v) => v > rubric.scale * 100)
  )
    throw new Error("score criteria or ranges differ from rubric");
  return parsed.values;
}
export function validateScoreKey(config: unknown, material: DecryptionMaterial) {
  assertScoreCipherWorks();
  const cipher = z
    .object({
      scoreCipher: z.object({
        keyId: z.string(),
        suite: z.string(),
        publicKey: z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v)),
      }),
    })
    .parse(config).scoreCipher;
  if (
    material.suite !== "x25519-hkdf-sha256-aes-256-gcm" ||
    cipher.suite !== material.suite ||
    material.keyId !== cipher.keyId ||
    scoreKeyId(cipher.publicKey) !== cipher.keyId ||
    !operatorKeyMatches(material.privateKey, cipher.publicKey)
  )
    throw new Error("Operator score key/suite does not match frozen cipher configuration");
}
export function processScores(
  records: readonly DecodedRecord[],
  output: RulesOutput,
  config: RulesConfig,
  frozenConfig: unknown,
  context: EvaluationContext,
  material?: DecryptionMaterial,
): RulesOutput {
  const verdicts = output.verdicts.map((v) => ({ ...v }));
  const byKey = new Map(verdicts.map((v) => [v.key, v]));
  const recusals = records.filter((r) => r.kind === "recusal" && byKey.get(r.key)?.counts);
  const finals = records.filter((r) => r.kind === "final_score" && byKey.get(r.key)?.counts);
  for (const r of finals)
    if (
      recusals.some(
        (c) => ref(c, "submission") === ref(r, "submission") && str(c, "judge") === str(r, "judge"),
      )
    )
      byKey.set(r.key, {
        key: r.key,
        kind: r.kind,
        counts: false,
        reason: "judge recused from this submission",
      });
  const base = { ...output, verdicts: verdicts.map((v) => byKey.get(v.key)!) };
  if (!material || finals.length === 0) return base;
  if (
    !isCutoffInWindow(context.arkivCutoff.timestamp, config.times) ||
    !isCutoffInWindow(context.sepoliaCutoff.timestamp, config.times)
  )
    throw new Error("Score decryption requires an in-window freeze context");
  validateScoreKey(frozenConfig, material);
  const selected = new Set<string>();
  const scores: ScoreDecision[] = [];
  for (const r of finals) {
    if (!byKey.get(r.key)?.counts) continue;
    let values: ScoreValues;
    try {
      const ciphertext = bytes(r, "ciphertext");
      if (!ciphertext) throw new ScoreCipherError("malformed", "missing envelope");
      const rubricRecord = records.find((x) => x.key === ref(r, "rubric"))!;
      const rubric = RubricSchema.parse(payload(rubricRecord, "payload"));
      const decoded = openScore(
        material.privateKey,
        ciphertext,
        scoreAad({
          event: context.event,
          submission: ref(r, "submission")!,
          judge: str(r, "judge")!,
          assignment: ref(r, "assignment")!,
          rubric: ref(r, "rubric")!,
        }),
      );
      values = scoreValues(
        parseJsonStrict(new TextDecoder("utf-8", { fatal: true }).decode(decoded)),
        rubric,
      );
    } catch (e) {
      // Only candidate data failures belong here. Configuration/key failures were checked above.
      const reason =
        e instanceof ScoreCipherError ? `invalid score envelope: ${e.reason}` : "invalid score values";
      byKey.set(r.key, { key: r.key, kind: r.kind, counts: false, reason });
      scores.push({ key: r.key, reason });
      continue;
    }
    const pair = `${str(r, "judge")}:${ref(r, "submission")}`;
    if (selected.has(pair)) {
      const reason = "duplicate final: earliest valid decrypted final counts";
      byKey.set(r.key, { key: r.key, kind: r.kind, counts: false, reason });
      scores.push({ key: r.key, reason });
      continue;
    }
    selected.add(pair);
    scores.push({ key: r.key, values });
  }
  return { ...base, verdicts: verdicts.map((v) => byKey.get(v.key)!), scores };
}
