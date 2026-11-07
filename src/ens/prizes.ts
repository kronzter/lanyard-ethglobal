// The `lanyard.prizes` text record on `winner.<team>.<edition>.<base>` is a canonical JSON string
// array (plans/A4-winners-consoles.md A4.1-R1). The badge cares about two prize strings only:
// `winner` and `runner-up`; any other prize string is opaque and ignored. Pure, no I/O.
export type WinnerPlace = "winner" | "runner-up";

export class PrizesParseError extends Error {
  constructor(reason: string) {
    super(`invalid lanyard.prizes record: ${reason}`);
    this.name = "PrizesParseError";
  }
}

/**
 * The place to show for a prizes record: null when the record is absent or lists neither place;
 * `winner` beats `runner-up` when both are listed. Throws {@link PrizesParseError} on a record
 * that is not a JSON array of strings.
 */
export function parsePlace(record: string | null | undefined): WinnerPlace | null {
  if (record === null || record === undefined || record.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record);
  } catch {
    throw new PrizesParseError("not JSON");
  }
  if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string"))
    throw new PrizesParseError("not an array of strings");
  const prizes = (parsed as string[]).map((p) => p.trim());
  if (prizes.includes("winner")) return "winner";
  if (prizes.includes("runner-up")) return "runner-up";
  return null;
}

export const PLACE_TEXT: Readonly<Record<WinnerPlace, string>> = {
  winner: "Winner",
  "runner-up": "Runner-up",
};
