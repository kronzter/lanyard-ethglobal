// Public team page (plans/01-evidence-and-interfaces.md §3a). No wallet, no role gate.
// P0 stub on fixture data; B4 owns the real page, reading the earliest valid captured
// submission and, after publication, the verified frozen bundle.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Linking } from "react-native";
import { useEffect, useState } from "react";
import { useEvaluation } from "@/arkiv/app-hooks";
import { publishedBundle } from "@/arkiv/published";
import { submissionContent } from "@/rules/kinds/judging";
import { decodeRecord, str } from "@/rules/decode";
import { isTeamLabel } from "@/shared/labels";
import { toFullName } from "@/shared/labels";
import { teamPageUrl, type TeamPageLinks, type TeamPageState } from "@/shared/types/team-page";
import { providers } from "@/providers";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Icon,
  type IconName,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Txt,
  useTheme,
} from "@/ui";

const LINK_LABELS: [keyof TeamPageLinks, string][] = [
  ["ethglobal", "ETHGlobal"],
  ["repository", "Source"],
  ["demo", "Live demo"],
  ["video", "Demo video"],
];

const LINK_ICONS: Record<keyof TeamPageLinks, IconName> = {
  ethglobal: "star",
  repository: "list",
  demo: "monitor",
  video: "monitor",
};

function Body({ state }: { state: TeamPageState }) {
  const names = { edition: providers.config.edition, baseName: providers.config.baseName };
  switch (state.status) {
    case "loading":
      return (
        <Card>
          <ActivityIndicator accessibilityLabel="Loading team" />
        </Card>
      );
    case "unknown-team":
      return (
        <Card>
          <EmptyState
            icon="users"
            title="Team not found"
            body={`No team named “${state.team}” is registered for ${names.edition}.`}
          />
        </Card>
      );
    case "unavailable":
      return (
        <Banner tone="danger" accessibilityRole="alert" title="Unavailable">
          {`Team details are unavailable right now: ${state.reason}.`}
        </Banner>
      );
    case "awaiting-submission":
      return (
        <Card>
          <Stackv gap={4}>
            <Txt variant="display">{state.team}</Txt>
            <Txt tone="muted" mono>
              {toFullName(state.team, names)}
            </Txt>
          </Stackv>
          <Banner icon="clock">Project details coming soon.</Banner>
        </Card>
      );
    case "published": {
      const { content } = state;
      const track = providers.config.tracks.find((t) => t.id === state.track)?.name ?? state.track;
      return (
        <Stackv gap={16}>
          <Card>
            <Row gap={8}>
              <Pill label={`${track} track`} tone="accent" />
              <Pill label="Submitted" tone="success" icon="check" />
            </Row>
            <Txt variant="display">{content.title}</Txt>
            <Txt tone="muted" mono>
              {toFullName(state.team, names)} · {track} track
            </Txt>
            {state.winner ? (
              <Banner tone="warning" icon="trophy" title="Winner">
                {state.winner.prizes.join(", ")}
              </Banner>
            ) : null}
            <Txt style={{ lineHeight: 22 }}>{content.description}</Txt>
          </Card>
          {content.members.length > 0 ? (
            <Card>
              <SectionHeader title="Team" icon="users" />
              <Row gap={8}>
                {content.members.map((m) => (
                  <Pill key={m} label={m} tone="neutral" icon="user" />
                ))}
              </Row>
            </Card>
          ) : null}
          <Row gap={8}>
            {LINK_LABELS.filter(([key]) => content.links[key] !== undefined).map(([key, label]) => (
              <Button
                key={key}
                accessibilityRole="link"
                icon={LINK_ICONS[key]}
                variant={key === "ethglobal" ? "primary" : "secondary"}
                label={label}
                onPress={() => Linking.openURL(content.links[key]!)}
              />
            ))}
          </Row>
        </Stackv>
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
  const { c } = useTheme();
  return (
    <Screen navTitle={team || "Team"}>
      <Body state={state} />
      {state.status !== "unknown-team" ? (
        <Row gap={6} wrap={false}>
          <Icon name="link" size={14} color={c.faint} />
          <Txt variant="caption" tone="faint" selectable style={{ flex: 1 }}>
            {teamPageUrl(state.team, origin)}
          </Txt>
        </Row>
      ) : null}
    </Screen>
  );
}
