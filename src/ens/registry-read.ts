// Direct reads of one label in one ENSv2 PermissionedRegistry, optionally at a historical block.
// Shared by the A2 operator scripts and the A2.4 reader. Runtime-neutral (viem only).
import { keccak256, parseAbi, toHex, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { registrationIdOf } from "../shared/ens/registration-id";

export const registryReadAbi = parseAbi([
  "struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }",
  "function getState(uint256 anyId) view returns (State)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
]);

export const labelId = (label: string): bigint => BigInt(keccak256(toHex(label)));

export type Registration = {
  /** 0 available, 1 reserved, 2 registered (ENSv2 `Status`, already accounting for expiry). */
  status: number;
  expiry: bigint;
  /** `getOwner`: zero once expired or unregistered. */
  owner: Address | null;
  /** The EAC resource of this registration: changes on unregister, re-registration and expiry. */
  resource: Hex;
  /** registrationIdOf(chainId, registry, resource); null whenever `owner` is null. */
  registrationId: Hex | null;
};

export async function readRegistration(
  client: PublicClient,
  opts: { chainId: number; registry: Address; label: string; blockNumber?: bigint },
): Promise<Registration> {
  const id = labelId(opts.label);
  const at = opts.blockNumber === undefined ? {} : { blockNumber: opts.blockNumber };
  const [state, owner] = await Promise.all([
    client.readContract({
      address: opts.registry,
      abi: registryReadAbi,
      functionName: "getState",
      args: [id],
      ...at,
    }),
    client.readContract({
      address: opts.registry,
      abi: registryReadAbi,
      functionName: "getOwner",
      args: [id],
      ...at,
    }),
  ]);
  const resource = toHex(state.resource, { size: 32 });
  const live = owner.toLowerCase() !== zeroAddress;
  return {
    status: state.status,
    expiry: state.expiry,
    owner: live ? (owner.toLowerCase() as Address) : null,
    resource,
    registrationId: live
      ? registrationIdOf({ chainId: opts.chainId, registry: opts.registry, resource })
      : null,
  };
}
