// Plain building blocks shared by the ENS console screens.
import { useCallback, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Banner, Button, Card, Chip, Field as UiField, IconBubble, Pill, Row, Screen, Txt } from "@/ui";
import { SEPOLIA_CHAIN_ID } from "./chain-guard";
import { formatTxResult, TxUncertain, type TxResult } from "./tx";
import { useConsole } from "./useConsole";

export function ConsoleFrame({ title, children }: { title: string; children: ReactNode }) {
  const { wallet, problem } = useConsole();
  return (
    <Screen title={title}>
      <Card>
        {wallet.status === "unavailable" ? (
          <Txt testID="wallet-unavailable" tone="muted">
            {wallet.reason}
          </Txt>
        ) : wallet.status !== "connected" ? (
          <Btn label="Connect wallet" onPress={wallet.connect} testID="wallet-connect" />
        ) : (
          <Row wrap={false} gap={12}>
            <IconBubble name="wallet" size={36} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt mono selectable>
                {wallet.address}
              </Txt>
              <Pill
                label={wallet.chainId === SEPOLIA_CHAIN_ID ? "Sepolia" : `Wrong chain (${wallet.chainId})`}
                tone={wallet.chainId === SEPOLIA_CHAIN_ID ? "success" : "warning"}
                dot
              />
            </View>
            {wallet.chainId !== SEPOLIA_CHAIN_ID && (
              <Btn label="Switch to Sepolia" onPress={() => wallet.switchChain(SEPOLIA_CHAIN_ID)} />
            )}
          </Row>
        )}
        {problem && wallet.status !== "unavailable" && <Banner tone="danger">{problem}</Banner>}
      </Card>
      {children}
    </Screen>
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
  return <Button testID={testID} variant="primary" disabled={disabled} onPress={onPress} label={label} />;
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
    <UiField
      label={label}
      testID={testID}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      mono={placeholder?.startsWith("0x")}
    />
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
    <Row gap={6}>
      {options.map((o) => (
        <Chip
          key={o}
          accessibilityRole="button"
          onPress={() => onChange(o)}
          selected={value === o}
          label={o}
        />
      ))}
    </Row>
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
    <View style={{ gap: 8 }} testID="console-log">
      {log.map((o, i) => (
        <Banner key={i} tone={o.kind === "ok" ? "success" : "danger"}>
          {o.text}
        </Banner>
      ))}
    </View>
  );
}
