import { useEffect, useState } from "react";
import { View } from "react-native";
import { useEvaluation } from "@/arkiv/app-hooks";
import { publishedBundle } from "@/arkiv/published";
import { providers } from "@/providers";
import type { TrackRanking } from "@/rules/rankings";
import {
  Avatar,
  Banner,
  Button,
  Card,
  IconBubble,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Stat,
  Txt,
  shortKey,
} from "@/ui";
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
  const eligible = finals.filter((r) => evaluation?.view.verdict(r.key)?.counts).length;
  const published = status.startsWith("Verified");
  return (
    <Screen title="Judging progress" maxWidth={900}>
      <Banner
        tone={published ? "success" : status.startsWith("Published evidence") ? "danger" : "neutral"}
        icon={published ? "check" : "lock"}
      >
        {status}
      </Banner>
      <Button
        variant="ghost"
        icon="refresh"
        label="Check publication"
        onPress={() => setGeneration((g) => g + 1)}
      />
      {!rankings ? (
        <Stackv gap={12}>
          <Row gap={12} align="stretch">
            <Stat label="valid assignments" value={assignments.length} />
            <Stat label="eligible final records" value={eligible} tone="success" />
          </Row>
          {finals
            .filter((r) => !evaluation?.view.verdict(r.key)?.counts)
            .map((r) => (
              <ListRow
                key={r.key}
                dim
                tone="muted"
                left={<IconBubble name="x" tone="muted" size={32} />}
                title={
                  <Txt mono tone="muted">
                    {shortKey(r.key)}
                  </Txt>
                }
                subtitle={`${r.key}: ${evaluation?.view.verdict(r.key)?.reason ?? ""}`}
              />
            ))}
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </Stackv>
      ) : (
        rankings.map((track) => (
          <Card key={track.track}>
            <SectionHeader title={`${track.track} track`} icon="trophy" />
            {track.projects.map((p) => {
              const score =
                p.displayHundredths !== undefined
                  ? `${p.displayHundredths / 100n}.${(p.displayHundredths % 100n).toString().padStart(2, "0")}`
                  : null;
              const medal =
                p.rank === 1 ? "warning" : p.rank === 2 ? "muted" : p.rank === 3 ? "accent" : "neutral";
              return (
                <Row key={p.submission} wrap={false} gap={12}>
                  <Avatar letter={p.rank ? String(p.rank) : "–"} tone={medal} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="h3">
                      {p.rank ? `${p.rank}. ` : "Unranked · "}
                      {p.team}
                    </Txt>
                    <Row gap={6}>
                      <Txt variant="caption" tone="muted">
                        {p.judgeCount} judges
                      </Txt>
                      {p.spread ? <Pill label="score spread flagged" tone="warning" icon="alert" /> : null}
                    </Row>
                  </View>
                  <Txt variant="h2" num tone={score ? "text" : "faint"}>
                    {score ?? "no counted judges"}
                  </Txt>
                </Row>
              );
            })}
          </Card>
        ))
      )}
      <Txt variant="caption" tone="muted">
        Rankings reproduce operator-attested captured evidence; completeness is unproven. Prize allocation is
        a separately disclosed manual input. Later revocations do not change frozen rankings.
      </Txt>
    </Screen>
  );
}
