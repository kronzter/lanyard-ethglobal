#!/usr/bin/env tsx
// A2.3-R1: revoke a badge by unregistering it in its holding registry.
//   pnpm exec tsx scripts/ens/revoke.ts (--book <hackers|judges|volunteers> | --partner <p> --sub <judges|staff>)
//     --label <l> [--as organizer|other] [--fork] [--dry-run]
// `--as other` (default) signs with SIGNER_PRIVATE_KEY: the head judge (judges book) or the partner
// (its sub-books) hold ROLE_UNREGISTER. `--as organizer` signs with the organizer, who holds it on the
// book roots. The registry decides; a wallet without the role reverts in simulation. An already
// unregistered or expired badge is skipped, so a rerun does nothing. Reads process.env only.
import { ArgError } from "../../src/ens/cli-args";
import {
  decideRevoke,
  historyEvent,
  labelId,
  parseRevokeArgs,
  REVOKE_USAGE,
  targetName,
} from "../../src/ens/revive-plan";
import { badgeRegistryAbi, resolveRegistry } from "./badge-target";
import { connect, fail } from "./connect";
import { recordHistory } from "./history";
import { loadLiveSepolia } from "./live";
import { sendTxWithHash } from "./send";
import { encodeFunctionData } from "viem";

async function main(): Promise<void> {
  const req = parseRevokeArgs(process.argv.slice(2));
  const live = loadLiveSepolia();
  const ctx = await connect({ fork: req.fork, needKey: !req.dryRun, signer: req.as });
  const pc = ctx.publicClient;
  const registry = await resolveRegistry(ctx, live.registrar, req.target);
  const id = labelId(req.target.label);
  const name = targetName(req.target);

  const [status, owner] = await Promise.all([
    pc.readContract({ address: registry, abi: badgeRegistryAbi, functionName: "getStatus", args: [id] }),
    pc.readContract({ address: registry, abi: badgeRegistryAbi, functionName: "getOwner", args: [id] }),
  ]);
  const decision = decideRevoke({ status });
  console.log(`${name} (registry ${registry}, owner ${owner}): ${decision.action}`);
  if (decision.action !== "act") {
    if (decision.action === "skip") console.log(`nothing to do: ${decision.reason}`);
    return;
  }
  if (req.dryRun) return void console.log("dry run: would unregister");

  const data = encodeFunctionData({ abi: badgeRegistryAbi, functionName: "unregister", args: [id] });
  const { block, hash: txHash } = await sendTxWithHash(ctx, registry, data, `unregister ${name}`);
  const file = recordHistory(req.fork, historyEvent("revoke", req.target, block, txHash, new Date()));
  console.log(`revoked ${name} at Sepolia block ${block}; recorded in ${file}`);
}

main().catch((err: unknown) => {
  if (err instanceof ArgError) {
    console.error(`revoke: ${err.message}\n${REVOKE_USAGE}`);
    process.exitCode = 2;
  } else fail("revoke", err);
});
