#!/usr/bin/env tsx
// A2.3-R2: revive an expired badge (or extend a live one) with its previous owner and roles, through the
// registrar's renew (global books) or renewPartnerBadge (partner sub-books). Organizer only.
//   pnpm exec tsx scripts/ens/revive.ts (--book <hackers|judges|volunteers> | --partner <p> --sub <judges|staff>)
//     --label <l> [--expiry <unix>] [--fork] [--dry-run]
// The default expiry is the book's policy expiry (hackers: event end + 7 days, judges: freeze deadline,
// volunteers and partner staff: event end). After the policy date has passed, pass --expiry explicitly.
// Refuses, before sending, an expiry that reduces the current one, is in the past or is above
// namespaceExpiry. Reads process.env only.
import { encodeFunctionData, keccak256, toHex, zeroAddress } from "viem";
import { ArgError } from "../../src/ens/cli-args";
import { lanyardRegistrarAbi } from "../../src/ens/ensv2-abi";
import {
  decideRevive,
  historyEvent,
  labelId,
  parseReviveArgs,
  partyHash,
  REVIVE_USAGE,
  targetName,
} from "../../src/ens/revive-plan";
import { badgeRegistryAbi, resolveRegistry } from "./badge-target";
import { connect, fail } from "./connect";
import { recordHistory } from "./history";
import { loadLiveSepolia } from "./live";
import { sendTxWithHash } from "./send";

const policyAbi = [
  { type: "function", name: "eventEnd", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "freezeDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
] as const;

async function main(): Promise<void> {
  const req = parseReviveArgs(process.argv.slice(2));
  const live = loadLiveSepolia();
  const ctx = await connect({ fork: req.fork, needKey: !req.dryRun });
  const pc = ctx.publicClient;
  const t = req.target;
  const registry = await resolveRegistry(ctx, live.registrar, t);
  const id = labelId(t.label);
  const name = targetName(t);

  let target: bigint;
  if (req.expiry !== null) target = req.expiry;
  else if (t.kind === "book")
    target = await pc.readContract({
      address: live.registrar,
      abi: lanyardRegistrarAbi,
      functionName: "badgeExpiry",
      args: [keccak256(toHex(t.book))],
    });
  else
    target = await pc.readContract({
      address: live.registrar,
      abi: policyAbi,
      functionName: t.sub === "judges" ? "freezeDeadline" : "eventEnd",
    });

  const [status, currentExpiry, tokenId, namespaceExpiry, head] = await Promise.all([
    pc.readContract({ address: registry, abi: badgeRegistryAbi, functionName: "getStatus", args: [id] }),
    pc.readContract({ address: registry, abi: badgeRegistryAbi, functionName: "getExpiry", args: [id] }),
    pc.readContract({ address: registry, abi: badgeRegistryAbi, functionName: "getTokenId", args: [id] }),
    pc.readContract({ address: live.registrar, abi: lanyardRegistrarAbi, functionName: "namespaceExpiry" }),
    pc.getBlock(),
  ]);
  const latestOwner = await pc.readContract({
    address: registry,
    abi: badgeRegistryAbi,
    functionName: "latestOwnerOf",
    args: [tokenId],
  });
  const decision = decideRevive(
    {
      status,
      currentExpiry,
      hasOwner: latestOwner !== zeroAddress,
      namespaceExpiry,
      now: head.timestamp,
    },
    target,
    req.expiry !== null,
  );
  console.log(`${name}: expiry ${currentExpiry} -> ${target}: ${decision.action}`);
  if (decision.action === "blocked") throw new Error(`blocked: ${decision.reason}`);
  if (decision.action === "skip") return void console.log(`nothing to do: ${decision.reason}`);
  if (req.dryRun) return void console.log("dry run: would renew");

  const data =
    t.kind === "book"
      ? encodeFunctionData({
          abi: lanyardRegistrarAbi,
          functionName: "renew",
          args: [keccak256(toHex(t.book)), t.label, target],
        })
      : encodeFunctionData({
          abi: lanyardRegistrarAbi,
          functionName: "renewPartnerBadge",
          args: [partyHash(t.partner), keccak256(toHex(t.sub)), t.label, target],
        });
  const { block, hash } = await sendTxWithHash(ctx, live.registrar, data, `renew ${name}`);
  const file = recordHistory(req.fork, historyEvent("revive", t, block, hash, new Date()));
  console.log(`revived ${name} until ${target} at Sepolia block ${block}; recorded in ${file}`);
}

main().catch((err: unknown) => {
  if (err instanceof ArgError) {
    console.error(`revive: ${err.message}\n${REVIVE_USAGE}`);
    process.exitCode = 2;
  } else fail("revive", err);
});
