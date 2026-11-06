// A2.4-R2: SepoliaEnsReader passes runEnsReaderConformance against a scenario replayed on a local
// anvil fork of live Sepolia (the organizer impersonated; nothing is sent to Sepolia). Skipped
// unless SEPOLIA_RPC_URL is set, like the Foundry fork suite; the URL is never printed.
//   SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com pnpm exec vitest run src/ens/sepolia-ens-reader.fork.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { afterAll, describe, expect, it } from "vitest";
import { eventConfig } from "../shared/event.config";
import {
  runEnsReaderConformance,
  type EnsConformanceScenario,
} from "../shared/testing/ens-reader-conformance";
import { dnsEncodeName } from "./dns-name";
import { lanyardRegistrarAbi } from "./ensv2-abi";
import { MemoryEnsCache } from "./ens-cache";
import { SepoliaEnsReader, type SepoliaEnsReaderOptions } from "./sepolia-ens-reader";
import { SepoliaIdentityDirectory } from "./sepolia-identity-directory";

const UPSTREAM = process.env.SEPOLIA_RPC_URL;
const PORT = 8547;
const LOCAL = `http://127.0.0.1:${PORT}`;
const deployment = JSON.parse(readFileSync(resolve(__dirname, "../../deployments/sepolia.json"), "utf8")) as {
  resetId: Hex;
  deployedAtBlock: string;
  contracts: Record<string, Address>;
};
const C = deployment.contracts;
const ORGANIZER = "0x36b7C556c584d65bd44Ae57656B64b68Bb88E2cF" as Address;
// Fresh addresses: anvil's well-known wallets carry EIP-7702 code on Sepolia and reject ERC-1155 mints.
const who = (n: number) =>
  `0x33333333333333333333333333333333333300${n.toString().padStart(2, "0")}` as Address;
const O1 = who(1);
const O2 = who(2);
const O3 = who(3);
const O4 = who(4);
const O5 = who(5);
const X = who(6);
const COORD = who(7);

const registryAbi = parseAbi([
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function unregister(uint256 anyId)",
  "function renew(uint256 anyId, uint64 newExpiry)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
]);
const resolverAbi = parseAbi([
  "function setAddress(bytes name, uint256 coinType, bytes value)",
  "function setText(bytes name, string key, string value)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
]);
const ROLE_SET_RESOLVER = 1n << 24n;
const id = (label: string) => BigInt(keccak256(toHex(label)));
const book = (b: string) => keccak256(toHex(b));
const full = (relative: string) =>
  dnsEncodeName(`${relative}.${eventConfig.edition}.${eventConfig.baseName}`);

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

