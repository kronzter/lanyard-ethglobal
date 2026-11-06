#!/usr/bin/env tsx
// A2.2 scoped grants, run by the organizer:
//   pnpm exec tsx scripts/ens/grant-roles.ts [--coordinator <address>] [--partners id=0x...,id=0x...]
//     [--head-judge <address>] [--audit] [--fork] [--dry-run]
// - coordinator: ROLE_SET_TEXT on the staff resolver, scoped to the `lanyard.perms` key only;
// - head judge: verified, never granted (the registrar installed UNREGISTER on the judges book at bootstrap);
// - partners (default: authorities.partners in event.config.ts): onboarded once through
//   LanyardRegistrar.onboardPartner, then every structural name and ancestor is checked to outlive
//   namespaceExpiry, up to lanyard.eth itself;
// - --audit: every badge holds zero registry roles and no ApprovalForAll is set (A2.2-R5/R6).
// Everything is observed before the first write; re-running does nothing. Reads process.env only.
import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  zeroAddress,
  type Address,
} from "viem";
import { ArgError } from "../../src/ens/cli-args";
import { lanyardRegistrarAbi, permissionedRegistryAbi } from "../../src/ens/ensv2-abi";
import {
  approvalViolations,
  decideCoordinator,
  decidePartner,
  GRANT_USAGE,
  headJudgeProblems,
  lifetimeProblems,
  parseGrantArgs,
  ROLE_SET_TEXT,
} from "../../src/ens/grant-plan";
import { scanLogs } from "../../src/ens/logs";
import { PERMS_TEXT_KEY } from "../../src/shared/ens/permission-envelope";
import { eventConfig } from "../../src/shared/event.config";
import { connect, fail, sameAddress } from "./connect";
import { loadLiveSepolia } from "./live";
import { sendTx } from "./send";

const resolverAbi = parseAbi([
  "function roles(uint256 resource,address account) view returns (uint256)",
  "function grantSetterRoles(bytes setter,address account) returns (bool)",
  "function setText(bytes name,string key,string value)",
]);
const registryExtraAbi = parseAbi(["function getResource(uint256 anyId) view returns (uint256)"]);
const labelRegistered = parseAbiItem(
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
);
const approvalForAll = parseAbiItem(
  "event ApprovalForAll(address indexed account, address indexed operator, bool approved)",
);
const h = (s: string) => keccak256(toHex(s));
const id = (s: string) => BigInt(h(s));

