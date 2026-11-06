// A4.3-R4: a console never sends on the wrong chain. It asks the wallet to switch and stops.
export const SEPOLIA_CHAIN_ID = 11155111 as const;

export type ChainGuard = { ok: true } | { ok: false; message: string };

export function guardChain(wallet: {
  chainId: number | null;
  switchChain(id: typeof SEPOLIA_CHAIN_ID): void;
}): ChainGuard {
  if (wallet.chainId === null) return { ok: false, message: "Connect a wallet first." };
  if (wallet.chainId === SEPOLIA_CHAIN_ID) return { ok: true };
  wallet.switchChain(SEPOLIA_CHAIN_ID);
  return {
    ok: false,
    message: `Wallet is on chain ${wallet.chainId}, not Sepolia. Asked it to switch; approve in the wallet and retry. Nothing was sent.`,
  };
}
