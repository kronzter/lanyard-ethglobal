#!/usr/bin/env tsx
// Deploy and initialize the fixed A2 resolvers on the selected chain.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { ensv2Sepolia } from "../../src/ens/ensv2-sepolia";
import { predictVerifiableProxy } from "../../src/ens/edition-plan";
import {
  HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  PUBLICATION_ORGANIZER_RESOLVER_ROLES,
} from "../../src/ens/issuance-plan";
import { connect, fail, ROOT, sameAddress, type Connection } from "./connect";

const factoryAbi = parseAbi([
  "function deployProxy(address implementation,uint256 salt,bytes data) returns (address)",
  "function proxyLogic() view returns (address)",
  "function verifyContract(address proxy) view returns (address implementation)",
]);
const resolverAbi = parseAbi([
  "function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function roles(uint256 resource,address account) view returns (uint256)",
  "function grantSetterRoles(bytes setter,address account) returns (bool)",
]);
const initAbi = parseAbi([
  "function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)",
]);
const textSetterAbi = parseAbi(["function setText(bytes name,string key,string value)"]);
const PERMISSIONED_RESOLVER_INTERFACE = "0x8c2427cc"; // IPermissionedResolver at pinned ENSv2 commit
const roleTextAdmin = 16n << 128n;
const roleText = 16n;
const roleLink = 1n << 28n;
const roleUpgrade = 1n << 124n;
const roleLinkAdmin = roleLink << 128n;
const roleUpgradeAdmin = roleUpgrade << 128n;

type ResolverKind = "hackers" | "staff" | "publication";
type ResolverState = {
  schemaVersion: 1;
  factory: Address;
  proxyLogic: Address;
  implementation: Address;
  organizer: Address;
} & Record<ResolverKind, Address>;

const saltOf = (kind: ResolverKind): bigint => BigInt(keccak256(toHex(`lanyard.resolver:${kind}`)));
const rootResource = 0n;
const urlResource = BigInt(keccak256(toHex("url")));

