// Organizer imports (B3.3-R1, R4, R6): a seat CSV checked against the current venue, and a
// venue.json checked before it is published. Pure; the organizer screen shows every problem.
import type { EventConfig } from "@/shared/config/schema";
import { isCanonicalLabel } from "@/shared/labels";
import { isAddress, type Address } from "@/shared/types/primitives";
import { parseVenue, type Venue } from "@/shared/types/venue";

export type SeatRow = { hackerAddress: Address; hackerLabel: string; seat: string };

/** `hacker_address,hacker_label,seat` rows (a header row is optional). */
export function parseSeatCsv(text: string, venue: Venue): { rows: SeatRow[]; errors: string[] } {
  const rows: SeatRow[] = [];
  const errors: string[] = [];
  const seats = new Set(venue.seats.map((s) => s.id));
  const usedSeat = new Map<string, number>();
  const usedHacker = new Map<string, number>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (line === "" || (i === 0 && /^hacker_address\s*,/i.test(line))) return;
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length !== 3) return errors.push(`line ${n}: expected hacker_address,hacker_label,seat`);
    const [address, label, seat] = cells as [string, string, string];
    const a = address.toLowerCase();
    if (!isAddress(a)) errors.push(`line ${n}: ${address} is not an address`);
    const parts = label.split(".");
    if (!(parts.length === 2 && parts[1] === "hackers" && isCanonicalLabel(label)))
      errors.push(`line ${n}: ${label} is not a hackers badge label (x.hackers)`);
    if (!seats.has(seat)) errors.push(`line ${n}: seat ${seat} is not in venue ${venue.id}`);
    if (usedSeat.has(seat))
      errors.push(`line ${n}: seat ${seat} is already given on line ${usedSeat.get(seat)}`);
    if (usedHacker.has(a))
      errors.push(`line ${n}: ${address} already has a seat on line ${usedHacker.get(a)}`);
    usedSeat.set(seat, n);
    usedHacker.set(a, n);
    rows.push({ hackerAddress: a as Address, hackerLabel: label, seat });
  });
  return { rows: errors.length ? [] : rows, errors };
}

/** Problems that would make a published venue unusable for tickets, shifts or partner staff. */
export function venueProblems(
  value: unknown,
  config: Pick<EventConfig, "partners">,
): { venue?: Venue; problems: string[] } {
  let venue: Venue;
  try {
    venue = parseVenue(value);
  } catch (e) {
    return { problems: [`not a valid venue.json: ${(e as Error).message.split("\n")[0]}`] };
  }
  const problems: string[] = [];
  const zones = new Set(venue.zones.map((z) => z.id));
  if (zones.size === 0) problems.push("the venue has no zones");
  for (const s of venue.seats)
    if (!zones.has(s.zone)) problems.push(`seat ${s.id} is in unknown zone ${s.zone}`);
  for (const z of zones)
    if (!venue.pois.some((p) => p.kind === "help-desk" && p.zone === z))
      problems.push(`zone ${z} has no help desk`);
  for (const p of config.partners)
    if (!venue.pois.some((x) => x.kind === "partner-table" && x.partner === p.id))
      problems.push(`partner ${p.id} has no partner table`);
  if (venue.seats.length === 0) problems.push("the venue has no seats");
  return { venue, problems };
}
