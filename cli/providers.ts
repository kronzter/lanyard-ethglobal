// The Node composition root (plans/01-evidence-and-interfaces.md §3): the only CLI file allowed
// to pick concrete implementations across tracks. It selects mocks until I2 (ENS reader) and I4
// (results publisher). The mock publisher persists to a local file so freeze runs survive a
// restart. Signing and decryption keys never pass through here.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { eventConfig } from "@/shared/event.config";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { ResultsPublisher } from "@/shared/interfaces/results-publisher";
import { MockResultsPublisher } from "@/shared/mocks/mock-results-publisher";
import { createSerializedStore, type PublisherStore } from "@/shared/mocks/publisher-store";
import { createFixtureEnsReader, fixtureTimeline } from "@/shared/mocks/fixtures";
import { parseCliFlags, type CliFlags } from "./flags";
import { mockSepoliaBlocks, type SepoliaBlocks } from "./sepolia-blocks";

export const DEFAULT_MOCK_PUBLISHER_FILE = ".lanyard/mock-publisher.json";

export class CliProviderNotWiredError extends Error {
  constructor(what: string, lands: string) {
    super(`${what} is not wired into the CLI yet: it lands in ${lands}.`);
    this.name = "CliProviderNotWiredError";
  }
}

/** A publisher store backed by one JSON file, written atomically (temp file, then rename). */
export function fileStore(file: string): PublisherStore {
  return createSerializedStore({
    async read() {
      try {
        return await readFile(file, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async write(text) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, text, "utf8");
      await rename(tmp, file);
    },
  });
}

export function createCliProviders(
  opts: { env?: Record<string, string | undefined>; publisherFile?: string } = {},
) {
  const flags: CliFlags = parseCliFlags(opts.env ?? process.env);
  const publisherFile = opts.publisherFile ?? DEFAULT_MOCK_PUBLISHER_FILE;
  return {
    flags,
    config: eventConfig,
    ensReader(): EnsReader {
      if (flags.ens === "mock") return createFixtureEnsReader();
      throw new CliProviderNotWiredError("SepoliaEnsReader", "A2.4, switched on at I2");
    },
    /** Sepolia block identity for verify; follows the ENS flag (the archive RPC client lands at I2). */
    sepoliaBlocks(): SepoliaBlocks {
      if (flags.ens === "mock") return mockSepoliaBlocks(fixtureTimeline());
      throw new CliProviderNotWiredError("Sepolia block source", "I2, with the SepoliaEnsReader");
    },
    resultsPublisher(): ResultsPublisher {
      if (flags.results === "mock") return new MockResultsPublisher({ store: fileStore(publisherFile) });
      throw new CliProviderNotWiredError("SepoliaResultsPublisher", "A4.2, switched on at I4");
    },
  };
}
