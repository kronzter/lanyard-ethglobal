import { Slot } from "expo-router";
import { WebOnly } from "@/shell/WebOnly";

export default function Layout() {
  return (
    <WebOnly title="Venue editor">
      <Slot />
    </WebOnly>
  );
}
