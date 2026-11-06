// Public team page (plans/01-evidence-and-interfaces.md §3a). No wallet, no role gate.
// P0 stub on fixture data; B4 owns the real page, reading the earliest valid captured
// submission and, after publication, the verified frozen bundle.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { useEvaluation } from "@/arkiv/app-hooks";
import { publishedBundle } from "@/arkiv/published";
import { submissionContent } from "@/rules/kinds/judging";
import { decodeRecord, str } from "@/rules/decode";
import { isTeamLabel } from "@/shared/labels";
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
  const { evaluation, error } = useEvaluation();
  const [resolved, setResolved] = useState<TeamPageState>({ status: "loading", team });
  useEffect(() => {
    let cancelled = false;
    setResolved({ status: "loading", team });
    void (async (): Promise<TeamPageState> => {
      if (!isTeamLabel(team)) return { status: "unknown-team", team };
      const ens = providers.ensReader();
      const bundle = await publishedBundle(providers.config, ens, async (uri) => {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Bundle HTTP ${response.status}`);
        return response.text();
      });
      if (bundle) {
        const verdicts = new Map(bundle.output.verdicts.map((v) => [v.key, v]));
        const selected = bundle.envelope.body.records
          .flatMap((o) => {
            const r = decodeRecord(o);
            return r.ok ? [r.record] : [];
          })
          .find((r) => r.kind === "submission" && str(r, "team") === team && verdicts.get(r.key)?.counts);
        if (!selected) return { status: "awaiting-submission", team };
        const parsed = submissionContent(selected);
        if (!parsed.success) throw new Error("Committed submission content is unavailable");
        const prize = bundle.envelope.body.prizes.find((p) => p.team === team);
        return {
          status: "published",
          team,
          track: parsed.data.track,
          content: parsed.data.content.page,
          winner: prize ? { prizes: prize.prizes } : null,
        };
      }
      if (error) throw new Error(error);
      if (!evaluation) return { status: "loading", team };
      const owner = await ens.owner(team, { sepoliaBlock: evaluation.context.sepoliaCutoff.number });
      if (!owner) return { status: "unknown-team", team };
      const selected = evaluation.view
        .records("submission")
        .find((r) => str(r, "team") === team && evaluation.view.verdict(r.key)?.counts);
      if (!selected) return { status: "awaiting-submission", team };
      const parsed = submissionContent(selected);
      if (!parsed.success) throw new Error("Submission content is unavailable");
      return {
        status: "published",
        team,
        track: parsed.data.track,
        content: parsed.data.content.page,
        winner: null,
      };
    })()
      .then((s) => {
        if (!cancelled) setResolved(s);
      })
      .catch((e) => {
        if (!cancelled) setResolved({ status: "unavailable", team, reason: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [team, evaluation, error]);
  const state: TeamPageState = resolved.team === team ? resolved : { status: "loading", team };
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
