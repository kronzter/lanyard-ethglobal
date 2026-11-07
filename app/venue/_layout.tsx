import { Slot, Stack } from "expo-router";
import { WebOnly } from "@/shell/WebOnly";

export default function Layout() {
  return (
    <>
      <Stack.Screen options={{ title: "Venue" }} />
      <WebOnly title="Venue editor">
        <Slot />
      </WebOnly>
    </>
  );
}
