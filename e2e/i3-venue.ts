// Shared I3 venue facts for the seed and the e2e test: the Mumbai venue as published, checked the way
// the organizer screen checks it, and where its live record is recorded.
import { keccak256 } from "viem";
import venueMumbai from "../fixtures/venue.mumbai.json";
import { venueProblems } from "../src/arkiv/seat-import";
import { canonicalBytes } from "../src/shared/canonical";
import { sepoliaEventConfig as config } from "../src/shared/live-event.config";

export const VENUE_VERSION = "mumbai-i3";
export const SEPOLIA_VENUE_FILE = "fixtures/sepolia-venue.json";
/** Venue records must stay small enough to read on a phone (I3 bug hunt: under 128 KiB). */
export const MAX_VENUE_BYTES = 128 * 1024;
/** The Mumbai venue checked the way the organizer screen checks it, with its exact record bytes. */
export function mumbaiVenue() {
  const { venue, problems } = venueProblems(venueMumbai, config);
  if (!venue || problems.length)
    throw new Error(`venue.mumbai.json is not publishable:\n${problems.join("\n")}`);
  const bytes = canonicalBytes(venueMumbai);
  if (bytes.length > MAX_VENUE_BYTES)
    throw new Error(`venue record is ${bytes.length} bytes > ${MAX_VENUE_BYTES}`);
  return { venue, bytes, hash: keccak256(bytes) };
}
