import { Stack } from "expo-router";
import { SessionProvider } from "@/shell/session";
import { WalletBridge } from "@/shell/WalletBridge";
import { WalletProvider } from "@/shell/wallet/WalletProvider";

export default function RootLayout() {
  return (
    <WalletProvider>
      <SessionProvider>
        <WalletBridge />
        <Stack screenOptions={{ headerTitle: "Lanyard" }} />
      </SessionProvider>
    </WalletProvider>
  );
}
