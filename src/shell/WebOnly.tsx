import type { ReactNode } from "react";
import { Platform } from "react-native";
import { Center, EmptyState } from "@/ui";
import { blocksOnPlatform } from "./routes";

/** Organizer screens, ENS consoles and the venue editor are web-only (P0.5-R7). */
export function WebOnly({ children, title }: { children: ReactNode; title: string }) {
  if (!blocksOnPlatform({ webOnly: true }, Platform.OS)) return <>{children}</>;
  return (
    <Center>
      <EmptyState
        icon="monitor"
        tone="accent"
        title="Open on web"
        body={`${title} is a web-only screen. Open Lanyard in a desktop browser to use it.`}
      />
    </Center>
  );
}
