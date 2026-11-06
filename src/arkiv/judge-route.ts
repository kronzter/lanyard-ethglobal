import type { Router } from "@/shared/interfaces/router";
import type { CellRef, LocatedStop } from "@/shared/types/venue";
import type { Hex } from "@/shared/types/primitives";
import { ref, str } from "@/rules/decode";
import { submissionContent } from "@/rules/kinds/judging";
import type { CurrentEvaluation } from "./evaluate-current";

export function assignedJudgeRoute(
  evaluation: CurrentEvaluation,
  judge: string,
  router: Router,
  start?: CellRef,
) {
  const view = evaluation.view;
  const venue = view.venueAt();
  const assignments = view
    .records("judge_assignment")
    .filter((r) => str(r, "judge") === judge && view.verdict(r.key)?.counts);
  const stops: LocatedStop[] = [];
  const unlocated: Hex[] = [];
  const seen = new Set<Hex>();
  for (const a of assignments) {
    const submission = view.records("submission").find((r) => r.key === ref(a, "submission"));
    if (!submission || seen.has(submission.key)) continue;
    seen.add(submission.key);
    const content = submissionContent(submission);
    const assignment = content.success ? view.seatOf(content.data.lead) : undefined;
    const seat =
      assignment && venue && ref(assignment, "venue") === venue.record.key
        ? venue.venue.seats.find((s) => s.id === str(assignment, "seat"))
        : undefined;
    if (seat) stops.push({ projectKey: submission.key, cell: seat.cell });
    else unlocated.push(submission.key);
  }
  const origin =
    start ??
    venue?.venue.pois.filter((p) => p.kind === "help-desk").sort((a, b) => a.id.localeCompare(b.id))[0]?.cell;
  return {
    assignments,
    stops,
    unlocated,
    order: venue && origin ? router.judgeRoute(venue.venue, origin, stops) : [],
    venue: venue?.venue,
  };
}
