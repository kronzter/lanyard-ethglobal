// Mock data source for the public team page until B4 reads captured submissions.
import pages from "../../../fixtures/team-pages.json";
import { isTeamLabel } from "../labels";
import { TeamPageStateSchema, type TeamPageState } from "../types/team-page";

const states: TeamPageState[] = Object.values(pages).map(
  (p) => TeamPageStateSchema.parse(p) as TeamPageState,
);

/** The fixture state for `team`: a registered team's state, or `unknown-team` for anything else. */
export function mockTeamPageState(team: string): TeamPageState {
  const known = states.find((s) => s.team === team && s.status !== "unknown-team");
  if (known) return known;
  return { status: "unknown-team", team: isTeamLabel(team) ? team : "unknown" };
}
