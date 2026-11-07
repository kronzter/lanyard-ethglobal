// A4.2-R3 / I4 prepared-publication gate: SepoliaResultsPublisher passes runResultsPublisherConformance
// and runPreparedPublisherConformance on a local anvil fork of live Sepolia, after the real deploy/handoff script (scripts/ens/deploy-winner-registrar.ts) has run there
// with the organizer impersonated. Nothing is sent to Sepolia. Skipped unless SEPOLIA_RPC_URL is set;
// the URL is never printed.
//   SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com pnpm exec vitest run src/ens/sepolia-results-publisher.fork.test.ts
//
// Each conformance check starts from an anvil snapshot taken right after the handoff. Receipt outcomes
// are injected at eth_sendRawTransaction, after the publisher has simulated and journalled the signed
// bytes: "revert" sets the contract's `locked` storage bit while the transaction is mined (it then
// reverts on chain with ResultsLocked) and restores it; "pending" turns automine off so the
// transaction waits in the pool until settle() mines it; "crash-after-broadcast" forwards the bytes and
// then fails the call, as if the process died before seeing the node's answer.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, openSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  keccak256,
  namehash,
  parseAbi,
  pad,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, describe, expect, it } from "vitest";
import { eventConfig } from "../shared/event.config";
import type { WinnerInput } from "../shared/interfaces/results-publisher";
import {
  runResultsPublisherConformance,
  samplePublication,
  type HarnessOutcome,
  type PublisherHarness,
} from "../shared/testing/results-publisher-conformance";
import {
  runPreparedPublisherConformance,
  type PreparedPublisherHarness,
} from "../shared/testing/prepared-publisher-conformance";
import { dnsEncodeName } from "./dns-name";
import { lanyardRegistrarAbi } from "./ensv2-abi";
import { SepoliaResultsPublisher, type PublisherJournalIO } from "./sepolia-results-publisher";
import { fileJournal } from "./sepolia-results-publisher.journal";
import { publicationResolverAbi, stateHashOf, winnerRegistrarAbi } from "./winner-registrar-abi";

const UPSTREAM = process.env.SEPOLIA_RPC_URL;
const PORT = 8548;
const LOCAL = `http://127.0.0.1:${PORT}`;
const ROOT = resolve(__dirname, "../..");
const deployment = JSON.parse(readFileSync(resolve(ROOT, "deployments/sepolia.json"), "utf8")) as {
  contracts: Record<string, Address>;
};
const REGISTRAR = deployment.contracts.lanyardRegistrar!;
const RESOLVER = deployment.contracts.publicationResolver!;
const ORGANIZER = "0x36b7C556c584d65bd44Ae57656B64b68Bb88E2cF" as Address;
// Fresh addresses: anvil's well-known wallets carry EIP-7702 code on Sepolia and reject ERC-1155 mints.
const who = (n: number) =>
  `0x44444444444444444444444444444444444400${n.toString().padStart(2, "0")}` as Address;
const TEAMS = { zkpay: who(1), chainchat: who(2) } as const;
const resultsAccount = privateKeyToAccount(generatePrivateKey());
const LOCKED_SLOT = toHex(2, { size: 32 }); // `locked` is byte 0 of slot 2 (forge inspect storageLayout)
const EDITION_NAME = `${eventConfig.edition}.${eventConfig.baseName}`;

function anvilBinary(): string {
  const local = join(homedir(), ".foundry", "bin", process.platform === "win32" ? "anvil.exe" : "anvil");
  try {
    readFileSync(local);
    return local;
  } catch {
    return "anvil";
  }
}

let anvil: ChildProcess | undefined;
afterAll(() => {
  anvil?.kill();
});

const base = createPublicClient({
  chain: sepolia,
  transport: http(LOCAL),
  cacheTime: 0,
  pollingInterval: 100,
});
const test = createTestClient({ chain: sepolia, mode: "anvil", transport: http(LOCAL) });
const rpc = (method: string, params: unknown[] = []) =>
  base.request({ method, params } as never) as Promise<unknown>;

