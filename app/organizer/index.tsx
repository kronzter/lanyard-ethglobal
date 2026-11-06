import { Link } from "expo-router";
import { View } from "react-native";
import { Placeholder } from "@/shell/Placeholder";
import { styles } from "@/shell/styles";

export default function Screen() {
  return (
    <View style={{ flex: 1 }}>
      <Placeholder path="/organizer" />
      <View style={{ padding: 16, alignItems: "center" }}>
        <Link href={"/organizer/faucet" as never} style={styles.link}>
          Desk faucet: first-time tGLM (B1.1)
        </Link>
        <Link href={"/organizer/records" as never} style={styles.link}>
          Records and verdicts: what counts and why (B2.2)
        </Link>
        <Link href={"/organizer/seats" as never} style={styles.link}>
          Venue and seats: publish venue.json, import seat assignments (B3.3)
        </Link>
      </View>
    </View>
  );
}
