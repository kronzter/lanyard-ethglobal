import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "@/shell/session";
import { WalletBridge } from "@/shell/WalletBridge";
import { WalletProvider } from "@/shell/wallet/WalletProvider";
import { useTheme } from "@/ui/theme";

export default function RootLayout() {
  const { c, dark } = useTheme();
  return (
    <WalletProvider>
      <SessionProvider>
        <WalletBridge />
        <StatusBar style={dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            title: "Lanyard",
            headerStyle: { backgroundColor: c.surface },
            headerTintColor: c.accent,
            headerTitleStyle: { color: c.text, fontWeight: "700", fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.bg },
          }}
        />
      </SessionProvider>
    </WalletProvider>
  );
}
