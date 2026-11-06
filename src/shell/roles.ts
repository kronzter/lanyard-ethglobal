// Which roles a wallet can act as, and which screens each role opens (P0.5-R6,
// plans/01-evidence-and-interfaces.md §3). Badge roles come only from IdentityDirectory, which
// checks ownership on-chain; authority roles come only from the configured wallets, so the
// organizer needs no fabricated badge. Display names are built forward from labels; nothing
// here reverse-resolves an address.
import type { AtBlock } from "@/shared/interfaces/ens-reader";
import type { IdentityDirectory } from "@/shared/interfaces/identity-directory";
import type { Address, Label } from "@/shared/types/primitives";

export type Authority = "organizer" | "results" | `partner:${string}`;

export type ShellRole =
  { kind: "authority"; authority: Authority } | { kind: "badge"; label: Label; role: string };

type AuthorityConfig = {
  authorities: { organizer: Address; results: Address; partners: Record<string, Address> };
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Configured authority wallets matching `address`, in a fixed order. */
export function authorityRoles(address: Address, config: AuthorityConfig): ShellRole[] {
  const { organizer, results, partners } = config.authorities;
  const found: Authority[] = [];
  if (same(address, organizer)) found.push("organizer");
  if (same(address, results)) found.push("results");
  for (const [id, wallet] of Object.entries(partners).sort(([a], [b]) => (a < b ? -1 : 1)))
    if (same(address, wallet)) found.push(`partner:${id}`);
  return found.map((authority) => ({ kind: "authority", authority }));
}

/** Authority roles first, then every badge the directory confirms the wallet owns. */
export async function rolesFor(
  address: Address,
  directory: IdentityDirectory,
  at: AtBlock,
  config: AuthorityConfig,
): Promise<ShellRole[]> {
  const badges = await directory.labelsFor(address, at);
  return [
    ...authorityRoles(address, config),
    ...badges.map((b): ShellRole => ({ kind: "badge", label: b.label, role: b.role })),
  ];
}

/** Stable key for a role, used for selection and React keys. */
export const roleKey = (r: ShellRole): string =>
  r.kind === "authority" ? `authority:${r.authority}` : `badge:${r.label}`;

/** Forward-built ENS name of a label in this edition (display only). */
export const ensName = (label: Label, names: { edition: string; baseName: string }): string =>
  [label, names.edition, names.baseName].filter((p) => p !== "").join(".");

const prefix = (role: string) => role.split(":")[0]!;

/** Human description of a role for the selector. */
export function roleTitle(r: ShellRole): string {
  if (r.kind === "authority") {
    if (r.authority === "organizer") return "Organizer";
    if (r.authority === "results") return "Results key";
    return `Partner · ${r.authority.slice("partner:".length)}`;
  }
  const [kind, scope] = [prefix(r.role), r.role.split(":")[1]];
  const titles: Record<string, string> = {
    hacker: "Hacker",
    "team-lead": "Team lead",
    "team-member": `Team member · ${scope}`,
    winner: `Winner · ${scope}`,
    volunteer: "Volunteer",
    "global-judge": "Judge · main track",
    "partner-judge": `Judge · ${scope}`,
    "partner-staff": `Partner staff · ${scope}`,
    partner: `Partner · ${scope}`,
    "partner-sub-book-owner": `Partner book · ${scope}`,
    "book-owner": `Book owner · ${scope}`,
    "edition-owner": "Edition owner",
  };
  return titles[kind] ?? "Unrecognized badge";
}

/**
 * Screens a role opens. Screens still check their own permissions (for example a volunteer
 * lead's shift-manager note); this only decides what the shell offers.
 */
export function screensFor(r: ShellRole): string[] {
  if (r.kind === "authority") {
    if (r.authority === "organizer") return ["/organizer", "/admin/ens", "/venue"];
    if (r.authority === "results") return []; // acts through the local freeze CLI only
    return ["/admin/ens"];
  }
  switch (prefix(r.role)) {
    case "hacker":
      return ["/tickets"];
    case "team-lead":
    case "team-member":
    case "winner":
      return ["/team"];
    case "volunteer":
      return ["/volunteer", "/lead", "/tickets"];
    case "global-judge":
    case "partner-judge":
      return ["/judge"];
    case "partner-staff":
      return ["/tickets"];
    case "partner":
    case "partner-sub-book-owner":
    case "book-owner":
    case "edition-owner":
      return ["/admin/ens"];
    default:
      return [];
  }
}
