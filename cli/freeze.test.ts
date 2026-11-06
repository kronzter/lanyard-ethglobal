import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { signBody } from "../src/rules";
import { describe, expect, it } from "vitest";
import { bytesToHex } from "viem";
import { canonicalBytes, canonicalHash, canonicalJson } from "../src/shared/canonical";
import { eventConfig } from "../src/shared/event.config";
import { configHash, freezeConfig } from "../src/shared/config/hash";
import { measured, requireMeasured } from "../src/shared/config/unmeasured";
import { scorePublicKey, scoreKeyId } from "../src/shared/crypto/score-cipher";
import { createFixtureEnsReader, fixtureTimeline } from "../src/shared/mocks/fixtures";
import { MockResultsPublisher } from "../src/shared/mocks/mock-results-publisher";
import { MemoryPublisherStore } from "../src/shared/mocks/publisher-store";
import { FakeArkiv } from "../src/arkiv/fake";
import { seedJudging } from "../src/arkiv/judging-seed";
import { captureForEvent, memoryObservationStore } from "../src/arkiv/capture";
import { buildCreate } from "../src/arkiv/writers";
import type { Hex } from "../src/shared/types/primitives";
import type { ResultsBody } from "../src/shared/evidence/bundle";
import type { PreparedPublication } from "../src/shared/interfaces/results-publisher";
import { fixtureResultsAccount } from "../scripts/rules-vector";
import { mockSepoliaBlocks } from "./sepolia-blocks";
import {
  parseJob,
  serializeJob,
  startFreeze,
  resumeFreeze,
  type FreezeDeps,
  type SummaryTransport,
} from "./freeze-core";
import { verify } from "./verify";
const secret = `0x${"b2".repeat(32)}` as Hex;
async function fixture() {
  const publicKey = scorePublicKey(secret);
  const cipher = {
    ...requireMeasured(eventConfig.scoreCipher, "cipher"),
    publicKey,
    keyId: scoreKeyId(publicKey),
  };
  const config = { ...eventConfig, scoreCipher: measured(cipher, "Public test key only") };
  const frozen = freezeConfig(config);
  const timeline = fixtureTimeline();
  const ens = createFixtureEnsReader();
  const blocks = mockSepoliaBlocks(timeline);
  const fake = new FakeArkiv(config.times.eventStart + 7200n - 2000n, 1000n, frozen.chains.rabdi.resetId);
  await seedJudging(fake, config, { finals: true, recusal: true });
  fake.advance((config.times.results - (await fake.head()).timestamp) / 2n);
  const cutoff = await fake.head();
  const sepoliaCutoff = await blocks.blockRef(await ens.sepoliaBlockAt(cutoff.timestamp));
  const context = {
    event: config.edition,
    arkivChainId: frozen.chains.rabdi.chainId,
    arkivResetId: frozen.chains.rabdi.resetId,
    sepoliaChainId: frozen.chains.sepolia.chainId,
    arkivCutoff: cutoff,
    sepoliaCutoff,
    configHash: configHash(config),
  };
  const retained = memoryObservationStore();
  await captureForEvent({
    reader: fake,
    edition: config.edition,
    network: { chainId: context.arkivChainId, resetId: context.arkivResetId },
    store: retained,
  });
  const { observations } = await retained.load();
  const store = new MemoryPublisherStore();
  const publisher = new MockResultsPublisher({ store });
  let journal: string | null = null;
  let copies: string[] = [];
  let captureCalls = 0;
  let keyCalls = 0;
  let summaryWrites = 0;
  let unknown = false;
  const summaries = new Map<
    Hex,
    {
      body: ResultsBody;
      prepared: PreparedPublication;
      receipt?: { txHash: Hex; blockNumber: bigint; blockHash: Hex; resultsKey: Hex };
    }
  >();
  const summary: SummaryTransport = {
    async prepare(body) {
      const nonce = BigInt(summaries.size);
      const rawTransaction = bytesToHex(canonicalBytes({ body, nonce }));
      const txHash = canonicalHash({ body, nonce });
      const prepared = { rawTransaction, txHash, nonce };
      summaries.set(txHash, { body, prepared });
      return prepared;
    },
    async broadcast(tx) {
      const value = summaries.get(tx.txHash)!;
      if (value.receipt) throw new Error("duplicate summary broadcast");
      summaryWrites++;
      const result = await fake.writer(config.authorities.results).write({
        creates: [
          buildCreate(
            "results",
            { edition: config.edition, byLabel: "results", times: config.times },
            { summary: value.body },
          ),
        ],
      });
      const head = await fake.head();
      value.receipt = {
        txHash: tx.txHash,
        blockNumber: head.number,
        blockHash: head.hash,
        resultsKey: result.created[0]!,
      };
      return value.receipt;
    },
    async reconcile(tx) {
      if (unknown) return "unknown";
      const value = summaries.get(tx.txHash);
      return value?.receipt ?? (value ? "prepared" : "unknown");
    },
    async read(key) {
      const value = [...summaries.values()].find((v) => v.receipt?.resultsKey === key);
      return value && (await fake.get(key)) ? value.body : null;
    },
  };
  const account = fixtureResultsAccount();
  const deps: FreezeDeps = {
    config,
    ens,
    publisher,
    summary,
    signer: {
      address: config.authorities.results,
      signMessage: (message) => account.signMessage({ message }),
    },
    material() {
      keyCalls++;
      return { suite: cipher.suite, keyId: cipher.keyId, privateKey: secret };
    },
    async capture() {
      captureCalls++;
      return {
        records: observations,
        inventory: observations.map((r) => r.key),
        context,
        diagnostics: {
          intervals: [{ fromBlock: 1000n, toBlock: cutoff.number }],
          gaps: [],
          knownKeys: observations.length,
        },
      };
    },
    async checkContext(saved) {
      expect(saved).toEqual(context);
    },
    async load() {
      return journal ? parseJob(journal) : null;
    },
    async save(job) {
      journal = serializeJob(job);
    },
    async retain(envelope) {
      const text = canonicalJson(envelope);
      if (!copies.length) copies = [text, text];
    },
    async checkCopies(envelope) {
      if (copies.length !== 2 || copies.some((c) => c !== canonicalJson(envelope)))
        throw new Error("corrupt retained copy");
    },
    async fetchText() {
      return copies[0]!;
    },
  };
  return {
    deps,
    fake,
    context,
    observations,
    store,
    summary,
    get job() {
      return journal ? parseJob(journal) : null;
    },
    get counts() {
      return { captureCalls, keyCalls, summaryWrites };
    },
    setUnknown() {
      unknown = true;
    },
    corruptCopy() {
      copies[1] = "broken";
    },
  };
}
const input = {
  prizes: [{ team: "zkpay", prizes: ["Main prize"] }],
  bundleUri: "https://example.org/mumbai2026/bundle.json",
};
describe("resumable freeze", () => {
  it("rejects prepared bytes copied or corrupted outside their signed operation binding", async () => {
    const f = await fixture();
    f.deps.hook = async (point) => {
      if (point === "afterPrepared") throw new Error("crash");
    };
    await expect(startFreeze(f.deps, input)).rejects.toThrow("crash");
    const job = f.job!;
    job.steps[0]!.prepared!.rawTransaction = "0x00";
    await f.deps.save(job);
    delete f.deps.hook;
    await expect(resumeFreeze(f.deps)).rejects.toThrow(/not signed for this exact/);
    expect(f.counts.summaryWrites).toBe(0);
  });

  it("rejects an otherwise locked event missing its promised winner declarations", async () => {
    const f = await fixture();
    const job = await startFreeze(f.deps, input);
    const event = (await f.deps.publisher.state()).eventResults!;
    const alternate = new MockResultsPublisher({ store: new MemoryPublisherStore() });
    await alternate.setEventResults(event);
    await alternate.lockResults(await alternate.state());
    const result = await verify(
      f.deps.config.edition,
      { bundleText: canonicalJson(job.envelope) },
      {
        config: f.deps.config,
        ensReader: () => createFixtureEnsReader(),
        publisher: () => alternate,
        sepoliaBlocks: () => mockSepoliaBlocks(fixtureTimeline()),
      },
    );
    expect(result.verdict).toBe("MISMATCH");
  });

  it.each(["submission", "rubric", "judge_assignment", "acceptance"])(
    "refuses lost retained %s bytes before key disclosure",
    async (kind) => {
      const f = await fixture();
      const original = await f.deps.capture();
      const removed = original.records.find((r) => r.kind === kind)!;
      f.deps.capture = async () => ({
        ...original,
        records: original.records.filter((r) => r.key !== removed.key),
        diagnostics: { ...original.diagnostics, knownKeys: original.diagnostics.knownKeys - 1 },
      });
      await expect(startFreeze(f.deps, input)).rejects.toThrow(/inventory|Missing retained/);
      expect(f.counts.keyCalls).toBe(0);
      expect(f.counts.summaryWrites).toBe(0);
    },
  );

  it("reproduces the persisted bundle in a fresh verifier process", async () => {
    const f = await fixture();
    const job = await startFreeze(f.deps, input);
    const directory = await mkdtemp(path.join(tmpdir(), "lanyard-b4-verify-"));
    try {
      const trusted = path.join(directory, "trusted-config.json");
      const bundle = path.join(directory, "bundle.json");
      const published = path.join(directory, "publisher.json");
      await writeFile(trusted, canonicalJson(f.deps.config));
      await writeFile(bundle, canonicalJson(job.envelope));
      await writeFile(published, canonicalJson(await f.store.load()));
      const result = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "cli/fixtures/verify-child.ts", trusted, bundle, published],
        {
          cwd: path.resolve(import.meta.dirname, ".."),
          env: { PATH: process.env.PATH, NODE_ENV: "test" },
          timeout: 30000,
        },
      );
      expect(result.stdout.trim()).toBe("MATCH");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects signed bundles with known gaps and claimed plaintext tampering", async () => {
    const f = await fixture();
    const job = await startFreeze(f.deps, input);
    for (const mutate of [
      (body: typeof job.envelope.body) => {
        body.diagnostics.gaps.push({ fromBlock: 1n, toBlock: 2n, reason: "missed interval" });
      },
      (body: typeof job.envelope.body) => {
        (body.output as { scores: { values?: Record<string, number> }[] }).scores.find(
          (s) => s.values,
        )!.values = { impact: 0, execution: 0 };
      },
      (body: typeof job.envelope.body) => {
        body.context.arkivCutoff.timestamp = f.deps.config.times.freezeDeadline;
      },
    ]) {
      const body = structuredClone(job.envelope.body);
      mutate(body);
      const tampered = await signBody(body, (message) => fixtureResultsAccount().signMessage({ message }));
      const result = await verify(
        f.deps.config.edition,
        { bundleText: canonicalJson(tampered) },
        {
          config: f.deps.config,
          ensReader: () => createFixtureEnsReader(),
          publisher: () => f.deps.publisher,
          sepoliaBlocks: () => mockSepoliaBlocks(fixtureTimeline()),
        },
      );
      expect(result.verdict).not.toBe("MATCH");
    }
  });

  it("freezes three tracks with revocation/recusal and independently verifies MATCH after source expiry", async () => {
    const f = await fixture();
    const job = await startFreeze(f.deps, input);
    expect(job.phase).toBe("complete");
    expect((await f.deps.publisher.state()).locked).toBe(true);
    expect(f.counts.summaryWrites).toBe(1);
    const output = job.envelope.body.output as {
      scores: unknown[];
      rankings: { track: string; projects: { judgeCount: number }[] }[];
    };
    expect(output.rankings.map((t) => [t.track, t.projects[0]?.judgeCount]).sort()).toEqual([
      ["arkiv", 2],
      ["ens", 2],
      ["main", 3],
    ]);
    f.fake.advance(9_000_000n);
    const outcome = await verify(
      f.deps.config.edition,
      { bundleText: canonicalJson(job.envelope) },
      {
        config: f.deps.config,
        ensReader: () => createFixtureEnsReader(),
        publisher: () => f.deps.publisher,
        sepoliaBlocks: () => mockSepoliaBlocks(fixtureTimeline()),
      },
    );
    expect(outcome.verdict).toBe("MATCH");
    await expect(startFreeze(f.deps, input)).rejects.toThrow(/already/);
  });
  it.each(["afterPrepared", "afterBroadcast", "afterReceipt", "afterVerified"] as const)(
    "resumes a crash %s without duplicate summary/publication",
    async (point) => {
      const f = await fixture();
      let crashed = false;
      f.deps.hook = async (p) => {
        if (p === point && !crashed) {
          crashed = true;
          throw new Error("crash");
        }
      };
      await expect(startFreeze(f.deps, input)).rejects.toThrow("crash");
      delete f.deps.hook;
      const before = f.counts;
      const restarted = { ...f.deps, publisher: new MockResultsPublisher({ store: f.store }) };
      expect((await resumeFreeze(restarted)).phase).toBe("complete");
      expect(f.counts.captureCalls).toBe(before.captureCalls);
      expect(f.counts.keyCalls).toBe(before.keyCalls);
      expect(f.counts.summaryWrites).toBe(1);
    },
  );
  it("adopts a successful-but-unlogged winner after a fresh publisher instance", async () => {
    const f = await fixture();
    let crashed = false;
    f.deps.hook = async (point, step) => {
      if (point === "afterBroadcast" && step.id === "winner:zkpay" && !crashed) {
        crashed = true;
        throw new Error("crash");
      }
    };
    await expect(startFreeze(f.deps, input)).rejects.toThrow("crash");
    delete f.deps.hook;
    await resumeFreeze({ ...f.deps, publisher: new MockResultsPublisher({ store: f.store }) });
    expect((await f.store.load())?.txs).toHaveLength(3);
  });
  it.each([-1n, 0n])("refuses an invalid cutoff before key retrieval (%s)", async (offset) => {
    const f = await fixture();
    const bad = offset === -1n ? f.deps.config.times.results - 1n : f.deps.config.times.freezeDeadline;
    f.deps.capture = async () => ({
      records: f.observations,
      inventory: f.observations.map((r) => r.key),
      context: { ...f.context, arkivCutoff: { ...f.context.arkivCutoff, timestamp: bad } },
      diagnostics: { intervals: [], gaps: [], knownKeys: 0 },
    });
    await expect(startFreeze(f.deps, input)).rejects.toThrow(/outside/);
    expect(f.counts.keyCalls).toBe(0);
    expect(f.job).toBeNull();
    expect(f.counts.summaryWrites).toBe(0);
  });
  it("blocks missing evidence, bad prizes, unavailable host and corrupt local copies before publication", async () => {
    const f = await fixture();
    await expect(
      startFreeze(f.deps, { ...input, prizes: [{ team: "missing", prizes: ["Prize"] }] }),
    ).rejects.toThrow(/no counted submission/);
    expect(f.counts.keyCalls).toBe(0);
    f.deps.fetchText = async () => {
      throw new Error("HTTP unavailable");
    };
    await expect(startFreeze(f.deps, input)).rejects.toThrow(/upload/);
    expect(f.job?.phase).toBe("awaiting-bundle");
    expect(f.counts.summaryWrites).toBe(0);
    f.corruptCopy();
    await expect(resumeFreeze(f.deps)).rejects.toThrow(/corrupt/);
  });
  it("stops an unknown submitted transaction instead of signing another nonce", async () => {
    const f = await fixture();
    f.deps.hook = async (point) => {
      if (point === "afterBroadcast") throw new Error("crash");
    };
    await expect(startFreeze(f.deps, input)).rejects.toThrow("crash");
    f.setUnknown();
    delete f.deps.hook;
    await expect(resumeFreeze(f.deps)).rejects.toThrow(/unknown/);
    expect(f.counts.summaryWrites).toBe(1);
  });
  it("resumes a saved in-window job after the wall-clock deadline with the same cutoffs", async () => {
    const f = await fixture();
    let crashed = false;
    f.deps.hook = async (point) => {
      if (point === "afterPrepared" && !crashed) {
        crashed = true;
        throw new Error("crash");
      }
    };
    await expect(startFreeze(f.deps, input)).rejects.toThrow("crash");
    const saved = f.job!.envelope.body.context;
    f.fake.advance(1_000_000n);
    delete f.deps.hook;
    const job = await resumeFreeze(f.deps);
    expect(job.envelope.body.context).toEqual(saved);
    expect(job.phase).toBe("complete");
  });
});
