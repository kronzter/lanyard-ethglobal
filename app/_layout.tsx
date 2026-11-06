import { Stack } from "expo-router";
import { SessionProvider } from "@/shell/session";

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerTitle: "Lanyard" }} />
    </SessionProvider>
  );
}
