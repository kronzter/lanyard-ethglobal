#!/usr/bin/env tsx
// Organizer-only A1.3 team registration. Reads process.env, never opens an env file.
// --demo is restricted to a loopback fork because fixtures use publicly known test wallets.
import { readFileSync } from "node:fs";
import { encodeFunctionData, isAddress, keccak256, toHex, zeroAddress, type Address } from "viem";
import { parsePersonas } from "../../src/shared/fixtures/personas";
import {
  buildDemoTeams,
  decideTeam,
  parseTeamArgs,
  TeamArgError,
  TEAM_USAGE,
  type DemoTeam,
} from "../../src/ens/team-plan";
import { bookHash } from "../../src/ens/badge-plan";
import { lanyardRegistrarAbi, permissionedRegistryAbi } from "../../src/ens/ensv2-abi";
import { connect, fail, ROOT, sameAddress, type Connection } from "./connect";
import { resolve } from "node:path";

const idOf = (label: string): bigint => BigInt(keccak256(toHex(label)));

async function main(): Promise<void> {
  const request = parseTeamArgs(process.argv.slice(2));
  // Validate the entire fixture before the first possible transaction.
  const teams: DemoTeam[] =
    request.mode === "demo"
      ? buildDemoTeams(
          parsePersonas(JSON.parse(readFileSync(resolve(ROOT, "fixtures/personas.json"), "utf8"))).personas,
        )
      : [{ label: request.label, lead: request.lead, members: [] }];
  const ctx = await connect({ fork: request.fork, needKey: !request.dryRun });
  const { publicClient: pc } = ctx;
  let registrar: Address;
  try {
    const state = JSON.parse(readFileSync(ctx.statePath, "utf8")) as { registrar?: unknown };
    if (
      typeof state.registrar !== "string" ||
      !isAddress(state.registrar) ||
      sameAddress(state.registrar, zeroAddress)
    ) {
      throw new Error("invalid registrar");
    }
    registrar = state.registrar;
  } catch {
    throw new Error(`no valid registrar in ${ctx.statePath}; run deploy-edition.ts first`);
  }

  const readRegistrar = <N extends "phase" | "organizer" | "edition" | "namespaceExpiry">(functionName: N) =>
    pc.readContract({ address: registrar, abi: lanyardRegistrarAbi, functionName });
  const [phase, organizer, edition, minimumExpiry, block] = await Promise.all([
    readRegistrar("phase"),
    readRegistrar("organizer"),
    readRegistrar("edition"),
    readRegistrar("namespaceExpiry"),
    pc.getBlock(),
  ]);
  if (phase !== 2) throw new Error("edition must be sealed before registering teams");
  if (!sameAddress(organizer, ctx.organizer)) throw new Error("organizer does not match this registrar");
  if (minimumExpiry <= block.timestamp) throw new Error("namespace lifetime has ended");

  // Observe all teams and member badges before sending anything, so a known conflict never leaves
  // half of a demo seed. Transactions remain sequential and safe to reconcile by rerunning.
  const plans = [];
  for (const team of teams) {
    if (sameAddress(team.lead, registrar))
      throw new Error(`${team.label}: registrar cannot be the team lead`);
    const hash = keccak256(toHex(team.label));
    const [registeredChild, registeredLead, currentOwner, currentChild, status, expiry] = await Promise.all([
      pc.readContract({
        address: registrar,
        abi: lanyardRegistrarAbi,
        functionName: "teamRegistry",
        args: [hash],
      }),
      pc.readContract({
        address: registrar,
        abi: lanyardRegistrarAbi,
        functionName: "teamLead",
        args: [hash],
      }),
      pc.readContract({
        address: edition,
        abi: permissionedRegistryAbi,
        functionName: "getOwner",
        args: [BigInt(hash)],
      }),
      pc.readContract({
        address: edition,
        abi: permissionedRegistryAbi,
        functionName: "getSubregistry",
        args: [team.label],
      }),
      pc.readContract({
        address: edition,
        abi: permissionedRegistryAbi,
        functionName: "getStatus",
        args: [BigInt(hash)],
      }),
      pc.readContract({
        address: edition,
        abi: permissionedRegistryAbi,
        functionName: "getExpiry",
        args: [BigInt(hash)],
      }),
    ]);
    const decision = decideTeam(
      { registeredChild, registeredLead, currentOwner, currentChild, status, expiry, minimumExpiry },
      team.lead,
    );
    if (decision.action === "blocked") throw new Error(`${team.label}: ${decision.reason}`);
    plans.push({ team, action: decision.action });
  }

  const hackers = bookHash("hackers");
  const badges: { label: string; owner: Address; issue: boolean }[] = [];
  if (request.mode === "demo") {
    const registry = await pc.readContract({
      address: registrar,
      abi: lanyardRegistrarAbi,
      functionName: "bookRegistry",
      args: [hackers],
    });
    const policyExpiry = await pc.readContract({
      address: registrar,
      abi: lanyardRegistrarAbi,
      functionName: "badgeExpiry",
      args: [hackers],
    });
    if (policyExpiry <= block.timestamp) throw new Error("hackers badge issue window has ended");
    for (const member of teams.flatMap((team) => team.members)) {
      const [owner, status, expiry] = await Promise.all([
        pc.readContract({
          address: registry,
          abi: permissionedRegistryAbi,
          functionName: "getOwner",
          args: [idOf(member.label)],
        }),
        pc.readContract({
          address: registry,
          abi: permissionedRegistryAbi,
          functionName: "getStatus",
          args: [idOf(member.label)],
        }),
        pc.readContract({
          address: registry,
          abi: permissionedRegistryAbi,
          functionName: "getExpiry",
          args: [idOf(member.label)],
        }),
      ]);
      const unused = status === 0 && expiry === 0n;
      const alreadyIssued = status === 2 && sameAddress(owner, member.address) && expiry >= policyExpiry;
      if (!unused && !alreadyIssued)
        throw new Error(`${member.label}.hackers: existing badge conflicts or has expired`);
      badges.push({ label: member.label, owner: member.address, issue: unused });
    }
  }

  for (const { team, action } of plans) {
    console.log(`${team.label} -> ${team.lead}: ${action}`);
    if (action === "register" && !request.dryRun)
      await send(ctx, registrar, "registerTeam", [team.label, team.lead]);
  }
  for (const badge of badges) {
    console.log(`${badge.label}.hackers -> ${badge.owner}: ${badge.issue ? "issue" : "skip"}`);
    if (badge.issue && !request.dryRun)
      await send(ctx, registrar, "registerBadge", [hackers, badge.label, badge.owner]);
  }
  if (request.dryRun) console.log("dry run: no transactions sent");
}

async function send(
  ctx: Connection,
  registrar: Address,
  functionName: "registerTeam" | "registerBadge",
  args: readonly [string, Address] | readonly [Address | `0x${string}`, string, Address],
): Promise<void> {
  const { walletClient: wc, publicClient: pc, account } = ctx;
  if (!wc || !account) throw new Error("organizer signing key is required");
  // Simulate immediately before submitting; a concurrently occupied label fails instead of being overwritten.
  const data =
    functionName === "registerTeam"
      ? encodeFunctionData({
          abi: lanyardRegistrarAbi,
          functionName,
          args: args as readonly [string, Address],
        })
      : encodeFunctionData({
          abi: lanyardRegistrarAbi,
          functionName,
          args: args as readonly [`0x${string}`, string, Address],
        });
  await pc.call({ to: registrar, data, account });
  const hash = await wc.sendTransaction({ to: registrar, data, account, chain: wc.chain });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  console.log(`confirmed ${hash}`);
}

main().catch((err: unknown) => {
  if (err instanceof TeamArgError) {
    console.error(`register-team: ${err.message}\n${TEAM_USAGE}`);
    process.exitCode = 2;
  } else fail("register-team", err);
});
