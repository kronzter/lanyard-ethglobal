// Public team page (plans/01-evidence-and-interfaces.md §3a). No wallet, no role gate.
// P0 stub on fixture data; B4 owns the real page, reading the earliest valid captured
// submission and, after publication, the verified frozen bundle.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { mockTeamPageState } from "@/shared/fixtures/team-pages";
import { toFullName } from "@/shared/labels";
import { teamPageUrl, type TeamPageLinks, type TeamPageState } from "@/shared/types/team-page";
import { providers } from "@/providers";

const LINK_LABELS: [keyof TeamPageLinks, string][] = [
  ["ethglobal", "ETHGlobal"],
  ["repository", "Source"],
  ["demo", "Live demo"],
  ["video", "Demo video"],
];

function Body({ state }: { state: TeamPageState }) {
  const names = { edition: providers.config.edition, baseName: providers.config.baseName };
  switch (state.status) {
    case "loading":
      return <ActivityIndicator accessibilityLabel="Loading team" />;
    case "unknown-team":
      return (
        <Text>
          No team named “{state.team}” is registered for {names.edition}.
        </Text>
      );
    case "unavailable":
      return <Text accessibilityRole="alert">Team details are unavailable right now: {state.reason}.</Text>;
    case "awaiting-submission":
      return (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 24, fontWeight: "600" }}>{state.team}</Text>
          <Text>{toFullName(state.team, names)}</Text>
          <Text>Project details coming soon.</Text>
        </View>
      );
    case "published": {
      const { content } = state;
      const track = providers.config.tracks.find((t) => t.id === state.track)?.name ?? state.track;
      return (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 24, fontWeight: "600" }}>{content.title}</Text>
          <Text>
            {toFullName(state.team, names)} · {track} track
          </Text>
          {state.winner ? <Text>Winner: {state.winner.prizes.join(", ")}</Text> : null}
          <Text>{content.description}</Text>
          {content.members.length > 0 ? <Text>Team: {content.members.join(", ")}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {LINK_LABELS.filter(([key]) => content.links[key] !== undefined).map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityRole="link"
                onPress={() => Linking.openURL(content.links[key]!)}
                style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Text>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      );
    }
  }
}

export default function TeamPage() {
  const { team = "" } = useLocalSearchParams<{ team: string }>();
  const state = mockTeamPageState(team);
  const origin = providers.deployments.sepolia.publicAppOrigin;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Body state={state} />
      {state.status !== "unknown-team" ? (
        <Text selectable style={{ opacity: 0.7 }}>
          {teamPageUrl(state.team, origin)}
        </Text>
      ) : null}
    </ScrollView>
  );
}
