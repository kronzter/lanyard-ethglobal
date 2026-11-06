#!/usr/bin/env tsx
// Seeds one badge through LanyardRegistrar (plans/A1-namespace.md › A1.2):
//   pnpm exec tsx scripts/ens/issue-badge.ts --book hackers --label priya --owner 0x… [--fork] [--dry-run]
// The registrar fixes roles and expiry per book, so this script chooses neither. Re-running with the same
// arguments does nothing; a label held by someone else is never overwritten. Organizer only: set
// SEPOLIA_RPC_URL (or FORK_RPC_URL with --fork) and ORGANIZER_PRIVATE_KEY in the environment.
// The registrar address comes from .lanyard/edition-*.json, written by deploy-edition.ts.
import { readFileSync } from "node:fs";
import { keccak256, toHex, type Address } from "viem";
import { BadgeArgError, bookHash, decideBadge, parseBadgeArgs, USAGE } from "../../src/ens/badge-plan";
import { lanyardRegistrarAbi, permissionedRegistryAbi } from "../../src/ens/ensv2-abi";
import { connect, fail } from "./connect";

async function main(): Promise<void> {
  const request = parseBadgeArgs(process.argv.slice(2));
  const ctx = await connect({ fork: request.fork, needKey: !request.dryRun });
  const { publicClient: pc, walletClient: wc, account } = ctx;

  let registrar: Address;
  try {
    const state = JSON.parse(readFileSync(ctx.statePath, "utf8")) as { registrar?: Address };
    if (!state.registrar) throw new Error("no registrar");
    registrar = state.registrar;
  } catch {
    throw new Error(`no registrar recorded in ${ctx.statePath}; run deploy-edition.ts first`);
  }

  const book = bookHash(request.book);
  const registry = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "bookRegistry",
    args: [book],
  });
  const phase = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "phase",
  });
  if (phase !== 2) throw new Error("the edition is not sealed yet; run deploy-edition.ts to completion");

  const currentOwner = await pc.readContract({
    address: registry,
    abi: permissionedRegistryAbi,
    functionName: "getOwner",
    args: [BigInt(keccak256(toHex(request.label)))],
  });
  const expiry = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "badgeExpiry",
    args: [book],
  });
  const decision = decideBadge({ currentOwner, wantedOwner: request.owner });
  const name = `${request.label}.${request.book}`;
  console.log(`${name} -> ${request.owner} (expires ${expiry}, no roles)`);

  if (decision.action !== "issue") {
    if (decision.action === "blocked") throw new Error(`blocked: ${decision.reason}`);
    console.log(`nothing to do: ${decision.reason}`);
    return;
  }
  if (request.dryRun) {
    console.log("dry run: would issue");
    return;
  }
  if (!wc || !account) throw new Error("ORGANIZER_PRIVATE_KEY is required to send transactions");

  const hash = await wc.writeContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "registerBadge",
    args: [book, request.label, request.owner],
    account,
    chain: wc.chain,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`registerBadge reverted in ${hash}`);
  console.log(`issued ${name}  ${hash}`);
}

main().catch((err: unknown) => {
  if (err instanceof BadgeArgError) {
    console.error(`issue-badge: ${err.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  fail("issue-badge", err);
});
