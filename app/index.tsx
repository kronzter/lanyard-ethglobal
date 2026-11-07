import { View } from "react-native";
import { providers } from "@/providers";
import { DevWalletPicker } from "@/shell/DevWalletPicker";
import { RolePanel } from "@/shell/RolePanel";
import { ROUTES } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { useWallet } from "@/shell/wallet/useWallet";
import {
  Banner,
  Button,
  Card,
  Disclosure,
  IconBubble,
  LinkRow,
  Row,
  Screen,
  Txt,
  routeCopy,
  useTheme,
} from "@/ui";

export default function Home() {
  const { address } = useSession();
  const wallet = useWallet();
  const { c } = useTheme();
  const mock = providers.flags.ens === "mock";
  const edition = providers.config.edition;

  return (
    <Screen navTitle="Lanyard">
      <View style={{ gap: 6, paddingTop: 8 }}>
        <Row gap={10}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: c.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Txt variant="h2" tone="onAccent">
              L
            </Txt>
          </View>
          <Txt variant="display">Lanyard</Txt>
        </Row>
        <Txt tone="muted">{edition} · shifts, help tickets and judging, signed by your wallet</Txt>
      </View>

      {!address && (
        <Card>
          <Row wrap={false} gap={12}>
            <IconBubble name="wallet" />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h2">Get started</Txt>
              <Txt variant="caption" tone="muted">
                Connect the wallet that holds your event badge.
              </Txt>
            </View>
          </Row>
          {wallet.status === "unavailable" ? (
            <Txt testID="wallet-unavailable" tone="muted">
              {wallet.reason}
            </Txt>
          ) : (
            <Button
              testID="wallet-connect"
              accessibilityRole="button"
              onPress={wallet.connect}
              variant="primary"
              size="lg"
              full
              icon="wallet"
              label="Connect wallet"
            />
          )}
          {mock && (
            <Txt variant="caption" tone="muted" style={{ textAlign: "center" }}>
              or act as a test persona below
            </Txt>
          )}
        </Card>
      )}
      {!address && mock && <DevWalletPicker />}
      <RolePanel />

      <Card padded={false} style={{ padding: 6 }}>
        <LinkRow
          href="/teams/zkpay"
          icon="link"
          title="Public team page: zkpay"
          subtitle="Open to everyone, no wallet needed"
        />
      </Card>

      {mock && (
        <Disclosure title="All screens (mock mode)" icon="list">
          <Banner>Development shortcut: screens still check your role.</Banner>
          {ROUTES.map((r) => {
            const copy = routeCopy(r.path);
            return (
              <LinkRow
                key={r.path}
                href={r.path}
                icon={copy.icon}
                title={`${r.title}${r.webOnly ? " (web only)" : ""}`}
                subtitle={copy.body}
              />
            );
          })}
        </Disclosure>
      )}
    </Screen>
  );
}
