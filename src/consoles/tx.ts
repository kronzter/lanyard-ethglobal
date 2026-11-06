// A4.3-R1/R2/R4: one guarded transaction. Chain guard, then on-chain authority, then simulate,
// send and wait. The result is the hash plus the Sepolia block.
import type { Address, Hex } from "viem";
import { checkAuthority, type Authority, type AuthorityReads } from "./authority";
import { guardChain } from "./chain-guard";

export type TxResult = { hash: Hex; block: bigint };

export class ConsoleBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleBlocked";
  }
}

/** The transaction was broadcast but its outcome is unknown or failed; the hash lets you reconcile. */
export class TxUncertain extends Error {
  constructor(
    message: string,
    readonly hash: Hex,
  ) {
    super(message);
    this.name = "TxUncertain";
  }
}

export type TxDeps = {
  wallet: {
    address: Address | null;
    chainId: number | null;
    switchChain: Parameters<typeof guardChain>[0]["switchChain"];
  };
  reads: AuthorityReads;
  simulate(req: { to: Address; data: Hex; from: Address }): Promise<void>;
  send(req: { to: Address; data: Hex; from: Address }): Promise<Hex>;
  wait(hash: Hex): Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
};

export type TxRequest = { to: Address; data: Hex; what: string; authority: Authority };

export const formatTxResult = (r: TxResult): string => `tx ${r.hash} in Sepolia block ${r.block}`;

export async function sendGuarded(deps: TxDeps, req: TxRequest): Promise<TxResult> {
  const guard = guardChain(deps.wallet);
  if (!guard.ok) throw new ConsoleBlocked(guard.message);
  const auth = await checkAuthority(req.authority, deps.wallet.address, deps.reads);
  if (!auth.ok) throw new ConsoleBlocked(auth.message);
  const from = deps.wallet.address!;
  try {
    await deps.simulate({ to: req.to, data: req.data, from });
  } catch (e) {
    throw new ConsoleBlocked(
      `${req.what} would revert: ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`,
    );
  }
  const hash = await deps.send({ to: req.to, data: req.data, from });
  let receipt;
  try {
    receipt = await deps.wait(hash);
  } catch (e) {
    throw new TxUncertain(
      `${req.what}: sent as ${hash} but not confirmed (${e instanceof Error ? e.message : String(e)}). Check it before retrying.`,
      hash,
    );
  }
  if (receipt.status !== "success") throw new TxUncertain(`${req.what} reverted in ${hash}`, hash);
  return { hash, block: receipt.blockNumber };
}
