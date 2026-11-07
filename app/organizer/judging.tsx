import { useState } from "react";
import { Platform } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { buildCreate, type KindInputs } from "@/arkiv/writers";
import { describeSubmit } from "@/arkiv/ui";
import { providers } from "@/providers";
import { str } from "@/rules/decode";
import {
  Banner,
  Button,
  Card,
  Center,
  Chip,
  EmptyState,
  Field,
  IconBubble,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Step,
  Txt,
  messageTone,
} from "@/ui";
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
  if (Platform.OS !== "web")
    return (
      <Center>
        <EmptyState icon="monitor" tone="accent" title="Open on web" />
      </Center>
    );
  const records = evaluation?.view.records("submission") ?? [];
  const rubrics = evaluation?.view.records("rubric") ?? [];
  return (
    <Screen
      title="Judging desk"
      subtitle="Accept immutable submissions, freeze track rubrics, and assign judges. Scores stay sealed until publication."
      maxWidth={900}
    >
      <SectionHeader title="Track" icon="star" />
      <Row gap={6}>
        {providers.config.tracks.map((t) => (
          <Chip key={t.id} label={t.name} selected={t.id === track} onPress={() => setTrack(t.id)} />
        ))}
      </Row>
      <Card>
        <Step n={1} title="Track rubric" right={<Pill label={track} tone="accent" />} />
        <Field
          accessibilityLabel="Rubric JSON"
          mono
          multiline
          value={rubricText}
          onChangeText={setRubricText}
        />
        <Button
          variant="primary"
          icon="lock"
          label="Publish rubric"
          disabled={busy}
          onPress={() => {
            try {
              void write("rubric", { track, rubric: RubricSchema.parse(parseJsonStrict(rubricText)) });
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        />
      </Card>
      <Card>
        <Step
          n={2}
          title="Submission acceptance"
          right={<Pill label={`${records.length} submitted`} tone="muted" />}
        />
        {records.length === 0 && (
          <Txt variant="caption" tone="muted">
            No submissions yet.
          </Txt>
        )}
        {records.map((r) => {
          const counts = evaluation?.view.verdict(r.key)?.counts;
          return (
            <ListRow
              key={r.key}
              onPress={() => {
                setSubmission(r.key);
                setTrack(str(r, "track") ?? "main");
              }}
              selected={submission === r.key}
              dim={!counts}
              left={<IconBubble name="star" tone={counts ? "accent" : "muted"} size={34} />}
              title={`${str(r, "team")} · ${str(r, "track")}`}
              subtitle={
                <Stackv gap={2}>
                  <Txt variant="caption" tone="faint" mono>
                    {r.key}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {evaluation?.view.verdict(r.key)?.reason ?? "Eligible submission"}
                  </Txt>
                </Stackv>
              }
            />
          );
        })}
        <Field
          label="Submission key"
          accessibilityLabel="Submission key"
          mono
          placeholder="0x… (tap a submission above)"
          value={submission}
          onChangeText={setSubmission}
        />
        <Button
          variant="primary"
          icon="check"
          label="Accept submission"
          disabled={busy || !isHex(submission, 32)}
          onPress={() => void write("acceptance", { submission: submission as `0x${string}`, track })}
        />
      </Card>
      <Card>
        <Step n={3} title="Judge assignment" />
        <Field
          label="Frozen rubric key"
          accessibilityLabel="Rubric key"
          mono
          placeholder="0x… (tap a rubric below)"
          value={rubric}
          onChangeText={setRubric}
        />
        {rubrics.map((r) => (
          <ListRow
            key={r.key}
            onPress={() => setRubric(r.key)}
            selected={rubric === r.key}
            title={<Pill label={str(r, "track") ?? "track"} tone="accent" />}
            subtitle={
              <Txt variant="caption" tone="muted" mono>
                {r.key} · {evaluation?.view.verdict(r.key)?.reason ?? "Frozen"}
              </Txt>
            }
          />
        ))}
        <Field
          label="Judge label"
          accessibilityLabel="Judge label"
          placeholder="ana.judges.arkiv.partners"
          value={judge}
          onChangeText={setJudge}
          autoCapitalize="none"
        />
        <Button
          variant="primary"
          icon="gavel"
          label="Assign judge"
          disabled={busy || !isHex(submission, 32) || !isHex(rubric, 32) || !judge}
          onPress={() =>
            void write("judge_assignment", {
              submission: submission as `0x${string}`,
              rubric: rubric as `0x${string}`,
              judge,
            })
          }
        />
      </Card>
      {message || error ? (
        <Banner accessibilityRole="alert" tone={messageTone(message || error || "")}>
          {message || error}
        </Banner>
      ) : null}
    </Screen>
  );
}
