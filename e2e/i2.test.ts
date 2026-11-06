// I2 joins the deployed A2 contracts/reader to B2 preparation, rules and bundle reproduction.
// Transactions run only on a local fork. Arkiv observations come through FakeArkiv + capture;
// this is repeatable integration coverage, not a claim of a live Rabdi or Android device run.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import deployment from "../deployments/sepolia.json";
import { createProviders } from "../src/providers";
import { createCliProviders } from "../cli/providers";
import { FakeArkiv } from "../src/arkiv/fake";
import { buildCreate } from "../src/arkiv/writers";
import { captureForEvent, memoryObservationStore } from "../src/arkiv/capture";
import { dnsEncodeName } from "../src/ens/dns-name";
import { lanyardRegistrarAbi } from "../src/ens/ensv2-abi";
import { canonicalHash, canonicalJson } from "../src/shared/canonical";
import { freezeConfig } from "../src/shared/config/hash";
import { eventConfig } from "../src/shared/event.config";
import { encodePermissionEnvelope, grantsPermission } from "../src/shared/ens/permission-envelope";
import type { EnsReader } from "../src/shared/interfaces/ens-reader";
import type { EvaluationContext } from "../src/shared/interfaces/evaluation-context";
import { assembleBody, evaluate, outputHashOf, prepare, RULES_VERSION, EnsSnapshot } from "../src/rules";

const enabled = process.env.LANYARD_I2 === "1";
let fork: ChildProcess | undefined;
afterAll(async () => {
  if (fork?.pid && fork.exitCode === null && fork.signalCode === null) {
    fork.kill();
    await once(fork, "exit");
  }
});
const rpc = (url: string) => createPublicClient({ chain: sepolia, transport: http(url), cacheTime: 0 });
const registryAbi = parseAbi([
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function unregister(uint256 anyId)",
  "function renew(uint256 anyId, uint64 expiry)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
]);
const resolverAbi = parseAbi([
  "function setAddress(bytes name, uint256 coinType, bytes value)",
  "function setText(bytes name, string key, string value)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
]);
const h = (s: string) => keccak256(toHex(s));
const id = (s: string) => BigInt(h(s));
const who = (n: number) =>
  `0x44444444444444444444444444444444444400${n.toString().padStart(2, "0")}` as Address;
const PRIYA = who(1),
  RAVI = who(2),
  NEXT = who(3),
  HACKER = who(4),
  FORWARD = who(5),
  COORD = who(6);
const full = (label: string) => dnsEncodeName(`${label}.${eventConfig.edition}.${eventConfig.baseName}`);

