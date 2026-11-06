// The frozen inputs to a pure rules evaluation (plans/01-evidence-and-interfaces.md §2).
import type { BlockRef, Hex } from "../types/primitives";

export type EvaluationContext = {
  event: string;
  arkivChainId: number;
  /** Recorded genesis/reset fingerprint, not the chain ID alone. */
  arkivResetId: Hex;
  sepoliaChainId: number;
  /** Observed Arkiv head after final capture: a filter on captured creation blocks. */
  arkivCutoff: BlockRef;
  /** Latest Sepolia block at or before the Arkiv cutoff timestamp, with configured confirmations. */
  sepoliaCutoff: BlockRef;
  configHash: Hex;
};
