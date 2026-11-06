// Export validation for the venue editor (plans/A3-venue-routing.md, A3.1-R3, R4, R6, R7).
// Errors block export; warnings do not.
import { type Venue, VenueSchema, cellIndex, decodeWalkable } from "@/shared/types/venue";

export const SEAT_WALKABLE_RADIUS = 3;
export const EXPORT_WARN_BYTES = 120 * 1024;

export type VenueIssue = { rule: "schema" | "R3" | "R4" | "R6" | "R7"; message: string };
export type VenueReport = { errors: VenueIssue[]; warnings: VenueIssue[]; bytes: number };

export const serializeVenue = (venue: Venue): string => JSON.stringify(venue);

export function validateVenue(venue: Venue, config: { partners: readonly { id: string }[] }): VenueReport {
  const errors: VenueIssue[] = [];
  const warnings: VenueIssue[] = [];
  const bytes = new TextEncoder().encode(serializeVenue(venue)).length;

  const parsed = VenueSchema.safeParse(venue);
  if (!parsed.success)
    for (const i of parsed.error.issues)
      errors.push({ rule: "schema", message: `${i.path.join(".") || "venue"}: ${i.message}` });

  const { cols, rows } = venue.grid;
  const mask = decodeWalkable(venue.walkable, cols, rows);
  const r = SEAT_WALKABLE_RADIUS;
  for (const s of venue.seats) {
    let found = false;
    for (let y = Math.max(0, s.cell.y - r); y <= Math.min(rows - 1, s.cell.y + r) && !found; y++)
      for (let x = Math.max(0, s.cell.x - r); x <= Math.min(cols - 1, s.cell.x + r); x++)
        if (mask[cellIndex({ x, y }, cols)] === 1) {
          found = true;
          break;
        }
    if (!found) errors.push({ rule: "R3", message: `Seat ${s.id} has no walkable cell within ${r} cells` });
  }

  if (bytes > EXPORT_WARN_BYTES)
    warnings.push({
      rule: "R4",
      message: `venue.json is ${(bytes / 1024).toFixed(1)} KiB; the Arkiv payload cap is 128 KiB`,
    });

  for (const z of venue.zones)
    if (!venue.pois.some((p) => p.kind === "help-desk" && p.zone === z.id))
      errors.push({ rule: "R6", message: `Zone ${z.id} has no help-desk POI` });

  const known = new Set(config.partners.map((p) => p.id));
  for (const id of known)
    if (!venue.pois.some((p) => p.kind === "partner-table" && p.partner === id))
      errors.push({ rule: "R7", message: `Partner ${id} has no partner-table POI` });
  for (const p of venue.pois)
    if (p.kind === "partner-table" && p.partner !== undefined && !known.has(p.partner))
      errors.push({ rule: "R7", message: `POI ${p.id} names unknown partner ${p.partner}` });

  return { errors, warnings, bytes };
}