async function startFork(): Promise<void> {
  if (
    await base.getChainId().then(
      () => true,
      () => false,
    )
  )
    throw new Error(`port ${PORT} is already serving an RPC; stop it first`);
  const log = process.env.ANVIL_LOG;
  // A load-balanced public upstream sometimes lags ("block not found" at genesis): retry the spawn.
  for (let attempt = 0; attempt < 4; attempt++) {
    let exited = false;
    anvil = spawn(
      anvilBinary(),
      ["--fork-url", UPSTREAM!, "--port", String(PORT), ...(log ? [] : ["--silent"])],
      { stdio: log ? ["ignore", openSync(log, "w"), openSync(log, "a")] : "ignore" },
    );
    anvil.on("exit", () => void (exited = true));
    for (let i = 0; i < 60 && !exited; i++) {
      try {
        await base.getChainId();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    anvil.kill();
  }
  throw new Error("anvil fork did not start");
}

/** Polls the receipt: viem's block watcher can miss a block anvil mines asynchronously. */
async function receiptOf(hash: Hex) {
  for (let i = 0; i < 1200; i++) {
    const r = await base.getTransactionReceipt({ hash }).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`no receipt for ${hash}`);
}

async function send(from: Address, to: Address, data: Hex): Promise<void> {
  await base.call({ account: from, to, data }); // fail fast with the revert reason
  const wc = createWalletClient({ account: from, chain: sepolia, transport: http(LOCAL) });
  // Explicit nonce: anvil can hand out a stale one right after an asynchronously mined block.
  const nonce = await base.getTransactionCount({ address: from, blockTag: "pending" });
  const hash = await wc.sendTransaction({ to, data, account: from, chain: sepolia, nonce });
  const receipt = await receiptOf(hash);
  if (receipt.status !== "success") throw new Error(`transaction to ${to} reverted`);
}

/** Runs the deploy/handoff script against the fork as the impersonated organizer. */
function script(args: string[]): { ok: boolean; out: string } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    FORK_RPC_URL: LOCAL,
    FORK_IMPERSONATE: ORGANIZER,
  };
  delete env.SEPOLIA_RPC_URL;
  delete env.ORGANIZER_PRIVATE_KEY;
  const r = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules/tsx/dist/cli.mjs"),
      join(ROOT, "scripts/ens/deploy-winner-registrar.ts"),
      "--fork",
      ...args,
    ],
    { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8" },
  );
  return {
    ok: r.status === 0 && !r.stderr.includes("deploy-winner-registrar:"),
    out: `${r.stdout}${r.stderr}`,
  };
}

type Setup = { winner: Address; snapshot: Hex; transcript: Record<string, string>; scopedRefusal: string };

async function setup(): Promise<Setup> {
  await startFork();
  for (const a of [ORGANIZER, resultsAccount.address]) {
    await test.setBalance({ address: a, value: 10n ** 20n });
  }
  await test.impersonateAccount({ address: ORGANIZER });
  // Live Sepolia may already hold these teams (the I1 cast seeds zkpay); register only the missing ones.
  for (const [label, lead] of Object.entries(TEAMS)) {
    const existing = await base.readContract({
      address: REGISTRAR,
      abi: lanyardRegistrarAbi,
      functionName: "teamRegistry",
      args: [keccak256(toHex(label))],
    });
    if (existing !== zeroAddress) continue;
    await send(
      ORGANIZER,
      REGISTRAR,
      encodeFunctionData({ abi: lanyardRegistrarAbi, functionName: "registerTeam", args: [label, lead] }),
    );
  }
  const wallet = ["--results-wallet", resultsAccount.address];

  // An unexpected scoped grant (a `url` setter on the publication resolver) blocks the handoff.
  const before = (await rpc("evm_snapshot")) as Hex;
  const urlSetter = encodeFunctionData({
    abi: publicationResolverAbi,
    functionName: "setText",
    args: ["0x", "url", ""],
  });
  await send(
    ORGANIZER,
    RESOLVER,
    encodeFunctionData({
      abi: publicationResolverAbi,
      functionName: "grantSetterRoles",
      args: [urlSetter, who(9)],
    }),
  );
  const refused = script(wallet);
  if (refused.ok) throw new Error(`the handoff ignored a scoped holder:\n${refused.out}`);
  await rpc("evm_revert", [before]);

  const transcript: Record<string, string> = {};
  const plan = script(["--plan", ...wallet]);
  transcript.plan = plan.out;
  const apply = script(wallet);
  transcript.apply = apply.out;
  const replan = script(["--plan"]);
  transcript.replan = replan.out;
  if (!plan.ok || !apply.ok || !replan.ok)
    throw new Error(`deploy/handoff failed:\n${Object.values(transcript).join("\n")}`);
  const saved = JSON.parse(readFileSync(join(ROOT, ".lanyard/winner-fork.json"), "utf8")) as {
    winnerRegistrar: Address;
  };
  return {
    winner: saved.winnerRegistrar,
    snapshot: (await rpc("evm_snapshot")) as Hex,
    transcript,
    scopedRefusal: refused.out,
  };
}

