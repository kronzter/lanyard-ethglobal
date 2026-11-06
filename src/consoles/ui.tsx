// Plain building blocks shared by the ENS console screens.
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { styles } from "@/shell/styles";
import { SEPOLIA_CHAIN_ID } from "./chain-guard";
import { formatTxResult, TxUncertain, type TxResult } from "./tx";
import { useConsole } from "./useConsole";

export function ConsoleFrame({ title, children }: { title: string; children: ReactNode }) {
  const { wallet, problem } = useConsole();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 720 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>{title}</Text>
      <View style={styles.card}>
        {wallet.status === "unavailable" ? (
          <Text testID="wallet-unavailable" style={styles.muted}>
            {wallet.reason}
          </Text>
        ) : wallet.status !== "connected" ? (
          <Btn label="Connect wallet" onPress={wallet.connect} testID="wallet-connect" />
        ) : (
          <>
            <Text style={styles.mono}>{wallet.address}</Text>
            <Text style={styles.muted}>
              {wallet.chainId === SEPOLIA_CHAIN_ID ? "Sepolia" : `Wrong chain (${wallet.chainId})`}
            </Text>
            {wallet.chainId !== SEPOLIA_CHAIN_ID && (
              <Btn label="Switch to Sepolia" onPress={() => wallet.switchChain(SEPOLIA_CHAIN_ID)} />
            )}
          </>
        )}
        {problem && wallet.status !== "unavailable" && <Text style={{ color: "#b91c1c" }}>{problem}</Text>}
      </View>
      {children}
    </ScrollView>
  );
}

export function Btn({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, styles.chipOn, disabled ? { opacity: 0.5 } : null, { alignSelf: "flex-start" }]}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.h3}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T | "";
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          onPress={() => onChange(o)}
          style={[styles.chip, value === o ? styles.chipOn : null]}
        >
          <Text>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export type Outcome = { kind: "ok" | "error"; text: string };

/** Runs one console action, tracking busy state and showing success (hash + block) or the reason. */
export function useRunner() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Outcome[]>([]);
  const push = useCallback((o: Outcome) => setLog((l) => [o, ...l].slice(0, 8)), []);
  const run = useCallback(
    async (what: string, fn: () => Promise<TxResult | string | void>) => {
      setBusy(true);
      try {
        const r = await fn();
        const detail = typeof r === "string" ? r : r ? formatTxResult(r) : "";
        push({ kind: "ok", text: `${what}: ${detail}`.trim() });
      } catch (e) {
        const hash = e instanceof TxUncertain ? ` (${e.hash})` : "";
        push({ kind: "error", text: `${what}: ${e instanceof Error ? e.message : String(e)}${hash}` });
      } finally {
        setBusy(false);
      }
    },
    [push],
  );
  return { busy, log, run, push };
}

export function Log({ log }: { log: Outcome[] }) {
  return (
    <View style={{ gap: 4 }} testID="console-log">
      {log.map((o, i) => (
        <Text key={i} selectable style={{ color: o.kind === "ok" ? "#15803d" : "#b91c1c" }}>
          {o.text}
        </Text>
      ))}
    </View>
  );
}
