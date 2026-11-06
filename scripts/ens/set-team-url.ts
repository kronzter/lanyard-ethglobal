#!/usr/bin/env tsx
// A2.1-R6: publish each team's Lanyard page URL in its ENS `url` record on the hackers resolver.
//   pnpm exec tsx scripts/ens/set-team-url.ts (--team <label> | --all) [--repair] [--fork] [--dry-run]
// Organizer only (the organizer holds the `url`-scoped text setter on the hackers resolver; team
// leads hold no shared-resolver text grant). Each write is read back through the Universal Resolver.
// Re-running does nothing. Reads process.env only, never a .env file.
import { encodeFunctionData, keccak256, parseAbi, parseAbiItem, toHex, type Address } from "viem";
import { ArgError } from "../../src/ens/cli-args";
import { dnsEncodeName } from "../../src/ens/dns-name";
import { permissionedRegistryAbi } from "../../src/ens/ensv2-abi";
import { scanLogs } from "../../src/ens/logs";
import { decideTeamUrl, parseTeamUrlArgs, TEAM_URL_USAGE } from "../../src/ens/team-url-plan";
import { TeamArgError } from "../../src/ens/team-plan";
import { eventConfig } from "../../src/shared/event.config";
import { toFullName } from "../../src/shared/labels";
import { connect, fail } from "./connect";
import { loadLiveSepolia } from "./live";
import { sendTx } from "./send";

const textSetterAbi = parseAbi(["function setText(bytes name,string key,string value)"]);
const teamRegistered = parseAbiItem(
  "event TeamRegistered(string label, address indexed lead, address registry, uint64 expiry)",
);

async function main(): Promise<void> {
  const request = parseTeamUrlArgs(process.argv.slice(2));
  const live = loadLiveSepolia();
  const ctx = await connect({ fork: request.fork, needKey: !request.dryRun });
  const pc = ctx.publicClient;
  const head = await pc.getBlockNumber();

  let labels: string[];
  if (request.teams.kind === "one") labels = [request.teams.label];
  else {
    const logs = await scanLogs(live.deployedAtBlock, head, (r) =>
      pc.getLogs({ address: live.registrar, event: teamRegistered, ...r }),
    );
    labels = [...new Set(logs.map((l) => l.args.label!))].sort();
    console.log(`${labels.length} registered team(s)`);
  }

  // Observe every team before the first write, so a known conflict never leaves half a run.
  const plans: { label: string; name: string; url: string; write: boolean }[] = [];
  const blocked: string[] = [];
  for (const label of labels) {
    const name = toFullName(label, eventConfig);
    const id = BigInt(keccak256(toHex(label)));
    const [status, resolver, currentUrl] = await Promise.all([
      pc.readContract({
        address: live.edition,
        abi: permissionedRegistryAbi,
        functionName: "getStatus",
        args: [id],
      }),
      pc.readContract({
        address: live.edition,
        abi: permissionedRegistryAbi,
        functionName: "getResolver",
        args: [label],
      }) as Promise<Address>,
      pc.getEnsText({ name, key: "url", universalResolverAddress: live.universalResolver }),
    ]);
    const decision = decideTeamUrl(
      { label, status, resolver, currentUrl: currentUrl ?? "" },
      {
        hackersResolver: live.hackersResolver,
        publicAppOrigin: live.publicAppOrigin,
        repair: request.repair,
      },
    );
    if (decision.action === "blocked") blocked.push(`${label}: ${decision.reason}`);
    else plans.push({ label, name, url: decision.url, write: decision.action === "write" });
  }
  if (blocked.length) throw new Error(`nothing sent; fix these first:\n  ${blocked.join("\n  ")}`);

  for (const p of plans) {
    console.log(`${p.name} url -> ${p.url}: ${p.write ? "write" : "skip"}`);
    if (!p.write || request.dryRun) continue;
    const data = encodeFunctionData({
      abi: textSetterAbi,
      functionName: "setText",
      args: [dnsEncodeName(p.name), "url", p.url],
    });
    await sendTx(ctx, live.hackersResolver, data, `setText url ${p.label}`);
    const readBack = await pc.getEnsText({
      name: p.name,
      key: "url",
      universalResolverAddress: live.universalResolver,
    });
    if (readBack !== p.url)
      throw new Error(`${p.name}: Universal Resolver returns ${readBack}, expected ${p.url}`);
  }
  if (request.dryRun) console.log("dry run: no transactions sent");
}

main().catch((err: unknown) => {
  if (err instanceof ArgError || err instanceof TeamArgError) {
    console.error(`set-team-url: ${err.message}\n${TEAM_URL_USAGE}`);
    process.exitCode = 2;
  } else fail("set-team-url", err);
});
