// Web wallet provider: Reown AppKit with the wagmi adapter (P0.5-R3). Must not import any
// react-native-only package. Exports match WalletProvider.tsx.
import { createAppKit, useAppKit, useDisconnect } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { walletChains, walletEnv } from "./chains";

export type WalletModal = {
  available: boolean;
  reason?: string;
  open(): void;
  disconnect(): Promise<void> | void;
};

function createWallet(env: Extract<typeof walletEnv, { ok: true }>) {
  const networks = walletChains(env);
  const wagmiAdapter = new WagmiAdapter({ projectId: env.projectId, networks: [...networks] });
  createAppKit({
    projectId: env.projectId,
    networks: [...networks],
    defaultNetwork: networks[0],
    adapters: [wagmiAdapter],
    metadata: {
      name: "Lanyard",
      description: "Hackathon check-in, tickets and judging on Arkiv",
      // WalletConnect checks this against the page; the public origin is still to be chosen.
      url: window.location.origin,
      icons: [],
    },
  });
  return { wagmiAdapter, queryClient: new QueryClient() };
}

// Created once at module scope; walletEnv never changes at runtime.
const wallet = walletEnv.ok ? createWallet(walletEnv) : null;

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!wallet) return <>{children}</>;
  return (
    <WagmiProvider config={wallet.wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={wallet.queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

const unavailable: WalletModal = {
  available: false,
  reason: walletEnv.ok ? undefined : `Wallet not configured: set ${walletEnv.missing.join(", ")}.`,
  open: () => {},
  disconnect: () => {},
};

function useConfiguredModal(): WalletModal {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  return { available: true, open: () => void open(), disconnect: () => void disconnect() };
}

/** Chosen once at module load: walletEnv.ok never changes, so hook order is stable. */
export const useWalletModal: () => WalletModal = walletEnv.ok ? useConfiguredModal : () => unavailable;
