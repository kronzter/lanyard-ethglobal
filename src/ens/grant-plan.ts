// A2.2 scoped grants: pure policy for scripts/ens/grant-roles.ts. The registrar already holds the
// fixed head-judge and partner entrypoints (A1); this decides what the organizer still has to do
// and what must be verified, never granting anything the plan does not name.
import { isAddress, zeroAddress, type Address } from "viem";
import { ArgError, parseArgs } from "./cli-args";

export type GrantRequest = {
  coordinator: Address | null;
  /** Partner id → wallet; defaults to `authorities.partners` in the event config. */
  partners: Record<string, Address>;
  /** The head judge the registrar must already be configured with. */
  headJudge: Address | null;
  /** Also audit every badge's role bitmap and ApprovalForAll state. */
  audit: boolean;
  fork: boolean;
  dryRun: boolean;
};

export const GRANT_USAGE =
  "usage: grant-roles.ts [--coordinator <address>] [--partners id=0x...,id=0x...] [--head-judge <address>] [--audit] [--fork] [--dry-run]";

const wallet = (flag: string, v: string): Address => {
  if (!isAddress(v, { strict: false }) || v.toLowerCase() === zeroAddress)
    throw new ArgError(`${flag} needs a nonzero address, got ${JSON.stringify(v)}`);
  return v.toLowerCase() as Address;
};

export function parseGrantArgs(
  argv: readonly string[],
  defaults: { partners: Record<string, string>; partnerIds: readonly string[]; headJudge?: string },
): GrantRequest {
  const { flags, values } = parseArgs(argv, {
    flags: ["--audit", "--fork", "--dry-run"],
    values: ["--coordinator", "--partners", "--head-judge"],
  });
  const partners: Record<string, Address> = {};
  const given = values.get("--partners");
  const entries: (readonly [string, string])[] =
    given === undefined
      ? Object.entries(defaults.partners)
      : given.split(",").map((pair) => {
          const [id, addr, ...rest] = pair.split("=");
          if (!id || !addr || rest.length) throw new ArgError(`bad --partners entry ${JSON.stringify(pair)}`);
          return [id, addr] as const;
        });
  for (const [id, addr] of entries) {
    if (!defaults.partnerIds.includes(id))
      throw new ArgError(`partner ${JSON.stringify(id)} is not in event.config.ts`);
    if (id in partners) throw new ArgError(`partner ${id} given twice`);
    partners[id] = wallet(`--partners ${id}`, addr);
  }
  const coordinator = values.get("--coordinator");
  const headJudge = values.get("--head-judge") ?? defaults.headJudge;
  const req: GrantRequest = {
    coordinator: coordinator === undefined ? null : wallet("--coordinator", coordinator),
    partners,
    headJudge: headJudge === undefined || headJudge === "" ? null : wallet("--head-judge", headJudge),
    audit: flags.has("--audit"),
    fork: flags.has("--fork"),
    dryRun: flags.has("--dry-run"),
  };
  const roles = [req.coordinator, req.headJudge, ...Object.values(partners)].filter((a) => a !== null);
  if (new Set(roles).size !== roles.length)
    throw new ArgError("coordinator, head judge and partner wallets must all differ");
  return req;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** ROLE_SET_TEXT on a PermissionedResolver (one nybble; the grant is scoped to a text key). */
export const ROLE_SET_TEXT = 1n << 4n;
/** Registry ROLE_UNREGISTER. */
export const ROLE_UNREGISTER = 1n << 12n;

export type Decision = { action: "act" | "skip" } | { action: "blocked"; reason: string };

/** The coordinator needs ROLE_SET_TEXT on the `lanyard.perms` resource of the staff resolver. */
export function decideCoordinator(rolesOnPermsKey: bigint): Decision {
  return (rolesOnPermsKey & ROLE_SET_TEXT) !== 0n ? { action: "skip" } : { action: "act" };
}

/** A partner is onboarded once, through the registrar, with exactly its configured wallet. */
export function decidePartner(registeredWallet: Address, wanted: Address): Decision {
  if (same(registeredWallet, zeroAddress)) return { action: "act" };
  if (same(registeredWallet, wanted)) return { action: "skip" };
  return {
    action: "blocked",
    reason: `already onboarded with ${registeredWallet}; partner wallets cannot be changed`,
  };
}

/** The head judge holds exactly UNREGISTER on the judges book root, installed at bootstrap (A2.2-R4). */
export function headJudgeProblems(o: {
  configured: Address;
  expected: Address | null;
  judgesRootRoles: bigint;
}): string[] {
  const out: string[] = [];
  if (same(o.configured, zeroAddress)) out.push("registrar has no head judge configured");
  if (o.expected && !same(o.configured, o.expected))
    out.push(`registrar head judge is ${o.configured}, expected ${o.expected}`);
  if (o.judgesRootRoles !== ROLE_UNREGISTER)
    out.push(
      `head judge root roles on judges are ${o.judgesRootRoles}, expected exactly UNREGISTER (${ROLE_UNREGISTER})`,
    );
  return out;
}

/** Every structural partner name and ancestor must outlive the namespace (A2.2-R3). */
export function lifetimeProblems(
  names: readonly { name: string; expiry: bigint }[],
  namespaceExpiry: bigint,
): string[] {
  return names
    .filter((n) => n.expiry < namespaceExpiry)
    .map((n) => `${n.name} expires at ${n.expiry}, before namespaceExpiry ${namespaceExpiry}`);
}

export type ApprovalEvent = { registry: Address; account: Address; operator: Address; approved: boolean };

/** Final ApprovalForAll state per (registry, account, operator); a surviving approval is a violation (A2.2-R5). */
export function approvalViolations(events: readonly ApprovalEvent[]): string[] {
  const state = new Map<string, boolean>();
  for (const e of events)
    state.set(
      `${e.registry.toLowerCase()} ${e.account.toLowerCase()} ${e.operator.toLowerCase()}`,
      e.approved,
    );
  return [...state]
    .filter(([, approved]) => approved)
    .map(([k]) => {
      const [registry, account, operator] = k.split(" ");
      return `${account} approved ${operator} for all tokens on ${registry}`;
    });
}
