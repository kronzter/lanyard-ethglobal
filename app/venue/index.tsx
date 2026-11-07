import { useMemo, useState } from "react";
import { View } from "react-native";
import mumbaiJson from "../../fixtures/venue.mumbai.json";
import { providers } from "@/providers";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { parseVenue } from "@/shared/types/venue";
import { Banner, Card, Chip, Row, Screen, Txt } from "@/ui";

const VENUES = {
  small: { label: "Small test hall", load: fixtureVenue },
  mumbai: { label: "Mumbai hall (draft)", load: () => parseVenue(mumbaiJson) },
} as const;
type VenueId = keyof typeof VENUES;

// Until A3 builds the editor, this screen previews the P0.5 stub map on the fixture venues:
// tap a seat to highlight it and draw the route from its zone's help desk.
export default function VenuePreview() {
  const [venueId, setVenueId] = useState<VenueId>("small");
  const venue = useMemo(() => VENUES[venueId].load(), [venueId]);
  const VenueMap = providers.venueMap();
  const [seatId, setSeatId] = useState<string | null>(null);
  const seat = venue.seats.find((s) => s.id === seatId);
  const desk = seat && venue.pois.find((p) => p.kind === "help-desk" && p.zone === seat.zone);
  const path = seat && desk ? providers.router().path(venue, desk.cell, seat.cell) : null;

  return (
    <Screen
      title="Venue"
      subtitle="Floor plan, seats and help desks. Tap a seat to see the walking route from its help desk."
      maxWidth={1040}
    >
      <Row gap={6}>
        {(Object.keys(VENUES) as VenueId[]).map((id) => (
          <Chip
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: id === venueId }}
            onPress={() => {
              setVenueId(id);
              setSeatId(null);
            }}
            selected={id === venueId}
            label={VENUES[id].label}
          />
        ))}
      </Row>
      <Card padded={false}>
        <VenueMap
          venue={venue}
          highlight={seat && desk ? [seat.id, desk.id] : []}
          path={path}
          onSeatTap={setSeatId}
        />
      </Card>
      <Row gap={12}>
        <Legend color="#A5A8B8" label="Seat" />
        <Legend color="#10B981" label="Help desk" square />
        <Legend color="#F59E0B" label="Selected" />
        <Legend color="#4F46E5" label="Walking path" line />
      </Row>
      <Banner icon="pin" testID="venue-preview-status">
        {`${venue.seats.length} seats · ${
          seat
            ? path
              ? `Seat ${seat.id}: ${path.length - 1} steps from ${desk!.name}`
              : `Seat ${seat.id}: no walking route`
            : "Tap a seat"
        }`}
      </Banner>
    </Screen>
  );
}

function Legend({
  color,
  label,
  square,
  line,
}: {
  color: string;
  label: string;
  square?: boolean;
  line?: boolean;
}) {
  return (
    <Row gap={6}>
      <View
        style={{
          width: line ? 18 : 10,
          height: line ? 3 : 10,
          borderRadius: square ? 3 : 5,
          backgroundColor: color,
        }}
      />
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
    </Row>
  );
}