async function main(): Promise<void> {
  const request = parseGrantArgs(process.argv.slice(2), {
    partners: eventConfig.authorities.partners,
    partnerIds: eventConfig.partners.map((p) => p.id),
    headJudge: process.env.LANYARD_HEAD_JUDGE,
  });
  const live = loadLiveSepolia();
  const ctx = await connect({ fork: request.fork, needKey: !request.dryRun });
  const pc = ctx.publicClient;
  const reg = <T>(functionName: string, args: readonly unknown[] = []) =>
    pc.readContract({
      address: live.registrar,
      abi: lanyardRegistrarAbi,
      functionName,
      args,
    } as never) as Promise<T>;
  const registry = <T>(address: Address, functionName: string, args: readonly unknown[]) =>
    pc.readContract({ address, abi: permissionedRegistryAbi, functionName, args } as never) as Promise<T>;

  const [phase, organizer, namespaceExpiry] = await Promise.all([
    reg<number>("phase"),
    reg<Address>("organizer"),
    reg<bigint>("namespaceExpiry"),
  ]);
  if (phase !== 2) throw new Error("edition must be sealed");
  if (!sameAddress(organizer, ctx.organizer))
    throw new Error(`registrar organizer is ${organizer}, not this signer`);

  // Head judge: verify only.
  const judges = await reg<Address>("bookRegistry", [h("judges")]);
  const headJudge = await reg<Address>("headJudge");
  const judgeProblems = headJudgeProblems({
    configured: headJudge,
    expected: request.headJudge,
    judgesRootRoles: await registry<bigint>(judges, "roles", [0n, headJudge]),
  });
  if (judgeProblems.length) throw new Error(`head judge: ${judgeProblems.join("; ")}`);
  console.log(`head judge ${headJudge}: UNREGISTER on judges, issues through registerJudge (verified)`);

  // Observe the coordinator and every partner before the first write.
  const permsResource = id(PERMS_TEXT_KEY);
  let grantCoordinator = false;
  if (request.coordinator) {
    const roles = await pc.readContract({
      address: live.staffResolver,
      abi: resolverAbi,
      functionName: "roles",
      args: [permsResource, request.coordinator],
    });
    grantCoordinator = decideCoordinator(roles).action === "act";
    console.log(
      `coordinator ${request.coordinator}: ${grantCoordinator ? "grant" : "skip"} ${PERMS_TEXT_KEY} setter`,
    );
  }
  const onboard: [string, Address][] = [];
  const blocked: string[] = [];
  for (const [partner, wallet] of Object.entries(request.partners)) {
    const d = decidePartner(await reg<Address>("partnerWallet", [h(partner)]), wallet);
    if (d.action === "blocked") blocked.push(`${partner}: ${d.reason}`);
    else {
      console.log(`partner ${partner} -> ${wallet}: ${d.action === "act" ? "onboard" : "skip"}`);
      if (d.action === "act") onboard.push([partner, wallet]);
    }
  }
  if (blocked.length) throw new Error(`nothing sent; fix these first:\n  ${blocked.join("\n  ")}`);

  if (request.dryRun) console.log("dry run: no transactions sent");
  else {
    if (grantCoordinator) {
      const setter = encodeFunctionData({
        abi: resolverAbi,
        functionName: "setText",
        args: ["0x", PERMS_TEXT_KEY, ""],
      });
      await sendTx(
        ctx,
        live.staffResolver,
        encodeFunctionData({
          abi: resolverAbi,
          functionName: "grantSetterRoles",
          args: [setter, request.coordinator!],
        }),
        "grant coordinator perms setter",
      );
      const after = await pc.readContract({
        address: live.staffResolver,
        abi: resolverAbi,
        functionName: "roles",
        args: [permsResource, request.coordinator!],
      });
      if ((after & ROLE_SET_TEXT) === 0n) throw new Error("coordinator grant was not applied");
    }
    for (const [partner, wallet] of onboard)
      await sendTx(
        ctx,
        live.registrar,
        encodeFunctionData({
          abi: lanyardRegistrarAbi,
          functionName: "onboardPartner",
          args: [partner, wallet],
        }),
        `onboard ${partner}`,
      );
  }

  // Lifetimes, on-chain, for the whole ancestry of every onboarded partner (A2.2-R3).
  const partnersBook = await reg<Address>("bookRegistry", [h("partners")]);
  const names = [
    { name: "lanyard.eth", expiry: await registry<bigint>(live.ethRegistry, "getExpiry", [id("lanyard")]) },
    {
      name: `${eventConfig.edition}.lanyard.eth`,
      expiry: await registry<bigint>(live.baseRegistry, "getExpiry", [id(eventConfig.edition)]),
    },
    { name: "partners", expiry: await registry<bigint>(live.edition, "getExpiry", [id("partners")]) },
  ];
  const badgeRegistries: Address[] = await Promise.all(
    ["hackers", "judges", "volunteers"].map((b) => reg<Address>("bookRegistry", [h(b)])),
  );
  for (const partner of Object.keys(request.partners)) {
    const parent = await reg<Address>("partnerRegistry", [h(partner)]);
    if (sameAddress(parent, zeroAddress)) continue; // dry run before onboarding
    names.push({
      name: `${partner}.partners`,
      expiry: await registry<bigint>(partnersBook, "getExpiry", [id(partner)]),
    });
    for (const sub of ["judges", "staff"]) {
      names.push({
        name: `${sub}.${partner}.partners`,
        expiry: await registry<bigint>(parent, "getExpiry", [id(sub)]),
      });
      badgeRegistries.push(await reg<Address>("partnerBookRegistry", [h(partner), h(sub)]));
    }
  }
  const short = lifetimeProblems(names, namespaceExpiry);
  if (short.length) throw new Error(`structural names expire too early:\n  ${short.join("\n  ")}`);
  console.log(`${names.length} structural names outlive namespaceExpiry ${namespaceExpiry}`);

  if (request.audit) await audit(ctx.publicClient, live.deployedAtBlock, badgeRegistries, live.edition);
}

/** Every live badge holds zero registry roles, and no account has a surviving ApprovalForAll. */
async function audit(
  pc: Awaited<ReturnType<typeof connect>>["publicClient"],
  from: bigint,
  registries: Address[],
  edition: Address,
): Promise<void> {
  const head = await pc.getBlockNumber();
  const problems: string[] = [];
  let badges = 0;
  for (const registry of registries) {
    const logs = await scanLogs(from, head, (r) =>
      pc.getLogs({ address: registry, event: labelRegistered, ...r }),
    );
    for (const label of new Set(logs.map((l) => l.args.label!))) {
      const owner = await pc.readContract({
        address: registry,
        abi: permissionedRegistryAbi,
        functionName: "getOwner",
        args: [id(label)],
      });
      if (sameAddress(owner, zeroAddress)) continue;
      badges++;
      const resource = await pc.readContract({
        address: registry,
        abi: registryExtraAbi,
        functionName: "getResource",
        args: [id(label)],
      });
      const roles = await pc.readContract({
        address: registry,
        abi: permissionedRegistryAbi,
        functionName: "roles",
        args: [resource, owner],
      });
      if (roles !== 0n) problems.push(`${label} on ${registry}: holder ${owner} has roles ${roles}`);
    }
  }
  const approvals = [];
  for (const registry of [...registries, edition]) {
    const logs = await scanLogs(from, head, (r) =>
      pc.getLogs({ address: registry, event: approvalForAll, ...r }),
    );
    approvals.push(
      ...logs.map((l) => ({
        registry,
        account: l.args.account!,
        operator: l.args.operator!,
        approved: l.args.approved!,
      })),
    );
  }
  problems.push(...approvalViolations(approvals));
  if (problems.length) throw new Error(`audit failed:\n  ${problems.join("\n  ")}`);
  console.log(`audit: ${badges} live badge(s) hold no roles; no ApprovalForAll is set`);
}

main().catch((err: unknown) => {
  if (err instanceof ArgError) {
    console.error(`grant-roles: ${err.message}\n${GRANT_USAGE}`);
    process.exitCode = 2;
  } else fail("grant-roles", err);
});
