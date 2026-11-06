// Sepolia block identity for `lanyard verify` (B2.3-R3, R8): the saved cutoff's block hash must
// still be the canonical one. `EnsReader` exposes no block hashes, so this small B-owned source
// supplies them: deterministic hashes over the fixture timeline in mock mode, a viem public client
// against the archive RPC once ENS goes live at I2.
import { canonicalHash } from "@/shared/canonical";
import type { BlockRef, Hex } from "@/shared/types/primitives";
import { timestampOfBlock, type Timeline } from "@/shared/fixtures/timeline";

export interface SepoliaBlocks {
  blockRef(number: bigint): Promise<BlockRef>;
}

/** The fixture chain's block hash: a pure function of chain ID and number. */
export const mockBlockHash = (chainId: number, number: bigint): Hex =>
  canonicalHash({ chain: "lanyard-mock-sepolia", chainId, number });

export function mockSepoliaBlocks(
  timeline: Timeline,
  opts: { override?: (number: bigint) => Hex | undefined } = {},
): SepoliaBlocks {
  return {
    async blockRef(number) {
      if (number < timeline.genesis.block || number > timeline.head)
        throw new Error(`Sepolia block ${number} is outside the mock chain`);
      return {
        number,
        hash: opts.override?.(number) ?? mockBlockHash(timeline.chainId, number),
        timestamp: timestampOfBlock(timeline, number),
      };
    },
  };
}
