import { durableWrite } from "./files";
import { open, mkdir, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, parseJsonStrict } from "../src/shared/canonical";
import { configHash } from "../src/shared/config/hash";
import { requireMeasured } from "../src/shared/config/unmeasured";
import { createArkivReader } from "../src/arkiv/client";
import { captureForEvent } from "../src/arkiv/capture";
import type { EvidenceEnvelope } from "../src/shared/evidence/bundle";
import type { EvaluationContext } from "../src/shared/interfaces/evaluation-context";
import type { Hex } from "../src/shared/types/primitives";
import { jsonlObservationStore, readCaptureInventory } from "./capture";
import { createCliProviders } from "./providers";
import { parseJob, serializeJob, startFreeze, resumeFreeze, type FreezeDeps } from "./freeze-core";
import { summaryTransport } from "./summary-transport";

const secret = (value: string | undefined, name: string): Hex => {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`Set ${name} in the local operator environment`);
  return value as Hex;
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function runFreeze(root: string, args: string[]): Promise<number> {
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (
        !["--resume", "--prizes", "--bundle-uri", "--copy", "--job"].includes(a) ||
        !args[i + 1] ||
        args[i + 1]!.startsWith("--")
      )
        throw new Error(`Unknown or incomplete freeze option ${a}`);
      if (values.has(a)) throw new Error(`Duplicate option ${a}`);
      values.set(a, args[++i]!);
    } else positional.push(a);
  }
  const providers = createCliProviders({ publisherFile: path.join(root, ".lanyard/mock-publisher.json") });
  const config = providers.config;
  if (positional.length > 1 || (positional[0] && positional[0] !== config.edition))
    throw new Error(`Freeze supports edition ${config.edition}`);
  const resume = values.get("--resume");
  if (resume && [...values.keys()].some((k) => k !== "--resume"))
    throw new Error("Resume accepts only its saved job path; no new configuration, prizes or cutoff");
  const directory = path.join(root, ".lanyard/freeze", config.edition);
  const jobFile = path.resolve(root, resume ?? values.get("--job") ?? path.join(directory, "job.json"));
  const bundleFile = path.join(path.dirname(jobFile), "bundle.json");
  const defaultCopy = path.join(root, ".lanyard/evidence-backup", config.edition, "bundle.json");
  // Copy locations are persisted alongside the immutable job, so resume uses the same files.
  const locationsFile = `${jobFile}.locations.json`;
  let copyFile = path.resolve(root, values.get("--copy") ?? defaultCopy);
  if (resume) {
    const locations = JSON.parse(await readFile(locationsFile, "utf8")) as { copyFile: string };
    copyFile = locations.copyFile;
  }
  if (path.resolve(bundleFile) === path.resolve(copyFile))
    throw new Error("Two distinct local bundle copies are required");
  const lockFile = path.join(directory, "operator.lock");
  await mkdir(directory, { recursive: true });
  const lock = await open(lockFile, "wx", 0o600).catch(() => {
    throw new Error(
      "Another freeze process or stale operator lock exists; reconcile the saved job before removing the lock",
    );
  });
  const activeJobFile = path.join(directory, "active-job.json");
  try {
    try {
      const active = JSON.parse(await readFile(activeJobFile, "utf8")) as { jobFile: string };
      if (active.jobFile !== jobFile)
        throw new Error(`A saved edition freeze exists at ${active.jobFile}; resume that exact job`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await lock.writeFile(String(process.pid));
    await lock.sync();
    if (!resume) {
      try {
        await stat(jobFile);
        throw new Error("Freeze job already exists; use --resume");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    const resultsSecret = secret(
      process.env.RESULTS_PRIVATE_KEY ?? process.env.LANYARD_KEY_RESULTS,
      "RESULTS_PRIVATE_KEY",
    );
    const account = privateKeyToAccount(resultsSecret);
    const access = { rpcUrl: process.env.RABDI_RPC_URL, accessKey: process.env.RABDI_ACCESS_KEY };
    const reader = createArkivReader(access);
    const ens = providers.ensReader();
    const blocks = providers.sepoliaBlocks();
    const confirmations = requireMeasured(config.chains.rabdi.confirmations, "Rabdi confirmations");
    const sepoliaConfirmations = requireMeasured(
      config.chains.sepolia.confirmations,
      "Sepolia confirmations",
    );
    const resetId = requireMeasured(config.chains.rabdi.resetId, "Rabdi reset identity");
    const checkContext = async (context: EvaluationContext) => {
      const deadline = Date.now() + 15 * 60 * 1000;
      while (
        (await reader.head()).number < context.arkivCutoff.number + BigInt(confirmations) - 1n ||
        (await ens.headBlock()) < context.sepoliaCutoff.number + BigInt(sepoliaConfirmations) - 1n
      ) {
        if (Date.now() > deadline) throw new Error("Cutoffs are not yet confirmed; no publication attempted");
        await pause(2000);
      }
      const a = await reader.block(context.arkivCutoff.number);
      const s = await blocks.blockRef(context.sepoliaCutoff.number);
      if (
        canonicalJson(a) !== canonicalJson(context.arkivCutoff) ||
        canonicalJson(s) !== canonicalJson(context.sepoliaCutoff) ||
        (await reader.block(0n)).hash !== resetId
      )
        throw new Error("Saved cutoff hash/timestamp or network reset identity differs");
    };
    const deps: FreezeDeps = {
      config,
      signer: {
        address: account.address.toLowerCase() as `0x${string}`,
        signMessage: (message) => account.signMessage({ message }),
      },
      material() {
        const cipher = requireMeasured(config.scoreCipher, "score cipher");
        return {
          suite: cipher.suite,
          keyId: cipher.keyId,
          privateKey: secret(process.env.SCORE_DECRYPTION_KEY, "SCORE_DECRYPTION_KEY"),
        };
      },
      ens,
      checkContext,
      publisher: providers.resultsPublisher(),
      summary: summaryTransport(config, resultsSecret, access),
      async load() {
        try {
          return parseJob(await readFile(jobFile, "utf8"));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw e;
        }
      },
      save: async (job) => {
        await durableWrite(locationsFile, JSON.stringify({ copyFile }));
        await durableWrite(activeJobFile, JSON.stringify({ jobFile }));
        await durableWrite(jobFile, serializeJob(job) + "\n");
      },
      async retain(envelope) {
        const text = canonicalJson(envelope) + "\n";
        for (const file of [bundleFile, copyFile]) {
          try {
            if ((await readFile(file, "utf8")) !== text)
              throw new Error("Existing retained bundle differs; refusing overwrite");
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            await durableWrite(file, text);
          }
        }
        await durableWrite(locationsFile, JSON.stringify({ copyFile }));
      },
      async checkCopies(envelope: EvidenceEnvelope) {
        const text = canonicalJson(envelope) + "\n";
        const [a, b] = await Promise.all([readFile(bundleFile, "utf8"), readFile(copyFile, "utf8")]);
        const [sa, sb] = await Promise.all([stat(bundleFile), stat(copyFile)]);
        if (a !== text || b !== text || (sa.ino === sb.ino && sa.dev === sb.dev))
          throw new Error("Two independent retained bundle files did not verify");
      },
      async fetchText(uri) {
        const response = await fetch(uri, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("Bundle download unavailable");
        return response.text();
      },
      async capture() {
        const observationFile = path.join(root, ".lanyard/capture", config.edition, "observations.jsonl");
        const store = jsonlObservationStore(
          path.join(root, ".lanyard/capture", config.edition, "observations.jsonl"),
        );
        const report = await captureForEvent({
          reader,
          edition: config.edition,
          network: { chainId: config.chains.rabdi.chainId, resetId },
          store,
        });
        if (!report.complete || report.gaps.length) throw new Error("Final capture is incomplete");
        const session = JSON.parse(
          await readFile(path.join(root, ".lanyard/capture", config.edition, "session.json"), "utf8"),
        ) as { active: boolean; pid: number; every: number; updatedAt: number };
        if (
          !session.active ||
          !Number.isInteger(session.pid) ||
          session.pid <= 0 ||
          !Number.isFinite(session.every) ||
          session.every <= 0 ||
          Date.now() - session.updatedAt > Math.max(30000, session.every * 3000)
        )
          throw new Error("Capture session is not healthy; start continuous capture before judging inputs");
        try {
          process.kill(session.pid, 0);
        } catch {
          throw new Error("Capture process is no longer running; reconcile its missed interval");
        }
        const reportsFile = path.join(root, ".lanyard/capture", config.edition, "reports.jsonl");
        const reports = (await readFile(reportsFile, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as { complete: boolean; gaps: string[]; pages: { blockNumber: string }[] },
          );
        if (!reports.length || reports.some((r) => !r.complete || r.gaps.length))
          throw new Error("Capture history is absent or has unresolved gaps");
        const { observations } = await store.load();
        const inventory = await readCaptureInventory(observationFile);
        const head = await reader.head();
        const sepoliaNumber = await ens.sepoliaBlockAt(head.timestamp);
        const sepoliaCutoff = await blocks.blockRef(sepoliaNumber);
        const first = BigInt(reports[0]!.pages[0]!.blockNumber);
        const judging = observations.filter((r) =>
          ["submission", "rubric", "judge_assignment", "final_score", "recusal"].includes(r.kind),
        );
        if (judging.some((r) => r.createdAtBlock <= first))
          throw new Error(
            "Capture started after judging inputs; reconcile and disclose the missed interval before freeze",
          );
        return {
          records: observations,
          inventory,
          context: {
            event: config.edition,
            arkivChainId: config.chains.rabdi.chainId,
            arkivResetId: resetId,
            sepoliaChainId: config.chains.sepolia.chainId,
            arkivCutoff: head,
            sepoliaCutoff,
            configHash: configHash(config),
          },
          diagnostics: {
            knownKeys: inventory.length,
            gaps: [],
            intervals: [{ fromBlock: first, toBlock: head.number }],
          },
        };
      },
    };
    const result = resume
      ? await resumeFreeze(deps)
      : await startFreeze(deps, {
          prizes: parseJsonStrict(
            await readFile(path.resolve(root, values.get("--prizes") ?? "fixtures/prizes.json"), "utf8"),
          ),
          bundleUri: values.get("--bundle-uri") ?? "",
        });
    console.log(
      `Freeze ${result.phase}: ${result.envelope.bundleHash}. Manual prizes are committed in the evidence bundle.`,
    );
    return 0;
  } catch (e) {
    console.error(
      `Freeze stopped: ${(e as Error).message}\nSaved job: ${jobFile}. Resume only this job; never rebuild or resend uncertain transactions.`,
    );
    return 1;
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
