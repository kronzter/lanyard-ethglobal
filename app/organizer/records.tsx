// /organizer/records (web-only, B2.2): which Arkiv records count, and why the others don't.
// Rejected records stay on screen, greyed, with their reason; nothing is hidden.
//
//   Bundle  import a bundle file (or paste its JSON) and re-run the rules on its own retained
//           inputs, showing the recomputed output hash (B2.3-R7: the same hash as `lanyard hash`).
//   Live    capture the current readonly records (Rabdi, or the development fake) into memory,
//           prepare historical ENS through the app's EnsReader (the fixture mock until I2) and
//           evaluate against an explicit development context. Current observations, not a frozen
//           evaluation.
import { useState } from "react";
import { Platform } from "react-native";
import { evaluateCurrent } from "@/arkiv/evaluate-current";
import type { Hex } from "@/shared/types/primitives";
import { ENGINE, outputHashOf, parseBundleText, reproduce, type RulesOutput } from "@/rules";
import { providers } from "@/providers";
import {
  Banner,
  Button,
  Card,
  Field,
  IconBubble,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Stat,
  Txt,
} from "@/ui";

type Result = {
  source: string;
  output: RulesOutput;
  outputHash: Hex;
  note?: string;
  claimedMismatch?: string;
};

function fromBundle(text: string): Result {
  const { body, bundleHash } = parseBundleText(text, { allowOutOfWindow: true });
  const r = reproduce(ENGINE, body);
  return {
    source: `bundle ${bundleHash}`,
    output: r.output,
    outputHash: r.outputHash,
    claimedMismatch: r.match ? undefined : r.difference,
  };
}

async function fromLive(): Promise<Result> {
  const { head, observations, report, output } = await evaluateCurrent({
    reader: providers.arkiv().reader,
    ens: providers.ensReader(),
    config: providers.config,
  });
  return {
    source: `live ${providers.arkiv().mode === "fake" ? "fake Arkiv (development)" : "Rabdi"} at block ${head.number}`,
    output,
    outputHash: outputHashOf(output),
    note:
      `Current observations (${observations.length} readonly records, ${report.excludedMutable} mutable drafts excluded), ` +
      `not a frozen evaluation.${report.complete ? "" : ` Incomplete scan: ${report.gaps.join("; ")}.`}`,
  };
}

/** Web-only file picker (this screen never renders on Android). */
function pickFile(onText: (text: string) => void, onError: (message: string) => void) {
  if (Platform.OS !== "web") return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) file.text().then(onText, (e: Error) => onError(e.message));
  };
  input.click();
}

export default function Records() {
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Result | Promise<Result>) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await f());
    } catch (e) {
      setError((e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(false);
    }
  };

  const verdicts = result?.output.verdicts ?? [];
  const counted = verdicts.filter((v) => v.counts).length;

  const kinds = [...new Set(verdicts.map((v) => v.kind))];

  return (
    <Screen
      title="Records & verdicts"
      subtitle={`Anyone can write to Arkiv; the rules decide what counts. Rules version ${ENGINE.version}`}
      maxWidth={900}
    >
      <Row gap={12} align="stretch">
        <Card style={{ flex: 1, minWidth: 280 }}>
          <Row gap={10} wrap={false}>
            <IconBubble name="shield" size={36} />
            <Txt variant="h2">Evidence bundle</Txt>
          </Row>
          <Button
            testID="records-pick"
            accessibilityRole="button"
            disabled={busy}
            icon="plus"
            label="Choose a bundle file…"
            onPress={() => pickFile((text) => void run(() => fromBundle(text)), setError)}
          />
          <Field
            testID="records-paste"
            value={pasted}
            onChangeText={setPasted}
            placeholder="…or paste bundle JSON"
            multiline
            mono
            autoCapitalize="none"
          />
          <Button
            testID="records-evaluate-paste"
            accessibilityRole="button"
            disabled={busy || pasted.trim() === ""}
            variant="primary"
            label="Evaluate pasted bundle"
            onPress={() => void run(() => fromBundle(pasted))}
          />
        </Card>

        <Card style={{ flex: 1, minWidth: 280 }}>
          <Row gap={10} wrap={false}>
            <IconBubble name="refresh" tone="success" size={36} />
            <Txt variant="h2">Live records</Txt>
          </Row>
          <Txt variant="caption" tone="muted">
            Captures the edition&apos;s current readonly records and checks them against historical ENS (
            {providers.flags.ens} reader).
          </Txt>
          <Button
            testID="records-live"
            accessibilityRole="button"
            disabled={busy}
            variant="primary"
            label={busy ? "Working…" : "Evaluate live records"}
            onPress={() => void run(fromLive)}
          />
        </Card>
      </Row>

      {error && (
        <Banner testID="records-error" tone="danger" title="Could not evaluate">
          {`Could not evaluate: ${error}`}
        </Banner>
      )}

      {result && (
        <Stackv gap={12} testID="records-result">
          <Row gap={12} align="stretch">
            <Stat label="records count" value={counted} tone="success" />
            <Stat label="greyed out, with a reason" value={verdicts.length - counted} tone="muted" />
          </Row>
          <Card tone="muted">
            <Txt variant="label" tone="muted">
              Output hash
            </Txt>
            <Txt mono selectable>
              Output hash {result.outputHash}
            </Txt>
            <Txt variant="caption" tone="muted">
              {result.source} · {counted} of {verdicts.length} records count
            </Txt>
            {result.note && (
              <Txt variant="caption" tone="muted">
                {result.note}
              </Txt>
            )}
          </Card>
          {result.claimedMismatch && (
            <Banner tone="danger">
              {`The bundle's claimed output differs from the recomputation: ${result.claimedMismatch}`}
            </Banner>
          )}
          {kinds.map((kind) => {
            const rows = verdicts.filter((v) => v.kind === kind);
            const ok = rows.filter((v) => v.counts).length;
            return (
              <Stackv key={kind} gap={8}>
                <SectionHeader
                  title={kind}
                  right={
                    <Pill
                      label={`${ok}/${rows.length} count`}
                      tone={ok === rows.length ? "success" : "warning"}
                    />
                  }
                />
                {rows.map((v) => (
                  <ListRow
                    key={v.key}
                    testID="records-verdict"
                    dim={!v.counts}
                    left={
                      <IconBubble
                        name={v.counts ? "check" : "x"}
                        tone={v.counts ? "success" : "muted"}
                        size={30}
                      />
                    }
                    title={
                      <Txt variant="h3">
                        {v.counts ? "✓" : "✗"} {v.kind}
                      </Txt>
                    }
                    subtitle={
                      <Stackv gap={2}>
                        <Txt variant="caption" mono tone="faint" selectable>
                          {v.key}
                        </Txt>
                        {!v.counts && <Txt variant="caption">{v.reason}</Txt>}
                      </Stackv>
                    }
                  />
                ))}
              </Stackv>
            );
          })}
        </Stackv>
      )}
    </Screen>
  );
}
