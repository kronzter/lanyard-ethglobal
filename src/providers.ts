// The app's single composition root (plans/01-evidence-and-interfaces.md §3). Only this file
// (and cli/providers.ts for Node) may import another track's concrete implementations; feature
// code asks here for shared interfaces. It never imports the CLI-only results publisher.
//
// Mock mode serves the fixture-backed mocks. A provider whose real implementation has not
// landed fails loudly rather than returning a silent stand-in.
import { type ComponentType, Suspense, createElement, lazy } from "react";
import rabdiJson from "../deployments/rabdi.json";
import sepoliaJson from "../deployments/sepolia.json";
import { parseRabdiDeployment, parseSepoliaDeployment } from "@/shared/deployments/load";
import { eventConfig } from "@/shared/event.config";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { IdentityDirectory } from "@/shared/interfaces/identity-directory";
import type { Router } from "@/shared/interfaces/router";
import type { VenueMapProps } from "@/shared/interfaces/venue-map";
import { StubRouter } from "@/shared/mocks/stub-router";
import {
  createFixtureEnsReader,
  createFixtureIdentityDirectory,
  fixtureTimeline,
} from "@/shared/mocks/fixtures";
import { fakeArkiv, rabdiArkiv, type AppArkiv } from "./arkiv/app-arkiv";
import { flags as defaultFlags, type Flags } from "./flags";

export class ProviderNotWiredError extends Error {
  constructor(what: string, lands: string) {
    super(`${what} is not wired yet: it lands in ${lands}.`);
    this.name = "ProviderNotWiredError";
  }
}

// Loaded on first render, so Node code that imports this file (tests, tooling) never pulls in
// react-native-svg.
const LazyStubVenueMap = lazy(() => import("./components/venue/StubVenueMap"));
function StubVenueMap(props: VenueMapProps) {
  return createElement(Suspense, { fallback: null }, createElement(LazyStubVenueMap, props));
}

export function createProviders(flags: Flags = defaultFlags) {
  let ensReader: EnsReader | undefined;
  let identityDirectory: IdentityDirectory | undefined;
  let router: Router | undefined;
  let arkiv: AppArkiv | undefined;
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
    /** Rabdi (testnet), or the development-only fake on the fixture timeline. Public RPC values only. */
    arkiv(): AppArkiv {
      return (arkiv ??=
        flags.arkiv === "fake"
          ? fakeArkiv(eventConfig, fixtureTimeline())
          : rabdiArkiv({
              rpcUrl: process.env.EXPO_PUBLIC_RABDI_RPC_URL,
              accessKey: process.env.EXPO_PUBLIC_RABDI_ACCESS_KEY,
            }));
    },
    router(): Router {
      if (flags.router === "stub") return (router ??= new StubRouter());
      throw new ProviderNotWiredError("GridRouter", "A3.2, switched on at I3");
    },
    venueMap(): ComponentType<VenueMapProps> {
      if (flags.router === "stub") return StubVenueMap;
      throw new ProviderNotWiredError("VenueMap", "A3.3, switched on at I3");
    },
  };
}

export type Providers = ReturnType<typeof createProviders>;
export const providers: Providers = createProviders();
