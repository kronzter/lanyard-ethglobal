// Issues one partner badge (staff or judge) through LanyardRegistrar.registerPartnerBadge, signed by the
// partner's own wallet (I3: `sam.staff.arkiv.partners` for the partner-help ticket):
//   pnpm exec tsx scripts/ens/issue-partner-badge.ts --partner arkiv --sub staff --label sam --owner 0x…
//     [--fork] [--dry-run]
// Signs with SIGNER_PRIVATE_KEY (the partner wallet onboarded by grant-roles.ts; FORK_IMPERSONATE on a
// fork); the registrar decides whether that wallet may issue. Re-running with the same arguments does
// nothing, and a label held by someone else is never overwritten. Reads process.env only.
import { isAddress, keccak256, toHex, type Address } from "viem";
import { decideBadge } from "../../src/ens/badge-plan";
import { lanyardRegistrarAbi, permissionedRegistryAbi } from "../../src/ens/ensv2-abi";
import { connect, fail, loadRegistrar } from "./connect";

const USAGE =
  "usage: issue-partner-badge.ts --partner <id> --sub staff|judges --label <label> --owner <address> [--fork] [--dry-run]";
const SUBS = ["staff", "judges"] as const;

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const partner = get("--partner");
  const sub = get("--sub");
  const label = get("--label");
  const owner = get("--owner");
  if (!partner || !/^[a-z0-9-]+$/.test(partner)) throw new Error(`--partner is required\n${USAGE}`);
  if (!sub || !(SUBS as readonly string[]).includes(sub))
    throw new Error(`--sub must be staff or judges\n${USAGE}`);
  if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error(`--label must be one lowercase label\n${USAGE}`);
  if (!owner || !isAddress(owner, { strict: false })) throw new Error(`--owner must be an address\n${USAGE}`);
  return {
    partner,
    sub,
    label,
    owner: owner as Address,
    fork: argv.includes("--fork"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(): Promise<void> {
  const req = parseArgs(process.argv.slice(2));
  const ctx = await connect({ fork: req.fork, needKey: !req.dryRun, signer: "other" });
  const { publicClient: pc, walletClient: wc, account } = ctx;
  const registrar = loadRegistrar(ctx);
  const partner = keccak256(toHex(req.partner));
  const sub = keccak256(toHex(req.sub));

  const registry = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "partnerBookRegistry",
    args: [partner, sub],
  });
  if (BigInt(registry) === 0n)
    throw new Error(
      `${req.sub}.${req.partner}.partners does not exist yet: onboard the partner (grant-roles.ts)`,
    );
  const currentOwner = await pc.readContract({
    address: registry,
    abi: permissionedRegistryAbi,
    functionName: "getOwner",
    args: [BigInt(keccak256(toHex(req.label)))],
  });
  const name = `${req.label}.${req.sub}.${req.partner}.partners`;
  const decision = decideBadge({ currentOwner, wantedOwner: req.owner });
  console.log(`${name} -> ${req.owner}`);
  if (decision.action !== "issue") {
    if (decision.action === "blocked") throw new Error(`blocked: ${decision.reason}`);
    console.log(`nothing to do: ${decision.reason}`);
    return;
  }
  if (req.dryRun) {
    console.log("dry run: would issue");
    return;
  }
  if (!wc || !account) throw new Error("SIGNER_PRIVATE_KEY (the partner wallet) is required to send");

  const hash = await wc.writeContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "registerPartnerBadge",
    args: [partner, sub, req.label, req.owner],
    account,
    chain: wc.chain,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`registerPartnerBadge reverted in ${hash}`);
  console.log(`issued ${name}  ${hash}`);
}

main().catch((err: unknown) => fail("issue-partner-badge", err));
