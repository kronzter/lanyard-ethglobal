// A4.3-R5: the desk's two-step team flow. Registration and URL linking are separate statuses; the
// link is "ready" only once the expected `url` is read back from the resolver, and the URL step can
// be retried alone without registering the team again.
import type { Address } from "viem";
import { decideTeam, type TeamObservation } from "../ens/team-plan";
import { decideTeamUrl } from "../ens/team-url-plan";

export type RegistrationStatus = "needed" | "done" | "blocked";
export type LinkStatus = "waiting" | "needed" | "ready" | "blocked";

export type TeamFlow = {
  registration: RegistrationStatus;
  link: LinkStatus;
  /** The one action the desk should offer next, or null when finished or blocked. */
  next: "register" | "link" | null;
  url: string | null;
  reason: string | null;
};

export type TeamFlowInput = {
  label: string;
  lead: Address;
  team: TeamObservation;
  /** The team name's resolver and the `url` text read back through the Universal Resolver. */
  resolver: Address;
  currentUrl: string | null;
  hackersResolver: Address;
  publicAppOrigin: string;
  repair: boolean;
};

export function planTeamFlow(i: TeamFlowInput): TeamFlow {
  const reg = decideTeam(i.team, i.lead);
  if (reg.action === "blocked")
    return { registration: "blocked", link: "waiting", next: null, url: null, reason: reg.reason };
  if (reg.action === "register")
    return { registration: "needed", link: "waiting", next: "register", url: null, reason: null };
  const url = decideTeamUrl(
    { label: i.label, status: i.team.status, resolver: i.resolver, currentUrl: i.currentUrl ?? "" },
    { hackersResolver: i.hackersResolver, publicAppOrigin: i.publicAppOrigin, repair: i.repair },
  );
  if (url.action === "blocked")
    return { registration: "done", link: "blocked", next: null, url: null, reason: url.reason };
  if (url.action === "skip")
    return { registration: "done", link: "ready", next: null, url: url.url, reason: null };
  return { registration: "done", link: "needed", next: "link", url: url.url, reason: null };
}
