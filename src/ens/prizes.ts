// The `lanyard.prizes` text record on `winner.<team>.<edition>.<base>` is a canonical JSON string
// array (plans/A4-winners-consoles.md A4.1-R1). The badge cares about two prize strings only:
// `winner` and `runner-up`; any other prize string is opaque and ignored. Parsing is pure; only
// lockedWinnerPlace reads, through an injected EnsReader.
import type { EnsReader } from "../shared/interfaces/ens-reader";

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

/**
 * The place to show for `label`'s winner name at `sepoliaBlock`, but only once the publication is
 * locked: the edition's `lanyard.locked` text must be "1" at that same block (A4 app lock sentinel).
 * A declared but unlocked winner yields null, and its prizes record is not even read.
 */
export async function lockedWinnerPlace(
  reader: Pick<EnsReader, "text">,
  label: string,
  sepoliaBlock: bigint,
): Promise<WinnerPlace | null> {
  const at = { sepoliaBlock };
  if ((await reader.text("", "lanyard.locked", at)) !== "1") return null;
  return parsePlace(await reader.text(`winner.${label}`, "lanyard.prizes", at));
}
