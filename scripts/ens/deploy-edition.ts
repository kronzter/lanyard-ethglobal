#!/usr/bin/env tsx
// Creates the ENS name tree's top two levels on Sepolia (plans/A1-namespace.md › A1.1):
//   lanyard.eth ─ base UserRegistry ─ mumbai2026 ─ edition registry (emancipated, owned by LanyardRegistrar)
// Idempotent and resumable: it reads the chain, plans only the missing steps (src/ens/edition-plan.ts)
// and runs them in order, so a stopped run continues and a finished run does nothing.
//
//   pnpm exec tsx scripts/ens/deploy-edition.ts --plan   # read-only: print what would run
//   pnpm exec tsx scripts/ens/deploy-edition.ts --fork   # against a local `anvil --fork-url` node
//   pnpm exec tsx scripts/ens/deploy-edition.ts          # live Sepolia (needs lanyard.eth registered first)
//
// Environment (read from process.env only; this script never opens a .env file):
//   SEPOLIA_RPC_URL        live RPC endpoint
//   FORK_RPC_URL           --fork endpoint (default http://127.0.0.1:8545)
//   ORGANIZER_PRIVATE_KEY  the organizer wallet's key (not needed for --plan)
// Run `forge build --root contracts` first: the registrar bytecode comes from contracts/out.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  encodeFunctionData,
  encodePacked,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  baseRegistrySalt,
  planEditionSteps,
  recoverRegistrar,
  registrarMismatches,
  predictVerifiableProxy,
  type EditionObservation,
  type EditionStep,
} from "../../src/ens/edition-plan";
import {
  HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  issuanceConfigurationState,
  issuanceMismatches,
  PUBLICATION_ORGANIZER_RESOLVER_ROLES,
  resolverForBook,
  type IssuanceConfig,
  expectedBookRoleCount,
} from "../../src/ens/issuance-plan";
import {
  admin,
  BASE_SETUP_ROLES,
  EDITION_NAME_ROLES,
  FAR_FUTURE,
  lanyardRegistrarAbi,
  permissionedRegistryAbi,
  REGISTRAR_PHASE,
  ROLE,
  userRegistryInitAbi,
  verifiableFactoryAbi,
} from "../../src/ens/ensv2-abi";
import { fixedResolverRoleProblems } from "../../src/ens/deploy-guards";
import { ensv2Sepolia } from "../../src/ens/ensv2-sepolia";
import { BOOKS } from "../../src/shared/labels";
import { namespaceExpiry } from "../../src/shared/config/validate";
import { eventConfig } from "../../src/shared/event.config";
import { parsePersonas } from "../../src/shared/fixtures/personas";
import { assertRegistrarVersion } from "../../src/ens/registrar-version";
import { connect, fail, ROOT, sameAddress, type Connection } from "./connect";

const ARTIFACT = resolve(ROOT, "contracts/out/LanyardRegistrar.sol/LanyardRegistrar.json");
const issuanceAbi = parseAbi([
  "function configureIssuance(address hackersResolver,address staffResolver,address headJudge,string baseName)",
  "function hackersResolver() view returns (address)",
  "function staffResolver() view returns (address)",
  "function headJudge() view returns (address)",
  "function baseName() view returns (string)",
]);
const resolverAbi = parseAbi([
  "function hasRoles(uint256 resource,uint256 roleBitmap,address account) view returns (bool)",
  "function roles(uint256 resource,address account) view returns (uint256)",
  "function roleCount(uint256 resource) view returns (uint256)",
  "function grantSetterRoles(bytes setter,address account) returns (bool)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
]);
const addressSetterAbi = parseAbi(["function setAddress(bytes name,uint256 coinType,bytes addr)"]);
const resolverFactoryAbi = parseAbi([
  "function verifyContract(address proxy) view returns (address implementation)",
  "function proxyLogic() view returns (address)",
]);
const PERMISSIONED_RESOLVER_INTERFACE = "0x8c2427cc";
const RESOLVER_ADDRESS_ROLE = 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

const idOf = (label: string): bigint => BigInt(keccak256(toHex(label)));
const lower = (a: string): Address => a.toLowerCase() as Address;

type Ctx = Connection;

type State = { registrar?: Address; registrarTx?: Hex };
type ResolverMetadata = {
  schemaVersion: 1;
  factory: Address;
  proxyLogic: Address;
  implementation: Address;
  organizer: Address;
  hackers: Address;
  staff: Address;
  publication: Address;
};

