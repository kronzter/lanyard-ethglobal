// Feeds the real wallet's address into the session (P0.5-R3). Renders nothing. Only real wallet
// changes are forwarded, so the mock-mode dev picker is left alone until a real wallet appears.
import { useEffect, useMemo, useRef } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { providers } from "@/providers";
import { fixtureTimeline } from "@/shared/mocks/fixtures";
import type { AtBlock } from "@/shared/interfaces/ens-reader";
import { DEFAULT_MOCK_MOMENT, mockMoments } from "./mock-clock";
import { useSession } from "./session";
import { walletEnv } from "./wallet/chains";
import { useWallet } from "./wallet/useWallet";

export function WalletBridge() {
  const session = useSession();
  const { address } = useWallet();
  const moments = useMemo(() => mockMoments(fixtureTimeline()), []);
  const wasConnected = useRef(false);
  const connect = useRef(session.connect);
  const disconnect = useRef(session.disconnect);
  connect.current = session.connect;
  disconnect.current = session.disconnect;

  useEffect(() => {
    if (!address) {
      if (wasConnected.current) {
        wasConnected.current = false;
        disconnect.current();
      }
      return;
    }
    wasConnected.current = true;
    let current = true;
    const readAt = async (): Promise<AtBlock> => {
      if (providers.flags.ens === "mock") {
        return { sepoliaBlock: moments.find((m) => m.id === DEFAULT_MOCK_MOMENT)!.block };
      }
      if (!walletEnv.ok) throw new Error("Sepolia RPC is not configured");
      const client = createPublicClient({ chain: sepolia, transport: http(walletEnv.sepoliaRpc) });
      const block = await client.getBlock();
      return { sepoliaBlock: block.number };
    };
    readAt()
      .then((at) => {
        if (current) connect.current(address, at);
      })
      .catch((e: unknown) => console.warn("Could not read the latest Sepolia block", e));
    return () => {
      current = false;
    };
  }, [address, moments]);

  return null;
}
