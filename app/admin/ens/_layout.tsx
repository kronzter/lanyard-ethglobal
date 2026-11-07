import { Slot, Stack } from "expo-router";
import { WebOnly } from "@/shell/WebOnly";

export default function Layout() {
  return (
    <>
      <Stack.Screen options={{ title: "ENS consoles" }} />
      <WebOnly title="ENS consoles">
        <Slot />
      </WebOnly>
    </>
  );
}
