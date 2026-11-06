// configHash commits to the frozen config: times including the freeze window, chain
// identities, authorities, partners, tracks, venue scale, cipher, shift-write and funding
// profiles and schema versions (plans/01-evidence-and-interfaces.md §2).
import { canonicalHash } from "../canonical";
import type { Hex } from "../types/primitives";
import type { EventConfig, FundingProfile, ShiftWriteProfile } from "./schema";
import { requireMeasured } from "./unmeasured";

type ChainIdentity = { chainId: number; confirmations: number; resetId: Hex };

export type FrozenEventConfig = Omit<
  EventConfig,
  "chains" | "scoreCipher" | "shiftWriteProfile" | "fundingProfile"
> & {
  chains: { sepolia: ChainIdentity; rabdi: ChainIdentity };
  scoreCipher: Extract<EventConfig["scoreCipher"], { status: "measured" }>["value"];
  shiftWriteProfile: ShiftWriteProfile;
  fundingProfile: FundingProfile;
};

/** Resolve every gated value; throws BlockedCapabilityError while any is unmeasured. */
export function freezeConfig(cfg: EventConfig): FrozenEventConfig {
  const chain = (name: "sepolia" | "rabdi"): ChainIdentity => ({
    chainId: cfg.chains[name].chainId,
    confirmations: requireMeasured(cfg.chains[name].confirmations, `${name} confirmation depth`),
    resetId: requireMeasured(cfg.chains[name].resetId, `${name} reset identity`),
  });
  return {
    ...cfg,
    chains: { sepolia: chain("sepolia"), rabdi: chain("rabdi") },
    scoreCipher: requireMeasured(cfg.scoreCipher, "score cipher"),
    shiftWriteProfile: requireMeasured(cfg.shiftWriteProfile, "shift-write profile"),
    fundingProfile: requireMeasured(cfg.fundingProfile, "funding profile"),
  };
}

/** keccak256 of the canonical frozen config. */
export const configHash = (cfg: EventConfig): Hex => canonicalHash(freezeConfig(cfg));
