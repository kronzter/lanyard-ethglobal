import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { str as arkivString, key as arkivKey } from "@arkiv-network/sdk";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { evaluateCurrent } from "@/arkiv/evaluate-current";
import { assignedJudgeRoute } from "@/arkiv/judge-route";
import { ScoreDrafts, draftKey, type DraftContext } from "@/arkiv/score-drafts";
import { scoreDraftStore } from "@/arkiv/score-draft-store";
import { scanKind } from "@/arkiv/readers";
import { buildCreate } from "@/arkiv/writers";
import { KINDS } from "@/arkiv/kinds";
import { describeSubmit } from "@/arkiv/ui";
import { providers } from "@/providers";
import { canonicalBytes } from "@/shared/canonical";
import { requireMeasured } from "@/shared/config/unmeasured";
import { freezeConfig } from "@/shared/config/hash";
import { sealScore, scoreAad } from "@/shared/crypto/score-cipher";
import type { Hex } from "@/shared/types/primitives";
import { payload, RubricSchema } from "@/rules/kinds/judging";
import { scoreValues } from "@/rules/scores";
import { ref, str } from "@/rules/decode";
import {
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  IconBubble,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Txt,
  messageTone,
  shortKey,
  useTheme,
} from "@/ui";

function ScoreEditor({
  context,
  rubric,
  onRefresh,
}: {
  context: DraftContext;
  rubric: ReturnType<typeof RubricSchema.parse>;
  onRefresh: () => void;
}) {
  const [scope] = useState(context);
  const writer = useWriter();
  const drafts = useMemo(() => new ScoreDrafts(scoreDraftStore()), []);
  const [values, setValues] = useState<Record<string, number>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [local, setLocal] = useState("Loading local draft…");
  const [remote, setRemote] = useState("Not synced to Arkiv");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const chain = useRef(Promise.resolve());
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    void drafts
      .load(scope)
      .then((v) => {
        if (active) {
          setValues(v ?? {});
          setInputs(Object.fromEntries(Object.entries(v ?? {}).map(([k, n]) => [k, (n / 100).toFixed(2)])));
          setLoaded(true);
          setSaved(true);
          setLocal(
            v
              ? "Restored from this device"
              : "No local draft. Enter each score; another device’s encrypted mirror cannot restore editable values.",
          );
        }
      })
      .catch((e) => {
        if (active) setLocal(`Local storage unavailable: ${(e as Error).message}`);
      });
    return () => {
      active = false;
    };
  }, [drafts, scope]);
  const edit = (criterion: string, text: string) => {
    if (!/^\d{0,3}(\.\d{0,2})?$/.test(text)) return;
    const next = { ...values };
    if (text === "" || text === ".") delete next[criterion];
    else {
      const [whole, fraction = ""] = text.split(".");
      const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (n > rubric.scale * 100) return;
      next[criterion] = n;
    }
    setInputs((previous) => ({ ...previous, [criterion]: text }));
    setValues(next);
    setSaved(false);
    setLocal("Saving on this device…");
    setRemote("Local edits not synced");
    const rev = ++revision.current;
    chain.current = chain.current.catch(() => undefined).then(() => drafts.save(scope, next));
    void chain.current
      .then(() => {
        if (rev === revision.current) {
          setSaved(true);
          setLocal("Saved on this device");
        }
      })
      .catch((e) => setLocal(`Not saved: ${(e as Error).message}`));
  };
  async function send(final: boolean) {
    if (!writer.queue || !writer.address || !writer.context() || !loaded || !saved) return;
    setBusy(true);
    try {
      await chain.current;
      const arkiv = providers.arkiv();
      if ((await writer.queue.reconcile()).length)
        throw new Error("An earlier wallet write is uncertain; reconcile it before sealing");
      const current = await evaluateCurrent({
        reader: arkiv.reader,
        ens: providers.ensReader(),
        config: providers.config,
      });
      if (
        current.view
          .records("final_score")
          .some(
            (r) =>
              str(r, "judge") === writer.byLabel &&
              ref(r, "submission") === scope.submission &&
              current.view.verdict(r.key)?.counts,
          )
      )
        throw new Error("An eligible final already exists. No new final was sent");
      if (current.head.timestamp >= providers.config.times.judgingEnd) throw new Error("Judging has ended");
      if (final) scoreValues({ schemaVersion: 1, values }, rubric);
      const cipher = requireMeasured(providers.config.scoreCipher, "score cipher");
      const scoreContext = {
        event: scope.event,
        submission: scope.submission,
        assignment: scope.assignment,
        rubric: scope.rubric,
        judge: writer.byLabel!,
      };
      const ciphertext = sealScore(
        cipher.publicKey,
        canonicalBytes({ schemaVersion: 1, values }),
        scoreAad(scoreContext),
      );
      const ctx = writer.context(current.head)!;
      const input = { ...scoreContext, ciphertext };
      if (final)
        setRemote(
          describeSubmit(
            await writer.queue.submit("Seal final score", {
              creates: [buildCreate("final_score", ctx, input)],
            }),
          ),
        );
      else {
        const mirrors = await scanKind(
          arkiv.reader,
          scope.event,
          "score_sheet",
          { submission: arkivKey(scope.submission), judge: arkivString(writer.byLabel!) },
          { creator: writer.address },
        );
        if (!mirrors.complete || mirrors.skipped) throw new Error("Cannot reconcile remote score mirrors");
        const mirror = mirrors.records.find(
          (r) =>
            r.values.assignment === scope.assignment &&
            r.values.rubric === scope.rubric &&
            r.owner === writer.address,
        );
        const batch = mirror
          ? {
              patches: [
                {
                  schema: KINDS.score_sheet.schema,
                  entityKey: mirror.key,
                  set: {
                    ciphertext: Uint8Array.from(ciphertext.slice(2).match(/../g) ?? [], (b) =>
                      parseInt(b, 16),
                    ),
                  },
                },
              ],
            }
          : { creates: [buildCreate("score_sheet", ctx, input)] };
        setRemote(describeSubmit(await writer.queue.submit("Sync encrypted draft", batch)));
      }
      onRefresh();
    } catch (e) {
      setRemote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const savedLocally = local === "Saved on this device" || local === "Restored from this device";
  return (
    <Card>
      <Row justify="space-between">
        <Txt variant="h2">Score</Txt>
        <Pill label={`0–${rubric.scale} · up to 2 decimals`} tone="neutral" />
      </Row>
      {loaded &&
        rubric.criteria.map((c) => (
          <Row key={c.id} wrap={false} gap={12}>
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="h3">{c.name}</Txt>
              <Pill label={`weight ${c.weight}`} tone="muted" />
            </View>
            <Field
              key={`${draftKey(scope)}:${c.id}`}
              accessibilityLabel={c.name}
              editable={loaded && !busy}
              style={{ width: 130 }}
              inputStyle={{ textAlign: "right", fontSize: 18, fontWeight: "600" }}
              keyboardType="decimal-pad"
              placeholder="–"
              suffix={`/ ${rubric.scale}`}
              value={inputs[c.id] ?? ""}
              onChangeText={(v) => edit(c.id, v)}
            />
          </Row>
        ))}
      <Divider />
      <Row gap={8}>
        {local.length <= 32 ? (
          <Pill
            label={local}
            tone={savedLocally ? "success" : "muted"}
            icon={savedLocally ? "check" : "clock"}
          />
        ) : null}
        {remote.length <= 32 ? <Pill label={remote} tone="neutral" icon="lock" /> : null}
      </Row>
      {local.length > 32 ? <Txt variant="caption">{local}</Txt> : null}
      {remote.length > 32 ? (
        <Txt variant="caption" tone="muted">
          {remote}
        </Txt>
      ) : null}
      <Txt variant="caption" tone="muted">
        Editable scores are stored on this device/profile. Anyone with access to its app storage can read
        them. Storage clearing or another device requires re-entry.
      </Txt>
      <Row gap={8}>
        <Button
          disabled={busy || !saved}
          onPress={() => void send(false)}
          icon="refresh"
          label="Sync encrypted mirror"
        />
        <Button
          variant="primary"
          disabled={busy || !saved}
          onPress={() => void send(true)}
          icon="lock"
          label="Seal final score"
        />
      </Row>
    </Card>
  );
}
export default function Judge() {
  const { evaluation, error, refresh } = useEvaluation();
  const { c } = useTheme();
  const writer = useWriter();
  const [selected, setSelected] = useState<Hex | null>(null);
  const [message, setMessage] = useState("");
  const route =
    evaluation && writer.byLabel ? assignedJudgeRoute(evaluation, writer.byLabel, providers.router()) : null;
  const assignment = route?.assignments.find((a) => a.key === selected);
  const rubricRecord =
    assignment && evaluation?.view.records("rubric").find((r) => r.key === ref(assignment, "rubric"));
  const parsed = rubricRecord ? RubricSchema.safeParse(payload(rubricRecord, "payload")) : null;
  const cipher = requireMeasured(providers.config.scoreCipher, "score cipher");
  const frozen = freezeConfig(providers.config);
  const context: DraftContext | null =
    assignment && writer.address
      ? {
          chainId: frozen.chains.rabdi.chainId,
          resetId: frozen.chains.rabdi.resetId,
          event: providers.config.edition,
          wallet: writer.address,
          submission: ref(assignment, "submission")!,
          assignment: assignment.key,
          rubric: ref(assignment, "rubric")!,
          keyId: cipher.keyId,
        }
      : null;
  // Display only: the team behind a submission key, from records already on screen.
  const teamFor = (submission: string | undefined) => {
    const r = submission
      ? evaluation?.view.records("submission").find((x) => x.key === submission)
      : undefined;
    return r ? str(r, "team") : undefined;
  };
  return (
    <Screen title="Your judging route" subtitle={writer.byLabel ?? undefined}>
      <Banner icon="lock" tone="accent" title="Scores stay sealed">
        Scores remain sealed until freeze. Choose an assignment to enter scores on this device.
      </Banner>
      {route && route.order.length > 0 && (
        <Card>
          <SectionHeader title="Walking order" icon="map" />
          {route.order.map((s, i) => (
            <Row key={s} wrap={false} gap={12}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: c.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt variant="caption" tone="accent" style={{ fontWeight: "700" }}>
                  {i + 1}
                </Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{teamFor(s) ?? "Submission"}</Txt>
                <Txt variant="caption" tone="faint" mono>
                  Submission {shortKey(s)}
                </Txt>
              </View>
            </Row>
          ))}
        </Card>
      )}
      {route?.unlocated.map((s) => (
        <Banner key={s} tone="warning" icon="pin">
          {`Location unavailable: ${teamFor(s) ?? shortKey(s)}`}
        </Banner>
      ))}
      {route && route.assignments.length > 0 && <SectionHeader title="Assignments" icon="gavel" />}
      {route?.assignments.map((a) => {
        const submission = ref(a, "submission");
        return (
          <ListRow
            key={a.key}
            selected={selected === a.key}
            onPress={() => setSelected(a.key)}
            left={<IconBubble name="star" tone={selected === a.key ? "accent" : "muted"} size={36} />}
            title={teamFor(submission) ?? `Submission ${submission}`}
            subtitle={`Submission ${shortKey(submission ?? "")} · Assignment ${shortKey(a.key)}`}
            chevron={selected !== a.key}
          />
        );
      })}
      {route && route.assignments.length === 0 && (
        <Card>
          <EmptyState
            icon="gavel"
            title="No assignments yet"
            body="The judging desk will assign submissions to you."
          />
        </Card>
      )}
      {context && parsed?.success && (
        <ScoreEditor
          key={`${writer.byLabel}:${draftKey(context)}`}
          context={context}
          rubric={parsed.data}
          onRefresh={refresh}
        />
      )}
      {context && (
        <Button
          variant="ghost"
          icon="x"
          label="Recuse myself"
          onPress={() => {
            const ctx = writer.context(evaluation?.head);
            if (writer.queue && ctx)
              void writer.queue
                .submit("Recuse from submission", {
                  creates: [
                    buildCreate("recusal", ctx, { submission: context.submission, judge: writer.byLabel! }),
                  ],
                })
                .then((r) => {
                  setMessage(describeSubmit(r));
                  refresh();
                })
                .catch((e) => setMessage((e as Error).message));
          }}
        />
      )}
      {message || error ? (
        <Banner accessibilityRole="alert" tone={messageTone(message || error || "")}>
          {message || error}
        </Banner>
      ) : (
        <Txt accessibilityRole="alert" />
      )}
    </Screen>
  );
}
