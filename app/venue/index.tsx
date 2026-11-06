import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import mumbaiJson from "../../fixtures/venue.mumbai.json";
import { providers } from "@/providers";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { parseVenue } from "@/shared/types/venue";
import { Placeholder } from "@/shell/Placeholder";
import { styles } from "@/shell/styles";

const VENUES = {
  small: { label: "Small test hall", load: fixtureVenue },
  mumbai: { label: "Mumbai hall (draft)", load: () => parseVenue(mumbaiJson) },
} as const;
type VenueId = keyof typeof VENUES;

// Until A3 builds the editor, this screen previews the P0.5 stub map on the fixture venues:
// tap a seat to highlight it and draw the route from its zone's help desk.
export default function Screen() {
  const [venueId, setVenueId] = useState<VenueId>("small");
  const venue = useMemo(() => VENUES[venueId].load(), [venueId]);
  const VenueMap = providers.venueMap();
  const [seatId, setSeatId] = useState<string | null>(null);
  const seat = venue.seats.find((s) => s.id === seatId);
  const desk = seat && venue.pois.find((p) => p.kind === "help-desk" && p.zone === seat.zone);
  const path = seat && desk ? providers.router().path(venue, desk.cell, seat.cell) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16, alignItems: "center" }}>
      <View style={{ height: 120, alignSelf: "stretch" }}>
        <Placeholder path="/venue" />
      </View>
      <View style={styles.wrap}>
        {(Object.keys(VENUES) as VenueId[]).map((id) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: id === venueId }}
            onPress={() => {
              setVenueId(id);
              setSeatId(null);
            }}
            style={[styles.chip, id === venueId && styles.chipOn]}
          >
            <Text>{VENUES[id].label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ width: "100%", maxWidth: 1000 }}>
        <VenueMap
          venue={venue}
          highlight={seat && desk ? [seat.id, desk.id] : []}
          path={path}
          onSeatTap={setSeatId}
        />
      </View>
      <Text testID="venue-preview-status">
        {`${venue.seats.length} seats · `}
        {seat
          ? path
            ? `Seat ${seat.id}: ${path.length - 1} steps from ${desk!.name}`
            : `Seat ${seat.id}: no walking route`
          : "Tap a seat"}
      </Text>
    </ScrollView>
  );
}
