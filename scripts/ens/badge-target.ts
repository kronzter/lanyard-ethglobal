// Resolves a revoke/revive target to its holding registry through the registrar.
import { keccak256, parseAbi, toHex, type Address } from "viem";
import { lanyardRegistrarAbi } from "../../src/ens/ensv2-abi";
import { partyHash, type Target } from "../../src/ens/revive-plan";
import type { Connection } from "./connect";

/** Registry functions A2.3 needs beyond the pinned ABI. */
export const badgeRegistryAbi = parseAbi([
  "function unregister(uint256 labelId)",
  "function getStatus(uint256 anyId) view returns (uint8)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getTokenId(uint256 anyId) view returns (uint256)",
  "function latestOwnerOf(uint256 tokenId) view returns (address)",
]);

export async function resolveRegistry(ctx: Connection, registrar: Address, t: Target): Promise<Address> {
  const pc = ctx.publicClient;
  const registry =
    t.kind === "book"
      ? await pc.readContract({
          address: registrar,
          abi: lanyardRegistrarAbi,
          functionName: "bookRegistry",
          args: [keccak256(toHex(t.book))],
        })
      : await pc.readContract({
          address: registrar,
          abi: lanyardRegistrarAbi,
          functionName: "partnerBookRegistry",
          args: [partyHash(t.partner), keccak256(toHex(t.sub))],
        });
  if (registry === "0x0000000000000000000000000000000000000000")
    throw new Error("no such book or partner sub-book on this registrar");
  return registry;
}
