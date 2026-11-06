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
      </View>
    </View>
  );
}
