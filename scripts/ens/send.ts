// Simulate, send and confirm one transaction from the connected signer. A concurrent change makes
// the simulation fail instead of being overwritten. Returns the block it landed in.
import type { Address, Hex } from "viem";
import type { Connection } from "./connect";

export async function sendTx(ctx: Connection, to: Address, data: Hex, what: string): Promise<bigint> {
  const { walletClient: wc, publicClient: pc, account } = ctx;
  if (!wc || !account) throw new Error(`a signing key is required to ${what}`);
  await pc.call({ to, data, account });
  const hash = await wc.sendTransaction({ to, data, account, chain: wc.chain });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${what} reverted in ${hash}`);
  console.log(`  ${what}: confirmed ${hash} in block ${receipt.blockNumber}`);
  return receipt.blockNumber;
}
