import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { readPermissionMap, type PermissionMap } from "@/ens/permission-map";
import { providers } from "@/providers";
import { styles } from "@/shell/styles";

// Web-only through app/admin/ens/_layout.tsx (WebOnly).
async function load(): Promise<PermissionMap> {
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("EXPO_PUBLIC_SEPOLIA_RPC_URL is not set");
  const d = providers.deployments.sepolia;
  if (d.mode !== "live") throw new Error("deployments/sepolia.json is not a live deployment");
  const c = d.contracts;
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) }) as PublicClient;
  return readPermissionMap(client, {
    deployedAtBlock: BigInt(d.deployedAtBlock),
    registrar: c.lanyardRegistrar as Address,
    baseRegistry: c.baseRegistry as Address,
    editionRegistry: c.editionRegistry as Address,
    resolvers: {
      hackersResolver: c.hackersResolver as Address,
      staffResolver: c.staffResolver as Address,
      publicationResolver: c.publicationResolver as Address,
    },
  });
}

type State =
  { status: "loading" } | { status: "ready"; map: PermissionMap } | { status: "error"; message: string };

export default function Screen() {
  const [state, setState] = useState<State>({ status: "loading" });
  const run = useCallback(() => {
    setState({ status: "loading" });
    load().then(
      (map) => setState({ status: "ready", map }),
      (e: unknown) =>
        setState({
          status: "error",
          message: (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "<rpc-url>"),
        }),
    );
  }, []);
  useEffect(run, [run]);

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Permission map</Text>
      <Text style={styles.muted}>
        Every role grant on Lanyard's contracts, read from EACRolesChanged events.
      </Text>
      <Text style={styles.link} onPress={run}>
        Refresh
      </Text>
      {state.status === "loading" && <Text>Scanning Sepolia logs...</Text>}
      {state.status === "error" && (
        <Text style={{ color: "#b91c1c" }}>Could not read the permission map: {state.message}</Text>
      )}
      {state.status === "ready" && <MapView map={state.map} />}
    </ScrollView>
  );
}

function MapView({ map }: { map: PermissionMap }) {
  const byContract = new Map<string, Map<string, PermissionMap["grants"]>>();
  for (const g of map.grants) {
    const resources = byContract.get(g.contract) ?? new Map();
    resources.set(g.resource, [...(resources.get(g.resource) ?? []), g]);
    byContract.set(g.contract, resources);
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.muted}>
        Block {map.block.toString()} · {map.grants.length} grants across {byContract.size} contracts
      </Text>
      {map.mismatches.length > 0 ? (
        <View
          style={{
            backgroundColor: "#fee2e2",
            borderColor: "#b91c1c",
            borderWidth: 1,
            borderRadius: 8,
            padding: 12,
            gap: 4,
          }}
        >
          <Text style={{ fontWeight: "700", color: "#7f1d1d" }}>
            Mismatch: {map.mismatches.length} entries differ from direct on-chain reads
          </Text>
          {map.mismatches.map((m, i) => (
            <Text key={i} style={[styles.mono, { color: "#7f1d1d" }]}>
              {m.kind} {m.contract} {m.resource.slice(0, 12)}
              {"account" in m ? ` ${m.account}` : ""}
              {"folded" in m ? ` events=${m.folded.toString(16)}` : ""}
              {"onchain" in m ? ` chain=${m.onchain.toString(16)}` : ""}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={{ color: "#166534" }}>
          Verified: every entry matches roles, hasRoles and roleCount reads at this block.
        </Text>
      )}
      {[...byContract].map(([contract, resources]) => (
        <View key={contract} style={styles.card}>
          <Text style={styles.h2}>{contract}</Text>
          {[...resources].map(([resource, grants]) => (
            <View key={resource} style={{ gap: 2 }}>
              <Text style={[styles.mono, styles.muted]}>resource {resource.slice(0, 18)}...</Text>
              {grants.map((g) => (
                <Text key={g.account} style={styles.mono}>
                  {g.account}: {g.roleNames.join(", ")}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
