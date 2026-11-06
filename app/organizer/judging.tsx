import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { buildCreate, type KindInputs } from "@/arkiv/writers";
import { describeSubmit } from "@/arkiv/ui";
import { providers } from "@/providers";
import { str } from "@/rules/decode";
import { styles } from "@/shell/styles";
import { isHex } from "@/shared/types/primitives";
import { parseJsonStrict } from "@/shared/canonical";
import { RubricSchema } from "@/rules/kinds/judging";

export default function Judging() {
  const { evaluation, error, refresh } = useEvaluation();
  const { queue, context } = useWriter();
  const [track, setTrack] = useState("main");
  const [submission, setSubmission] = useState("");
  const [rubric, setRubric] = useState("");
  const [judge, setJudge] = useState("");
  const [rubricText, setRubricText] = useState(
    '{"criteria":[{"id":"impact","name":"Impact","weight":1}],"scale":10}',
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function write<K extends "rubric" | "acceptance" | "judge_assignment">(
    kind: K,
    input: KindInputs[K],
  ) {
    const ctx = context(evaluation?.head);
    if (!queue || !ctx) {
      setMessage("Connect an authorized wallet and select its role.");
      return;
    }
    setBusy(true);
    try {
      setMessage(describeSubmit(await queue.submit(kind, { creates: [buildCreate(kind, ctx, input)] })));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  }
  if (Platform.OS !== "web") return <Text>Open on web</Text>;
  const records = evaluation?.view.records("submission") ?? [];
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 900, width: "100%", alignSelf: "center" }}
    >
      <Text style={styles.h2}>Judging desk</Text>
      <Text style={styles.muted}>
        Accept immutable submissions, freeze track rubrics, and assign judges. Scores stay sealed until
        publication.
      </Text>
      <View style={styles.wrap}>
        {providers.config.tracks.map((t) => (
          <Pressable
            key={t.id}
            style={[styles.chip, t.id === track && styles.chipOn]}
            onPress={() => setTrack(t.id)}
          >
            <Text>{t.name}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.card}>
        <Text style={styles.h3}>Track rubric</Text>
        <TextInput
          accessibilityLabel="Rubric JSON"
          style={styles.input}
          multiline
          value={rubricText}
          onChangeText={setRubricText}
        />
        <Pressable
          style={styles.chip}
          disabled={busy}
          onPress={() => {
            try {
              void write("rubric", { track, rubric: RubricSchema.parse(parseJsonStrict(rubricText)) });
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <Text>Publish rubric</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.h3}>Submission acceptance</Text>
        {records.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => {
              setSubmission(r.key);
              setTrack(str(r, "track") ?? "main");
            }}
            style={styles.row}
          >
            <Text style={evaluation?.view.verdict(r.key)?.counts ? undefined : styles.muted}>
              {str(r, "team")} · {str(r, "track")}
              {"\n"}
              {r.key}
              {"\n"}
              {evaluation?.view.verdict(r.key)?.reason ?? "Eligible submission"}
            </Text>
          </Pressable>
        ))}
        <TextInput
          accessibilityLabel="Submission key"
          style={styles.input}
          value={submission}
          onChangeText={setSubmission}
        />
        <Pressable
          style={styles.chip}
          disabled={busy || !isHex(submission, 32)}
          onPress={() => void write("acceptance", { submission: submission as `0x${string}`, track })}
        >
          <Text>Accept submission</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.h3}>Judge assignment</Text>
        <Text>Frozen rubric key</Text>
        <TextInput
          accessibilityLabel="Rubric key"
          style={styles.input}
          value={rubric}
          onChangeText={setRubric}
        />
        {(evaluation?.view.records("rubric") ?? []).map((r) => (
          <Pressable key={r.key} onPress={() => setRubric(r.key)}>
            <Text style={styles.muted}>
              {str(r, "track")} · {r.key} · {evaluation?.view.verdict(r.key)?.reason ?? "Frozen"}
            </Text>
          </Pressable>
        ))}
        <Text>Judge label</Text>
        <TextInput
          accessibilityLabel="Judge label"
          style={styles.input}
          value={judge}
          onChangeText={setJudge}
          autoCapitalize="none"
        />
        <Pressable
          style={styles.chip}
          disabled={busy || !isHex(submission, 32) || !isHex(rubric, 32) || !judge}
          onPress={() =>
            void write("judge_assignment", {
              submission: submission as `0x${string}`,
              rubric: rubric as `0x${string}`,
              judge,
            })
          }
        >
          <Text>Assign judge</Text>
        </Pressable>
      </View>
      <Text accessibilityRole="alert">{message || error}</Text>
    </ScrollView>
  );
}
