// Pure decisions behind the deploy-time safety checks (A1-D7, A1-D8). The scripts read the chain and
// hand the numbers here; nothing in this file does I/O, so every rule is unit-tested.
import { ROLE, admin } from "./ensv2-abi";
import type { Address } from "viem";
import {
  HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  PUBLICATION_ORGANIZER_RESOLVER_ROLES,
} from "./issuance-plan";

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
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

export type PublicationResolverInventory = {
  target: Address;
  /** The publication resolver deploy-resolvers.ts recorded in .lanyard/resolvers-*.json. */
  recorded: Address;
  hackers: Address;
  staff: Address;
  hasCode: boolean;
  /** ERC165 answer for the IPermissionedResolver interface id. */
  supportsInterface: boolean;
  rootCounts: bigint;
  organizerRoot: bigint;
  registrarRoot: bigint;
};

/** `setPublicationResolver` is one-shot and permanent: the target must be exactly the resolver we deployed. */
export function publicationResolverProblems(inv: PublicationResolverInventory): string[] {
  const out: string[] = [];
  if (!same(inv.target, inv.recorded))
    out.push(`target ${inv.target} is not the recorded publication resolver ${inv.recorded}`);
  if (same(inv.target, inv.hackers) || same(inv.target, inv.staff))
    out.push("target is the hackers or staff resolver");
  if (!inv.hasCode) out.push("target has no code");
  if (!inv.supportsInterface) out.push("target does not support IPermissionedResolver");
  if (inv.rootCounts !== PUBLICATION_ORGANIZER_RESOLVER_ROLES)
    out.push(
      `target root role counts are ${inv.rootCounts}, expected exactly ${PUBLICATION_ORGANIZER_RESOLVER_ROLES}`,
    );
  if (inv.organizerRoot !== PUBLICATION_ORGANIZER_RESOLVER_ROLES)
    out.push(`target organizer root roles are ${inv.organizerRoot}`);
  if (inv.registrarRoot !== 0n) out.push(`registrar holds root roles ${inv.registrarRoot} on the target`);
  return out;
}

export type WinnerRegistrarInput = {
  target: Address;
  registrar: Address;
  organizer: Address;
  hasCode: boolean;
  /** What the target reports as its LanyardRegistrar, or null when it cannot be asked. */
  pointsBack: Address | null;
  allowUnverified: boolean;
};

/**
 * `setWinnerRegistrar` hands the target the right to promote and renew winning teams, once. A WinnerRegistrar
 * (A4.1) does not exist in the repo yet, so there is nothing to read back from it: until it does, the caller
 * must pass the explicit override acknowledging the address was checked by hand.
 */
export function winnerRegistrarProblems(inv: WinnerRegistrarInput): string[] {
  const out: string[] = [];
  if (!inv.hasCode) out.push("target has no code");
  if (same(inv.target, inv.registrar)) out.push("target is the registrar itself");
  if (same(inv.target, inv.organizer)) out.push("target is the organizer");
  if (inv.pointsBack !== null) {
    if (!same(inv.pointsBack, inv.registrar))
      out.push(`target points at ${inv.pointsBack}, not this registrar ${inv.registrar}`);
  } else if (!inv.allowUnverified)
    out.push(
      "target cannot be verified (no WinnerRegistrar exists yet, A4.1); pass --allow-unverified-winner-registrar after checking it by hand",
    );
  return out;
}