async function startFork(): Promise<void> {
  anvil = spawn(anvilBinary(), ["--fork-url", UPSTREAM!, "--port", String(PORT), "--silent"], {
    stdio: "ignore",
  });
  const probe = createPublicClient({ transport: http(LOCAL) });
  for (let i = 0; i < 60; i++) {
    try {
      await probe.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("anvil fork did not start");
}

async function buildScenario(): Promise<{
  scenario: EnsConformanceScenario;
  options: SepoliaEnsReaderOptions;
}> {
  await startFork();
  const pc = createPublicClient({ chain: sepolia, transport: http(LOCAL), cacheTime: 0 }) as PublicClient;
  const test = createTestClient({ chain: sepolia, mode: "anvil", transport: http(LOCAL) });
  for (const a of [ORGANIZER, O4, COORD]) {
    await test.impersonateAccount({ address: a });
    await test.setBalance({ address: a, value: 10n ** 20n });
  }
  // anvil_mine ignores evm_setNextBlockTimestamp, so mine with an explicit timestamp.
  const mineAt = (timestamp: bigint) =>
    test.request({ method: "evm_mine", params: [toHex(timestamp)] } as never);
  const send = async (
    from: Address,
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
  ) => {
    const wc = createWalletClient({ account: from, chain: sepolia, transport: http(LOCAL) });
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const hash = await wc.sendTransaction({ to, data, account: from, chain: sepolia });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return receipt.blockNumber;
  };
  const registrar = C.lanyardRegistrar!;
  const reg = (fn: string, args: readonly unknown[]) =>
    send(ORGANIZER, registrar, lanyardRegistrarAbi, fn, args);
  const bookRegistry = (b: string) =>
    pc.readContract({
      address: registrar,
      abi: lanyardRegistrarAbi,
      functionName: "bookRegistry",
      args: [book(b)],
    });
  const hackers = await bookRegistry("hackers");
  const now = (await pc.getBlock()).timestamp;
  const namespaceExpiry = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "namespaceExpiry",
  });
  const eventEnd = await pc.readContract({
    address: registrar,
    abi: lanyardRegistrarAbi,
    functionName: "eventEnd",
  });

  // Owner vs address: the organizer repoints vol1's forward address away from its owner.
  await reg("registerBadge", [book("volunteers"), "vol1", O1]);
  const ownerBlock = await send(ORGANIZER, C.staffResolver!, resolverAbi, "setAddress", [
    full("vol1.volunteers"),
    60n,
    X,
  ]);

  // Text: the coordinator sets and clears a note.
  const permsSetter = encodeFunctionData({
    abi: resolverAbi,
    functionName: "setText",
    args: ["0x", "lanyard.perms", ""],
  });
  await send(ORGANIZER, C.staffResolver!, resolverAbi, "grantSetterRoles", [permsSetter, COORD]);
  const setBlock = await send(COORD, C.staffResolver!, resolverAbi, "setText", [
    full("vol1.volunteers"),
    "lanyard.perms",
    "hello",
  ]);
  const removedBlock = await send(COORD, C.staffResolver!, resolverAbi, "setText", [
    full("vol1.volunteers"),
    "lanyard.perms",
    "",
  ]);

  // Unregister.
  await reg("registerBadge", [book("hackers"), "hk1", O2]);
  const unregisterBlock = await send(ORGANIZER, hackers, registryAbi, "unregister", [id("hk1")]);

  // Reissue to another wallet.
  const reissueBefore = await reg("registerBadge", [book("hackers"), "hk2", O2]);
  await send(ORGANIZER, hackers, registryAbi, "unregister", [id("hk2")]);
  const reissueAfter = await reg("registerBadge", [book("hackers"), "hk2", O3]);

  // Role change, then renewal, on a raw organizer badge with a short expiry and one resolver role.
  const roleBefore = await send(ORGANIZER, hackers, registryAbi, "register", [
    "hk3",
    O4,
    "0x0000000000000000000000000000000000000000",
    C.hackersResolver!,
    ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n),
    now + 86_400n,
  ]);
  const roleAfter = await send(O4, hackers, registryAbi, "revokeRoles", [id("hk3"), ROLE_SET_RESOLVER, O4]);
  const renewAfter = await send(ORGANIZER, hackers, registryAbi, "renew", [id("hk3"), now + 2n * 86_400n]);

  // A raw badge that outlives its ancestors, and one that expires exactly at event end.
  await send(ORGANIZER, hackers, registryAbi, "register", [
    "hk4",
    O5,
    "0x0000000000000000000000000000000000000000",
    C.hackersResolver!,
    0n,
    namespaceExpiry + 86_400n,
  ]);
  await reg("registerBadge", [book("volunteers"), "vol2", O5]);
  await mineAt(eventEnd);
  const exactBlock = await pc.getBlockNumber();
  await mineAt(namespaceExpiry + 10n);
  const ancestorBlock = await pc.getBlockNumber();
  const ancestorTs = (await pc.getBlock({ blockNumber: ancestorBlock })).timestamp;

  // Two blocks 12 s apart.
  await mineAt(ancestorTs + 12n);
  const tsBlock = await pc.getBlockNumber();
  await mineAt(ancestorTs + 24n);

  const options: SepoliaEnsReaderOptions = {
    client: pc,
    chainId: sepolia.id,
    resetId: deployment.resetId,
    names: eventConfig,
    registrar,
    ethRegistry: C.ensEthRegistry!,
    baseRegistry: C.baseRegistry!,
    edition: C.editionRegistry!,
    universalResolver: C.ensUniversalResolverV2!,
    deployedAtBlock: BigInt(deployment.deployedAtBlock),
  };
  return {
    options,
    scenario: {
      ownerVsAddress: { label: "vol1.volunteers", block: ownerBlock, owner: O1, address: X },
      unregister: { label: "hk1.hackers", block: unregisterBlock },
      ancestorExpiry: { label: "hk4.hackers", block: ancestorBlock, blockTimestamp: ancestorTs },
      exactExpiry: { label: "vol2.volunteers", expiry: eventEnd, block: exactBlock },
      text: { label: "vol1.volunteers", key: "lanyard.perms", value: "hello", setBlock, removedBlock },
      reissue: { label: "hk2.hackers", before: reissueBefore, after: reissueAfter },
      renewal: { label: "hk3.hackers", before: roleAfter, after: renewAfter },
      roleChange: { label: "hk3.hackers", before: roleBefore, after: roleAfter },
      timestamp: { block: tsBlock, timestamp: ancestorTs + 12n, secondsToNext: 12n },
    },
  };
}

const failingClient = createPublicClient({
  chain: sepolia,
  transport: custom({
    request: async () => {
      throw new Error("rpc down");
    },
  }),
}) as PublicClient;

const built = UPSTREAM ? buildScenario() : null;

describe.skipIf(!UPSTREAM)(
  "SepoliaEnsReader on a Sepolia fork",
  () => {
    runEnsReaderConformance("SepoliaEnsReader (Sepolia fork)", async () => {
      const { options, scenario } = await built!;
      return {
        reader: new SepoliaEnsReader({ ...options, cache: new MemoryEnsCache() }),
        failing: new SepoliaEnsReader({ ...options, client: failingClient }),
        scenario,
      };
    });

    it("discovers roles from registrations, verified by owner, never by address records", async () => {
      const { options, scenario: s } = await built!;
      const reader = new SepoliaEnsReader(options);
      const dir = new SepoliaIdentityDirectory({
        client: options.client,
        reader,
        registrar: options.registrar,
        baseRegistry: options.baseRegistry,
        edition: options.edition,
        editionLabel: eventConfig.edition,
        deployedAtBlock: options.deployedAtBlock,
      });
      const at = (sepoliaBlock: bigint) => ({ sepoliaBlock });
      expect(await dir.labelsFor(O2, at(s.reissue.before))).toEqual([
        { label: "hk2.hackers", role: "hacker" },
      ]);
      expect(await dir.labelsFor(O2, at(s.reissue.after))).toEqual([]);
      expect(await dir.labelsFor(O3, at(s.reissue.after))).toEqual([
        { label: "hk2.hackers", role: "hacker" },
      ]);
      expect(await dir.labelsFor(O1, at(s.ownerVsAddress.block))).toEqual([
        { label: "vol1.volunteers", role: "volunteer" },
      ]);
      expect(await dir.labelsFor(X, at(s.ownerVsAddress.block))).toEqual([]);
      const broken = new SepoliaIdentityDirectory({
        client: failingClient,
        reader,
        registrar: options.registrar,
        baseRegistry: options.baseRegistry,
        edition: options.edition,
        editionLabel: eventConfig.edition,
        deployedAtBlock: options.deployedAtBlock,
      });
      await expect(broken.labelsFor(O1, at(s.ownerVsAddress.block))).rejects.toThrow(/EnsReader/);
    });
  },
  600_000,
);