function readSaved(path: string): Partial<ResolverState> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<ResolverState>;
  } catch {
    return {};
  }
}
function save(path: string, value: ResolverState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function send(ctx: Connection, label: string, request: Promise<Hex>): Promise<void> {
  const hash = await request;
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted in ${hash}`);
  console.log(`  ok  ${label}  ${hash}`);
}

async function deploy(
  ctx: Connection,
  kind: ResolverKind,
  proxyLogic: Address,
  implementation: Address,
): Promise<Address> {
  const { publicClient: pc, walletClient: wc, account } = ctx;
  const actualProxyLogic = await pc.readContract({
    address: ensv2Sepolia.verifiableFactory,
    abi: factoryAbi,
    functionName: "proxyLogic",
  });
  if (!sameAddress(actualProxyLogic, proxyLogic))
    throw new Error(`factory proxyLogic changed from ${proxyLogic} to ${actualProxyLogic}`);
  const predicted = predictVerifiableProxy({
    factory: ensv2Sepolia.verifiableFactory,
    proxyLogic,
    sender: ctx.organizer,
    salt: saltOf(kind),
  });
  const code = await pc.getCode({ address: predicted });
  if (code && code !== "0x") {
    const actualImpl = await pc.readContract({
      address: ensv2Sepolia.verifiableFactory,
      abi: factoryAbi,
      functionName: "verifyContract",
      args: [predicted],
    });
    if (!sameAddress(actualImpl, implementation))
      throw new Error(`${kind} resolver proxy has unexpected implementation ${actualImpl}`);
    return predicted;
  }
  if (!wc || !account)
    throw new Error(`--plan shows ${kind} resolver is missing; ORGANIZER_PRIVATE_KEY is required to deploy`);
  const roleBitmap =
    kind === "publication"
      ? roleText | roleTextAdmin | roleLink | roleLinkAdmin | roleUpgrade | roleUpgradeAdmin
      : HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES;
  const init = encodeFunctionData({
    abi: initAbi,
    functionName: "initialize",
    args: [[{ account: ctx.organizer, roleBitmap }], []],
  });
  await send(
    ctx,
    `deploy-${kind}-resolver`,
    wc.writeContract({
      address: ensv2Sepolia.verifiableFactory,
      abi: factoryAbi,
      functionName: "deployProxy",
      args: [implementation, saltOf(kind), init],
      account,
      chain: wc.chain,
    }),
  );
  const deployedCode = await pc.getCode({ address: predicted });
  if (!deployedCode || deployedCode === "0x")
    throw new Error(`${kind} resolver deployment did not appear at ${predicted}`);
  return predicted;
}

async function ensureRoles(ctx: Connection, kind: ResolverKind, resolver: Address): Promise<void> {
  const pc = ctx.publicClient;
  const required =
    kind === "publication" ? PUBLICATION_ORGANIZER_RESOLVER_ROLES : HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES;
  const rootRoles = await pc.readContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "roles",
    args: [rootResource, ctx.organizer],
  });
  if (rootRoles !== required)
    throw new Error(`${kind} resolver organizer root roles are ${rootRoles}, expected exactly ${required}`);
  if (kind === "hackers") {
    const setter = encodeFunctionData({
      abi: textSetterAbi,
      functionName: "setText",
      args: ["0x", "url", ""],
    });
    const urlRoles = await pc.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "roles",
      args: [urlResource, ctx.organizer],
    });
    if ((urlRoles & roleText) === 0n) {
      if (!ctx.walletClient || !ctx.account)
        throw new Error(
          "hackers resolver lacks organizer's URL setter grant; run without --plan to repair it",
        );
      await send(
        ctx,
        "grant-hackers-url-setter",
        ctx.walletClient.writeContract({
          address: resolver,
          abi: resolverAbi,
          functionName: "grantSetterRoles",
          args: [setter, ctx.organizer],
          account: ctx.account,
          chain: ctx.walletClient.chain,
        }),
      );
    }
    const finalUrlRoles = await pc.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "roles",
      args: [urlResource, ctx.organizer],
    });
    if ((finalUrlRoles & roleText) === 0n)
      throw new Error("hackers resolver URL setter grant was not applied");
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const planOnly = args.has("--plan");
  const fork = args.has("--fork");
  for (const arg of args)
    if (arg !== "--plan" && arg !== "--fork") throw new Error(`unknown argument ${arg}`);
  const ctx = await connect({ fork, needKey: !planOnly });
  const pc = ctx.publicClient;
  const implementation = ensv2Sepolia.permissionedResolverImpl;
  const path = resolve(ROOT, `.lanyard/resolvers-${fork ? "fork" : "sepolia"}.json`);
  const saved = readSaved(path);
  const kinds: ResolverKind[] = ["hackers", "staff", "publication"];
  const addresses = {} as Record<ResolverKind, Address>;
  const factoryLogic = await pc.readContract({
    address: ensv2Sepolia.verifiableFactory,
    abi: factoryAbi,
    functionName: "proxyLogic",
  });
  if (sameAddress(factoryLogic, "0x0000000000000000000000000000000000000000"))
    throw new Error("resolver factory has no proxy logic configured");
  if (
    saved.schemaVersion !== undefined &&
    (saved.schemaVersion !== 1 ||
      !sameAddress(
        saved.factory ?? "0x0000000000000000000000000000000000000000",
        ensv2Sepolia.verifiableFactory,
      ) ||
      !sameAddress(saved.proxyLogic ?? "0x0000000000000000000000000000000000000000", factoryLogic) ||
      !sameAddress(saved.implementation ?? "0x0000000000000000000000000000000000000000", implementation) ||
      !sameAddress(saved.organizer ?? "0x0000000000000000000000000000000000000000", ctx.organizer))
  )
    throw new Error(
      "saved resolver metadata factory, implementation, organizer, or schema differs from this run",
    );
  for (const kind of kinds) {
    const predicted = predictVerifiableProxy({
      factory: ensv2Sepolia.verifiableFactory,
      proxyLogic: factoryLogic,
      sender: ctx.organizer,
      salt: saltOf(kind),
    });
    if (saved[kind] && !sameAddress(saved[kind]!, predicted))
      throw new Error(`saved ${kind} resolver address differs from deterministic deployment ${predicted}`);
    addresses[kind] = predicted;
    const code = await pc.getCode({ address: predicted });
    if (code && code !== "0x") {
      const actualImpl = await pc.readContract({
        address: ensv2Sepolia.verifiableFactory,
        abi: factoryAbi,
        functionName: "verifyContract",
        args: [predicted],
      });
      if (!sameAddress(actualImpl, implementation))
        throw new Error(`${kind} resolver uses unexpected implementation ${actualImpl}`);
      const supports = await pc.readContract({
        address: predicted,
        abi: resolverAbi,
        functionName: "supportsInterface",
        args: [PERMISSIONED_RESOLVER_INTERFACE],
      });
      if (!supports) throw new Error(`${kind} resolver does not support IPermissionedResolver`);
      const expectedRoles =
        kind === "publication"
          ? PUBLICATION_ORGANIZER_RESOLVER_ROLES
          : HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES;
      const actualRoles = await pc.readContract({
        address: predicted,
        abi: resolverAbi,
        functionName: "roles",
        args: [rootResource, ctx.organizer],
      });
      if (actualRoles !== expectedRoles)
        throw new Error(
          `${kind} resolver organizer root roles are ${actualRoles}, expected exactly ${expectedRoles}`,
        );
      if (kind === "hackers") {
        const urlRoles = await pc.readContract({
          address: predicted,
          abi: resolverAbi,
          functionName: "roles",
          args: [urlResource, ctx.organizer],
        });
        console.log(
          `${kind}: ${predicted} deployed${(urlRoles & roleText) !== 0n ? "" : "; needs URL setter grant"}`,
        );
      } else console.log(`${kind}: ${predicted} deployed`);
    } else console.log(`${kind}: ${predicted} deploy`);
  }
  if (planOnly) return;
  for (const kind of kinds) {
    addresses[kind] = await deploy(ctx, kind, factoryLogic, implementation);
    await ensureRoles(ctx, kind, addresses[kind]);
    const supports = await pc.readContract({
      address: addresses[kind],
      abi: resolverAbi,
      functionName: "supportsInterface",
      args: [PERMISSIONED_RESOLVER_INTERFACE],
    });
    if (!supports) throw new Error(`${kind} resolver does not support IPermissionedResolver`);
  }
  save(path, {
    schemaVersion: 1,
    factory: ensv2Sepolia.verifiableFactory,
    proxyLogic: factoryLogic,
    implementation,
    organizer: ctx.organizer,
    ...addresses,
  });
  console.log(`saved resolver metadata to ${path}`);
}

main().catch((err: unknown) => fail("deploy-resolvers", err));
