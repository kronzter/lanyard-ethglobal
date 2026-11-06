// Local operator pipeline. No app module imports this file; keys are requested only after gates.
import { recoverMessageAddress } from "viem";
import { z } from "zod";
import { canonicalHash, canonicalJson, parseJsonStrict } from "../src/shared/canonical";
import { configHash, freezeConfig } from "../src/shared/config/hash";
import type { EventConfig } from "../src/shared/config/schema";
import { isCutoffInWindow } from "../src/shared/config/validate";
import {
  EvidenceBodySchema,
  verifyEnvelope,
  resultsBodyOf,
  resultsHashOf,
  assertSummaryFits,
  type CaptureDiagnosticsSchema,
  type EvidenceEnvelope,
  type ResultsBody,
} from "../src/shared/evidence/bundle";
import { dedupeObservations, type CapturedObservation } from "../src/shared/evidence/observation";
import type { EnsReader } from "../src/shared/interfaces/ens-reader";
import type { EvaluationContext } from "../src/shared/interfaces/evaluation-context";
import {
  emptyPublicationState,
  samePublicationState,
  type PreparedResultsPublisher,
  type PreparedPublication,
  type ConfirmedTx,
  type PublicationInput,
  type PublicationState,
  type PublicationOperation,
} from "../src/shared/interfaces/results-publisher";
import {
  AddressSchema,
  Bytes32Schema,
  HexSchema,
  type Address,
  type Hex,
} from "../src/shared/types/primitives";
import { ENGINE, prepare, evaluateWith, assembleBody, signBody, rankingsOf, reproduce } from "../src/rules";
import { assertRequiredEvidence } from "../src/rules/evidence-closure";
import { validateScoreKey, type DecryptionMaterial } from "../src/rules/scores";

const big = z.union([z.bigint(), z.string().regex(/^(0|[1-9][0-9]*)$/)]).transform(BigInt);
const preparedSchema = z.object({ rawTransaction: HexSchema, txHash: Bytes32Schema, nonce: big }).strict();
const receiptSchema = z
  .object({ txHash: Bytes32Schema, blockNumber: big, blockHash: Bytes32Schema })
  .strict();
const StepSchema = z
  .object({
    id: z.string(),
    operationHash: Bytes32Schema,
    status: z.enum(["planned", "prepared", "submitted", "receipt_confirmed", "verified"]),
    prepared: preparedSchema.optional(),
    binding: HexSchema.optional(),
    receipt: receiptSchema.optional(),
    resultsKey: Bytes32Schema.optional(),
  })
  .strict();
export type FreezeStep = z.infer<typeof StepSchema>;
export type FreezeJob = {
  schemaVersion: 1;
  event: string;
  signer: Address;
  planHash: Hex;
  envelope: EvidenceEnvelope;
  phase: "awaiting-bundle" | "publishing" | "complete";
  steps: FreezeStep[];
};
export const serializeJob = (job: FreezeJob) => canonicalJson(job);
export function parseJob(text: string): FreezeJob {
  const value = z
    .object({
      schemaVersion: z.literal(1),
      event: z.string(),
      signer: AddressSchema,
      planHash: Bytes32Schema,
      envelope: z.object({ body: z.unknown(), bundleHash: Bytes32Schema, signature: HexSchema }).strict(),
      phase: z.enum(["awaiting-bundle", "publishing", "complete"]),
      steps: z.array(StepSchema),
    })
    .strict()
    .parse(parseJsonStrict(text));
  if (new Set(value.steps.map((s) => s.id)).size !== value.steps.length)
    throw new Error("Duplicate freeze journal steps");
  return { ...value, envelope: { ...value.envelope, body: EvidenceBodySchema.parse(value.envelope.body) } };
}
export interface SummaryTransport {
  prepare(body: ResultsBody): Promise<PreparedPublication>;
  broadcast(tx: PreparedPublication): Promise<ConfirmedTx & { resultsKey: Hex }>;
  reconcile(
    tx: PreparedPublication,
  ): Promise<"prepared" | "pending" | "unknown" | "reverted" | (ConfirmedTx & { resultsKey: Hex })>;
  read(key: Hex): Promise<ResultsBody | null>;
}
export type FreezeDeps = {
  config: EventConfig;
  signer: { address: Address; signMessage(message: string): Promise<Hex> };
  material(): DecryptionMaterial;
  capture(): Promise<{
    records: CapturedObservation[];
    inventory: Hex[];
    context: EvaluationContext;
    diagnostics: z.infer<typeof CaptureDiagnosticsSchema>;
    missing?: Hex[];
  }>;
  ens: EnsReader;
  checkContext(context: EvaluationContext): Promise<void>;
  publisher: PreparedResultsPublisher;
  summary: SummaryTransport;
  load(): Promise<FreezeJob | null>;
  save(job: FreezeJob): Promise<void>;
  retain(envelope: EvidenceEnvelope): Promise<void>;
  checkCopies(envelope: EvidenceEnvelope): Promise<void>;
  fetchText(uri: string): Promise<string>;
  hook?(
    point: "afterPrepared" | "afterBroadcast" | "afterReceipt" | "afterVerified",
    step: FreezeStep,
  ): Promise<void>;
};
const planHash = (envelope: EvidenceEnvelope, signer: Address) =>
  canonicalHash({
    event: envelope.body.event,
    signer,
    bundleHash: envelope.bundleHash,
    summaryHash: resultsHashOf(resultsBodyOf(envelope, rankingsOf(reproduce(ENGINE, envelope.body).output))),
  });
