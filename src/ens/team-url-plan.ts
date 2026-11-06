// A2.1-R6: each team's ENS `url` record points at its deterministic Lanyard page. Pure policy; the
// script observes the chain and writes. A changed resolver or a different existing URL is reported
// for explicit repair; nothing is inferred or overwritten silently.
import type { Address } from "viem";
import { teamPageUrl } from "../shared/types/team-page";
import { ArgError, parseArgs } from "./cli-args";
import { validateTeamLabel } from "./team-plan";

export type TeamUrlRequest = {
  teams: { kind: "all" } | { kind: "one"; label: string };
  fork: boolean;
  dryRun: boolean;
  /** Overwrite a different existing URL (never a different resolver). */
  repair: boolean;
};

export const TEAM_URL_USAGE =
  "usage: set-team-url.ts (--team <label> | --all) [--repair] [--fork] [--dry-run]";

export function parseTeamUrlArgs(argv: readonly string[]): TeamUrlRequest {
  const { flags, values } = parseArgs(argv, {
    flags: ["--all", "--repair", "--fork", "--dry-run"],
    values: ["--team"],
  });
  const team = values.get("--team");
  if (flags.has("--all") === (team !== undefined)) throw new ArgError("give exactly one of --team or --all");
  if (team !== undefined) validateTeamLabel(team);
  return {
    teams: team === undefined ? { kind: "all" } : { kind: "one", label: team },
    fork: flags.has("--fork"),
    dryRun: flags.has("--dry-run"),
    repair: flags.has("--repair"),
  };
}

export type TeamUrlObservation = {
  label: string;
  /** Edition registry status of the team name: 2 = registered. */
  status: number;
  /** The team name's resolver in the edition registry. */
  resolver: Address;
  /** The current `url` text on the hackers resolver ("" when unset). */
  currentUrl: string;
};

export type TeamUrlDecision =
  { action: "write"; url: string } | { action: "skip"; url: string } | { action: "blocked"; reason: string };

export function decideTeamUrl(
  o: TeamUrlObservation,
  ctx: { hackersResolver: Address; publicAppOrigin: string; repair: boolean },
): TeamUrlDecision {
  const url = teamPageUrl(o.label, ctx.publicAppOrigin);
  if (o.status !== 2) return { action: "blocked", reason: "team is not registered (or has expired)" };
  if (o.resolver.toLowerCase() !== ctx.hackersResolver.toLowerCase())
    return {
      action: "blocked",
      reason: `team resolver is ${o.resolver}, not the hackers resolver; the lead repointed it, so repair it explicitly`,
    };
  if (o.currentUrl === url) return { action: "skip", url };
  if (o.currentUrl !== "" && !ctx.repair)
    return {
      action: "blocked",
      reason: `url is ${JSON.stringify(o.currentUrl)}; rerun with --repair to replace it`,
    };
  return { action: "write", url };
}