const edition = eventConfig.edition;
const baseLabel = eventConfig.baseName.replace(/\.eth$/, "");
const nsExpiry = namespaceExpiry(eventConfig.times);

function readState(path: string): State {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as State;
  } catch {
    return {};
  }
}

function writeState(path: string, state: State & Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function issuanceHeadJudge(ctx: Ctx): Address {
  let address: Address;
  if (ctx.fork) {
    const override = process.env.LANYARD_HEAD_JUDGE;
    if (override) address = getAddress(override);
    else {
      const personas = parsePersonas(
        JSON.parse(readFileSync(resolve(ROOT, "fixtures/personas.json"), "utf8")) as unknown,
      );
      const judge = personas.personas.find((persona) => persona.role === "head-judge");
      if (!judge) throw new Error("fixtures/personas.json has no head-judge persona for --fork");
      address = getAddress(judge.address);
    }
  } else {
    const configured = process.env.LANYARD_HEAD_JUDGE;
    if (!configured) throw new Error("LANYARD_HEAD_JUDGE is required for Sepolia issuance setup");
    address = getAddress(configured);
  }
  if (sameAddress(address, ZERO_ADDRESS)) throw new Error("head judge must be a non-zero address");
  if (sameAddress(address, ctx.organizer)) throw new Error("head judge must be distinct from organizer");
  return address;
}

function readResolverMetadata(ctx: Ctx): ResolverMetadata {
  const path = resolve(ROOT, `.lanyard/resolvers-${ctx.fork ? "fork" : "sepolia"}.json`);
  let metadata: ResolverMetadata;
  try {
    metadata = JSON.parse(readFileSync(path, "utf8")) as ResolverMetadata;
  } catch {
    throw new Error(`resolver metadata missing at ${path}; run scripts/ens/deploy-resolvers.ts first`);
  }
  if (
    metadata.schemaVersion !== 1 ||
    !sameAddress(metadata.factory, ensv2Sepolia.verifiableFactory) ||
    !sameAddress(metadata.implementation, ensv2Sepolia.permissionedResolverImpl) ||
    !sameAddress(metadata.organizer, ctx.organizer)
  )
    throw new Error(
      "resolver metadata factory, implementation, organizer, or schema does not match this run",
    );
  for (const [name, address] of [
    ["hackers", metadata.hackers],
    ["staff", metadata.staff],
    ["publication", metadata.publication],
  ] as const) {
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
      throw new Error(`resolver metadata has invalid ${name} address`);
  }
  return metadata;
}

async function validateResolverMetadata(ctx: Ctx, metadata: ResolverMetadata): Promise<void> {
  const pc = ctx.publicClient;
  const actualLogic = await pc.readContract({
    address: ensv2Sepolia.verifiableFactory,
    abi: resolverFactoryAbi,
    functionName: "proxyLogic",
  });
  if (!sameAddress(actualLogic, metadata.proxyLogic))
    throw new Error(`factory proxyLogic is ${actualLogic}, expected recorded ${metadata.proxyLogic}`);
  for (const [kind, address] of [
    ["hackers", metadata.hackers],
    ["staff", metadata.staff],
    ["publication", metadata.publication],
  ] as const) {
    const salt = BigInt(keccak256(toHex(`lanyard.resolver:${kind}`)));
    const predicted = predictVerifiableProxy({
      factory: ensv2Sepolia.verifiableFactory,
      proxyLogic: metadata.proxyLogic,
      sender: ctx.organizer,
      salt,
    });
    if (!sameAddress(address, predicted))
      throw new Error(`${kind} resolver address differs from deterministic deployment ${predicted}`);
    const code = await pc.getCode({ address });
    if (!code || code === "0x") throw new Error(`${kind} resolver ${address} has no code`);
    const implementation = await pc.readContract({
      address: ensv2Sepolia.verifiableFactory,
      abi: resolverFactoryAbi,
      functionName: "verifyContract",
      args: [address],
    });
    if (!sameAddress(implementation, ensv2Sepolia.permissionedResolverImpl))
      throw new Error(`${kind} resolver uses unexpected implementation ${implementation}`);
    const supports = await pc.readContract({
      address,
      abi: resolverAbi,
      functionName: "supportsInterface",
      args: [PERMISSIONED_RESOLVER_INTERFACE],
    });
    if (!supports) throw new Error(`${kind} resolver does not support IPermissionedResolver`);
    const roles =
      kind === "publication" ? PUBLICATION_ORGANIZER_RESOLVER_ROLES : HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES;
    const actualRoles = await pc.readContract({
      address,
      abi: resolverAbi,
      functionName: "roles",
      args: [0n, ctx.organizer],
    });
    if (actualRoles !== roles)
      throw new Error(`${kind} resolver organizer root roles are ${actualRoles}, expected exactly ${roles}`);
  }
  const hackersUrlResource = BigInt(keccak256(toHex("url")));
  if (
    !(await pc.readContract({
      address: metadata.hackers,
      abi: resolverAbi,
      functionName: "hasRoles",
      args: [hackersUrlResource, 1n << 4n, ctx.organizer],
    }))
  )
    throw new Error("hackers resolver is missing organizer's URL-scoped text setter permission");
}

/** Everything the planner needs, read from the chain (and the local state file for the registrar). */
async function observe(ctx: Ctx, state: State, expectedIssuance: IssuanceConfig) {
  const { publicClient: pc, organizer } = ctx;
  const eth = ensv2Sepolia.ethRegistry;

  const lanyardOwner = await pc.readContract({
    address: eth,
    abi: permissionedRegistryAbi,
    functionName: "getOwner",
    args: [idOf(baseLabel)],
  });
  const lanyardExpiry = await pc.readContract({
    address: eth,
    abi: permissionedRegistryAbi,
    functionName: "getExpiry",
    args: [idOf(baseLabel)],
  });
  const proxyLogic = await pc.readContract({
    address: ensv2Sepolia.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: "proxyLogic",
  });
  const baseRegistry = predictVerifiableProxy({
    factory: ensv2Sepolia.verifiableFactory,
    proxyLogic,
    sender: organizer,
    salt: baseRegistrySalt(eventConfig.baseName),
  });
  const baseDeployed = ((await pc.getCode({ address: baseRegistry })) ?? "0x") !== "0x";

  let baseAttached = false;
  let parentSet = false;
  let parentLocked = false;
  if (baseDeployed) {
    const sub = await pc.readContract({
      address: eth,
      abi: permissionedRegistryAbi,
      functionName: "getSubregistry",
      args: [baseLabel],
    });
    baseAttached = sameAddress(sub, baseRegistry);
    const [parent, label] = await pc.readContract({
      address: baseRegistry,
      abi: permissionedRegistryAbi,
      functionName: "getParent",
    });
    parentSet = sameAddress(parent, eth) && label === baseLabel;
    const held = await pc.readContract({
      address: baseRegistry,
      abi: permissionedRegistryAbi,
      functionName: "roles",
      args: [0n, organizer],
    });
    parentLocked = (held & (ROLE.SET_PARENT | admin(ROLE.SET_PARENT))) === 0n;
  }

  let registrarPhase: EditionObservation["registrarPhase"] = null;
  let issuanceConfigured = false;
  let editionNameAttached = false;
  let editionRegistry: Address | null = null;
  if (state.registrar) {
    const r = state.registrar;
    if (((await pc.getCode({ address: r })) ?? "0x") === "0x")
      throw new Error(`recorded registrar ${r} has no code; refusing to deploy over recorded state`);
    await assertRegistrarVersion(pc, r);
    const call = { address: r, abi: lanyardRegistrarAbi } as const;
    const [
      org,
      base,
      factory,
      impl,
      end,
      freeze,
      label,
      phase,
      hackersResolver,
      staffResolver,
      headJudge,
      configuredBaseName,
    ] = await Promise.all([
      pc.readContract({ ...call, functionName: "organizer" }),
      pc.readContract({ ...call, functionName: "baseRegistry" }),
      pc.readContract({ ...call, functionName: "factory" }),
      pc.readContract({ ...call, functionName: "userRegistryImplementation" }),
      pc.readContract({ ...call, functionName: "eventEnd" }),
      pc.readContract({ ...call, functionName: "freezeDeadline" }),
      pc.readContract({ ...call, functionName: "editionLabel" }),
      pc.readContract({ ...call, functionName: "phase" }),
      pc.readContract({ address: r, abi: issuanceAbi, functionName: "hackersResolver" }),
      pc.readContract({ address: r, abi: issuanceAbi, functionName: "staffResolver" }),
      pc.readContract({ address: r, abi: issuanceAbi, functionName: "headJudge" }),
      pc.readContract({ address: r, abi: issuanceAbi, functionName: "baseName" }),
    ]);
    const mismatches = registrarMismatches(
      {
        organizer: org,
        baseRegistry: base,
        factory,
        userRegistryImplementation: impl,
        eventEnd: end,
        freezeDeadline: freeze,
        editionLabel: label,
      },
      {
        organizer,
        baseRegistry,
        factory: ensv2Sepolia.verifiableFactory,
        userRegistryImplementation: ensv2Sepolia.userRegistryImpl,
        eventEnd: eventConfig.times.eventEnd,
        freezeDeadline: eventConfig.times.freezeDeadline,
        editionLabel: edition,
      },
    );
    if (mismatches.length > 0) {
      throw new Error(`recorded registrar ${r} does not match the config: ${mismatches.join("; ")}`);
    }
    registrarPhase = REGISTRAR_PHASE[phase] ?? null;
    if (!sameAddress(expectedIssuance.headJudge, organizer) && sameAddress(expectedIssuance.headJudge, r))
      throw new Error("head judge must be distinct from the registrar");
    const noIssuanceConfig =
      sameAddress(hackersResolver, ZERO_ADDRESS) &&
      sameAddress(staffResolver, ZERO_ADDRESS) &&
      sameAddress(headJudge, ZERO_ADDRESS) &&
      configuredBaseName === "";
    const actualIssuance: IssuanceConfig | null = noIssuanceConfig
      ? null
      : { hackersResolver, staffResolver, headJudge, baseName: configuredBaseName };
    const issuanceState = issuanceConfigurationState(registrarPhase, actualIssuance, expectedIssuance);
    if (issuanceState.mismatches.length > 0)
      throw new Error(
        `recorded registrar ${r} issuance configuration mismatch: ${issuanceState.mismatches.join("; ")}`,
      );
    issuanceConfigured = issuanceState.configured;
    if (registrarPhase !== "created" && !issuanceConfigured)
      throw new Error(`recorded registrar ${r} has no issuance configuration after bootstrap`);
    if (registrarPhase !== "created") {
      editionRegistry = await pc.readContract({
        address: r,
        abi: lanyardRegistrarAbi,
        functionName: "edition",
      });
    }
    if (baseDeployed) {
      const owner = await pc.readContract({
        address: baseRegistry,
        abi: permissionedRegistryAbi,
        functionName: "getOwner",
        args: [idOf(edition)],
      });
      editionNameAttached = sameAddress(owner, r);
    }
  }

  const observation: EditionObservation = {
    lanyardOwnedByOrganizer: sameAddress(lanyardOwner, organizer),
    lanyardExpiry,
    namespaceExpiry: nsExpiry,
    baseRegistryDeployed: baseDeployed,
    baseAttachedToLanyard: baseAttached,
    baseParentSet: parentSet,
    baseParentLocked: parentLocked,
    registrarPhase,
    issuanceConfigured,
    editionNameAttached,
  };
  return { observation, baseRegistry, editionRegistry };
}

/**
 * A1-D7: the full root-role inventory of the hackers and staff resolvers, read-only. Run before `seal`
 * (a resolver admin or UPGRADE holder could later stop the registrar's address writes, and with them all
 * issuance, for good) and again in the final verify. Returns problems; empty means clean.
 */
async function fixedResolverProblems(
  ctx: Ctx,
  registrar: Address,
  resolvers: ResolverMetadata,
): Promise<string[]> {
  const pc = ctx.publicClient;
  const coin60 = BigInt(keccak256(encodePacked(["uint256"], [60n])));
  const url = BigInt(keccak256(toHex("url")));
  const problems: string[] = [];
  for (const kind of ["hackers", "staff"] as const) {
    const address = resolvers[kind];
    const rolesOf = (resource: bigint, account: Address) =>
      pc.readContract({ address, abi: resolverAbi, functionName: "roles", args: [resource, account] });
    const countOf = (resource: bigint) =>
      pc.readContract({ address, abi: resolverAbi, functionName: "roleCount", args: [resource] });
    const [rootCounts, organizerRoot, registrarRoot, registrarCoin60, coin60Counts, urlCounts] =
      await Promise.all([
        countOf(0n),
        rolesOf(0n, ctx.organizer),
        rolesOf(0n, registrar),
        rolesOf(coin60, registrar),
        countOf(coin60),
        countOf(url),
      ]);
    problems.push(
      ...fixedResolverRoleProblems({
        kind,
        rootCounts,
        organizerRoot,
        registrarRoot,
        registrarCoin60,
        coin60Counts,
        urlCounts,
      }),
    );
  }
  return problems;
}

async function send(ctx: Ctx, label: string, request: Promise<Hex>): Promise<void> {
  const hash = await request;
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted in ${hash}`);
  console.log(`  ok  ${label}  ${hash}`);
}

async function runStep(
  ctx: Ctx,
  step: EditionStep,
  baseRegistry: Address,
  state: State,
  issuance: IssuanceConfig,
  resolvers: ResolverMetadata,
): Promise<void> {
  const wc = ctx.walletClient;
  const account = ctx.account;
  if (!wc || !account) throw new Error("ORGANIZER_PRIVATE_KEY is required to send transactions");
  const eth = ensv2Sepolia.ethRegistry;
  const common = { account, chain: wc.chain } as const;
  const base = { address: baseRegistry, abi: permissionedRegistryAbi, ...common } as const;

  switch (step) {
    case "deploy-base-registry": {
      const init = encodeFunctionData({
        abi: userRegistryInitAbi,
        functionName: "initialize",
        args: [[{ account: ctx.organizer, roleBitmap: BASE_SETUP_ROLES }]],
      });
      await send(
        ctx,
        step,
        wc.writeContract({
          address: ensv2Sepolia.verifiableFactory,
          abi: verifiableFactoryAbi,
          functionName: "deployProxy",
          args: [ensv2Sepolia.userRegistryImpl, baseRegistrySalt(eventConfig.baseName), init],
          ...common,
        }),
      );
      return;
    }
    case "attach-base-registry":
      return send(
        ctx,
        step,
        wc.writeContract({
          address: eth,
          abi: permissionedRegistryAbi,
          functionName: "setSubregistry",
          args: [idOf(baseLabel), baseRegistry],
          ...common,
        }),
      );
    case "set-base-parent":
      return send(
        ctx,
        step,
        wc.writeContract({ ...base, functionName: "setParent", args: [eth, baseLabel] }),
      );
    case "lock-base-parent":
      return send(
        ctx,
        step,
        wc.writeContract({
          ...base,
          functionName: "revokeRootRoles",
          args: [ROLE.SET_PARENT | admin(ROLE.SET_PARENT), ctx.organizer],
        }),
      );
    case "deploy-registrar": {
      const artifact = readArtifact();
      const hash = await wc.deployContract({
        abi: lanyardRegistrarAbi,
        bytecode: artifact,
        args: [
          ctx.organizer,
          ensv2Sepolia.verifiableFactory,
          ensv2Sepolia.userRegistryImpl,
          baseRegistry,
          edition,
          eventConfig.times.eventEnd,
          eventConfig.times.freezeDeadline,
        ],
        ...common,
      });
      state.registrarTx = hash;
      writeState(ctx.statePath, state); // before waiting: a stopped run recovers the address from this hash
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress)
        throw new Error(`${step} failed in ${hash}`);
      state.registrar = lower(receipt.contractAddress);
      writeState(ctx.statePath, state); // record at once so a stopped run resumes with this registrar
      console.log(`  ok  ${step}  ${state.registrar}  ${hash}`);
      return;
    }
    case "configure-issuance": {
      const registrar = requireRegistrar(state);
      if (sameAddress(registrar, issuance.headJudge) || sameAddress(registrar, ctx.organizer))
        throw new Error("head judge must be distinct from organizer and registrar");
      const resource60 = BigInt(keccak256(encodePacked(["uint256"], [60n])));
      const setter = encodeFunctionData({
        abi: addressSetterAbi,
        functionName: "setAddress",
        args: ["0x", 60n, encodePacked(["address"], [registrar])],
      });
      for (const [kind, resolver] of [
        ["hackers", resolvers.hackers],
        ["staff", resolvers.staff],
      ] as const) {
        const hasAddressAuthority = await ctx.publicClient.readContract({
          address: resolver,
          abi: resolverAbi,
          functionName: "hasRoles",
          args: [resource60, RESOLVER_ADDRESS_ROLE, registrar],
        });
        if (!hasAddressAuthority) {
          await send(
            ctx,
            `grant-registrar-coin60-address-${kind}`,
            wc.writeContract({
              address: resolver,
              abi: resolverAbi,
              functionName: "grantSetterRoles",
              args: [setter, registrar],
              ...common,
            }),
          );
        }
        if (
          !(await ctx.publicClient.readContract({
            address: resolver,
            abi: resolverAbi,
            functionName: "hasRoles",
            args: [resource60, RESOLVER_ADDRESS_ROLE, registrar],
          }))
        )
          throw new Error(`${kind} resolver did not grant registrar the coin-60 address role`);
      }
      await send(
        ctx,
        step,
        wc.writeContract({
          address: registrar,
          abi: issuanceAbi,
          functionName: "configureIssuance",
          args: [issuance.hackersResolver, issuance.staffResolver, issuance.headJudge, issuance.baseName],
          ...common,
        }),
      );
      return;
    }
    case "bootstrap-edition":
      return send(
        ctx,
        step,
        wc.writeContract({
          address: requireRegistrar(state),
          abi: lanyardRegistrarAbi,
          functionName: "bootstrapEdition",
          ...common,
        }),
      );
    case "attach-edition-name": {
      const registrar = requireRegistrar(state);
      const editionRegistry = await ctx.publicClient.readContract({
        address: registrar,
        abi: lanyardRegistrarAbi,
        functionName: "edition",
      });
      await send(
        ctx,
        step,
        wc.writeContract({
          ...base,
          functionName: "register",
          args: [
            edition,
            registrar,
            editionRegistry,
            "0x0000000000000000000000000000000000000000",
            EDITION_NAME_ROLES,
            FAR_FUTURE,
          ],
        }),
      );
      return;
    }
    case "seal-edition": {
      // Sealing is the point of no return for the resolver wiring: refuse before sending anything.
      const resolverProblems = await fixedResolverProblems(ctx, requireRegistrar(state), resolvers);
      if (resolverProblems.length > 0)
        throw new Error(`refusing to seal, nothing sent: ${resolverProblems.join("; ")}`);
      return send(
        ctx,
        step,
        wc.writeContract({
          address: requireRegistrar(state),
          abi: lanyardRegistrarAbi,
          functionName: "seal",
          ...common,
        }),
      );
    }
  }
}

/** A deploy tx was recorded but no address: adopt the registrar from its receipt instead of deploying twice. */
async function adoptRecordedDeploy(ctx: Ctx, state: State): Promise<void> {
  if (state.registrar || !state.registrarTx) return;
  let receipt: Awaited<ReturnType<Ctx["publicClient"]["getTransactionReceipt"]>> | null;
  try {
    receipt = await ctx.publicClient.getTransactionReceipt({ hash: state.registrarTx });
  } catch {
    receipt = null; // not mined (yet), or unknown to this node
  }
  const decision = recoverRegistrar(
    receipt ? { status: receipt.status, contractAddress: receipt.contractAddress ?? null } : null,
  );
  if (decision.action === "wait") {
    throw new Error(`registrar deploy ${state.registrarTx} has no receipt yet; wait for it, then re-run`);
  }
  if (decision.action === "use") {
    await assertRegistrarVersion(ctx.publicClient, decision.address);
    state.registrar = decision.address;
    console.log(`recovered registrar ${decision.address} from ${state.registrarTx}`);
  } else {
    delete state.registrarTx; // it reverted: the planner deploys a fresh one
  }
  writeState(ctx.statePath, state);
}

function requireRegistrar(state: State): Address {
  if (!state.registrar) throw new Error("no registrar recorded");
  return state.registrar;
}

function readArtifact(): Hex {
  let raw: string;
  try {
    raw = readFileSync(ARTIFACT, "utf8");
  } catch {
    throw new Error(
      "contracts/out/LanyardRegistrar.sol is missing; run `forge build --root contracts` first",
    );
  }
  const bytecode = (JSON.parse(raw) as { bytecode?: { object?: string } }).bytecode?.object;
  if (!bytecode || !bytecode.startsWith("0x")) throw new Error("LanyardRegistrar artifact has no bytecode");
  return bytecode as Hex;
}

/** Re-reads the chain after the last step and fails loudly if the end state is not what A1.1 promises. */
async function verifyFinal(
  ctx: Ctx,
  baseRegistry: Address,
  state: State,
  expectedIssuance: IssuanceConfig,
  resolvers: ResolverMetadata,
): Promise<Address> {
  const pc = ctx.publicClient;
  const registrar = requireRegistrar(state);
  await assertRegistrarVersion(pc, registrar);
  const [hackersResolver, staffResolver, headJudge, configuredBaseName] = await Promise.all([
    pc.readContract({ address: registrar, abi: issuanceAbi, functionName: "hackersResolver" }),
    pc.readContract({ address: registrar, abi: issuanceAbi, functionName: "staffResolver" }),
    pc.readContract({ address: registrar, abi: issuanceAbi, functionName: "headJudge" }),
    pc.readContract({ address: registrar, abi: issuanceAbi, functionName: "baseName" }),
  ]);
  const issuanceProblems = issuanceMismatches(
    { hackersResolver, staffResolver, headJudge, baseName: configuredBaseName },
    expectedIssuance,
  );
  if (issuanceProblems.length > 0)
    throw new Error(`final issuance configuration check failed: ${issuanceProblems.join("; ")}`);
  const editionRegistry = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "edition",
  });
  const reg = { address: editionRegistry, abi: permissionedRegistryAbi } as const;
  const [emancipated, counts, parent, upgrade] = await Promise.all([
    pc.readContract({ ...reg, functionName: "isEmancipated" }),
    pc.readContract({ ...reg, functionName: "roleCount", args: [0n] }),
    pc.readContract({ ...reg, functionName: "getParent" }),
    pc.readContract({ ...reg, functionName: "hasRootRoles", args: [ROLE.UPGRADE, registrar] }),
  ]);
  const problems: string[] = await fixedResolverProblems(ctx, registrar, resolvers);
  if (!emancipated) problems.push("edition registry is not emancipated");
  if (counts !== (ROLE.REGISTRAR | ROLE.RENEW)) problems.push(`edition root role counts are ${counts}`);
  if (upgrade) problems.push("registrar holds ROLE_UPGRADE");
  if (!sameAddress(parent[0], baseRegistry) || parent[1] !== edition)
    problems.push("edition parent pointer is wrong");
  // The four books exist, belong to the organizer and have exactly the managed-registry roles (A1.2-R1/R2).
  const organizerBookRoles = ROLE.REGISTRAR | ROLE.UNREGISTER | ROLE.RENEW | ROLE.SET_RESOLVER;
  for (const book of BOOKS) {
    const hash = keccak256(toHex(book));
    const registry = await pc.readContract({
      address: registrar,
      abi: lanyardRegistrarAbi,
      functionName: "bookRegistry",
      args: [hash],
    });
    const bookReg = { address: registry, abi: permissionedRegistryAbi } as const;
    const [owner, subregistry, bookResolver, expiry, counts, held, headJudgeRoles, bookParent] =
      await Promise.all([
        pc.readContract({ ...reg, functionName: "getOwner", args: [idOf(book)] }),
        pc.readContract({ ...reg, functionName: "getSubregistry", args: [book] }),
        pc.readContract({ ...reg, functionName: "getResolver", args: [book] }),
        pc.readContract({ ...reg, functionName: "getExpiry", args: [idOf(book)] }),
        pc.readContract({ ...bookReg, functionName: "roleCount", args: [0n] }),
        pc.readContract({ ...bookReg, functionName: "roles", args: [0n, ctx.organizer] }),
        pc.readContract({ ...bookReg, functionName: "roles", args: [0n, expectedIssuance.headJudge] }),
        pc.readContract({ ...bookReg, functionName: "getParent" }),
      ]);
    if (!sameAddress(owner, ctx.organizer)) problems.push(`${book}: name is not owned by the organizer`);
    if (!sameAddress(subregistry, registry)) problems.push(`${book}: name does not point at its registry`);
    if (!sameAddress(bookResolver, resolverForBook(book, expectedIssuance)))
      problems.push(`${book}: name has the wrong fixed resolver`);
    if (expiry !== nsExpiry) problems.push(`${book}: name expires at ${expiry}, expected ${nsExpiry}`);
    if (counts !== expectedBookRoleCount(book))
      problems.push(`${book}: unexpected root role holders (${counts})`);
    if (book === "judges" && headJudgeRoles !== ROLE.UNREGISTER)
      problems.push(`judges: head judge roles are ${headJudgeRoles}`);
    if (held !== organizerBookRoles) problems.push(`${book}: organizer roles are ${held}`);
    if (!sameAddress(bookParent[0], editionRegistry) || bookParent[1] !== book)
      problems.push(`${book}: parent pointer is wrong`);
  }
  // Phase, protected labels and the edition name in the base registry (A1.1-R3, R4).
  const phase = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "phase",
  });
  if (REGISTRAR_PHASE[phase] !== "sealed") problems.push("registrar is not sealed");
  for (const label of ["admin", "staff", "lanyard", "ethglobal", "winner"]) {
    const status = await pc.readContract({ ...reg, functionName: "getStatus", args: [idOf(label)] });
    if (status !== 1) problems.push(`${label} is not reserved in the edition registry`);
  }
  const baseReg = { address: baseRegistry, abi: permissionedRegistryAbi } as const;
  const [nameOwner, nameExpiry, nameRoles, resolverSet] = await Promise.all([
    pc.readContract({ ...baseReg, functionName: "getOwner", args: [idOf(edition)] }),
    pc.readContract({ ...baseReg, functionName: "getExpiry", args: [idOf(edition)] }),
    pc.readContract({ ...baseReg, functionName: "roles", args: [idOf(edition), registrar] }),
    pc.readContract({ address: registrar, abi: lanyardRegistrarAbi, functionName: "publicationResolver" }),
  ]);
  if (!sameAddress(nameOwner, registrar)) problems.push("edition name is not owned by the registrar");
  if (nameExpiry !== FAR_FUTURE) problems.push(`edition name expires at ${nameExpiry}, not far-future`);
  const resolverFrozen = !sameAddress(resolverSet, "0x0000000000000000000000000000000000000000");
  const expectedNameRoles = resolverFrozen ? ROLE.RENEW : EDITION_NAME_ROLES;
  if (nameRoles !== expectedNameRoles) problems.push(`registrar roles on the edition name are ${nameRoles}`);
  if (problems.length > 0) throw new Error(`final state check failed: ${problems.join("; ")}`);
  return editionRegistry;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const planOnly = args.has("--plan");
  const fork = args.has("--fork");
  for (const a of args) if (!["--plan", "--fork"].includes(a)) throw new Error(`unknown argument ${a}`);

  const ctx: Ctx = await connect({ fork, needKey: !planOnly });
  const { organizer } = ctx;
  const state = readState(ctx.statePath);
  const resolverMetadata = readResolverMetadata(ctx);
  await validateResolverMetadata(ctx, resolverMetadata);
  const issuance: IssuanceConfig = {
    hackersResolver: resolverMetadata.hackers,
    staffResolver: resolverMetadata.staff,
    headJudge: issuanceHeadJudge(ctx),
    baseName: eventConfig.baseName,
  };
  if (state.registrar && sameAddress(state.registrar, issuance.headJudge))
    throw new Error("head judge must be distinct from the recorded registrar");

  await adoptRecordedDeploy(ctx, state);
  const { observation, baseRegistry } = await observe(ctx, state, issuance);
  const plan = planEditionSteps(observation);
  console.log(
    `edition ${edition}.${eventConfig.baseName} on ${fork ? "fork" : "sepolia"}, organizer ${organizer}`,
  );
  if (plan.status === "blocked") throw new Error(`blocked: ${plan.reason}`);
  console.log(plan.steps.length === 0 ? "nothing to do" : `plan: ${plan.steps.join(" → ")}`);
  if (planOnly) return;

  for (const step of plan.steps) {
    console.log(`> ${step}`);
    await runStep(ctx, step, baseRegistry, state, issuance, resolverMetadata);
  }
  const after = await observe(ctx, state, issuance);
  const left = planEditionSteps(after.observation);
  if (left.status !== "ready" || left.steps.length > 0)
    throw new Error("steps ran but the chain still needs work");
  const editionRegistry = await verifyFinal(ctx, baseRegistry, state, issuance, resolverMetadata);
  writeState(ctx.statePath, {
    registrar: requireRegistrar(state),
    baseRegistry,
    editionRegistry,
    verifiedAt: new Date().toISOString(),
  });
  console.log(
    `done. base ${baseRegistry}, registrar ${state.registrar}, edition registry ${editionRegistry}`,
  );
}

main().catch((err: unknown) => fail("deploy-edition", err));
