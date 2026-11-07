// /organizer/faucet (web-only, B1.1-R4/R7/R8): the desk sends first-time tGLM from the dedicated
// desk wallet and records a readonly `drip`. The connected wallet signs; no key lives in the app.
// QR scanning arrives with the shared onboarding-desk scanner (A4.3); this screen takes a pasted
// address.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import { formatEther } from "viem";
import { createArkivReader, createWalletWriter } from "@/arkiv/client";
import { txUrl } from "@/arkiv/chain";
import { drip, type DripOutcome } from "@/arkiv/drip";
import { localStorageStore } from "@/arkiv/store";
import { RABDI_CHAIN_ID } from "@/shared/config/schema";
import type { Address } from "@/shared/types/primitives";
import { providers } from "@/providers";
import {
  Address as AddressText,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Row,
  Screen,
  Stat,
  Txt,
} from "@/ui";
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
      <Screen title="Desk faucet">
        <Card>
          <EmptyState
            icon="drop"
            title="Desk funding not configured"
            body="Desk funding is not configured in deployments/rabdi.json or the event config."
          />
        </Card>
      </Screen>
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
    <Screen
      title="Desk faucet"
      subtitle={`Sends ${formatEther(dripWei)} tGLM once per wallet from the desk wallet, then records it on Arkiv.`}
    >
      <Row gap={12} align="stretch">
        <Stat label="tGLM per wallet" value={formatEther(dripWei)} tone="accent" />
        <Stat label="desk balance (tGLM)" value={deskBalance === null ? "…" : formatEther(deskBalance)} />
      </Row>
      <Card tone="muted">
        <Txt variant="label" tone="muted">
          Desk wallet
        </Txt>
        <AddressText value={deskWallet} full tone="text" />
      </Card>

      {wallet.status !== "connected" ? (
        <Button
          accessibilityRole="button"
          onPress={wallet.connect}
          variant="primary"
          size="lg"
          full
          icon="wallet"
          label={
            wallet.status === "unavailable"
              ? (wallet.reason ?? "Wallet unavailable")
              : "Connect the desk wallet"
          }
        />
      ) : !isDesk ? (
        <Banner testID="faucet-not-desk" tone="warning" title="Wrong wallet">
          {`Connected ${wallet.address}. Connect the desk wallet ${deskWallet} to send tGLM.`}
        </Banner>
      ) : !onRabdi ? (
        <Button
          accessibilityRole="button"
          onPress={() => wallet.switchChain(RABDI_CHAIN_ID)}
          variant="warning"
          full
          label="Switch the desk wallet to Arkiv Rabdi"
        />
      ) : (
        <Card>
          <Field
            label="Recipient address"
            testID="faucet-recipient"
            value={recipient}
            onChangeText={setRecipient}
            placeholder="0x… (paste the wallet address shown on their phone)"
            autoCapitalize="none"
            mono
          />
          <Button
            testID="faucet-send"
            accessibilityRole="button"
            disabled={busy || recipient.trim() === ""}
            onPress={send}
            variant="primary"
            size="lg"
            full
            icon="drop"
            label={busy ? "Waiting for the desk wallet…" : `Send ${formatEther(dripWei)} tGLM`}
          />
        </Card>
      )}

      {outcome && (
        <Card
          testID="faucet-outcome"
          tone={outcome.status === "sent" ? "success" : outcome.status === "failed" ? "danger" : "warning"}
        >
          <Txt variant="h3">{describe(outcome)}</Txt>
          {"txHash" in outcome && outcome.txHash && outcome.txHash !== "0x" && (
            <Txt tone="accent" mono onPress={() => Linking.openURL(txUrl(outcome.txHash!))}>
              Transaction {outcome.txHash}
            </Txt>
          )}
          {outcome.status === "sent" && (
            <Txt mono variant="caption">
              Drip record {outcome.recordKey}
              {recipientBalance !== null
                ? ` · recipient now holds ${formatEther(recipientBalance)} tGLM`
                : ""}
            </Txt>
          )}
        </Card>
      )}
    </Screen>
  );
}
