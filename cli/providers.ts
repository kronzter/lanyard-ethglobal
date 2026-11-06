// The Node composition root (plans/01-evidence-and-interfaces.md §3): the only CLI file allowed
// to pick concrete implementations across tracks. ENS is live at I2; results stay mock until I4.
// The mock publisher persists to a local file so freeze runs survive a
// restart. Signing and decryption keys never pass through here.
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import sepoliaJson from "../deployments/sepolia.json";
import { parseSepoliaDeployment, requireLive } from "@/shared/deployments/load";
import { createSepoliaEnsReader } from "../src/ens/sepolia-ens-reader";
import { MemoryEnsCache } from "../src/ens/ens-cache";
import { readFile } from "node:fs/promises";
import { eventConfig } from "@/shared/event.config";
import { sepoliaEventConfig } from "@/shared/live-event.config";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { PreparedResultsPublisher } from "@/shared/interfaces/results-publisher";
import { MockResultsPublisher } from "@/shared/mocks/mock-results-publisher";
import { createSerializedStore, type PublisherStore } from "@/shared/mocks/publisher-store";
import { createFixtureEnsReader, fixtureTimeline } from "@/shared/mocks/fixtures";
import { durableWrite } from "./files";
import { parseCliFlags, type CliFlags } from "./flags";
import { liveSepoliaBlocks, mockSepoliaBlocks, type SepoliaBlocks } from "./sepolia-blocks";

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
      await durableWrite(file, text);
    },
  });
}

export function createCliProviders(
  opts: { env?: Record<string, string | undefined>; publisherFile?: string } = {},
) {
  const env = opts.env ?? process.env;
  const flags: CliFlags = parseCliFlags(env);
  let ensReader: EnsReader | undefined;
  let blocks: SepoliaBlocks | undefined;
  const rpcUrl = () => {
    const url = env.SEPOLIA_RPC_URL ?? env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    if (!url) throw new Error("SEPOLIA_RPC_URL is required for sepolia ENS mode");
    requireLive(parseSepoliaDeployment(sepoliaJson), eventConfig);
    return url;
  };
  const publisherFile = opts.publisherFile ?? DEFAULT_MOCK_PUBLISHER_FILE;
  return {
    flags,
    config: flags.ens === "sepolia" ? sepoliaEventConfig : eventConfig,
    ensReader(): EnsReader {
      if (flags.ens === "mock") return (ensReader ??= createFixtureEnsReader());
      return (ensReader ??= createSepoliaEnsReader({
        rpcUrl: rpcUrl(),
        deployment: requireLive(parseSepoliaDeployment(sepoliaJson), eventConfig),
        names: eventConfig,
        cache: new MemoryEnsCache(),
      }));
    },
    /** Sepolia block identity for verify, from the same RPC as the historical reader. */
    sepoliaBlocks(): SepoliaBlocks {
      if (flags.ens === "mock") return (blocks ??= mockSepoliaBlocks(fixtureTimeline()));
      return (blocks ??= liveSepoliaBlocks(
        createPublicClient({ chain: sepolia, transport: http(rpcUrl()) }),
      ));
    },
    resultsPublisher(): PreparedResultsPublisher {
      if (flags.results === "mock") return new MockResultsPublisher({ store: fileStore(publisherFile) });
      throw new CliProviderNotWiredError("SepoliaResultsPublisher", "A4.2, switched on at I4");
    },
  };
}
