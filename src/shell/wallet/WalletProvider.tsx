// Android (native) wallet provider: Reown AppKit React Native with its wagmi adapter (P0.5-R3).
// Metro picks WalletProvider.web.tsx on web; both files export the same names and types.
import "@walletconnect/react-native-compat";
import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppKit, AppKitProvider, createAppKit, useAppKit, type Storage } from "@reown/appkit-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
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

// AsyncStorage is app-wide, so a key written by another library may not hold JSON.
function parse<T>(v: string | null): T | undefined {
  if (v === null) return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

const storage: Storage = {
  getKeys: async () => [...(await AsyncStorage.getAllKeys())],
  getEntries: async <T,>() => {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet([...keys]);
    return pairs.map(([k, v]) => [k, parse<T>(v)] as [string, T]);
  },
  getItem: async <T,>(key: string) => {
    return parse<T>(await AsyncStorage.getItem(key));
  },
  setItem: async (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)),
  removeItem: async (key) => AsyncStorage.removeItem(key),
};

function createWallet(env: Extract<typeof walletEnv, { ok: true }>) {
  const networks = walletChains(env);
  const wagmiAdapter = new WagmiAdapter({ projectId: env.projectId, networks });
  const appKit = createAppKit({
    projectId: env.projectId,
    networks: [...networks],
    defaultNetwork: networks[0],
    adapters: [wagmiAdapter],
    storage,
    metadata: {
      name: "Lanyard",
      description: "Hackathon check-in, tickets and judging on Arkiv",
      // Placeholder: the public origin is still to be chosen.
      url: "https://lanyard.app",
      icons: [],
      redirect: { native: "lanyard://" },
    },
  });
  return { wagmiAdapter, appKit, queryClient: new QueryClient() };
}

// Created once at module scope; walletEnv never changes at runtime.
const wallet = walletEnv.ok ? createWallet(walletEnv) : null;

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!wallet) return <>{children}</>;
  return (
    <AppKitProvider instance={wallet.appKit}>
      <WagmiProvider config={wallet.wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={wallet.queryClient}>
          {children}
          <AppKit />
        </QueryClientProvider>
      </WagmiProvider>
    </AppKitProvider>
  );
}

const unavailable: WalletModal = {
  available: false,
  reason: walletEnv.ok ? undefined : `Wallet not configured: set ${walletEnv.missing.join(", ")}.`,
  open: () => {},
  disconnect: () => {},
};

function useConfiguredModal(): WalletModal {
  const { open, disconnect } = useAppKit();
  return { available: true, open: () => open(), disconnect: () => disconnect() };
}

/** Chosen once at module load: walletEnv.ok never changes, so hook order is stable. */
export const useWalletModal: () => WalletModal = walletEnv.ok ? useConfiguredModal : () => unavailable;
