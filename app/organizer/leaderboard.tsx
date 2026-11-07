import { useEffect, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { useEvaluation } from "@/arkiv/app-hooks";
import { publishedBundle } from "@/arkiv/published";
import { providers } from "@/providers";
import type { TrackRanking } from "@/rules/rankings";
import { styles } from "@/shell/styles";
export default function Leaderboard() {
  const { evaluation, error } = useEvaluation();
  const [rankings, setRankings] = useState<TrackRanking[] | null>(null);
  const [status, setStatus] = useState("Checking publication…");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    void publishedBundle(providers.config, providers.ensReader(), async (uri) => {
      const r = await fetch(uri);
      if (!r.ok) throw new Error(`Bundle HTTP ${r.status}`);
      return r.text();
    })
      .then((bundle) => {
        if (active) {
          setRankings(bundle?.output.rankings ?? null);
          setStatus(
            bundle
              ? "Verified published bundle · frozen cutoff"
              : "Scores are sealed. Rankings become available after freeze.",
          );
        }
      })
      .catch((e) => {
        if (active) {
          setRankings(null);
          setStatus(`Published evidence unavailable: ${(e as Error).message}`);
        }
      });
    return () => {
      active = false;
    };
  }, [generation]);
  const assignments =
    evaluation?.view.records("judge_assignment").filter((r) => evaluation.view.verdict(r.key)?.counts) ?? [];
  const finals = evaluation?.view.records("final_score") ?? [];
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 900, width: "100%", alignSelf: "center" }}
    >
      <Text style={styles.h2}>Judging progress</Text>
      <Text>{status}</Text>
      <Pressable style={styles.chip} onPress={() => setGeneration((g) => g + 1)}>
        <Text>Check publication</Text>
      </Pressable>
      {!rankings ? (
        <View style={styles.card}>
          <Text>
            {assignments.length} valid assignments ·{" "}
            {finals.filter((r) => evaluation?.view.verdict(r.key)?.counts).length} eligible final records
          </Text>
          {finals
            .filter((r) => !evaluation?.view.verdict(r.key)?.counts)
            .map((r) => (
              <Text key={r.key} style={styles.muted}>
                {r.key}: {evaluation?.view.verdict(r.key)?.reason}
              </Text>
            ))}
          <Text>{error}</Text>
        </View>
      ) : (
        rankings.map((track) => (
          <View key={track.track} style={styles.card}>
            <Text style={styles.h3}>{track.track}</Text>
            {track.projects.map((p) => (
              <Text key={p.submission}>
                {p.rank ? `${p.rank}. ` : "Unranked · "}
                {p.team}
                {p.displayHundredths !== undefined
                  ? ` · ${p.displayHundredths / 100n}.${(p.displayHundredths % 100n).toString().padStart(2, "0")}`
                  : " · no counted judges"}{" "}
                · {p.judgeCount} judges{p.spread ? " · score spread flagged" : ""}
              </Text>
            ))}
          </View>
        ))
      )}
      <Text style={styles.muted}>
        Rankings reproduce operator-attested captured evidence; completeness is unproven. Prize allocation is
        a separately disclosed manual input. Later revocations do not change frozen rankings.
      </Text>
    </ScrollView>
  );
}
