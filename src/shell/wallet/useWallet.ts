// The one wallet hook for the app (P0.5-R3): address, chain, a viem wallet client and an
// EIP-1193 provider for Sepolia and Rabdi. Platform-agnostic; the platform lives in WalletProvider.
import { useEffect, useState } from "react";
import type { EIP1193Provider, WalletClient } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import type { Address } from "@/shared/types/primitives";
import { walletEnv } from "./chains";
import { useWalletModal } from "./WalletProvider";

export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected";

export type Wallet = {
  status: WalletStatus;
  reason?: string;
  address: Address | null;
  chainId: number | null;
  walletClient: WalletClient | null;
  provider: EIP1193Provider | null;
  connect(): void;
  disconnect(): void;
  switchChain(id: 11155111 | 7794095): void;
};

function useUnavailableWallet(): Wallet {
  const modal = useWalletModal();
  return {
    status: "unavailable",
    reason: modal.reason,
    address: null,
    chainId: null,
    walletClient: null,
    provider: null,
    connect: () => {},
    disconnect: () => {},
    switchChain: () => {},
  };
}

function useConfiguredWallet(): Wallet {
  const modal = useWalletModal();
  const account = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const connector = account.connector;

  useEffect(() => {
    let current = true;
    setProvider(null);
    if (account.status === "connected" && connector) {
      connector
        .getProvider()
        .then((p) => {
          if (current) setProvider(p as EIP1193Provider);
        })
        .catch(() => {
          if (current) setProvider(null);
        });
    }
    return () => {
      current = false;
    };
  }, [connector, account.status]);

  const status: WalletStatus =
    account.status === "connected"
      ? "connected"
      : account.status === "connecting" || account.status === "reconnecting"
        ? "connecting"
        : "disconnected";

  return {
    status,
    address: account.address ? (account.address.toLowerCase() as Address) : null,
    chainId: account.chainId ?? null,
    walletClient: (walletClient as WalletClient | undefined) ?? null,
    provider,
    connect: modal.open,
    disconnect: () => void modal.disconnect(),
    switchChain: (chainId) => switchChain({ chainId }),
  };
}

/** Chosen once at module load: walletEnv.ok never changes, so hook order is stable. */
export const useWallet: () => Wallet = walletEnv.ok ? useConfiguredWallet : useUnavailableWallet;
