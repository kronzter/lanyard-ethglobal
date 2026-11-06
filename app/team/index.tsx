import { str as arkivString } from "@arkiv-network/sdk";
import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
import { styles } from "@/shell/styles";

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
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}
    >
      <Text style={styles.h2}>Your project</Text>
      {!team ? (
        <Text>Select your team-lead role to edit and submit.</Text>
      ) : (
        <>
          <Link href={`/teams/${team}`}>{team} · Public team page</Link>
          <WinnerBadge team={team} />
          <Text style={styles.muted}>
            Your submission seals these details. Later draft edits cannot change the submitted project.
          </Text>
          <View style={styles.card}>
            <Text>Project title</Text>
            <TextInput
              accessibilityLabel="Project title"
              style={styles.input}
              value={loadedFor === identity ? page.title : ""}
              onChangeText={(title) => setPage({ ...page, title })}
            />
            <Text>Description</Text>
            <TextInput
              accessibilityLabel="Description"
              style={styles.input}
              multiline
              value={loadedFor === identity ? page.description : ""}
              onChangeText={(description) => setPage({ ...page, description })}
            />
            <Text>Members · one per line, up to four</Text>
            <TextInput
              accessibilityLabel="Members"
              style={styles.input}
              multiline
              value={loadedFor === identity ? page.members.join("\n") : ""}
              onChangeText={(members) => setPage({ ...page, members: members.split("\n") })}
            />
            {(["ethglobal", "repository", "demo", "video"] as const).map((k) => (
              <View key={k}>
                <Text>{k === "ethglobal" ? "ETHGlobal showcase · required for submission" : k}</Text>
                <TextInput
                  accessibilityLabel={k}
                  style={styles.input}
                  autoCapitalize="none"
                  value={loadedFor === identity ? (page.links[k] ?? "") : ""}
                  onChangeText={(v) => {
                    const links = { ...page.links };
                    if (v) links[k] = v;
                    else delete links[k];
                    setPage({ ...page, links });
                  }}
                />
              </View>
            ))}
            <Text>Track</Text>
            <View style={styles.wrap}>
              {providers.config.tracks.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.chip, track === t.id && styles.chipOn]}
                  onPress={() => setTrack(t.id)}
                >
                  <Text>{t.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy || loadedFor !== identity}
              onPress={() => void save(false)}
              style={styles.chip}
            >
              <Text>Save draft</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={
                busy ||
                loadedFor !== identity ||
                !draft ||
                sealed ||
                !evaluation ||
                evaluation.head.timestamp >= providers.config.times.submissionDeadline
              }
              onPress={() => void save(true)}
              style={styles.chip}
            >
              <Text>{sealed ? "Submitted" : "Seal submission"}</Text>
            </Pressable>
          </View>
          {draft && loadedFor === identity && (
            <Text selectable style={styles.muted}>
              Project {draft.key}
              {"\n"}Creator {draft.creator}
              {"\n"}Owner {draft.owner} · Block {String(draft.createdAt)}
            </Text>
          )}
          {submissions.map((r) => (
            <Text
              key={r.key}
              selectable
              style={evaluation?.view.verdict(r.key)?.counts ? styles.mono : styles.muted}
            >
              Submission {r.key}
              {"\n"}Creator {r.creator}
              {"\n"}Observed owner {r.obs.owner} · Block {String(r.obs.createdAtBlock)}
              {"\n"}
              {evaluation?.view.verdict(r.key)?.reason ?? "Counted"}
            </Text>
          ))}
        </>
      )}
      {(message || error) && <Text accessibilityRole="alert">{message || error}</Text>}
    </ScrollView>
  );
}
