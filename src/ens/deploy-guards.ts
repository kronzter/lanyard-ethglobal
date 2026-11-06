// Pure decisions behind the deploy-time safety checks (A1-D7, A1-D8). The scripts read the chain and
// hand the numbers here; nothing in this file does I/O, so every rule is unit-tested.
import { ROLE, admin } from "./ensv2-abi";
import { HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES } from "./issuance-plan";

const UPGRADE_MASK = ROLE.UPGRADE | admin(ROLE.UPGRADE);

/** Role counts read from one of the two fixed resolvers (hackers, staff) the registrar writes to. */
export type FixedResolverInventory = {
  kind: "hackers" | "staff";
  /** `roleCount(0)`: one nybble per role, counting holders. */
  rootCounts: bigint;
  /** `roles(0, organizer)`. */
  organizerRoot: bigint;
  /** `roles(0, registrar)`. */
  registrarRoot: bigint;
  /** `roles(keccak256(uint256 60), registrar)`: the coin-60 argument-scoped ROLE_SET_ADDRESS. */
  registrarCoin60: bigint;
  /** `roleCount(keccak256(uint256 60))`. */
  coin60Counts: bigint;
  /** `roleCount(keccak256("url"))`: the organizer's text setter on the hackers resolver only. */
  urlCounts: bigint;
};

/**
 * The inventory deploy-resolvers.ts creates and nothing else. The organizer is the one expected root
 * holder: ROLE_SET_ADDRESS plus the admins of SET_ADDRESS and SET_TEXT (HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES),
 * so `roleCount(0)` must equal that constant exactly. That alone rules out any second holder, any
 * ROLE_UPGRADE (UUPS upgrade) or its admin, and any other admin. The registrar needs no root role; it
 * holds only the coin-60 setter, granted through grantSetterRoles, which no other account shares.
 */
export function fixedResolverRoleProblems(inv: FixedResolverInventory): string[] {
  const out: string[] = [];
  const label = `${inv.kind} resolver`;
  if ((inv.rootCounts & UPGRADE_MASK) !== 0n)
    out.push(`${label}: someone holds ROLE_UPGRADE or its admin (root counts ${inv.rootCounts})`);
  if (inv.rootCounts !== HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES)
    out.push(
      `${label}: root role counts are ${inv.rootCounts}, expected exactly ${HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES}`,
    );
  if (inv.organizerRoot !== HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES)
    out.push(`${label}: organizer root roles are ${inv.organizerRoot}`);
  if (inv.registrarRoot !== 0n) out.push(`${label}: registrar holds root roles ${inv.registrarRoot}`);
  if ((inv.registrarCoin60 & ROLE.REGISTRAR) !== ROLE.REGISTRAR)
    out.push(`${label}: registrar lacks the coin-60 ROLE_SET_ADDRESS (has ${inv.registrarCoin60})`);
  if (inv.coin60Counts !== ROLE.REGISTRAR)
    out.push(`${label}: coin-60 role counts are ${inv.coin60Counts}, expected only the registrar`);
  const expectedUrl = inv.kind === "hackers" ? 16n : 0n;
  if (inv.urlCounts !== expectedUrl)
    out.push(`${label}: url role counts are ${inv.urlCounts}, expected ${expectedUrl}`);
  return out;
}
