import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { readPermissionMap, type PermissionMap } from "@/ens/permission-map";
import { providers } from "@/providers";
import { Banner, Button, Card, Pill, Row, Screen, Stackv, Txt } from "@/ui";

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

export default function PermissionMapScreen() {
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
    <Screen
      title="Permission map"
      subtitle="Every role grant on Lanyard's contracts, read from EACRolesChanged events."
      maxWidth={960}
    >
      <Button variant="ghost" icon="refresh" label="Refresh" onPress={run} />
      {state.status === "loading" && <Banner icon="refresh">Scanning Sepolia logs...</Banner>}
      {state.status === "error" && (
        <Banner tone="danger">{`Could not read the permission map: ${state.message}`}</Banner>
      )}
      {state.status === "ready" && <MapView map={state.map} />}
    </Screen>
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
    <Stackv gap={12}>
      <Txt variant="caption" tone="muted">
        Block {map.block.toString()} · {map.grants.length} grants across {byContract.size} contracts
      </Txt>
      {map.mismatches.length > 0 ? (
        <Banner
          tone="danger"
          title={`Mismatch: ${map.mismatches.length} entries differ from direct on-chain reads`}
        >
          <Stackv gap={2}>
            {map.mismatches.map((m, i) => (
              <Txt key={i} mono tone="danger">
                {m.kind} {m.contract} {m.resource.slice(0, 12)}
                {"account" in m ? ` ${m.account}` : ""}
                {"folded" in m ? ` events=${m.folded.toString(16)}` : ""}
                {"onchain" in m ? ` chain=${m.onchain.toString(16)}` : ""}
              </Txt>
            ))}
          </Stackv>
        </Banner>
      ) : (
        <Banner tone="success" title="Verified">
          Verified: every entry matches roles, hasRoles and roleCount reads at this block.
        </Banner>
      )}
      {[...byContract].map(([contract, resources]) => (
        <Card key={contract}>
          <Txt variant="h2">{contract}</Txt>
          {[...resources].map(([resource, grants]) => (
            <Stackv key={resource} gap={4}>
              <Txt variant="caption" mono tone="faint">
                resource {resource.slice(0, 18)}...
              </Txt>
              {grants.map((g) => (
                <Row key={g.account} gap={6}>
                  <Txt mono selectable>
                    {g.account}:
                  </Txt>
                  {g.roleNames.map((n) => (
                    <Pill key={n} label={n} tone="accent" />
                  ))}
                </Row>
              ))}
            </Stackv>
          ))}
        </Card>
      ))}
    </Stackv>
  );
}
