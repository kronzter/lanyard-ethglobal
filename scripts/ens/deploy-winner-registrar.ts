#!/usr/bin/env tsx
// A4.1-R5 / A4.2: deploy WinnerRegistrar and hand it the publication resolver.
//   pnpm exec tsx scripts/ens/deploy-winner-registrar.ts [--plan] [--fork] --results-wallet <address>
// Steps, each skipped when already done (a re-plan after success reports nothing to do):
//   1. deploy WinnerRegistrar(registrar, resultsWallet) from the forge artifact in contracts/out;
//   2. organizer calls the registrar's one-shot setWinnerRegistrar;
//   3. organizer grants the contract the publication resolver's complete root inventory (text, link,
//      upgrade and their admins);
//   4. organizer revokes its own root roles (irreversible: simulated first);
//   5. require checkSealed()/grantInventorySealed().
// Before any send it audits every EACRolesChanged log of the publication resolver since deployment and
// refuses if any account other than the organizer and the contract holds a root role, or anyone holds
// a scoped (per-key) grant, for the six publication keys or any other key. The deployed address is
// recorded in `.lanyard/winner-<fork|sepolia>.json` (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BaseError,
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { lanyardRegistrarAbi } from "../../src/ens/ensv2-abi";
import { PUBLICATION_ORGANIZER_RESOLVER_ROLES } from "../../src/ens/issuance-plan";
import { scanLogs } from "../../src/ens/logs";
import { publicationResolverAbi, winnerRegistrarAbi } from "../../src/ens/winner-registrar-abi";
import { eventConfig } from "../../src/shared/event.config";
import { connect, fail, ROOT, sameAddress, type Connection } from "./connect";
import { loadLiveSepolia } from "./live";

const RESOLVER_ROLES = PUBLICATION_ORGANIZER_RESOLVER_ROLES;
const SEALED_PHASE = 2;
// anvil/hardhat default wallets: their keys are public, never a live results wallet.
const PUBLIC_TEST_WALLETS = [
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
];

type Saved = {
  schemaVersion: 1;
  chainId: number;
  registrar: Address;
  publicationResolver: Address;
  winnerRegistrar: Address;
  resultsWallet: Address;
};

function parseArgs(argv: string[]): { plan: boolean; fork: boolean; resultsWallet: Address | null } {
  let plan = false;
  let fork = false;
  let resultsWallet: Address | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--plan") plan = true;
    else if (a === "--fork") fork = true;
    else if (a === "--results-wallet") {
      const v = argv[++i];
      if (!v || !isAddress(v, { strict: false })) throw new Error("--results-wallet needs an address");
      resultsWallet = getAddress(v);
    } else throw new Error(`unknown argument ${a}`);
  }
  return { plan, fork, resultsWallet };
}

function readSaved(path: string): Partial<Saved> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<Saved>;
  } catch {
    return {};
  }
}

