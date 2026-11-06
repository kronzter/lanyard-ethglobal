// The two chains the wallet connects to (P0.5-R3): Sepolia for ENS, Rabdi for Arkiv. Every value
// here is public: EXPO_PUBLIC_* values ship inside the app (plans/00-README.md › RPCs).
import { type Chain, defineChain } from "viem";
import { sepolia as viemSepolia } from "viem/chains";
import { RABDI_CHAIN_ID } from "@/shared/config/schema";

export const RABDI_PUBLIC_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";

export type WalletEnv =
  { ok: true; projectId: string; sepoliaRpc: string; rabdiRpc: string } | { ok: false; missing: string[] };

/** Read the wallet settings; a missing value disables the wallet instead of crashing the app. */
export function parseWalletEnv(env: {
  projectId?: string;
  sepoliaRpc?: string;
  rabdiRpc?: string;
}): WalletEnv {
  const missing = [
    !env.projectId && "EXPO_PUBLIC_REOWN_PROJECT_ID",
    !env.sepoliaRpc && "EXPO_PUBLIC_SEPOLIA_RPC_URL",
  ].filter((m): m is string => typeof m === "string");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    projectId: env.projectId!,
    sepoliaRpc: env.sepoliaRpc!,
    rabdiRpc: env.rabdiRpc || RABDI_PUBLIC_RPC,
  };
}

// Expo inlines each EXPO_PUBLIC_* value only when it is read as a literal member access.
export const walletEnv: WalletEnv = parseWalletEnv({
  projectId: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
  sepoliaRpc: process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL,
  rabdiRpc: process.env.EXPO_PUBLIC_RABDI_RPC_URL,
});

/** Sepolia and Rabdi with the configured RPC URLs, Sepolia first (the default network). */
export function walletChains(env: { sepoliaRpc: string; rabdiRpc: string }): readonly [Chain, Chain] {
  const sepolia: Chain = {
    ...viemSepolia,
    rpcUrls: { default: { http: [env.sepoliaRpc] } },
  };
  const rabdi = defineChain({
    id: RABDI_CHAIN_ID,
    name: "Arkiv Rabdi",
    nativeCurrency: { name: "Test GLM", symbol: "tGLM", decimals: 18 },
    rpcUrls: { default: { http: [env.rabdiRpc] } },
    testnet: true,
  });
  return [sepolia, rabdi];
}
