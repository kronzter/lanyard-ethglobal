import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { providers } from "@/providers";
import { DevWalletPicker } from "@/shell/DevWalletPicker";
import { RolePanel } from "@/shell/RolePanel";
import { ROUTES } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { styles } from "@/shell/styles";

export default function Home() {
  const { address } = useSession();
  const mock = providers.flags.ens === "mock";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Lanyard · {providers.config.edition}</Text>

      {!address &&
        (mock ? (
          <DevWalletPicker />
        ) : (
          <View style={styles.card}>
            <Text>Wallet connection arrives with AppKit (P0.5-R3).</Text>
          </View>
        ))}
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
