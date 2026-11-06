// Shared by the ENS operator scripts: RPC, organizer wallet and the local state file, all taken from
// process.env (these scripts never open a .env file) and never printed.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { eventConfig } from "../../src/shared/event.config";
import { assertLoopbackUrl, redactUrls } from "./safety";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type Connection = {
  fork: boolean;
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  organizer: Address;
  account: PrivateKeyAccount | null;
  /** `.lanyard/edition-<fork|sepolia>.json`, git-ignored. */
  statePath: string;
};

export const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * `SEPOLIA_RPC_URL` (or `FORK_RPC_URL`, default a local anvil, with `fork`) and `ORGANIZER_PRIVATE_KEY`.
 * A live run requires the key to belong to `authorities.organizer`; a fork run accepts any key.
 */
export async function connect(opts: { fork: boolean; needKey: boolean }): Promise<Connection> {
  const rpcUrl = opts.fork
    ? (process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545")
    : process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is not set");
  if (opts.fork) assertLoopbackUrl(rpcUrl);
  const key = process.env.ORGANIZER_PRIVATE_KEY;
  if (opts.needKey && !key) throw new Error("ORGANIZER_PRIVATE_KEY is not set");

  const account = key ? privateKeyToAccount(key as Hex) : null;
  const organizer = account?.address ?? getAddress(eventConfig.authorities.organizer);
  if (!opts.fork && account && !sameAddress(account.address, eventConfig.authorities.organizer)) {
    throw new Error(
      "ORGANIZER_PRIVATE_KEY does not match authorities.organizer in src/shared/event.config.ts",
    );
  }

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id)
    throw new Error(`RPC reports chain ${chainId}, expected Sepolia (${sepolia.id})`);
  return {
    fork: opts.fork,
    publicClient,
    walletClient: account ? createWalletClient({ account, chain: sepolia, transport }) : null,
    organizer,
    account,
    statePath: resolve(ROOT, `.lanyard/edition-${opts.fork ? "fork" : "sepolia"}.json`),
  };
}

/** Prints an error without ever echoing an RPC URL and sets a non-zero exit code. */
export function fail(script: string, err: unknown): void {
  const text =
    err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  const urls = [process.env.SEPOLIA_RPC_URL, process.env.FORK_RPC_URL].filter((u): u is string => !!u);
  console.error(`${script}: ${redactUrls(text, urls)}`);
  process.exitCode = 1;
}
