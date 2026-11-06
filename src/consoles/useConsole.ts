// The console runtime: live Sepolia addresses, a public client, on-chain authority reads and a
// guarded sender over the connected wallet. Thin glue; the policy lives in the pure modules here.
import { useCallback, useMemo } from "react";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { providers } from "@/providers";
import { requireLive } from "@/shared/deployments/load";
import { eventConfig } from "@/shared/event.config";
import { walletEnv } from "@/shell/wallet/chains";
import { useWallet } from "@/shell/wallet/useWallet";
import { lanyardRegistrarAbi } from "../ens/ensv2-abi";
import type { AuthorityReads } from "./authority";
import { sendGuarded, ConsoleBlocked, type TxRequest, type TxResult } from "./tx";

export type Live = {
  registrar: Address;
  edition: Address;
  hackersResolver: Address;
  staffResolver: Address;
  universalResolver: Address;
  publicAppOrigin: string;
};

type Env = { ok: true; live: Live; pc: PublicClient; reads: AuthorityReads } | { ok: false; reason: string };

const rolesAbi = parseAbi(["function roles(uint256 resource,address account) view returns (uint256)"]);

let cached: Env | undefined;
function env(): Env {
  if (cached) return cached;
  try {
    if (!walletEnv.ok) throw new Error(`Wallet not configured: set ${walletEnv.missing.join(", ")}.`);
    const d = requireLive(providers.deployments.sepolia, eventConfig);
    const need = (k: string): Address => {
      const a = d.contracts[k];
      if (!a) throw new Error(`deployments/sepolia.json has no contracts.${k}`);
      return getAddress(a);
    };
    const live: Live = {
      registrar: need("lanyardRegistrar"),
      edition: need("editionRegistry"),
      hackersResolver: need("hackersResolver"),
      staffResolver: need("staffResolver"),
      universalResolver: need("ensUniversalResolverV2"),
      publicAppOrigin: d.publicAppOrigin,
    };
    const pc = createPublicClient({
      chain: sepolia,
      transport: http(walletEnv.sepoliaRpc),
    }) as PublicClient;
    const reg = <T>(functionName: string, args: readonly unknown[] = []) =>
      pc.readContract({
        address: live.registrar,
        abi: lanyardRegistrarAbi,
        functionName,
        args,
      } as never) as Promise<T>;
    const reads: AuthorityReads = {
      organizer: () => reg<Address>("organizer"),
      headJudge: () => reg<Address>("headJudge"),
      partnerWallet: (h) => reg<Address>("partnerWallet", [h]),
      coordinatorRoles: (resource, account) =>
        pc.readContract({
          address: live.staffResolver,
          abi: rolesAbi,
          functionName: "roles",
          args: [resource, account],
        }),
    };
    cached = { ok: true, live, pc, reads };
  } catch (e) {
    cached = { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return cached;
}

export function useConsole() {
  const wallet = useWallet();
  const e = useMemo(env, []);

  const send = useCallback(
    async (req: TxRequest): Promise<TxResult> => {
      if (!e.ok) throw new ConsoleBlocked(e.reason);
      const wc = wallet.walletClient;
      if (!wc) throw new ConsoleBlocked("Connect a wallet first.");
      return sendGuarded(
        {
          wallet: { address: wallet.address, chainId: wallet.chainId, switchChain: wallet.switchChain },
          reads: e.reads,
          simulate: async ({ to, data, from }) => {
            await e.pc.call({ account: from, to, data });
          },
          send: ({ to, data, from }): Promise<Hex> =>
            wc.sendTransaction({ account: from, to, data, chain: sepolia }),
          wait: async (hash) => {
            const r = await e.pc.waitForTransactionReceipt({ hash });
            return { status: r.status, blockNumber: r.blockNumber };
          },
        },
        req,
      );
    },
    [e, wallet.walletClient, wallet.address, wallet.chainId, wallet.switchChain],
  );

  return {
    wallet,
    ready: e.ok,
    problem: e.ok ? null : e.reason,
    live: e.ok ? e.live : null,
    pc: e.ok ? e.pc : null,
    send,
  };
}