const save = (deps: FreezeDeps, job: FreezeJob) => deps.save(structuredClone(job));
const bindingMessage = (job: FreezeJob, step: FreezeStep) =>
  `Lanyard publication step v1\n${canonicalHash({ planHash: job.planHash, operationHash: step.operationHash, prepared: step.prepared })}`;
async function checkBinding(job: FreezeJob, step: FreezeStep) {
  if (!step.prepared) return;
  if (
    !step.binding ||
    (
      await recoverMessageAddress({ message: bindingMessage(job, step), signature: step.binding })
    ).toLowerCase() !== job.signer
  )
    throw new Error("Saved transaction bytes/nonce are not signed for this exact publication operation");
}

function gate(context: EvaluationContext, config: EventConfig) {
  for (const cutoff of [context.arkivCutoff, context.sepoliaCutoff])
    if (!isCutoffInWindow(cutoff.timestamp, config.times))
      throw new Error("Freeze cutoff outside [results, freezeDeadline); no key was requested or published");
  if (context.configHash !== configHash(config)) throw new Error("Freeze configuration commitment differs");
}
export async function startFreeze(
  deps: FreezeDeps,
  input: { prizes: unknown; bundleUri: string },
): Promise<FreezeJob> {
  if (await deps.load()) throw new Error("Freeze already exists; resume the saved job explicitly");
  if (deps.signer.address.toLowerCase() !== deps.config.authorities.results)
    throw new Error("Results signer differs from configured results wallet");
  if (!samePublicationState(await deps.publisher.state(), emptyPublicationState()))
    throw new Error("Results publication already exists");
  if ((await deps.publisher.pendingTransactions()).length)
    throw new Error("An earlier prepared/pending publication must be reconciled before a new freeze");
  const captured = await deps.capture();
  gate(captured.context, deps.config);
  if (captured.diagnostics.gaps.length || captured.missing?.length)
    throw new Error("Known capture gaps or missing required evidence block freeze");
  await deps.checkContext(captured.context);
  const retainedKeys = dedupeObservations(captured.records)
    .map((r) => r.key)
    .sort();
  if (
    new Set(captured.inventory).size !== captured.inventory.length ||
    canonicalJson([...captured.inventory].sort()) !== canonicalJson(retainedKeys) ||
    captured.diagnostics.knownKeys !== captured.inventory.length
  )
    throw new Error("Missing retained evidence: independent capture inventory differs from retained keys");
  const records = dedupeObservations(captured.records).filter(
    (r) => r.flags.readonly && r.kind !== "results",
  );
  if (captured.diagnostics.knownKeys < records.length)
    throw new Error("Capture inventory is smaller than retained evidence");
  const config = freezeConfig(deps.config);
  const prepared = await prepare(records, deps.ens, captured.context, config);
  assertRequiredEvidence(ENGINE, records, prepared.ens, captured.context, config);
  const metadata = evaluateWith(ENGINE, records, prepared.ens, captured.context, config, ENGINE.version);
  const prizes = EvidenceBodySchema.shape.prizes.parse(input.prizes);
  if (new Set(prizes.map((p) => p.team)).size !== prizes.length)
    throw new Error("One winner declaration per team; combine its prizes");
  for (const p of prizes) {
    const submission = records.find(
      (r) =>
        r.kind === "submission" &&
        r.attributes.some((a) => a.name === "team" && a.value === p.team) &&
        metadata.verdicts.some((v) => v.key === r.key && v.counts),
    );
    if (!submission || p.prizes.some((v) => !v.trim()))
      throw new Error(`Prize recipient ${p.team} has no counted submission or valid prizes`);
    if (!(await deps.ens.owner(p.team, { sepoliaBlock: captured.context.sepoliaCutoff.number })))
      throw new Error(`Winning team ${p.team} is not registered at the cutoff`);
  }
  // Validate URI before retrieving/exporting key material.
  EvidenceBodySchema.shape.bundleUri.parse(input.bundleUri);
  const material = deps.material();
  validateScoreKey(config, material);
  const output = evaluateWith(
    ENGINE,
    records,
    prepared.ens,
    captured.context,
    config,
    ENGINE.version,
    material,
  );
  const body = assembleBody({
    context: captured.context,
    config,
    ruleVersion: ENGINE.version,
    records,
    ens: prepared.ens,
    diagnostics: { ...captured.diagnostics, inputKeys: records.map((r) => r.key).sort() },
    decryption: material,
    prizes,
    output,
    bundleUri: input.bundleUri,
  });
  const envelope = await signBody(body, (message) => deps.signer.signMessage(message));
  await verifyEnvelope(envelope, deps.config.authorities.results);
  assertSummaryFits(resultsBodyOf(envelope, rankingsOf(output)));
  // Staging a signed in-window bundle is durable before the operator uploads its public copy.
  const job: FreezeJob = {
    schemaVersion: 1,
    event: body.event,
    signer: deps.config.authorities.results,
    planHash: planHash(envelope, deps.config.authorities.results),
    envelope,
    phase: "awaiting-bundle",
    steps: [],
  };
  await save(deps, job);
  await deps.retain(envelope);
  await deps.checkCopies(envelope);
  return resumeFreeze(deps);
}
async function stepFor(
  deps: FreezeDeps,
  job: FreezeJob,
  id: string,
  operation: unknown,
): Promise<FreezeStep> {
  const hash = canonicalHash(operation);
  let step = job.steps.find((s) => s.id === id);
  if (step && step.operationHash !== hash)
    throw new Error(`Saved ${id} operation conflicts with the immutable plan`);
  if (!step) {
    step = { id, operationHash: hash, status: "planned" };
    job.steps.push(step);
    await save(deps, job);
  }
  return step;
}
export async function resumeFreeze(deps: FreezeDeps): Promise<FreezeJob> {
  const job = await deps.load();
  if (!job) throw new Error("No saved freeze job");
  if (job.phase === "complete") throw new Error("Freeze is already complete");
  const body = await verifyEnvelope(job.envelope, deps.config.authorities.results);
  job.envelope.body = body;
  gate(body.context, deps.config);
  if (
    job.event !== deps.config.edition ||
    job.signer !== deps.config.authorities.results ||
    job.signer !== deps.signer.address.toLowerCase() ||
    planHash(job.envelope, job.signer) !== job.planHash
  )
    throw new Error("Saved freeze plan/config/signer hash differs");
  await deps.checkContext(body.context);
  const reproduced = reproduce(ENGINE, body);
  if (!reproduced.match) throw new Error(`Saved computation differs: ${reproduced.difference}`);
  const ens = await prepare(body.records, deps.ens, body.context, body.config);
  if (canonicalJson(ens.ens) !== canonicalJson(body.ens))
    throw new Error("Saved historical ENS evidence differs");
  await deps.retain(job.envelope);
  await deps.checkCopies(job.envelope);
  let remote: string;
  try {
    remote = await deps.fetchText(body.bundleUri);
  } catch {
    throw new Error(
      "Bundle is retained locally; upload it to bundleUri, then resume this saved job. No results were published",
    );
  }
  if (canonicalJson(parseJsonStrict(remote)) !== canonicalJson(job.envelope))
    throw new Error("Downloaded bundle differs from both retained copies");
  job.phase = "publishing";
  await save(deps, job);
  const summaryBody = resultsBodyOf(job.envelope, rankingsOf(reproduced.output));
  assertSummaryFits(summaryBody);
  const summary = await stepFor(deps, job, "summary", summaryBody);
  if (summary.status !== "verified") {
    if (!summary.prepared) {
      summary.prepared = await deps.summary.prepare(summaryBody);
      summary.binding = await deps.signer.signMessage(bindingMessage(job, summary));
      summary.status = "prepared";
      await save(deps, job);
      await deps.hook?.("afterPrepared", summary);
    }
    await checkBinding(job, summary);
    let confirmed: ConfirmedTx & { resultsKey: Hex };
    const outcome = await deps.summary.reconcile(summary.prepared);
    if (typeof outcome === "string") {
      if (outcome !== "prepared" && !(outcome === "unknown" && summary.status === "prepared"))
        throw new Error(`Summary transaction ${outcome}; stop and reconcile, never allocate another nonce`);
      summary.status = "submitted";
      await save(deps, job);
      confirmed = await deps.summary.broadcast(summary.prepared);
      await deps.hook?.("afterBroadcast", summary);
    } else confirmed = outcome;
    summary.receipt = {
      txHash: confirmed.txHash,
      blockNumber: confirmed.blockNumber,
      blockHash: confirmed.blockHash,
    };
    summary.resultsKey = confirmed.resultsKey;
    summary.status = "receipt_confirmed";
    await save(deps, job);
    await deps.hook?.("afterReceipt", summary);
    if (canonicalJson(await deps.summary.read(summary.resultsKey)) !== canonicalJson(summaryBody))
      throw new Error("Confirmed results summary readback differs");
    summary.status = "verified";
    await save(deps, job);
    await deps.hook?.("afterVerified", summary);
  }
  await checkBinding(job, summary);
  if (summary.prepared) {
    const canonical = await deps.summary.reconcile(summary.prepared);
    if (
      typeof canonical === "string" ||
      canonical.resultsKey !== summary.resultsKey ||
      canonicalJson({
        txHash: canonical.txHash,
        blockNumber: canonical.blockNumber,
        blockHash: canonical.blockHash,
      }) !== canonicalJson(summary.receipt)
    )
      throw new Error("Saved verified summary receipt/key is no longer canonical");
  }
  if (!summary.resultsKey) throw new Error("Saved summary has no confirmed Arkiv key");
  const input: PublicationInput = {
    event: job.event,
    resultsKey: summary.resultsKey,
    resultsHash: resultsHashOf(summaryBody),
    bundleHash: job.envelope.bundleHash,
    bundleUri: body.bundleUri,
  };
  const expected: PublicationState = {
    eventResults: input,
    winners: Object.fromEntries(body.prizes.map((p) => [p.team, { ...input, ...p }])),
    locked: false,
  };
  const operations: [string, PublicationOperation][] = [
    ["event", { kind: "setEventResults", input }],
    ...body.prizes.map(
      (p) =>
        [`winner:${p.team}`, { kind: "declareWinner", input: { ...input, ...p } }] as [
          string,
          PublicationOperation,
        ],
    ),
    ["lock", { kind: "lockResults", expected }],
  ];
  const allowed = new Set(["summary", ...operations.map(([id]) => id)]);
  if (job.steps.some((s) => !allowed.has(s.id))) throw new Error("Unknown operation in saved freeze job");
  for (const [id, operation] of operations) {
    const step = await stepFor(deps, job, id, operation);
    const state = await deps.publisher.state();
    if (state.eventResults && canonicalJson(state.eventResults) !== canonicalJson(input))
      throw new Error("Conflicting published event commitment");
    for (const [team, winner] of Object.entries(state.winners))
      if (canonicalJson(expected.winners[team] ?? null) !== canonicalJson(winner))
        throw new Error("Conflicting published winner state");
    const matches =
      operation.kind === "setEventResults"
        ? state.eventResults !== null
        : operation.kind === "declareWinner"
          ? canonicalJson(state.winners[operation.input.team] ?? null) === canonicalJson(operation.input)
          : state.locked && samePublicationState(state, { ...expected, locked: true });
    if (matches) {
      step.status = "verified";
      await save(deps, job);
      continue;
    }
    if (step.status === "verified" || state.locked)
      throw new Error("Verified publication state is missing or conflicts");
    if (!step.prepared) {
      step.prepared = await deps.publisher.prepare(operation);
      step.binding = await deps.signer.signMessage(bindingMessage(job, step));
      step.status = "prepared";
      await save(deps, job);
      await deps.hook?.("afterPrepared", step);
    }
    await checkBinding(job, step);
    const outcome = await deps.publisher.preparedStatus(step.prepared.txHash);
    let receipt: ConfirmedTx;
    if (typeof outcome === "string") {
      if (outcome !== "prepared") throw new Error(`Publication transaction ${outcome}; stop and reconcile`);
      step.status = "submitted";
      await save(deps, job);
      receipt = await deps.publisher.broadcastPrepared(step.prepared);
      await deps.hook?.("afterBroadcast", step);
    } else receipt = outcome;
    step.receipt = receipt;
    step.status = "receipt_confirmed";
    await save(deps, job);
    await deps.hook?.("afterReceipt", step);
    const read = await deps.publisher.state();
    const correct =
      operation.kind === "setEventResults"
        ? canonicalJson(read.eventResults) === canonicalJson(input)
        : operation.kind === "declareWinner"
          ? canonicalJson(read.winners[operation.input.team] ?? null) === canonicalJson(operation.input)
          : samePublicationState(read, { ...expected, locked: true });
    if (!correct) throw new Error("Confirmed publication readback differs");
    step.status = "verified";
    await save(deps, job);
    await deps.hook?.("afterVerified", step);
  }
  job.phase = "complete";
  await save(deps, job);
  return job;
}
