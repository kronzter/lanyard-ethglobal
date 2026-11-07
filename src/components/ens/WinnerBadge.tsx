import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { providers } from "@/providers";
import { createSepoliaEnsReader } from "@/ens/sepolia-ens-reader";
import { PLACE_TEXT, lockedWinnerPlace, type WinnerPlace } from "@/ens/prizes";
import { eventConfig } from "@/shared/event.config";
import type { EnsReader } from "@/shared/interfaces/ens-reader";

let shared: EnsReader | null = null;
/** The Sepolia reader on the app's public RPC; null when EXPO_PUBLIC_SEPOLIA_RPC_URL is unset. */
function defaultReader(): EnsReader | null {
  if (shared) return shared;
  if (providers.flags.ens === "mock") return providers.ensReader();
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  const deployment = providers.deployments.sepolia;
  if (!rpcUrl || deployment.mode !== "live") return null;
  shared = createSepoliaEnsReader({
    rpcUrl,
    deployment,
    names: eventConfig,
  });
  return shared;
}

type State = { status: "loading" } | { status: "done"; place: WinnerPlace | null } | { status: "error" };

/**
 * "Winner" / "Runner-up" for a team, read from `lanyard.prizes` on `winner.<label>` through the
 * Universal Resolver, once the edition's `lanyard.locked` sentinel is "1" at that same block. Renders
 * nothing while loading, before the lock or when the team has no such prize, and a quiet
 * "Prize status unavailable" line when the read fails. `reader` is for tests and previews.
 */
export function WinnerBadge({ label, reader }: { label: string; reader?: EnsReader }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    (async () => {
      const r = reader ?? defaultReader();
      if (!r) throw new Error("no Sepolia RPC configured");
      // The prize shows only once the edition's lanyard.locked is "1" at the same block.
      return lockedWinnerPlace(r, label, await r.headBlock());
    })().then(
      (place) => live && setState({ status: "done", place }),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, [label, reader]);

  if (state.status === "loading") return null;
  if (state.status === "error")
    return <Text style={{ fontSize: 12, color: "#71717a" }}>Prize status unavailable</Text>;
  if (!state.place) return null;
  const winner = state.place === "winner";
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 12,
        paddingVertical: 4,
        paddingHorizontal: 10,
        backgroundColor: winner ? "#fef3c7" : "#e4e4e7",
        borderWidth: 1,
        borderColor: winner ? "#d97706" : "#a1a1aa",
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "600", color: winner ? "#78350f" : "#3f3f46" }}>
        {PLACE_TEXT[state.place]}
      </Text>
    </View>
  );
}

export default WinnerBadge;
