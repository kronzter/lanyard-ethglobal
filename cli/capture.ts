import { durableAppend, durableWrite } from "./files";
// `lanyard capture [--every <seconds>] [--max-pages <n>]`: retain the edition's readonly Arkiv
// records as operator-attested observations (B1.3-R8). Observations are appended, never rewritten,
// to .lanyard/capture/<edition>/observations.jsonl. Any gap, reset or conflict makes the run exit
// non-zero, which is what blocks an automatic freeze until it is resolved and disclosed.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  captureForEvent,
  decodeLines,
  encodeLine,
  retainObservedEntity,
  type ObservationStore,
} from "../src/arkiv/capture";
import { createArkivReader } from "../src/arkiv/client";
import { requireMeasured } from "../src/shared/config/unmeasured";
import { RABDI_CHAIN_ID } from "../src/shared/config/schema";
import { Bytes32Schema, type Hex } from "../src/shared/types/primitives";
import { eventConfig } from "../src/shared/event.config";

export function jsonlObservationStore(file: string): ObservationStore {
  const add = async (line: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await durableAppend(file, line + "\n");
  };
  return {
    async append(observation) {
      await durableAppend(`${file}.inventory.jsonl`, JSON.stringify({ key: observation.key }) + "\n");
      await add(encodeLine({ type: "observation", observation }));
    },
    markGone: (mark) => add(encodeLine({ type: "gone", ...mark })),
    async load() {
      try {
        return decodeLines(await readFile(file, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return { observations: [], gone: [] };
        throw e;
      }
    },
  };
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export async function runCapture(root: string, args: string[]): Promise<number> {
  const every = Number(flag(args, "--every") ?? 0);
  const maxPages = Number(flag(args, "--max-pages") ?? 50);
  if (!Number.isFinite(every) || every < 0 || !Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error("Capture interval/page budget must be valid positive values");
  const edition = eventConfig.edition;
  const store = jsonlObservationStore(path.join(root, ".lanyard", "capture", edition, "observations.jsonl"));
  const reader = createArkivReader({
    rpcUrl: process.env.RABDI_RPC_URL,
    accessKey: process.env.RABDI_ACCESS_KEY,
  });
  const network = {
    chainId: RABDI_CHAIN_ID,
    resetId: requireMeasured(eventConfig.chains.rabdi.resetId, "Rabdi reset identity"),
  };
  const captureDirectory = path.join(root, ".lanyard/capture", edition);
  await mkdir(captureDirectory, { recursive: true });
  const sessionFile = path.join(captureDirectory, "session.json");
  let watcherError: string | null = null;
  let pending = Promise.resolve();
  let dirty: boolean;
  let stop = false;
  const startupGaps: string[] = [];
  try {
    const prior = JSON.parse(await readFile(sessionFile, "utf8")) as { lastBlock: string };
    const now = await reader.head();
    if (now.number > BigInt(prior.lastBlock))
      startupGaps.push(`capture restarted after block ${prior.lastBlock}; reconcile the missed interval`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const unsubscribe = every
    ? reader.watch({
        onEvent(event) {
          dirty = true;
          pending = pending
            .then(async () => {
              const entity = await reader.get(event.entityKey);
              if (
                entity?.attributes.app?.value.value === "lanyard" &&
                entity.attributes.event?.value.value === edition
              )
                await retainObservedEntity(reader, store, entity, network);
            })
            .catch(() => {
              watcherError = "scoped entity evidence could not be retained after an invalidation";
            });
        },
        onError() {
          watcherError = "capture watcher disconnected; known missed interval must be reconciled";
        },
      })
    : () => {};
  const halt = () => {
    stop = true;
  };
  process.on("SIGINT", halt);
  process.on("SIGTERM", halt);
  let lastBlock = (await reader.head()).number;
  try {
    do {
      dirty = false;
      await pending;
      const report = await captureForEvent({ reader, edition, network, store, maxPages });
      if (startupGaps.length || watcherError) {
        report.complete = false;
        report.gaps.push(...startupGaps, ...(watcherError ? [watcherError] : []));
      }
      lastBlock = (await reader.head()).number;
      await durableAppend(
        path.join(captureDirectory, "reports.jsonl"),
        JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n",
      );
      await durableWrite(
        sessionFile,
        JSON.stringify({
          active: !!every && report.complete,
          pid: process.pid,
          lastBlock: lastBlock.toString(),
          every,
          updatedAt: Date.now(),
        }),
      );
      console.log(JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      if (!report.complete) return 1;
      if (!every) return 0;
      const until = Date.now() + every * 1000;
      while (!stop && !dirty && !watcherError && Date.now() < until)
        await new Promise((r) => setTimeout(r, 250));
    } while (!stop);
    return 0;
  } finally {
    unsubscribe();
    process.off("SIGINT", halt);
    process.off("SIGTERM", halt);
    await pending;
    await durableWrite(
      sessionFile,
      JSON.stringify({
        active: false,
        pid: process.pid,
        lastBlock: lastBlock.toString(),
        every,
        updatedAt: Date.now(),
      }),
    );
  }
}

/** Independent write-ahead inventory: losing an observation line must not erase its known key. */
export async function readCaptureInventory(file: string): Promise<Hex[]> {
  const text = await readFile(`${file}.inventory.jsonl`, "utf8");
  return [
    ...new Set(
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => Bytes32Schema.parse((JSON.parse(line) as { key: unknown }).key)),
    ),
  ].sort();
}
