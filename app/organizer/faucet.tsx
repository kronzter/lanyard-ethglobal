// /organizer/faucet (web-only, B1.1-R4/R7/R8): the desk sends first-time tGLM from the dedicated
// desk wallet and records a readonly `drip`. The connected wallet signs; no key lives in the app.
// QR scanning arrives with the shared onboarding-desk scanner (A4.3); this screen takes a pasted
// address.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatEther } from "viem";
import { createArkivReader, createWalletWriter } from "@/arkiv/client";
import { txUrl } from "@/arkiv/chain";
import { drip, type DripOutcome } from "@/arkiv/drip";
import { localStorageStore } from "@/arkiv/store";
import { RABDI_CHAIN_ID } from "@/shared/config/schema";
import type { Address } from "@/shared/types/primitives";
import { providers } from "@/providers";
import { styles } from "@/shell/styles";
import { useWallet } from "@/shell/wallet/useWallet";

const access = {
  rpcUrl: process.env.EXPO_PUBLIC_RABDI_RPC_URL,
  accessKey: process.env.EXPO_PUBLIC_RABDI_ACCESS_KEY,
};

function describe(o: DripOutcome): string {
  switch (o.status) {
    case "sent":
      return o.resumed ? "Recorded an earlier transfer (no second send)." : "Sent and recorded.";
    case "refused":
      return `Refused: ${o.detail}`;
    case "uncertain":
      return `Not finished: ${o.detail}`;
    case "rejected":
      return "You cancelled this in the desk wallet. Nothing was sent.";
    case "failed":
      return `Failed: ${o.detail}`;
  }
}

export default function Faucet() {
  const wallet = useWallet();
  const deployment = providers.deployments.rabdi;
  const dripWei = providers.config.funding?.dripWei;
  const deskWallet =
    deployment.mode === "live" && deployment.funding.profile === "desk-wallet"
      ? deployment.funding.deskWallet
      : null;
  const reader = useMemo(() => createArkivReader(access), []);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DripOutcome | null>(null);
  const [deskBalance, setDeskBalance] = useState<bigint | null>(null);
  const [recipientBalance, setRecipientBalance] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (deskWallet) setDeskBalance(await reader.balance(deskWallet).catch(() => null));
  }, [reader, deskWallet]);
  useEffect(() => void refresh(), [refresh]);

  if (!deskWallet || !dripWei)
    return (
      <View style={{ padding: 16 }}>
        <Text style={styles.h2}>Desk faucet</Text>
        <Text style={styles.muted}>
          Desk funding is not configured in deployments/rabdi.json or the event config.
        </Text>
      </View>
    );

  const isDesk = wallet.address?.toLowerCase() === deskWallet;
  const onRabdi = wallet.chainId === RABDI_CHAIN_ID;

  const send = async () => {
    if (!wallet.provider || !wallet.address) return;
    setBusy(true);
    setOutcome(null);
    setRecipientBalance(null);
    try {
      const result = await drip(
        {
          reader,
          desk: createWalletWriter(wallet.provider, wallet.address as Address, access),
          deskWallet,
          dripWei,
          edition: providers.config.edition,
          times: providers.config.times,
          journal: localStorageStore("lanyard:"),
        },
        recipient,
      );
      setOutcome(result);
      if (result.status === "sent") setRecipientBalance(await reader.balance(result.recipient));
    } catch (e) {
      setOutcome({ status: "failed", txHash: "0x", detail: (e as Error).message.split("\n")[0]! });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={styles.h2}>Desk faucet</Text>
      <Text style={styles.muted}>
        Sends {formatEther(dripWei)} tGLM once per wallet from the desk wallet {deskWallet}, then records it
        on Arkiv. Desk balance: {deskBalance === null ? "…" : `${formatEther(deskBalance)} tGLM`}
      </Text>

      {wallet.status !== "connected" ? (
        <Pressable accessibilityRole="button" onPress={wallet.connect} style={styles.chip}>
          <Text>{wallet.status === "unavailable" ? wallet.reason : "Connect the desk wallet"}</Text>
        </Pressable>
      ) : !isDesk ? (
        <Text testID="faucet-not-desk">
          Connected {wallet.address}. Connect the desk wallet {deskWallet} to send tGLM.
        </Text>
      ) : !onRabdi ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => wallet.switchChain(RABDI_CHAIN_ID)}
          style={styles.chip}
        >
          <Text>Switch the desk wallet to Arkiv Rabdi</Text>
        </Pressable>
      ) : (
        <View style={styles.card}>
          <Text style={styles.h3}>Recipient address</Text>
          <TextInput
            testID="faucet-recipient"
            value={recipient}
            onChangeText={setRecipient}
            placeholder="0x… (paste the wallet address shown on their phone)"
            autoCapitalize="none"
            style={styles.input}
          />
          <Pressable
            testID="faucet-send"
            accessibilityRole="button"
            disabled={busy || recipient.trim() === ""}
            onPress={send}
            style={[styles.chip, busy ? undefined : styles.chipOn]}
          >
            <Text>{busy ? "Waiting for the desk wallet…" : `Send ${formatEther(dripWei)} tGLM`}</Text>
          </Pressable>
        </View>
      )}

      {outcome && (
        <View style={styles.card} testID="faucet-outcome">
          <Text>{describe(outcome)}</Text>
          {"txHash" in outcome && outcome.txHash && outcome.txHash !== "0x" && (
            <Text style={styles.link} onPress={() => Linking.openURL(txUrl(outcome.txHash!))}>
              Transaction {outcome.txHash}
            </Text>
          )}
          {outcome.status === "sent" && (
            <Text style={styles.mono}>
              Drip record {outcome.recordKey}
              {recipientBalance !== null
                ? ` · recipient now holds ${formatEther(recipientBalance)} tGLM`
                : ""}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}
