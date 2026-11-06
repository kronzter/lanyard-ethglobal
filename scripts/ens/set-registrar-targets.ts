// One-shot, permanent registrar wiring after `seal`: setPublicationResolver and setWinnerRegistrar.
// Both calls cannot be undone, so each target is verified read-only first and a failed check sends nothing
// (A1-D8). The decisions live in src/ens/deploy-guards.ts.
//
//   pnpm exec tsx scripts/ens/set-registrar-targets.ts [--plan] [--fork] --publication
//   pnpm exec tsx scripts/ens/set-registrar-targets.ts [--plan] [--fork] --winner 0x… [--allow-unverified-winner-registrar]
//
// --publication uses the publication resolver recorded by deploy-resolvers.ts. No WinnerRegistrar contract
// exists in the repo yet (A4.1), so there is nothing to read a back-pointer from; --winner is refused unless
// --allow-unverified-winner-registrar says the address was checked by hand. Once A4.1 lands, read its
// registrar pointer into `pointsBack` below and drop the override. Env as in deploy-edition.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, parseAbi, type Address } from "viem";
import { publicationResolverProblems, winnerRegistrarProblems } from "../../src/ens/deploy-guards";
import { lanyardRegistrarAbi } from "../../src/ens/ensv2-abi";
import { assertRegistrarVersion } from "../../src/ens/registrar-version";
import { connect, fail, ROOT, sameAddress } from "./connect";

const resolverAbi = parseAbi([
  "function roles(uint256 resource,address account) view returns (uint256)",
  "function roleCount(uint256 resource) view returns (uint256)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
]);
const PERMISSIONED_RESOLVER_INTERFACE = "0x8c2427cc";
const ZERO = "0x0000000000000000000000000000000000000000";
const SEALED = 2;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set<string>();
  let winner: Address | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--winner") winner = getAddress(argv[++i] ?? "");
    else if (["--plan", "--fork", "--publication", "--allow-unverified-winner-registrar"].includes(a))
      flags.add(a);
    else throw new Error(`unknown argument ${a}`);
  }
  const plan = flags.has("--plan");
  if (!flags.has("--publication") && !winner)
    throw new Error("nothing to do: pass --publication and/or --winner <address>");
  const ctx = await connect({ fork: flags.has("--fork"), needKey: !plan });
  const pc = ctx.publicClient;

  const state = JSON.parse(readFileSync(ctx.statePath, "utf8")) as { registrar?: Address };
  if (!state.registrar) throw new Error(`no registrar recorded in ${ctx.statePath}`);
  const registrar = state.registrar;
  await assertRegistrarVersion(pc, registrar);
  const reg = { address: registrar, abi: lanyardRegistrarAbi } as const;
  const phase = await pc.readContract({ ...reg, functionName: "phase" });
  if (phase !== SEALED) throw new Error(`registrar is in phase ${phase}; both calls need it sealed`);

  const wc = ctx.walletClient;
  const common = wc && ctx.account ? ({ account: ctx.account, chain: wc.chain } as const) : null;
  const calls: { label: string; run: () => Promise<`0x${string}`> }[] = [];

  if (flags.has("--publication")) {
    if (!sameAddress(await pc.readContract({ ...reg, functionName: "publicationResolver" }), ZERO))
      throw new Error("publication resolver is already set");
    const meta = JSON.parse(
      readFileSync(resolve(ROOT, `.lanyard/resolvers-${ctx.fork ? "fork" : "sepolia"}.json`), "utf8"),
    ) as { hackers: Address; staff: Address; publication: Address };
    const target = meta.publication;
    const code = await pc.getCode({ address: target });
    const hasCode = !!code && code !== "0x";
    const at = { address: target, abi: resolverAbi } as const;
    // Reads on an address without code would revert; the hasCode problem is reported instead.
    const problems = publicationResolverProblems({
      target,
      recorded: meta.publication,
      hackers: meta.hackers,
      staff: meta.staff,
      hasCode,
      supportsInterface: hasCode
        ? await pc.readContract({
            ...at,
            functionName: "supportsInterface",
            args: [PERMISSIONED_RESOLVER_INTERFACE],
          })
        : false,
      rootCounts: hasCode ? await pc.readContract({ ...at, functionName: "roleCount", args: [0n] }) : 0n,
      organizerRoot: hasCode
        ? await pc.readContract({ ...at, functionName: "roles", args: [0n, ctx.organizer] })
        : 0n,
      registrarRoot: hasCode
        ? await pc.readContract({ ...at, functionName: "roles", args: [0n, registrar] })
        : 0n,
    });
    if (problems.length > 0)
      throw new Error(`refusing setPublicationResolver, nothing sent: ${problems.join("; ")}`);
    console.log(`publication resolver ${target}: checks pass`);
    calls.push({
      label: "setPublicationResolver",
      run: () => {
        if (!wc || !common) throw new Error("ORGANIZER_PRIVATE_KEY is required");
        return wc.writeContract({
          ...reg,
          functionName: "setPublicationResolver",
          args: [target],
          ...common,
        });
      },
    });
  }

  if (winner) {
    const target = winner;
    if (!sameAddress(await pc.readContract({ ...reg, functionName: "winnerRegistrar" }), ZERO))
      throw new Error("winner registrar is already set");
    const code = await pc.getCode({ address: target });
    const problems = winnerRegistrarProblems({
      target,
      registrar,
      organizer: ctx.organizer,
      hasCode: !!code && code !== "0x",
      pointsBack: null, // no WinnerRegistrar ABI exists yet (A4.1)
      allowUnverified: flags.has("--allow-unverified-winner-registrar"),
    });
    if (problems.length > 0)
      throw new Error(`refusing setWinnerRegistrar, nothing sent: ${problems.join("; ")}`);
    console.log(`winner registrar ${target}: checks pass (back-pointer unverified)`);
    calls.push({
      label: "setWinnerRegistrar",
      run: () => {
        if (!wc || !common) throw new Error("ORGANIZER_PRIVATE_KEY is required");
        return wc.writeContract({ ...reg, functionName: "setWinnerRegistrar", args: [target], ...common });
      },
    });
  }

  if (plan) return console.log(`plan: ${calls.map((c) => c.label).join(" → ")}`);
  for (const call of calls) {
    const hash = await call.run();
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${call.label} reverted in ${hash}`);
    console.log(`  ok  ${call.label}  ${hash}`);
  }
}

main().catch((err: unknown) => fail("set-registrar-targets", err));