async function startFork(): Promise<string> {
  const portServer = createServer();
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => portServer.close((err) => (err ? reject(err) : resolve())));
  const upstream = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const upstreamClient = rpc(upstream);
  const pinned = await upstreamClient.getBlock({ blockTag: "finalized" });
  expect(await upstreamClient.getChainId()).toBe(sepolia.id);
  expect((await upstreamClient.getBlock({ blockNumber: 0n })).hash).toBe(deployment.resetId);
  fork = spawn(
    process.env.ANVIL_BINARY ?? "anvil",
    [
      "--fork-url",
      upstream,
      "--fork-block-number",
      String(pinned.number),
      "--port",
      String(port),
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let startError: Error | undefined;
  fork.on("error", (err) => {
    startError = err;
  });
  const url = `http://127.0.0.1:${port}`;
  const probe = createPublicClient({ transport: http(url, { retryCount: 0, timeout: 1000 }) });
  for (let i = 0; i < 100; i++) {
    if (startError) throw startError;
    if (fork.exitCode !== null) throw new Error("I2 anvil exited before its RPC was ready");
    try {
      await probe.getChainId();
      return url;
    } catch {
      /* wait for the fork */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("I2 local Sepolia fork did not start");
}

it.skipIf(!enabled)(
  "A2 history → B2 preparation → identical app/CLI bundles and browser hash",
  async () => {
    const url = await startFork();
    const pc = rpc(url) as PublicClient;
    const test = createTestClient({ chain: sepolia, mode: "anvil", transport: http(url) });
    const c = deployment.contracts;
    const registrar = c.lanyardRegistrar as Address;
    const organizer = (
      await pc.readContract({ address: registrar, abi: lanyardRegistrarAbi, functionName: "organizer" })
    ).toLowerCase() as Address;
    for (const account of [organizer, PRIYA, COORD]) {
      await test.impersonateAccount({ address: account });
      await test.setBalance({ address: account, value: 10n ** 20n });
    }
    const history: { action: string; block: bigint; txHash: string }[] = [];
    const send = async (
      address: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
      from = organizer,
    ) => {
      // All callers send to this locally created fork, never the upstream RPC.
      const wallet = createWalletClient({ account: from, chain: sepolia, transport: http(url) });
      const txHash = await wallet.sendTransaction({
        to: address,
        data: encodeFunctionData({ abi, functionName, args } as never),
      });
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      expect(receipt.status, functionName).toBe("success");
      history.push({ action: functionName, block: receipt.blockNumber, txHash });
      return receipt.blockNumber;
    };
    const reg = (fn: string, args: readonly unknown[]) => send(registrar, lanyardRegistrarAbi, fn, args);
    const book = (label: string) =>
      pc.readContract({
        address: registrar,
        abi: lanyardRegistrarAbi,
        functionName: "bookRegistry",
        args: [h(label)],
      });
    const volunteers = await book("volunteers");
    const app = createProviders({ ens: "sepolia", router: "stub", arkiv: "fake" }, { sepoliaRpcUrl: url });
    const cli = createCliProviders({ env: { LANYARD_ENS: "sepolia", SEPOLIA_RPC_URL: url } });
    const reader = cli.ensReader();
    const at = (sepoliaBlock: bigint) => ({ sepoliaBlock });
    const label = "i2-priya.volunteers";
    await reg("registerBadge", [h("volunteers"), "i2-priya", PRIYA]);
    const ownerBlock = await send(c.staffResolver as Address, resolverAbi, "setAddress", [
      full(label),
      60n,
      FORWARD,
    ]);
    expect(await reader.owner(label, at(ownerBlock))).toBe(PRIYA);
    expect(await reader.address(label, at(ownerBlock))).toBe(FORWARD);
    const originalId = await reader.registrationId(label, at(ownerBlock));
    expect(originalId).not.toBeNull();
    const note = (registrationId: NonNullable<typeof originalId>, permissions = ["shift-manager"]) =>
      encodePermissionEnvelope({ schemaVersion: 1, registrationId, holder: PRIYA, permissions });
    const text = (value: string) =>
      send(c.staffResolver as Address, resolverAbi, "setText", [full(label), "lanyard.perms", value], COORD);
    await send(c.staffResolver as Address, resolverAbi, "grantSetterRoles", [
      encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: ["0x", "lanyard.perms", ""] }),
      COORD,
    ]);
    const grant = await text(note(originalId!));
    const remove = await text(note(originalId!, []));
    const grantAgain = await text(note(originalId!));
    const raviBefore = await reg("registerBadge", [h("volunteers"), "i2-ravi", RAVI]);
    const revoked = await send(volunteers, registryAbi, "unregister", [id("i2-ravi")]);
    const reissued = await reg("registerBadge", [h("volunteers"), "i2-ravi", NEXT]);
    expect(await reader.owner("i2-ravi.volunteers", at(raviBefore))).toBe(RAVI);
    expect(await reader.owner("i2-ravi.volunteers", at(revoked))).toBeNull();
    expect(await reader.owner("i2-ravi.volunteers", at(reissued))).toBe(NEXT);
    expect(await reader.unregisteredBetween("i2-ravi.volunteers", revoked, revoked)).toBe(true);
    expect(await reader.unregisteredBetween("i2-ravi.volunteers", raviBefore, revoked - 1n)).toBe(false);
    expect(await reader.unregisteredBetween("i2-ravi.volunteers", revoked + 1n, reissued)).toBe(false);

    const now = (await pc.getBlock()).timestamp;
    const shortExpiry = now + 120n;
    const role = 1n << 24n;
    const shortBefore = await send(volunteers, registryAbi, "register", [
      "i2-short",
      PRIYA,
      zeroAddress,
      c.staffResolver,
      role | (role << 128n),
      shortExpiry,
    ]);
    const shortId = await reader.registrationId("i2-short.volunteers", at(shortBefore));
    const roleAfter = await send(
      volunteers,
      registryAbi,
      "revokeRoles",
      [id("i2-short"), role, PRIYA],
      PRIYA,
    );
    expect(await reader.registrationId("i2-short.volunteers", at(roleAfter))).toBe(shortId);
    await test.request({ method: "evm_mine", params: [toHex(shortExpiry)] } as never);
    const expired = await pc.getBlockNumber();
    expect(await reader.owner("i2-short.volunteers", at(expired))).toBeNull();
    expect(await reader.expiry("i2-short.volunteers", at(expired))).toBe(shortExpiry);
    const revived = await send(volunteers, registryAbi, "renew", [id("i2-short"), shortExpiry + 3600n]);
    expect(await reader.owner("i2-short.volunteers", at(revived))).toBe(PRIYA);
    expect(await reader.registrationId("i2-short.volunteers", at(revived))).toBe(shortId);
    expect(await reader.unregisteredBetween("i2-short.volunteers", shortBefore, revived)).toBe(false);
    const renewal = await send(volunteers, registryAbi, "renew", [
      id("i2-priya"),
      eventConfig.times.eventEnd + 60n,
    ]);
    expect(await reader.registrationId(label, at(renewal))).toBe(originalId);
    await send(volunteers, registryAbi, "unregister", [id("i2-priya")]);
    const reissueLead = await reg("registerBadge", [h("volunteers"), "i2-priya", PRIYA]);
    const newId = await reader.registrationId(label, at(reissueLead));
    expect(newId).not.toBe(originalId);
    expect(await reader.text(label, "lanyard.perms", at(reissueLead))).toBe(note(originalId!));
    const freshGrant = await text(note(newId!));
    const hackerBlock = await reg("registerBadge", [h("hackers"), "i2-hacker", HACKER]);
    const directory = await app.identityDirectory().labelsFor(HACKER, at(hackerBlock));
    expect(directory).toContainEqual({ label: "i2-hacker.hackers", role: "hacker" });
    expect(await app.identityDirectory().labelsFor(FORWARD, at(ownerBlock))).toEqual([]);

    // Both composition roots select the independently configured live ENS authorities.
    // The explicit context below is for development, outside the event freeze window.
    expect(cli.config.authorities.organizer).toBe(organizer);
    expect(cli.config.authorities.headJudge).toBe(
      (
        await pc.readContract({ address: registrar, abi: lanyardRegistrarAbi, functionName: "headJudge" })
      ).toLowerCase(),
    );
    expect(canonicalJson(app.config)).toBe(canonicalJson(cli.config));
    const frozen = freezeConfig(cli.config);
    const config = frozen;
    const sourceTime = (await pc.getBlock({ blockNumber: hackerBlock })).timestamp + 1n;
    const fake = new FakeArkiv(sourceTime - 2002n, 1000n, frozen.chains.rabdi.resetId);
    for (const account of [organizer, PRIYA]) fake.fund(account, 10n ** 20n);
    const payload = {
      hacker_label: "i2-hacker.hackers",
      hacker_address: HACKER,
      seat: "w1",
      venue: `0x${"01".repeat(32)}`,
    };
    for (const [creator, by] of [
      [organizer, "organizer"],
      [PRIYA, label],
    ] as const) {
      await fake.writer(creator).write({
        creates: [
          buildCreate(
            "seat_assignment",
            {
              byLabel: by,
              edition: config.edition,
              times: eventConfig.times,
              head: await fake.head(),
            },
            {
              hackerLabel: payload.hacker_label,
              hackerAddress: HACKER,
              seat: payload.seat,
              venue: payload.venue as `0x${string}`,
            },
          ),
        ],
      });
    }
    const store = memoryObservationStore();
    const report = await captureForEvent({
      reader: fake,
      store,
      edition: config.edition,
      network: { chainId: config.chains.rabdi.chainId, resetId: config.chains.rabdi.resetId },
    });
    expect(report.complete).toBe(true);
    const { observations: records } = await store.load();
    expect(records).toHaveLength(2);
    const arkivCutoff = await fake.head();
    await test.request({ method: "evm_mine", params: [toHex(arkivCutoff.timestamp + 12n)] } as never);
    const sepoliaCutoff = await cli
      .sepoliaBlocks()
      .blockRef(await reader.sepoliaBlockAt(arkivCutoff.timestamp));
    const context: EvaluationContext = {
      event: config.edition,
      arkivChainId: config.chains.rabdi.chainId,
      arkivResetId: config.chains.rabdi.resetId,
      sepoliaChainId: sepolia.id,
      arkivCutoff,
      sepoliaCutoff,
      configHash: canonicalHash(config),
    };
    const nodePrepared = await prepare(records, reader, context, config);
    const appPrepared = await prepare(records, app.ensReader(), context, config);
    expect(canonicalJson(appPrepared.ens)).toBe(canonicalJson(nodePrepared.ens));
    const output = evaluate(records, nodePrepared.ens, context, config, RULES_VERSION);
    const validKey = records.find((r) => r.creator === organizer)!.key;
    expect(output.verdicts.find((v) => v.key === validKey)?.counts).toBe(true);
    const forged = output.verdicts.find((v) => v.key !== validKey)!;
    expect(forged.counts).toBe(false);
    expect("reason" in forged && forged.reason).toMatch(/organizer wallet/);

    // Additional historical display/note snapshots, deliberately independent of B3 shift kinds.
    const snapshots = async (r: EnsReader) =>
      Promise.all(
        [grant, remove, grantAgain, renewal, reissueLead, freshGrant].map(async (block) => {
          const [owner, address, expiry, registrationId, text] = await Promise.all([
            r.owner(label, at(block)),
            r.address(label, at(block)),
            r.expiry(label, at(block)),
            r.registrationId(label, at(block)),
            r.text(label, "lanyard.perms", at(block)),
          ]);
          return {
            block,
            owner,
            address,
            expiry,
            registrationId,
            text,
            grants: grantsPermission(text, { owner, registrationId }, "shift-manager"),
          };
        }),
      );
    const historical = await snapshots(reader);
    expect(historical.map((s) => s.grants)).toEqual([true, false, true, true, false, true]);
    expect(canonicalJson(await snapshots(app.ensReader()))).toBe(canonicalJson(historical));
    const snapshot = EnsSnapshot.from(nodePrepared.ens);
    expect(snapshot.owner("i2-hacker.hackers", hackerBlock)).toBe(HACKER);
    const bodyFor = (ens: typeof nodePrepared.ens) =>
      assembleBody(
        {
          context,
          config,
          ruleVersion: RULES_VERSION,
          records,
          ens,
          diagnostics: {
            intervals: [{ fromBlock: 1000n, toBlock: arkivCutoff.number }],
            gaps: [],
            knownKeys: 2,
          },
          decryption: { keyId: "i2-no-scores", suite: "none", privateKey: `0x${"00".repeat(32)}` },
          prizes: [],
          output,
          bundleUri: "https://bundles.lanyard.example/mumbai2026/i2.json",
        },
        { allowOutOfWindow: true },
      );
    const body = bodyFor(nodePrepared.ens);
    expect(canonicalJson(bodyFor(appPrepared.ens))).toBe(canonicalJson(body));
    await mkdir(".lanyard/i2", { recursive: true });
    const bundlePath = ".lanyard/i2/bundle.json";
    await writeFile(bundlePath, canonicalJson(body) + "\n");
    await writeFile(
      ".lanyard/i2/sepolia-history-fork.json",
      canonicalJson({ mode: "fork", deployment, operations: history, historical }) + "\n",
    );
    const exec = promisify(execFile);
    const expectedHash = outputHashOf(output);
    const { stdout } = await exec("pnpm", [
      "exec",
      "tsx",
      "cli/index.ts",
      "hash",
      config.edition,
      "--bundle",
      bundlePath,
    ]);
    expect(stdout.trim()).toBe(expectedHash);
    const built = await build({
      stdin: {
        contents: `import {parseBundleText,reproduce,ENGINE} from './src/rules'; const body=parseBundleText(${JSON.stringify(canonicalJson(body))},{allowOutOfWindow:true}).body; const result=reproduce(ENGINE,body); document.body.textContent='I2:'+JSON.stringify(result)+':END';`,
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      write: false,
    });
    const htmlPath = `${process.cwd()}/.lanyard/i2/reproduce.html`;
    await writeFile(
      htmlPath,
      `<html><body><script>${built.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
    );
    const { stdout: dom } = await exec(
      process.env.BROWSER ?? "chromium",
      ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", `file://${htmlPath}`],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const match = /I2:(\{.*?\}):END/s.exec(dom);
    expect(match, "browser reproduction report").not.toBeNull();
    const browser = JSON.parse(match![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(browser.match).toBe(true);
    expect(browser.outputHash).toBe(expectedHash);
    console.log(
      `I2 PASS: historical owner/address/notes, revoke/reissue/revive, 2 captured rows, app/CLI bundle equality, Node/browser hash ${expectedHash}`,
    );
  },
  600_000,
);
