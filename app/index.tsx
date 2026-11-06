import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { providers } from "@/providers";
import { DevWalletPicker } from "@/shell/DevWalletPicker";
import { RolePanel } from "@/shell/RolePanel";
import { ROUTES } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { styles } from "@/shell/styles";
import { useWallet } from "@/shell/wallet/useWallet";

export default function Home() {
  const { address } = useSession();
  const wallet = useWallet();
  const mock = providers.flags.ens === "mock";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Lanyard · {providers.config.edition}</Text>

      {!address && (
        <View style={styles.card}>
          {wallet.status === "unavailable" ? (
            <Text testID="wallet-unavailable" style={styles.muted}>
              {wallet.reason}
            </Text>
          ) : (
            <Pressable
              testID="wallet-connect"
              accessibilityRole="button"
              onPress={wallet.connect}
              style={styles.chip}
            >
              <Text>Connect wallet</Text>
            </Pressable>
          )}
          {mock && <Text style={styles.muted}>or act as a test persona</Text>}
        </View>
      )}
      {!address && mock && <DevWalletPicker />}
      <RolePanel />

      <View>
        <Text style={styles.h3}>Open to everyone</Text>
        <Link href={"/teams/zkpay" as never} style={styles.link}>
          Public team page: zkpay
        </Link>
      </View>

      {mock && (
        <View>
          <Text style={styles.h3}>All screens (mock mode)</Text>
          {ROUTES.map((r) => (
            <Link key={r.path} href={r.path as never} style={styles.link}>
              {r.title}
              {r.webOnly ? " (web only)" : ""}
            </Link>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