const built = UPSTREAM ? setup() : null;
let setupDone: Setup | undefined;
void built?.then(
  (s) => void (setupDone = s),
  () => undefined, // surfaced by the tests that await `built`
);
let snapshot: Hex | null = null;

/** Back to the post-handoff state (anvil consumes a snapshot on revert, so take a new one). */
async function reset(): Promise<Address> {
  const s = await built!;
  await rpc("evm_revert", [snapshot ?? s.snapshot]);
  snapshot = (await rpc("evm_snapshot")) as Hex;
  await rpc("evm_setAutomine", [true]);
  return s.winner;
}

async function withLockedBit<T>(contract: Address, run: () => Promise<T>): Promise<T> {
  const original = (await rpc("eth_getStorageAt", [contract, LOCKED_SLOT, "latest"])) as Hex;
  await rpc("anvil_setStorageAt", [contract, LOCKED_SLOT, pad(toHex(BigInt(original) | 1n), { size: 32 })]);
  try {
    return await run();
  } finally {
    await rpc("anvil_setStorageAt", [contract, LOCKED_SLOT, original]);
  }
}

function memoryJournal(): PublisherJournalIO {
  let journal: string | null = null;
  return { read: async () => journal, write: async (t: string) => void (journal = t) };
}

/** `ready` gates every RPC (and settle), so a synchronous harness factory can still reset the fork first. */
function forkHarness(
  contract: Address,
  io: PublisherJournalIO = memoryJournal(),
  ready: Promise<unknown> = Promise.resolve(),
): PreparedPublisherHarness & PublisherHarness {
  const queue: HarnessOutcome[] = [];
  const client = createPublicClient({
    chain: sepolia,
    cacheTime: 0,
    pollingInterval: 100,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        await ready;
        if (method !== "eth_sendRawTransaction") return rpc(method, (params as unknown[]) ?? []);
        const outcome = queue.shift() ?? "success";
        const forward = () => rpc(method, params as unknown[]) as Promise<Hex>;
        switch (outcome) {
          case "success":
            return forward();
          case "revert":
            return withLockedBit(contract, async () => {
              const hash = await forward();
              await receiptOf(hash);
              return hash;
            });
          case "pending":
            await rpc("evm_setAutomine", [false]);
            return forward();
          case "crash-after-broadcast":
            await forward();
            throw new Error("simulated crash after broadcast");
        }
      },
    }),
  }) as PublicClient;
  const open = () =>
    new SepoliaResultsPublisher({
      client,
      account: resultsAccount,
      contract,
      journal: io,
      confirmations: 1,
      receiptTimeoutMs: 1500,
      pollingIntervalMs: 100,
    });
  return {
    open,
    restart: open,
    next: (o) => void queue.push(o),
    settle: async (_hash, outcome) => {
      await ready;
      const mine = () => rpc("evm_mine");
      if (outcome === "success") await mine();
      else await withLockedBit(contract, mine);
      await rpc("evm_setAutomine", [true]);
    },
  };
}

const win = (team: string, prizes: string[]): WinnerInput => ({ ...samplePublication, team, prizes });

