import type { ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { blocksOnPlatform } from "./routes";

/** Organizer screens, ENS consoles and the venue editor are web-only (P0.5-R7). */
export function WebOnly({ children, title }: { children: ReactNode; title: string }) {
  if (!blocksOnPlatform({ webOnly: true }, Platform.OS)) return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Open on web</Text>
      <Text style={{ marginTop: 8, textAlign: "center" }}>
        {title} is a web-only screen. Open Lanyard in a desktop browser to use it.
      </Text>
    </View>
  );
}
