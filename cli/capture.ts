// `lanyard capture [--every <seconds>] [--max-pages <n>]`: retain the edition's readonly Arkiv
// records as operator-attested observations (B1.3-R8). Observations are appended, never rewritten,
// to .lanyard/capture/<edition>/observations.jsonl. Any gap, reset or conflict makes the run exit
// non-zero, which is what blocks an automatic freeze until it is resolved and disclosed.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { captureForEvent, decodeLines, encodeLine, type ObservationStore } from "../src/arkiv/capture";
import { createArkivReader } from "../src/arkiv/client";
import { requireMeasured } from "../src/shared/config/unmeasured";
import { RABDI_CHAIN_ID } from "../src/shared/config/schema";
import { eventConfig } from "../src/shared/event.config";

export function jsonlObservationStore(file: string): ObservationStore {
  const add = async (line: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, line + "\n", "utf8");
  };
  return {
    append: (observation) => add(encodeLine({ type: "observation", observation })),
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
  for (;;) {
    const report = await captureForEvent({ reader, edition, network, store, maxPages });
    console.log(
      JSON.stringify({ at: new Date().toISOString(), ...report }, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
    if (!report.complete) return 1;
    if (!every) return 0;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}
