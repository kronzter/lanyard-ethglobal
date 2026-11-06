// The app's single composition root (plans/01-evidence-and-interfaces.md §3). Only this file
// (and cli/providers.ts for Node) may import another track's concrete implementations; feature
// code asks here for shared interfaces. It never imports the CLI-only results publisher.
//
// Mock mode serves the fixture-backed mocks. A provider whose real implementation has not
// landed fails loudly rather than returning a silent stand-in.
import rabdiJson from "../deployments/rabdi.json";
import sepoliaJson from "../deployments/sepolia.json";
import { parseRabdiDeployment, parseSepoliaDeployment } from "@/shared/deployments/load";
import { eventConfig } from "@/shared/event.config";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { IdentityDirectory } from "@/shared/interfaces/identity-directory";
import { createFixtureEnsReader, createFixtureIdentityDirectory } from "@/shared/mocks/fixtures";
import { flags as defaultFlags, type Flags } from "./flags";

export class ProviderNotWiredError extends Error {
  constructor(what: string, lands: string) {
    super(`${what} is not wired yet: it lands in ${lands}.`);
    this.name = "ProviderNotWiredError";
  }
}

export function createProviders(flags: Flags = defaultFlags) {
  let ensReader: EnsReader | undefined;
  let identityDirectory: IdentityDirectory | undefined;
  return {
    flags,
    config: eventConfig,
    deployments: {
      sepolia: parseSepoliaDeployment(sepoliaJson),
      rabdi: parseRabdiDeployment(rabdiJson),
    },
    ensReader(): EnsReader {
      if (flags.ens === "mock") return (ensReader ??= createFixtureEnsReader());
      throw new ProviderNotWiredError("SepoliaEnsReader", "A2.4, switched on at I2");
    },
    identityDirectory(): IdentityDirectory {
      if (flags.ens === "mock")
        return (identityDirectory ??= createFixtureIdentityDirectory(createFixtureEnsReader()));
      throw new ProviderNotWiredError("Sepolia IdentityDirectory", "A2.4, switched on at I2");
    },
    router(): never {
      throw flags.router === "stub"
        ? new ProviderNotWiredError("StubRouter", "P0.3 (before B3)")
        : new ProviderNotWiredError("GridRouter", "A3.2, switched on at I3");
    },
  };
}

export type Providers = ReturnType<typeof createProviders>;
export const providers: Providers = createProviders();
