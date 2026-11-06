// The venue map's props (plans/P0-foundation.md › P0.5-R5, A3-venue-routing.md › A3.3-R1).
// The P0.5 stub and A3.3's real map both take exactly these, so Track B screens never change
// when I3 swaps one for the other. Screens get the component from src/providers.ts.
import type { Cell, Venue } from "../types/venue";

export type VenueMapProps = {
  venue: Venue;
  /** Seat or POI IDs to emphasize and label. Unknown IDs are ignored. */
  highlight?: readonly string[];
  /** Walking path to draw, as returned by `Router.path`; null or empty draws nothing. */
  path?: readonly Cell[] | null;
  /** Called with the seat ID when a seat is tapped. */
  onSeatTap?: (seatId: string) => void;
};
