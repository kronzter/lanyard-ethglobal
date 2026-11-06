// Pure A1.3 operator input and reconciliation policy. The contract enforces the same label policy.
import { isAddress, zeroAddress, type Address } from "viem";
import { normalizeLabel, BOOKS } from "../shared/labels";
import type { Persona } from "../shared/fixtures/personas";

export class TeamArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamArgError";
  }
}

const protectedLabels: readonly string[] = [...BOOKS, "admin", "staff", "lanyard", "ethglobal", "winner"];

export function validateTeamLabel(label: string): string {
  try {
    normalizeLabel(label);
  } catch (err) {
    throw new TeamArgError(err instanceof Error ? err.message : "invalid team label");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(label) || protectedLabels.includes(label)) {
    throw new TeamArgError("team label must be 3–32 canonical characters and not a protected label");
  }
  return label;
}

export type TeamRequest =
  | { mode: "team"; label: string; lead: Address; fork: boolean; dryRun: boolean }
  | { mode: "demo"; fork: true; dryRun: boolean };

export const TEAM_USAGE =
  "usage: register-team.ts (--label <team> --lead <address> | --demo --fork) [--fork] [--dry-run]";

export function parseTeamArgs(argv: string[]): TeamRequest {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]!;
    if (["--fork", "--dry-run", "--demo"].includes(arg)) {
      if (flags.has(arg)) throw new TeamArgError(`${arg} given twice`);
      flags.add(arg);
    } else if (arg === "--label" || arg === "--lead") {
      if (values.has(arg)) throw new TeamArgError(`${arg} given twice`);
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new TeamArgError(`${arg} needs a value`);
      values.set(arg, value);
    } else throw new TeamArgError(`unknown argument ${arg}`);
  }
  const dryRun = flags.has("--dry-run");
  if (flags.has("--demo")) {
    if (values.size) throw new TeamArgError("--demo cannot be combined with --label or --lead");
    if (!flags.has("--fork"))
      throw new TeamArgError("public fixture addresses may only be seeded with --fork");
    return { mode: "demo", fork: true, dryRun };
  }
  const label = values.get("--label");
  const lead = values.get("--lead");
  if (!label || !lead) throw new TeamArgError("--label and --lead are required");
  validateTeamLabel(label);
  if (!isAddress(lead, { strict: false }) || lead.toLowerCase() === zeroAddress) {
    throw new TeamArgError("--lead must be a nonzero wallet address");
  }
  return { mode: "team", label, lead: lead.toLowerCase() as Address, fork: flags.has("--fork"), dryRun };
}

export type TeamObservation = {
  registeredChild: Address;
  registeredLead: Address;
  currentOwner: Address;
  currentChild: Address;
  status: number;
  expiry: bigint;
  minimumExpiry: bigint;
};
export type TeamDecision = { action: "register" | "skip" } | { action: "blocked"; reason: string };

export function decideTeam(state: TeamObservation, wantedLead: Address): TeamDecision {
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  const no = (reason: string): TeamDecision => ({ action: "blocked", reason });
  if (same(state.registeredChild, zeroAddress)) {
    if (
      state.status !== 0 ||
      !same(state.currentOwner, zeroAddress) ||
      !same(state.registeredLead, zeroAddress)
    ) {
      return no("label is occupied or has inconsistent registrar state");
    }
    return { action: "register" };
  }
  if (state.status !== 2 || state.expiry < state.minimumExpiry)
    return no("existing team is expired or too short-lived");
  if (!same(state.registeredLead, wantedLead) || !same(state.currentOwner, wantedLead))
    return no("team belongs to a different lead");
  if (!same(state.registeredChild, state.currentChild))
    return no("team child registry does not match its original registration");
  return { action: "skip" };
}

export type DemoMember = { label: string; address: Address; displayName: string };
export type DemoTeam = { label: string; lead: Address; members: DemoMember[] };

export function buildDemoTeams(personas: readonly Persona[]): DemoTeam[] {
  const hackers = personas.filter((p) => p.role === "hacker");
  const labels = [...new Set(hackers.map((p) => p.team))].sort();
  return labels.map((label) => {
    if (!label) throw new TeamArgError("hacker is missing a team");
    validateTeamLabel(label);
    const roster = hackers.filter((p) => p.team === label).sort((a, b) => a.id.localeCompare(b.id));
    const leads = roster.filter((p) => p.labels.includes(label));
    if (leads.length !== 1) throw new TeamArgError(`${label} must have exactly one lead`);
    if (roster.length < 1 || roster.length > 4)
      throw new TeamArgError(`${label} must have one to four members`);
    const members = roster.map((p): DemoMember => {
      if (!p.by.endsWith(".hackers") || !p.labels.includes(p.by))
        throw new TeamArgError(`${p.id} is missing its hackers badge`);
      const badge = p.by.slice(0, -".hackers".length);
      normalizeLabel(badge);
      if (!badge || badge.includes(".")) throw new TeamArgError(`${p.id} has an invalid hackers badge`);
      return { label: badge, address: p.address, displayName: p.displayName };
    });
    return { label, lead: leads[0]!.address, members };
  });
}
