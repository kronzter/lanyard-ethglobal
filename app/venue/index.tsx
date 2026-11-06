import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { providers } from "@/providers";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { Placeholder } from "@/shell/Placeholder";

// Until A3 builds the editor, this screen previews the P0.5 stub map on the small fixture venue:
// tap a seat to highlight it and draw the route from its zone's help desk.
export default function Screen() {
  const venue = useMemo(() => fixtureVenue(), []);
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
      <View style={{ width: "100%", maxWidth: 800 }}>
        <VenueMap
          venue={venue}
          highlight={seat && desk ? [seat.id, desk.id] : []}
          path={path}
          onSeatTap={setSeatId}
        />
      </View>
      <Text testID="venue-preview-status">
        {seat
          ? path
            ? `Seat ${seat.id}: ${path.length - 1} steps from ${desk!.name}`
            : `Seat ${seat.id}: no walking route`
          : "Tap a seat"}
      </Text>
    </ScrollView>
  );
}