function artifact(): { abi: Abi; bytecode: Hex } {
  const path = resolve(ROOT, "contracts/out/WinnerRegistrar.sol/WinnerRegistrar.json");
  let json: { abi: Abi; bytecode: { object: Hex } };
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as typeof json;
  } catch {
    throw new Error(`no forge artifact at ${path}; run \`forge build\` in contracts/`);
  }
  if (!/^0x[0-9a-f]+$/i.test(json.bytecode.object)) throw new Error("the forge artifact has no bytecode");
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/** Holders of any role on the publication resolver, from its full log history, checked against roleCount. */
async function audit(
  ctx: Connection,
  resolver: Address,
  fromBlock: bigint,
): Promise<{ root: Map<Address, bigint>; scoped: { resource: bigint; account: Address; roles: bigint }[] }> {
  const pc = ctx.publicClient;
  const head = await pc.getBlockNumber();
  const event = publicationResolverAbi.find((x) => x.type === "event" && x.name === "EACRolesChanged")!;
  const logs = await scanLogs(fromBlock, head, (r) =>
    pc.getLogs({ address: resolver, event: event as never, ...r }),
  );
  const pairs = new Map<string, { resource: bigint; account: Address }>();
  for (const log of logs) {
    const { resource, account } = (log as unknown as { args: { resource: bigint; account: Address } }).args;
    pairs.set(`${resource}:${account.toLowerCase()}`, { resource, account: getAddress(account) });
  }
  const read = (functionName: "roles" | "roleCount", args: readonly unknown[]) =>
    pc.readContract({
      address: resolver,
      abi: publicationResolverAbi,
      functionName,
      args,
      blockNumber: head,
    } as never) as Promise<bigint>;
  const root = new Map<Address, bigint>();
  const scoped: { resource: bigint; account: Address; roles: bigint }[] = [];
  const sums = new Map<bigint, bigint>();
  for (const { resource, account } of pairs.values()) {
    const roles = await read("roles", [resource, account]);
    if (roles === 0n) continue;
    sums.set(resource, (sums.get(resource) ?? 0n) + roles);
    if (resource === 0n) root.set(account, roles);
    else scoped.push({ resource, account, roles });
  }
  // Each role is the low bit of its nybble and roleCount keeps one count per nybble, so the holders'
  // bitmaps must add up to roleCount exactly: otherwise the log scan missed a holder.
  const resources = new Set<bigint>([0n, ...[...pairs.values()].map((p) => p.resource)]);
  for (const resource of resources) {
    const count = await read("roleCount", [resource]);
    if (count !== (sums.get(resource) ?? 0n))
      throw new Error(
        `publication resolver resource ${resource}: roleCount ${count} does not match the holders found in its logs`,
      );
  }
  return { root, scoped };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const live = loadLiveSepolia();
  const ctx = await connect({ fork: args.fork, needKey: !args.plan });
  const pc = ctx.publicClient;
  const chainId = await pc.getChainId();
  const statePath = resolve(ROOT, `.lanyard/winner-${args.fork ? "fork" : "sepolia"}.json`);
  const saved = readSaved(statePath);

  const reg = <T>(functionName: string, a: readonly unknown[] = []) =>
    pc.readContract({
      address: live.registrar,
      abi: lanyardRegistrarAbi,
      functionName,
      args: a,
    } as never) as Promise<T>;
  const [organizer, phase, resolver, currentWinner] = await Promise.all([
    reg<Address>("organizer"),
    reg<number>("phase"),
    reg<Address>("publicationResolver"),
    reg<Address>("winnerRegistrar"),
  ]);
  if (!sameAddress(organizer, ctx.organizer))
    throw new Error("the connected organizer is not the registrar's organizer");
  if (phase !== SEALED_PHASE) throw new Error("the edition must be sealed first");
  if (!sameAddress(resolver, live.publicationResolver))
    throw new Error(`registrar publication resolver ${resolver} differs from deployments/sepolia.json`);

  const wr = <T>(address: Address, functionName: string) =>
    pc.readContract({ address, abi: winnerRegistrarAbi, functionName } as never) as Promise<T>;
  const verify = async (w: Address, wallet: Address | null): Promise<Address> => {
    const code = await pc.getCode({ address: w });
    if (!code || code === "0x") throw new Error(`WinnerRegistrar ${w} has no code`);
    const [r, p, rw, label, roles] = await Promise.all([
      wr<Address>(w, "registrar"),
      wr<Address>(w, "publicationResolver"),
      wr<Address>(w, "resultsWallet"),
      wr<string>(w, "editionLabel"),
      wr<bigint>(w, "RESOLVER_ROLES"),
    ]);
    if (!sameAddress(r, live.registrar) || !sameAddress(p, resolver) || label !== eventConfig.edition)
      throw new Error(`WinnerRegistrar ${w} is bound to another registrar, resolver or edition`);
    if (roles !== RESOLVER_ROLES)
      throw new Error(`WinnerRegistrar ${w} expects roles ${roles}, not ${RESOLVER_ROLES}`);
    if (wallet && !sameAddress(rw, wallet))
      throw new Error(`WinnerRegistrar ${w} has results wallet ${rw}, not --results-wallet ${wallet}`);
    return getAddress(rw);
  };

  let winner: Address | null = null;
  let resultsWallet = args.resultsWallet ?? (saved.resultsWallet ? getAddress(saved.resultsWallet) : null);
  if (!sameAddress(currentWinner, zeroAddress)) {
    winner = getAddress(currentWinner);
    resultsWallet = await verify(winner, resultsWallet);
  } else if (saved.winnerRegistrar && saved.chainId === chainId) {
    const code = await pc.getCode({ address: saved.winnerRegistrar });
    if (code && code !== "0x") {
      winner = getAddress(saved.winnerRegistrar);
      resultsWallet = await verify(winner, resultsWallet);
    }
  }
  if (!resultsWallet) throw new Error("--results-wallet <address> is required for a first deployment");
  if (sameAddress(resultsWallet, organizer)) throw new Error("the results wallet must not be the organizer");
  if (!args.fork && PUBLIC_TEST_WALLETS.includes(resultsWallet.toLowerCase()))
    throw new Error(`results wallet ${resultsWallet} is a public test wallet; use a dedicated key`);

  if (winner && (await wr<boolean>(winner, "locked"))) {
    console.log(`WinnerRegistrar ${winner}: results are locked; nothing to do`);
    return;
  }

  const inventory = await audit(ctx, resolver, live.deployedAtBlock);
  const unexpected: string[] = [];
  for (const [account, roles] of inventory.root) {
    if (sameAddress(account, organizer) || (winner && sameAddress(account, winner))) {
      if ((roles & ~RESOLVER_ROLES) !== 0n) unexpected.push(`${account} holds extra root roles ${roles}`);
    } else unexpected.push(`${account} holds root roles ${roles}`);
  }
  for (const s of inventory.scoped)
    unexpected.push(`${s.account} holds roles ${s.roles} on resource ${s.resource}`);
  if (unexpected.length > 0)
    throw new Error(
      `unexpected publication resolver holders block the handoff:\n  ${unexpected.join("\n  ")}`,
    );
  const organizerRoles = inventory.root.get(getAddress(organizer)) ?? 0n;
  const winnerRoles = winner ? (inventory.root.get(winner) ?? 0n) : 0n;
  if (winnerRoles !== RESOLVER_ROLES && (organizerRoles & RESOLVER_ROLES) !== RESOLVER_ROLES)
    throw new Error(
      "neither the organizer nor the contract holds the complete inventory; it cannot be granted",
    );

  const steps: string[] = [];
  if (!winner)
    steps.push(`deploy WinnerRegistrar(registrar ${live.registrar}, results wallet ${resultsWallet})`);
  if (sameAddress(currentWinner, zeroAddress)) steps.push("registrar.setWinnerRegistrar(WinnerRegistrar)");
  if (winnerRoles !== RESOLVER_ROLES)
    steps.push(`publicationResolver.grantRootRoles(${RESOLVER_ROLES}, WinnerRegistrar)`);
  if (organizerRoles !== 0n) steps.push(`publicationResolver.revokeRootRoles(${organizerRoles}, organizer)`);

  console.log(`registrar:            ${live.registrar}`);
  console.log(`publication resolver: ${resolver}`);
  console.log(`results wallet:       ${resultsWallet}`);
  console.log(`WinnerRegistrar:      ${winner ?? "(not deployed)"}`);
  if (steps.length === 0) {
    const sealed = await wr<boolean>(winner!, "grantInventorySealed");
    if (!sealed) throw new Error("no step is left but grantInventorySealed() is false");
    console.log("nothing to do: the contract holds the sealed publication inventory");
    save(statePath, {
      schemaVersion: 1,
      chainId,
      registrar: live.registrar,
      publicationResolver: resolver,
      winnerRegistrar: winner!,
      resultsWallet,
    });
    return;
  }
  for (const s of steps) console.log(`  do  ${s}`);
  if (args.plan) return;

  const { walletClient: wc, account } = ctx;
  if (!wc || !account) throw new Error("a signing key is required");
  if (!winner) {
    const { abi, bytecode } = artifact();
    const hash = await wc.deployContract({
      abi,
      bytecode,
      args: [live.registrar, resultsWallet],
      account,
      chain: wc.chain,
      nonce: await pc.getTransactionCount({ address: account.address, blockTag: "pending" }),
    });
    const receipt = await receiptOf(ctx, hash);
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`deployment reverted in ${hash}`);
    winner = getAddress(receipt.contractAddress);
    console.log(`  deploy WinnerRegistrar: ${winner} in ${hash} (block ${receipt.blockNumber})`);
    await verify(winner, resultsWallet);
    save(statePath, {
      schemaVersion: 1,
      chainId,
      registrar: live.registrar,
      publicationResolver: resolver,
      winnerRegistrar: winner,
      resultsWallet,
    });
  }
  const w = winner;
  if (sameAddress(currentWinner, zeroAddress))
    await sendTx(
      ctx,
      live.registrar,
      encodeFunctionData({ abi: lanyardRegistrarAbi, functionName: "setWinnerRegistrar", args: [w] }),
      "setWinnerRegistrar",
    );
  const rolesNow = (await pc.readContract({
    address: resolver,
    abi: publicationResolverAbi,
    functionName: "roles",
    args: [0n, w],
  })) as bigint;
  if (rolesNow !== RESOLVER_ROLES)
    await sendTx(
      ctx,
      resolver,
      encodeFunctionData({
        abi: publicationResolverAbi,
        functionName: "grantRootRoles",
        args: [RESOLVER_ROLES, w],
      }),
      "grant the inventory to WinnerRegistrar",
    );
  const orgNow = (await pc.readContract({
    address: resolver,
    abi: publicationResolverAbi,
    functionName: "roles",
    args: [0n, organizer],
  })) as bigint;
  if (orgNow !== 0n)
    // sendTx simulates (eth_call) before sending, so an unrevokable role fails here without effect.
    await sendTx(
      ctx,
      resolver,
      encodeFunctionData({
        abi: publicationResolverAbi,
        functionName: "revokeRootRoles",
        args: [orgNow, organizer],
      }),
      "revoke the organizer's inventory",
    );

  await audit(ctx, resolver, live.deployedAtBlock);
  try {
    await pc.readContract({ address: w, abi: winnerRegistrarAbi, functionName: "checkSealed" });
  } catch (err) {
    const data =
      err instanceof BaseError
        ? (err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null)?.data
        : undefined;
    const why = data ? decodeErrorResult({ abi: winnerRegistrarAbi, data }) : null;
    throw new Error(
      `checkSealed() failed after the handoff: ${why ? `${why.errorName}(${why.args?.join(", ")})` : String(err)}`,
      { cause: err },
    );
  }
  if (!(await wr<boolean>(w, "grantInventorySealed")))
    throw new Error("grantInventorySealed() is false after the handoff");
  console.log(`handoff complete: WinnerRegistrar ${w} is the sole publication resolver writer`);
  save(statePath, {
    schemaVersion: 1,
    chainId,
    registrar: live.registrar,
    publicationResolver: resolver,
    winnerRegistrar: w,
    resultsWallet,
  });
}

/** Polls for the receipt (a fork mining on demand produces no later block for a block watcher). */
async function receiptOf(ctx: Connection, hash: Hex, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await ctx.publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (r) return r;
    if (Date.now() > deadline) throw new Error(`no receipt for ${hash}; reconcile it before rerunning`);
    await new Promise((res) => setTimeout(res, ctx.fork ? 250 : 4_000));
  }
}

/** Simulate, send and confirm one organizer transaction. */
async function sendTx(ctx: Connection, to: Address, data: Hex, what: string): Promise<void> {
  const { walletClient: wc, publicClient: pc, account } = ctx;
  if (!wc || !account) throw new Error(`a signing key is required to ${what}`);
  await pc.call({ to, data, account });
  const nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await wc.sendTransaction({ to, data, account, chain: wc.chain, nonce });
  const receipt = await receiptOf(ctx, hash);
  if (receipt.status !== "success") throw new Error(`${what} reverted in ${hash}`);
  console.log(`  ${what}: confirmed ${hash} in block ${receipt.blockNumber}`);
}

function save(path: string, value: Saved): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`saved ${path}`);
}

main().catch((err: unknown) => fail("deploy-winner-registrar", err));
