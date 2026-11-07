import { Link } from "expo-router";
import { Text, View } from "react-native";
import { styles } from "@/shell/styles";

const LINKS = [
  { href: "/admin/ens/desk", label: "Onboarding desk (organizer)" },
  { href: "/admin/ens/coordinator", label: "Coordinator (make or unmake leads)" },
  { href: "/admin/ens/partner", label: "Partner console (judges and staff)" },
  { href: "/admin/ens/head-judge", label: "Head judge (global judges)" },
] as const;

export default function Screen() {
  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>ENS consoles</Text>
      <Text style={styles.muted}>Staff wallets sign every transaction; nothing is stored in the app.</Text>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} style={styles.link}>
          {l.label}
        </Link>
      ))}
    </View>
  );
}
