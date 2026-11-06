#!/usr/bin/env tsx
// A2.2-R2: the volunteer coordinator makes or unmakes a lead.
//   pnpm exec tsx scripts/ens/set-perms.ts --volunteer <label> (--make | --unmake) [--fork] [--dry-run]
// Signed with SIGNER_PRIVATE_KEY (the coordinator; FORK_IMPERSONATE on a fork). Reads the badge's
// registration ID and holder directly from the pinned volunteers registry, writes the canonical
// `lanyard.perms` envelope bound to them on the staff resolver, then re-reads the binding after
// the receipt: a concurrent reissue makes the note ineffective, so the script fails and asks for a
// fresh grant. Re-running does nothing. Reads process.env only.
import { encodeFunctionData, keccak256, parseAbi, toHex, type Address } from "viem";
import { sepolia } from "viem/chains";
import { ArgError } from "../../src/ens/cli-args";
import { dnsEncodeName } from "../../src/ens/dns-name";
import { lanyardRegistrarAbi } from "../../src/ens/ensv2-abi";
import { bindingChanged, decidePerms, parsePermsArgs, PERMS_USAGE } from "../../src/ens/perms-plan";
import { readRegistration, registryReadAbi } from "../../src/ens/registry-read";
import { PERMS_TEXT_KEY } from "../../src/shared/ens/permission-envelope";
import { eventConfig } from "../../src/shared/event.config";
import { toFullName } from "../../src/shared/labels";
import { connect, fail } from "./connect";
import { loadLiveSepolia } from "./live";
import { sendTx } from "./send";

const textSetterAbi = parseAbi(["function setText(bytes name,string key,string value)"]);

async function main(): Promise<void> {
  const request = parsePermsArgs(process.argv.slice(2));
  const live = loadLiveSepolia();
  const ctx = await connect({ fork: request.fork, needKey: !request.dryRun, signer: "other" });
  const pc = ctx.publicClient;
  const registry = await pc.readContract({
    address: live.registrar,
    abi: lanyardRegistrarAbi,
    functionName: "bookRegistry",
    args: [keccak256(toHex("volunteers"))],
  });
  const relative = `${request.label}.volunteers`;
  const name = toFullName(relative, eventConfig);
  const read = () => readRegistration(pc, { chainId: sepolia.id, registry, label: request.label });

  const before = await read();
  const [resolver, current] = await Promise.all([
    pc.readContract({
      address: registry,
      abi: registryReadAbi,
      functionName: "getResolver",
      args: [request.label],
    }) as Promise<Address>,
    pc.getEnsText({ name, key: PERMS_TEXT_KEY, universalResolverAddress: live.universalResolver }),
  ]);
  const decision = decidePerms({
    binding: before,
    make: request.make,
    resolver,
    staffResolver: live.staffResolver,
    current,
  });
  if (decision.action === "blocked") throw new Error(`${name}: ${decision.reason}`);
  console.log(`${name} ${PERMS_TEXT_KEY} -> ${decision.value}: ${decision.action}`);
  if (decision.action === "skip") return;
  if (request.dryRun) return console.log("dry run: no transactions sent");

  const block = await sendTx(
    ctx,
    live.staffResolver,
    encodeFunctionData({
      abi: textSetterAbi,
      functionName: "setText",
      args: [dnsEncodeName(name), PERMS_TEXT_KEY, decision.value],
    }),
    `${request.make ? "make" : "unmake"} lead ${relative}`,
  );
  const after = await read();
  if (bindingChanged(before, after))
    throw new Error(
      `${name} was reissued or changed hands during the write (block ${block}); the note grants nothing. Run again for a fresh grant.`,
    );
  const readBack = await pc.getEnsText({
    name,
    key: PERMS_TEXT_KEY,
    universalResolverAddress: live.universalResolver,
  });
  if (readBack !== decision.value) throw new Error(`${name}: Universal Resolver returns ${readBack}`);
  console.log(`  binding unchanged; note effective from block ${block}`);
}

main().catch((err: unknown) => {
  if (err instanceof ArgError) {
    console.error(`set-perms: ${err.message}\n${PERMS_USAGE}`);
    process.exitCode = 2;
  } else fail("set-perms", err);
});
