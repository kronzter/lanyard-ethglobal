// A4.3-R2: before any send, read on-chain whether the connected wallet holds the authority the
// action needs. Pure over a small reads interface so it is tested without a chain.
import { keccak256, toHex, type Address } from "viem";
import { ROLE_SET_TEXT } from "../ens/grant-plan";
import { PERMS_TEXT_KEY } from "../shared/ens/permission-envelope";

export type Authority =
  | { kind: "organizer" }
  | { kind: "headJudge" }
  | { kind: "coordinator" }
  | { kind: "partner"; partner: string };

export type AuthorityReads = {
  organizer(): Promise<Address>;
  headJudge(): Promise<Address>;
  partnerWallet(partnerHash: `0x${string}`): Promise<Address>;
  /** staff resolver `roles(keccak256("lanyard.perms"), wallet)` */
  coordinatorRoles(resource: bigint, wallet: Address): Promise<bigint>;
};

export type AuthorityCheck = { ok: true } | { ok: false; message: string };

export const permsResource = (): bigint => BigInt(keccak256(toHex(PERMS_TEXT_KEY)));
export const partnerHash = (partner: string): `0x${string}` => keccak256(toHex(partner));

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function describeAuthority(a: Authority): string {
  switch (a.kind) {
    case "organizer":
      return "the organizer";
    case "headJudge":
      return "the head judge";
    case "coordinator":
      return "the volunteer coordinator (ROLE_SET_TEXT on lanyard.perms)";
    case "partner":
      return `the ${a.partner} partner wallet`;
  }
}

export async function checkAuthority(
  need: Authority,
  wallet: Address | null,
  reads: AuthorityReads,
): Promise<AuthorityCheck> {
  if (!wallet) return { ok: false, message: "Connect a wallet first." };
  let held: boolean;
  try {
    switch (need.kind) {
      case "organizer":
        held = same(await reads.organizer(), wallet);
        break;
      case "headJudge":
        held = same(await reads.headJudge(), wallet);
        break;
      case "partner":
        held = same(await reads.partnerWallet(partnerHash(need.partner)), wallet);
        break;
      case "coordinator":
        held = ((await reads.coordinatorRoles(permsResource(), wallet)) & ROLE_SET_TEXT) !== 0n;
        break;
    }
  } catch (e) {
    return {
      ok: false,
      message: `Could not read on-chain roles: ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`,
    };
  }
  return held
    ? { ok: true }
    : { ok: false, message: `This wallet (${wallet}) is not ${describeAuthority(need)}. Nothing was sent.` };
}
