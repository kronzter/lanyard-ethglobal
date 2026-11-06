import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { eventConfig } from "@/shared/event.config";
import { ROUTES } from "@/shell/routes";

export default function Home() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View>
        <Text style={{ fontSize: 22, fontWeight: "600" }}>Lanyard · {eventConfig.edition}</Text>
        <Text style={{ marginTop: 4 }}>
          Wallet connection and role selection arrive with P0.5 (AppKit). Until then, every screen is
          reachable here.
        </Text>
      </View>
      {ROUTES.map((r) => (
        <Link key={r.path} href={r.path as never} style={{ fontSize: 16, paddingVertical: 6 }}>
          {r.title}
          {r.webOnly ? " (web only)" : ""}
        </Link>
      ))}
      <Link href={"/teams/zkpay" as never} style={{ fontSize: 16, paddingVertical: 6 }}>
        Public team page: zkpay
      </Link>
    </ScrollView>
  );
}
