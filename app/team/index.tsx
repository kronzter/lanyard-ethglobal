import { str as arkivString } from "@arkiv-network/sdk";
import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { scanKind, type LanyardRecord } from "@/arkiv/readers";
import { KINDS } from "@/arkiv/kinds";
import { buildCreate } from "@/arkiv/writers";
import { describeSubmit } from "@/arkiv/ui";
import { canonicalBytes, parseJsonStrict } from "@/shared/canonical";
import { isTeamLabel } from "@/shared/labels";
import { validateTeamPageContent, type TeamPageContent } from "@/shared/types/team-page";
import { providers } from "@/providers";
import { str } from "@/rules/decode";
import {
  Banner,
  Button,
  Card,
  Chip,
  Disclosure,
  Divider,
  EmptyState,
  Field,
  IconBubble,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Txt,
  messageTone,
} from "@/ui";

const empty: TeamPageContent = { title: "", description: "", members: [], links: {} };
export default function Team() {
  const { evaluation, error, refresh } = useEvaluation();
  const { queue, context, address, byLabel } = useWriter();
  const team = byLabel && isTeamLabel(byLabel) ? byLabel : null;
  const [draft, setDraft] = useState<LanyardRecord | null>(null);
  const [page, setPage] = useState(empty);
  const [track, setTrack] = useState("main");
  const [loadedFor, setLoadedFor] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const identity = `${address}:${team}`;
  useEffect(() => {
    let cancelled = false;
    setLoadedFor("");
    setDraft(null);
    setPage(empty);
    setMessage("");
    if (!team || !address) return;
    void (async () => {
      const result = await scanKind(
        providers.arkiv().reader,
        providers.config.edition,
        "project",
        { team: arkivString(team) },
        { creator: address },
      );
      if (!result.complete || result.skipped) throw new Error("Project scan is incomplete");
      const latest = result.records
        .filter((r) => r.owner === address)
        .sort((a, b) =>
          a.updatedAt === b.updatedAt ? a.key.localeCompare(b.key) : a.updatedAt > b.updatedAt ? -1 : 1,
        )[0];
      if (cancelled) return;
      if (latest) {
        const raw = String(latest.values.content);
        const content = parseJsonStrict(
          new TextDecoder().decode(Uint8Array.from(raw.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16))),
        ) as { page: unknown };
        setPage(validateTeamPageContent(content.page));
        setTrack(String(latest.values.track));
        setDraft(latest);
      }
      setLoadedFor(identity);
    })().catch((e) => {
      if (!cancelled) setMessage((e as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [team, address, identity]);
  const submissions = evaluation?.view.records("submission").filter((r) => str(r, "team") === team) ?? [];
  const sealed = submissions.some((r) => evaluation?.view.verdict(r.key)?.counts);
  const save = async (seal: boolean) => {
    const ctx = context(evaluation?.head);
    if (!queue || !ctx || !team || !address || !evaluation || loadedFor !== identity) return;
    setBusy(true);
    setMessage("");
    try {
      const content = { page: validateTeamPageContent(page) };
      if (seal) {
        if (!draft) throw new Error("Save your project before submitting");
        const result = await queue.submit("Submit immutable project", {
          creates: [
            buildCreate("submission", ctx, { project: draft.key, team, track, lead: address, content }),
          ],
        });
        setMessage(describeSubmit(result));
      } else {
        const result = await queue.submit(
          "Save project draft",
          draft
            ? {
                patches: [
                  {
                    schema: KINDS.project.schema,
                    entityKey: draft.key,
                    set: { track, content: canonicalBytes(content) },
                  },
                ],
              }
            : { creates: [buildCreate("project", ctx, { team, track, content })] },
        );
        if ((result.status === "verified" || result.status === "confirmed") && !draft) {
          const records = await scanKind(
            providers.arkiv().reader,
            providers.config.edition,
            "project",
            { team: arkivString(team) },
            { creator: address },
          );
          setDraft(records.records.find((r) => result.created.includes(r.key)) ?? null);
        }
        setMessage(describeSubmit(result));
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const WinnerBadge = providers.winnerBadge();
  const LINK_FIELDS = {
    ethglobal: "ETHGlobal showcase",
    repository: "Source",
    demo: "Live demo",
    video: "Demo video",
  };
  const deadlinePassed =
    !!evaluation && evaluation.head.timestamp >= providers.config.times.submissionDeadline;
  return (
    <Screen
      title="My project"
      subtitle={team ? undefined : "Team leads edit and submit here."}
      right={sealed ? <Pill label="Submitted" tone="success" icon="check" /> : null}
    >
      {!team ? (
        <Card>
          <EmptyState
            icon="star"
            title="Choose your team-lead role"
            body="Select your team-lead role to edit and submit."
          />
        </Card>
      ) : (
        <>
          <Card>
            <Row wrap={false} gap={12}>
              <IconBubble name="users" />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="h2">{team}</Txt>
                <Link href={`/teams/${team}`}>
                  <Txt variant="caption" tone="accent">
                    {team} · Public team page
                  </Txt>
                </Link>
              </View>
            </Row>
            <WinnerBadge team={team} />
          </Card>
          <Banner icon="lock">
            Your submission seals these details. Later draft edits cannot change the submitted project.
          </Banner>
          <Card>
            <Field
              label="Project title"
              accessibilityLabel="Project title"
              value={loadedFor === identity ? page.title : ""}
              onChangeText={(title) => setPage({ ...page, title })}
            />
            <Field
              label="Description"
              accessibilityLabel="Description"
              multiline
              value={loadedFor === identity ? page.description : ""}
              onChangeText={(description) => setPage({ ...page, description })}
            />
            <Field
              label="Members"
              hint="One per line, up to four."
              accessibilityLabel="Members"
              multiline
              value={loadedFor === identity ? page.members.join("\n") : ""}
              onChangeText={(members) => setPage({ ...page, members: members.split("\n") })}
            />
            <Divider />
            <SectionHeader title="Links" icon="link" />
            {(["ethglobal", "repository", "demo", "video"] as const).map((k) => (
              <Field
                key={k}
                label={LINK_FIELDS[k]}
                {...(k === "ethglobal" ? { hint: "Required for submission." } : {})}
                accessibilityLabel={k}
                autoCapitalize="none"
                placeholder="https://…"
                value={loadedFor === identity ? (page.links[k] ?? "") : ""}
                onChangeText={(v) => {
                  const links = { ...page.links };
                  if (v) links[k] = v;
                  else delete links[k];
                  setPage({ ...page, links });
                }}
              />
            ))}
            <Divider />
            <SectionHeader title="Track" icon="star" />
            <Row gap={6}>
              {providers.config.tracks.map((t) => (
                <Chip key={t.id} label={t.name} selected={track === t.id} onPress={() => setTrack(t.id)} />
              ))}
            </Row>
            <Row gap={8} style={{ marginTop: 4 }}>
              <Button
                accessibilityRole="button"
                disabled={busy || loadedFor !== identity}
                onPress={() => void save(false)}
                label="Save draft"
              />
              <Button
                accessibilityRole="button"
                variant={sealed ? "success" : "primary"}
                icon={sealed ? "check" : "lock"}
                disabled={busy || loadedFor !== identity || !draft || sealed || !evaluation || deadlinePassed}
                onPress={() => void save(true)}
                label={sealed ? "Submitted" : "Seal submission"}
              />
            </Row>
          </Card>
          {((draft && loadedFor === identity) || submissions.length > 0) && (
            <Disclosure title="Evidence" icon="shield">
              {draft && loadedFor === identity && (
                <Stackv gap={2}>
                  <Txt variant="label" tone="muted">
                    Project draft
                  </Txt>
                  <Txt selectable mono tone="muted">
                    Project {draft.key}
                    {"\n"}Creator {draft.creator}
                    {"\n"}Owner {draft.owner} · Block {String(draft.createdAt)}
                  </Txt>
                </Stackv>
              )}
              {submissions.map((r) => {
                const counts = evaluation?.view.verdict(r.key)?.counts;
                return (
                  <ListRow
                    key={r.key}
                    dim={!counts}
                    title={
                      <Pill
                        label={counts ? "Counted" : "Not counted"}
                        tone={counts ? "success" : "muted"}
                        dot
                      />
                    }
                    subtitle={
                      <Txt selectable mono tone={counts ? "text" : "muted"}>
                        Submission {r.key}
                        {"\n"}Creator {r.creator}
                        {"\n"}Observed owner {r.obs.owner} · Block {String(r.obs.createdAtBlock)}
                        {"\n"}
                        {evaluation?.view.verdict(r.key)?.reason ?? "Counted"}
                      </Txt>
                    }
                  />
                );
              })}
            </Disclosure>
          )}
        </>
      )}
      {(message || error) && (
        <Banner accessibilityRole="alert" tone={messageTone(message || error || "")}>
          {message || error}
        </Banner>
      )}
    </Screen>
  );
}
