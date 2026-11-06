// registrationId = keccak256(canonical({ chainId, registry, resource })), where `resource` is the
// holding registry's EAC resource for this registration (plans/01-evidence-and-interfaces.md §3).
// The resource changes on unregister/re-registration but not on renewal or role changes, so
// neither does the ID. Never derive it from the mutable ERC-1155 token ID.
import { canonicalHash } from "../canonical";
import { isAddress, isHex, type Address, type Hex } from "../types/primitives";

export function registrationIdOf(input: { chainId: number; registry: Address; resource: Hex }): Hex {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0)
    throw new Error(`bad chainId ${input.chainId}`);
  if (!isAddress(input.registry)) throw new Error(`bad registry address ${input.registry}`);
  if (!isHex(input.resource, 32)) throw new Error(`resource must be 32-byte hex, got ${input.resource}`);
  return canonicalHash({
    chainId: input.chainId,
    registry: input.registry.toLowerCase(),
    resource: input.resource.toLowerCase(),
  });
}
