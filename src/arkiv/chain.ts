// Rabdi chain settings for Arkiv clients and wallets (B1.1-R1). Every value here is public: a
// read-only access key, if one is configured, ships in the app as an EXPO_PUBLIC_* value and is
// treated as public (plans/00-README.md › RPCs). No signing key is ever configured here.
import { rabdi } from "@arkiv-network/sdk/chains";
import { RABDI_CHAIN_ID } from "@/shared/config/schema";

export const RABDI_PUBLIC_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";
export const RABDI_EXPLORER = "https://rabdi.explorer.arkiv.network";

export type RabdiAccess = { rpcUrl?: string; accessKey?: string };

/** The SDK's Rabdi chain with an explicit (possibly empty) read access key. */
export const rabdiChain = (access: RabdiAccess = {}) => rabdi({ accessKey: access.accessKey ?? "" });

/** The RPC URL reads go to: the configured one, else the keyless public endpoint. */
export const rabdiRpcUrl = (access: RabdiAccess = {}) => access.rpcUrl || RABDI_PUBLIC_RPC;

/** `wallet_addEthereumChain` parameters (EIP-3085); keyless, so no credential reaches a wallet. */
export const RABDI_WALLET_ADD_PARAMS = {
  chainId: `0x${RABDI_CHAIN_ID.toString(16)}`,
  chainName: "Arkiv Rabdi",
  nativeCurrency: { name: "Test GLM", symbol: "tGLM", decimals: 18 },
  rpcUrls: [RABDI_PUBLIC_RPC],
  blockExplorerUrls: [RABDI_EXPLORER],
} as const;

/** Hide credentials in a URL before it reaches a log line or an error message. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) u.username = u.password = "***";
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, "***");
    u.pathname = u.pathname
      .split("/")
      .map((seg) => (seg.length >= 16 && /^[A-Za-z0-9_-]+$/.test(seg) ? "***" : seg))
      .join("/");
    return u.toString();
  } catch {
    return "<invalid url>";
  }
}

export const txUrl = (hash: string) => `${RABDI_EXPLORER}/tx/${hash}`;
