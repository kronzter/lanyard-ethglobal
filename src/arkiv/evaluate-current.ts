// Current observations → rules → views, for the app's screens (B2.2 live view, B3 screens).
//
// Capture the edition's readonly records into memory, map the head to Sepolia through the app's
// EnsReader, prepare historical ENS and evaluate against an explicit development context. This is
// a present-tense view of current observations, not a frozen evaluation: nothing is signed and
// the Sepolia cutoff hash is not checked.
import { freezeConfig, configHash } from "@/shared/config/hash";
import type { EventConfig } from "@/shared/config/schema";
import type { CapturedObservation } from "@/shared/evidence/observation";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { BlockRef, Hex } from "@/shared/types/primitives";
import { ENGINE, evaluate, evaluationView, prepare, type EvaluationView, type RulesOutput } from "@/rules";
import type { ArkivReader } from "./api";
import { captureForEvent, memoryObservationStore, type CaptureReport } from "./capture";

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

export type CurrentEvaluation = {
  head: BlockRef;
  context: EvaluationContext;
  observations: CapturedObservation[];
  report: CaptureReport;
  output: RulesOutput;
  view: EvaluationView;
};

export class EvaluationUnavailable extends Error {
  constructor(cause: Error) {
    super(
      `Rule evaluation is unavailable: ${cause.message.split("\n")[0]}. ` +
        "With the mock ENS reader, records on the Rabdi testnet are evaluable from I2 (real ENS history); " +
        "use EXPO_PUBLIC_LANYARD_ARKIV=fake to try the flows before then.",
    );
    this.name = "EvaluationUnavailable";
  }
}

export async function evaluateCurrent(o: {
  reader: ArkivReader;
  ens: EnsReader;
  config: EventConfig;
}): Promise<CurrentEvaluation> {
  const frozen = freezeConfig(o.config);
  const network = { chainId: frozen.chains.rabdi.chainId, resetId: frozen.chains.rabdi.resetId };
  const store = memoryObservationStore();
  const report = await captureForEvent({ reader: o.reader, edition: o.config.edition, network, store });
  const { observations } = await store.load();
  const head = await o.reader.block(report.pages[0]!.blockNumber);
  try {
    const sepoliaBlock = await o.ens.sepoliaBlockAt(head.timestamp);
    const context: EvaluationContext = {
      event: o.config.edition,
      arkivChainId: network.chainId,
      arkivResetId: network.resetId,
      sepoliaChainId: frozen.chains.sepolia.chainId,
      arkivCutoff: head,
      sepoliaCutoff: { number: sepoliaBlock, hash: ZERO_HASH, timestamp: head.timestamp },
      configHash: configHash(o.config),
    };
    const prepared = await prepare(observations, o.ens, context, frozen);
    const output = evaluate(observations, prepared.ens, context, frozen, ENGINE.version);
    const view = evaluationView(observations, prepared.ens, context, output);
    return { head, context, observations, report, output, view };
  } catch (e) {
    throw new EvaluationUnavailable(e as Error);
  }
}
