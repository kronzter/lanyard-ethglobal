// /organizer/records (web-only, B2.2): which Arkiv records count, and why the others don't.
// Rejected records stay on screen, greyed, with their reason; nothing is hidden.
//
//   Bundle  import a bundle file (or paste its JSON) and re-run the rules on its own retained
//           inputs, showing the recomputed output hash (B2.3-R7: the same hash as `lanyard hash`).
//   Live    capture the current readonly records into memory, prepare historical ENS through the
//           app's EnsReader (the fixture mock until I2) and evaluate against an explicit
//           development context. Current observations, not a frozen evaluation.
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { captureForEvent, memoryObservationStore } from "@/arkiv/capture";
import { createArkivReader } from "@/arkiv/client";
import { configHash, freezeConfig } from "@/shared/config/hash";
import { requireMeasured } from "@/shared/config/unmeasured";
import { RABDI_CHAIN_ID } from "@/shared/config/schema";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import {
  ENGINE,
  evaluate,
  outputHashOf,
  parseBundleText,
  prepare,
  reproduce,
  type RulesOutput,
} from "@/rules";
import { providers } from "@/providers";
import { styles } from "@/shell/styles";

const access = {
  rpcUrl: process.env.EXPO_PUBLIC_RABDI_RPC_URL,
  accessKey: process.env.EXPO_PUBLIC_RABDI_ACCESS_KEY,
};

type Result = {
  source: string;
  output: RulesOutput;
  outputHash: Hex;
  note?: string;
  claimedMismatch?: string;
};

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

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
  const config = providers.config;
  const frozen = freezeConfig(config);
  const reader = createArkivReader(access);
  const store = memoryObservationStore();
  const report = await captureForEvent({
    reader,
    edition: config.edition,
    network: {
      chainId: RABDI_CHAIN_ID,
      resetId: requireMeasured(config.chains.rabdi.resetId, "rabdi reset"),
    },
    store,
  });
  const { observations } = await store.load();
  const head = await reader.block(report.pages[0]!.blockNumber);
  const ens = providers.ensReader();
  const sepoliaBlock = await ens.sepoliaBlockAt(head.timestamp);
  const context: EvaluationContext = {
    event: config.edition,
    arkivChainId: RABDI_CHAIN_ID,
    arkivResetId: frozen.chains.rabdi.resetId,
    sepoliaChainId: frozen.chains.sepolia.chainId,
    arkivCutoff: head,
    // A development context: the Sepolia block hash is not checked here, and nothing is frozen.
    sepoliaCutoff: { number: sepoliaBlock, hash: ZERO_HASH, timestamp: head.timestamp },
    configHash: configHash(config),
  };
  const prepared = await prepare(observations, ens, context, frozen);
  const output = evaluate(observations, prepared.ens, context, frozen, ENGINE.version);
  return {
    source: `live Rabdi at block ${head.number}`,
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

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={styles.h2}>Records and verdicts</Text>
      <Text style={styles.muted}>
        Anyone can write to Arkiv; the rules decide what counts. Rules version {ENGINE.version}
      </Text>

      <View style={styles.card}>
        <Text style={styles.h3}>Evidence bundle</Text>
        <View style={styles.wrap}>
          <Pressable
            testID="records-pick"
            accessibilityRole="button"
            disabled={busy}
            style={styles.chip}
            onPress={() => pickFile((text) => void run(() => fromBundle(text)), setError)}
          >
            <Text>Choose a bundle file…</Text>
          </Pressable>
        </View>
        <TextInput
          testID="records-paste"
          value={pasted}
          onChangeText={setPasted}
          placeholder="…or paste bundle JSON"
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          style={[styles.input, styles.mono]}
        />
        <Pressable
          testID="records-evaluate-paste"
          accessibilityRole="button"
          disabled={busy || pasted.trim() === ""}
          style={styles.chip}
          onPress={() => void run(() => fromBundle(pasted))}
        >
          <Text>Evaluate pasted bundle</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.h3}>Live records</Text>
        <Text style={styles.muted}>
          Captures the edition&apos;s current readonly records and checks them against historical ENS (
          {providers.flags.ens} reader).
        </Text>
        <Pressable
          testID="records-live"
          accessibilityRole="button"
          disabled={busy}
          style={styles.chip}
          onPress={() => void run(fromLive)}
        >
          <Text>{busy ? "Working…" : "Evaluate live records"}</Text>
        </Pressable>
      </View>

      {error && (
        <View style={styles.card} testID="records-error">
          <Text>Could not evaluate: {error}</Text>
        </View>
      )}

      {result && (
        <View style={{ gap: 8 }} testID="records-result">
          <Text style={styles.mono}>Output hash {result.outputHash}</Text>
          <Text style={styles.muted}>
            {result.source} · {counted} of {verdicts.length} records count
          </Text>
          {result.note && <Text style={styles.muted}>{result.note}</Text>}
          {result.claimedMismatch && (
            <Text>
              The bundle&apos;s claimed output differs from the recomputation: {result.claimedMismatch}
            </Text>
          )}
          {verdicts.map((v) => (
            <View
              key={v.key}
              style={[styles.row, v.counts ? undefined : { opacity: 0.5 }]}
              testID="records-verdict"
            >
              <Text>
                {v.counts ? "✓" : "✗"} {v.kind}
              </Text>
              <Text style={[styles.mono, styles.muted]}>{v.key}</Text>
              {!v.counts && <Text>{v.reason}</Text>}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
