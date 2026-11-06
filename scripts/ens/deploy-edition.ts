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
import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
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
import { ensv2Sepolia } from "../../src/ens/ensv2-sepolia";
import { BOOKS } from "../../src/shared/labels";
import { namespaceExpiry } from "../../src/shared/config/validate";
import { eventConfig } from "../../src/shared/event.config";
import { connect, fail, ROOT, sameAddress, type Connection } from "./connect";

const ARTIFACT = resolve(ROOT, "contracts/out/LanyardRegistrar.sol/LanyardRegistrar.json");

const idOf = (label: string): bigint => BigInt(keccak256(toHex(label)));
const lower = (a: string): Address => a.toLowerCase() as Address;

type Ctx = Connection;

type State = { registrar?: Address; registrarTx?: Hex };

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

/** Everything the planner needs, read from the chain (and the local state file for the registrar). */
async function observe(ctx: Ctx, state: State) {
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
  let editionNameAttached = false;
  let editionRegistry: Address | null = null;
  if (state.registrar && ((await pc.getCode({ address: state.registrar })) ?? "0x") !== "0x") {
    const r = state.registrar;
    const call = { address: r, abi: lanyardRegistrarAbi } as const;
    const [org, base, factory, impl, end, freeze, label, phase] = await Promise.all([
      pc.readContract({ ...call, functionName: "organizer" }),
      pc.readContract({ ...call, functionName: "baseRegistry" }),
      pc.readContract({ ...call, functionName: "factory" }),
      pc.readContract({ ...call, functionName: "userRegistryImplementation" }),
      pc.readContract({ ...call, functionName: "eventEnd" }),
      pc.readContract({ ...call, functionName: "freezeDeadline" }),
      pc.readContract({ ...call, functionName: "editionLabel" }),
      pc.readContract({ ...call, functionName: "phase" }),
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
    editionNameAttached,
  };
  return { observation, baseRegistry, editionRegistry };
}

async function send(ctx: Ctx, label: string, request: Promise<Hex>): Promise<void> {
  const hash = await request;
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted in ${hash}`);
  console.log(`  ok  ${label}  ${hash}`);
}

async function runStep(ctx: Ctx, step: EditionStep, baseRegistry: Address, state: State): Promise<void> {
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
    case "seal-edition":
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
async function verifyFinal(ctx: Ctx, baseRegistry: Address, state: State): Promise<Address> {
  const pc = ctx.publicClient;
  const registrar = requireRegistrar(state);
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
  const problems: string[] = [];
  if (!emancipated) problems.push("edition registry is not emancipated");
  if (counts !== (ROLE.REGISTRAR | ROLE.RENEW)) problems.push(`edition root role counts are ${counts}`);
  if (upgrade) problems.push("registrar holds ROLE_UPGRADE");
  if (!sameAddress(parent[0], baseRegistry) || parent[1] !== edition)
    problems.push("edition parent pointer is wrong");
  // The four books exist, belong to the organizer and have exactly the managed-registry roles (A1.2-R1/R2).
  const organizerBookRoles = ROLE.REGISTRAR | ROLE.UNREGISTER | ROLE.RENEW | ROLE.SET_RESOLVER;
  const bookCounts = 2n * ROLE.REGISTRAR + ROLE.UNREGISTER + 2n * ROLE.RENEW + ROLE.SET_RESOLVER;
  for (const book of BOOKS) {
    const hash = keccak256(toHex(book));
    const registry = await pc.readContract({
      address: registrar,
      abi: lanyardRegistrarAbi,
      functionName: "bookRegistry",
      args: [hash],
    });
    const bookReg = { address: registry, abi: permissionedRegistryAbi } as const;
    const [owner, subregistry, expiry, counts, held, bookParent] = await Promise.all([
      pc.readContract({ ...reg, functionName: "getOwner", args: [idOf(book)] }),
      pc.readContract({ ...reg, functionName: "getSubregistry", args: [book] }),
      pc.readContract({ ...reg, functionName: "getExpiry", args: [idOf(book)] }),
      pc.readContract({ ...bookReg, functionName: "roleCount", args: [0n] }),
      pc.readContract({ ...bookReg, functionName: "roles", args: [0n, ctx.organizer] }),
      pc.readContract({ ...bookReg, functionName: "getParent" }),
    ]);
    if (!sameAddress(owner, ctx.organizer)) problems.push(`${book}: name is not owned by the organizer`);
    if (!sameAddress(subregistry, registry)) problems.push(`${book}: name does not point at its registry`);
    if (expiry !== nsExpiry) problems.push(`${book}: name expires at ${expiry}, expected ${nsExpiry}`);
    if (counts !== bookCounts) problems.push(`${book}: unexpected root role holders (${counts})`);
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
  if (nameExpiry < nsExpiry) problems.push(`edition name expires at ${nameExpiry}, before ${nsExpiry}`);
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

  await adoptRecordedDeploy(ctx, state);
  const { observation, baseRegistry } = await observe(ctx, state);
  const plan = planEditionSteps(observation);
  console.log(
    `edition ${edition}.${eventConfig.baseName} on ${fork ? "fork" : "sepolia"}, organizer ${organizer}`,
  );
  if (plan.status === "blocked") throw new Error(`blocked: ${plan.reason}`);
  console.log(plan.steps.length === 0 ? "nothing to do" : `plan: ${plan.steps.join(" → ")}`);
  if (planOnly) return;

  for (const step of plan.steps) {
    console.log(`> ${step}`);
    await runStep(ctx, step, baseRegistry, state);
  }
  const after = await observe(ctx, state);
  const left = planEditionSteps(after.observation);
  if (left.status !== "ready" || left.steps.length > 0)
    throw new Error("steps ran but the chain still needs work");
  const editionRegistry = await verifyFinal(ctx, baseRegistry, state);
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
