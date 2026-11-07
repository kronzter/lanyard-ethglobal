// Shared by the ENS operator scripts: RPC, organizer wallet and the local state file, all taken from
// process.env (these scripts never open a .env file) and never printed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAddress,
  isAddress,
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { sepolia } from "viem/chains";
import sepoliaJson from "../../deployments/sepolia.json";
import { parseSepoliaDeployment } from "../../src/shared/deployments/load";
import { eventConfig } from "../../src/shared/event.config";
import { sepoliaEventConfig } from "../../src/shared/live-event.config";
import { assertLoopbackUrl, chooseOrganizer, privateKeyFromEnv, redactUrls, registrarFrom } from "./safety";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type Connection = {
  fork: boolean;
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  organizer: Address;
  /** The signer: the organizer's key, SIGNER_PRIVATE_KEY for another role, or an impersonated fork account. */
  account: Account | null;
  /** `.lanyard/edition-<fork|sepolia>.json`, git-ignored. */
  statePath: string;
};

export const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * `SEPOLIA_RPC_URL` (or `FORK_RPC_URL`, default a local anvil, with `fork`) and a signing key.
 * The organizer signs with `ORGANIZER_PRIVATE_KEY`; a live organizer run requires that key to belong to
 * `authorities.organizer`, or to LANYARD_LIVE_ORGANIZER when set (see chooseOrganizer). Other roles
 * (`signer: "other"`: coordinator, head judge, partner) sign with `SIGNER_PRIVATE_KEY`, and the
 * contracts decide whether that wallet may act. On a loopback fork only, `FORK_IMPERSONATE=<address>`
 * replaces the key with anvil's impersonation, so rehearsals need no secret at all.
 */
export async function connect(opts: {
  fork: boolean;
  needKey: boolean;
  signer?: "organizer" | "other";
}): Promise<Connection> {
  const rpcUrl = opts.fork
    ? (process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545")
    : process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is not set");
  if (opts.fork) assertLoopbackUrl(rpcUrl);
  const signer = opts.signer ?? "organizer";
  const keyEnv = signer === "organizer" ? "ORGANIZER_PRIVATE_KEY" : "SIGNER_PRIVATE_KEY";
  const impersonate = process.env.FORK_IMPERSONATE;
  if (impersonate && !opts.fork) throw new Error("FORK_IMPERSONATE is only allowed with --fork");
  if (impersonate && !isAddress(impersonate, { strict: false }))
    throw new Error("FORK_IMPERSONATE is not an address");
  const key = impersonate ? undefined : process.env[keyEnv];
  if (opts.needKey && !key && !impersonate) throw new Error(`${keyEnv} is not set`);

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id)
    throw new Error(`RPC reports chain ${chainId}, expected Sepolia (${sepolia.id})`);

  let account: Account | null = key ? privateKeyToAccount(privateKeyFromEnv(key, keyEnv)) : null;
  if (impersonate) {
    await publicClient.request({
      method: "anvil_impersonateAccount" as never,
      params: [impersonate] as never,
    });
    account = { address: getAddress(impersonate), type: "json-rpc" };
  }
  const { organizer, warning } = chooseOrganizer({
    fork: opts.fork,
    key: signer === "organizer" ? (account?.address ?? null) : null,
    // Live runs answer to the deployed organizer (I2's live config); forks keep the fixture wallets.
    config: (opts.fork ? eventConfig : sepoliaEventConfig).authorities.organizer,
    override: process.env.LANYARD_LIVE_ORGANIZER,
  });
  if (warning) console.warn(`warning: ${warning}`);
  return {
    fork: opts.fork,
    publicClient,
    walletClient: account ? createWalletClient({ account, chain: sepolia, transport }) : null,
    organizer,
    account,
    statePath: resolve(ROOT, `.lanyard/edition-${opts.fork ? "fork" : "sepolia"}.json`),
  };
}

/** The registrar this run acts on: local deploy state, else (live only) deployments/sepolia.json. */
export function loadRegistrar(ctx: Connection): Address {
  let stateText: string | null = null;
  try {
    stateText = readFileSync(ctx.statePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return registrarFrom({ stateText, fork: ctx.fork, deployment: parseSepoliaDeployment(sepoliaJson) });
}

/** Prints an error without ever echoing an RPC URL and sets a non-zero exit code. */
export function fail(script: string, err: unknown): void {
  const text =
    err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  const urls = [process.env.SEPOLIA_RPC_URL, process.env.FORK_RPC_URL].filter((u): u is string => !!u);
  console.error(`${script}: ${redactUrls(text, urls)}`);
  process.exitCode = 1;
}
