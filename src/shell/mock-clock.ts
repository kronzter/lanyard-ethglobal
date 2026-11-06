// Moments a developer can pick as "now" in mock mode. The fixture chain's head lies after the
// edition lapses, when nothing resolves, so mock sessions default to the second hour of the
// event, when every badge is issued and Priya is a lead (fixtures/README.md › ens-history.json).
import type { Timeline } from "@/shared/fixtures/timeline";

export type MockMoment = { id: string; label: string; block: bigint };

const HOUR_BLOCKS = (t: Timeline) => BigInt(3600 / t.secondsPerBlock);

export function mockMoments(t: Timeline): MockMoment[] {
  const h = HOUR_BLOCKS(t);
  const at = (k: keyof Timeline["times"]) => t.times[k].block;
  return [
    { id: "event-start-2h", label: "Event start + 2 h", block: at("eventStart") + 2n * h },
    { id: "day-2", label: "Event start + 21 h (Priya no longer lead)", block: at("eventStart") + 21n * h },
    { id: "judging", label: "Submission deadline + 2 h (judging)", block: at("submissionDeadline") + 2n * h },
    { id: "after-results", label: "Results + 2 h", block: at("results") + 2n * h },
    { id: "head", label: "Fixture head (edition lapsed)", block: t.head },
  ];
}

export const DEFAULT_MOCK_MOMENT = "event-start-2h";