describe.skipIf(!UPSTREAM)(
  "SepoliaResultsPublisher on a Sepolia fork",
  () => {
    it("deploys and hands off idempotently, refusing an unexpected scoped holder", async () => {
      const s = await built!;
      console.log(
        `--- plan ---\n${s.transcript.plan}\n--- apply ---\n${s.transcript.apply}\n--- re-plan ---\n${s.transcript.replan}\n--- scoped refusal ---\n${s.scopedRefusal}`,
      );
      expect(s.transcript.replan).toContain("nothing to do");
      expect(s.scopedRefusal).toMatch(/unexpected publication resolver holders/);
      const roles = await base.readContract({
        address: RESOLVER,
        abi: publicationResolverAbi,
        functionName: "roles",
        args: [0n, ORGANIZER],
      });
      expect(roles).toBe(0n);
    });

    runResultsPublisherConformance("SepoliaResultsPublisher (Sepolia fork)", async () =>
      forkHarness(await reset()),
    );

    // The prepared-publication gate, over the durable file journal the freeze CLI uses: each check
    // gets a reset fork and a fresh journal file, and every restart reopens that file.
    runPreparedPublisherConformance("SepoliaResultsPublisher (Sepolia fork, file journal)", () => {
      if (!setupDone) throw new Error("the fork deploy/handoff has not finished");
      const dir = mkdtempSync(join(tmpdir(), "lanyard-publisher-journal-"));
      return forkHarness(setupDone.winner, fileJournal(join(dir, "journal.json")), reset());
    });

    it("matches the contract's state hash, then locks the publication resolver for everyone", async () => {
      const contract = await reset();
      const p = forkHarness(contract).open();
      await p.setEventResults(samplePublication);
      // Declared out of label order, so the hash's team sorting is exercised.
      await p.declareWinner(win("zkpay", ["winner"]));
      await expect(p.declareWinner(win("chainchat", ["winner"]))).rejects.toThrow(/already awarded/);
      await expect(p.declareWinner(win("chainchat", ["winner", "runner-up"]))).rejects.toThrow(/sorted/);
      await expect(p.declareWinner(win("chainchat", ["first"]))).rejects.toThrow(/unknown prize/);
      await p.declareWinner(win("chainchat", ["runner-up"]));
      const state = await p.state();
      const onChain = await base.readContract({
        address: contract,
        abi: winnerRegistrarAbi,
        functionName: "stateHash",
      });
      expect(stateHashOf(state)).toBe(onChain);
      const textAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
      const resolverText = async (name: string, key: string) => {
        const call = encodeFunctionData({ abi: textAbi, functionName: "text", args: [namehash(name), key] });
        const out = await base.readContract({
          address: RESOLVER,
          abi: publicationResolverAbi,
          functionName: "resolve",
          args: [dnsEncodeName(name), call],
        });
        return decodeFunctionResult({ abi: textAbi, functionName: "text", data: out });
      };
      expect(await resolverText(EDITION_NAME, "lanyard.bundle-uri")).toBe(samplePublication.bundleUri);
      expect(await resolverText(`winner.zkpay.${EDITION_NAME}`, "lanyard.prizes")).toBe('["winner"]');

      expect(await resolverText(EDITION_NAME, "lanyard.locked")).toBe("");
      await p.lockResults(state);
      expect(await resolverText(EDITION_NAME, "lanyard.locked")).toBe("1");
      expect(
        await base.readContract({
          address: RESOLVER,
          abi: publicationResolverAbi,
          functionName: "roleCount",
          args: [0n],
        }),
      ).toBe(0n);

      await test.impersonateAccount({ address: contract });
      await test.setBalance({ address: contract, value: 10n ** 18n });
      const name = dnsEncodeName(EDITION_NAME);
      const attempts: [string, Hex][] = [
        [
          "setText",
          encodeFunctionData({
            abi: publicationResolverAbi,
            functionName: "setText",
            args: [name, "lanyard.results", "0x00"],
          }),
        ],
        [
          "setText(other key)",
          encodeFunctionData({
            abi: publicationResolverAbi,
            functionName: "setText",
            args: [dnsEncodeName(`winner.zkpay.${EDITION_NAME}`), "url", "https://evil.example"],
          }),
        ],
        [
          "linkToNode",
          encodeFunctionData({
            abi: publicationResolverAbi,
            functionName: "linkToNode",
            args: [name, namehash("evil.eth")],
          }),
        ],
        [
          "upgradeToAndCall",
          encodeFunctionData({
            abi: publicationResolverAbi,
            functionName: "upgradeToAndCall",
            args: [who(8), "0x"],
          }),
        ],
        [
          "grantRootRoles",
          encodeFunctionData({
            abi: publicationResolverAbi,
            functionName: "grantRootRoles",
            args: [16n, ORGANIZER],
          }),
        ],
      ];
      for (const from of [ORGANIZER, resultsAccount.address, contract])
        for (const [what, data] of attempts)
          await expect(
            base.call({ account: from, to: RESOLVER, data }),
            `${what} from ${from}`,
          ).rejects.toThrow();
      await expect(p.declareWinner(win("chainchat", ["winner"]))).rejects.toThrow(/locked/);
    });
  },
  900_000,
);
