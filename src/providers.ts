// The app's single composition root (plans/01-evidence-and-interfaces.md §3). Only this file
// (and cli/providers.ts for Node) may import another track's concrete implementations; feature
// code asks here for shared interfaces. It never imports the CLI-only results publisher.
//
// ENS uses A2's live reader and identity directory after I2. Mock mode remains available for
// deterministic development. Router and publication switch at their own integrations.
import { type ComponentType, Suspense, createElement, lazy } from "react";
import rabdiJson from "../deployments/rabdi.json";
import sepoliaJson from "../deployments/sepolia.json";
import { parseRabdiDeployment, parseSepoliaDeployment, requireLive } from "@/shared/deployments/load";
import { eventConfig } from "@/shared/event.config";
import { sepoliaEventConfig } from "@/shared/live-event.config";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { IdentityDirectory } from "@/shared/interfaces/identity-directory";
import type { Router } from "@/shared/interfaces/router";
import type { VenueMapProps } from "@/shared/interfaces/venue-map";
import { StubRouter } from "@/shared/mocks/stub-router";
import { GridRouter } from "@/venue/grid-router";
import {
  createFixtureEnsReader,
  createFixtureIdentityDirectory,
  fixtureTimeline,
} from "@/shared/mocks/fixtures";
import { fakeArkiv, rabdiArkiv, type AppArkiv } from "./arkiv/app-arkiv";
import { createSepoliaEnsReader } from "./ens/sepolia-ens-reader";
import { createSepoliaIdentityDirectory } from "./ens/sepolia-identity-directory";
import { MemoryEnsCache } from "./ens/ens-cache";
import { flags as defaultFlags, type Flags } from "./flags";

export class ProviderNotWiredError extends Error {
  constructor(what: string, lands: string) {
    super(`${what} is not wired yet: it lands in ${lands}.`);
    this.name = "ProviderNotWiredError";
  }
}

// Loaded on first render, so Node code that imports this file (tests, tooling) never pulls in
// react-native-svg, gesture-handler or reanimated.
const LazyStubVenueMap = lazy(() => import("./components/venue/StubVenueMap"));
function StubVenueMap(props: VenueMapProps) {
  return createElement(Suspense, { fallback: null }, createElement(LazyStubVenueMap, props));
}
const LazyVenueMap = lazy(() => import("./components/venue/VenueMap"));
function VenueMap(props: VenueMapProps) {
  return createElement(Suspense, { fallback: null }, createElement(LazyVenueMap, props));
}

// A4.3's badge renders through react-native, so it loads on first render too. WinnerBadge builds
// `winner.<label>` itself: it takes the team's edition-relative label, not the full winner name.
const LazyWinnerBadge = lazy(() => import("./components/ens/WinnerBadge"));
function winnerBadgeFor(reader: () => EnsReader | undefined): ComponentType<{ team: string }> {
  return function ProviderWinnerBadge({ team }: { team: string }) {
    return createElement(
      Suspense,
      { fallback: null },
      createElement(LazyWinnerBadge, { label: team, reader: reader() }),
    );
  };
}

export function createProviders(flags: Flags = defaultFlags, opts: { sepoliaRpcUrl?: string } = {}) {
  const rpcUrl = () => {
    const url = opts.sepoliaRpcUrl ?? process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    if (!url) throw new Error("EXPO_PUBLIC_SEPOLIA_RPC_URL is required for sepolia ENS mode");
    return url;
  };
  const deployment = () => requireLive(parseSepoliaDeployment(sepoliaJson), eventConfig);
  let ensReader: EnsReader | undefined;
  let identityDirectory: IdentityDirectory | undefined;
  let router: Router | undefined;
  let arkiv: AppArkiv | undefined;
  let winnerBadge: ComponentType<{ team: string }> | undefined;
  return {
    flags,
    config: flags.ens === "sepolia" ? sepoliaEventConfig : eventConfig,
    deployments: {
      sepolia: parseSepoliaDeployment(sepoliaJson),
      rabdi: parseRabdiDeployment(rabdiJson),
    },
    ensReader(): EnsReader {
      if (flags.ens === "mock") return (ensReader ??= createFixtureEnsReader());
      return (ensReader ??= createSepoliaEnsReader({
        rpcUrl: rpcUrl(),
        deployment: deployment(),
        names: eventConfig,
        cache: new MemoryEnsCache(),
      }));
    },
    identityDirectory(): IdentityDirectory {
      if (flags.ens === "mock")
        return (identityDirectory ??= createFixtureIdentityDirectory(createFixtureEnsReader()));
      return (identityDirectory ??= createSepoliaIdentityDirectory({
        rpcUrl: rpcUrl(),
        deployment: deployment(),
        editionLabel: eventConfig.edition,
        reader: this.ensReader(),
      }));
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
      return (router ??= flags.router === "stub" ? new StubRouter() : new GridRouter());
    },
    /**
     * `lanyard.prizes` on `winner.<team>`, read through this provider's ENS reader (the fixture reader
     * in mock mode, which holds no winner names, so the badge renders nothing). Without a usable live
     * reader (no RPC configured) the badge falls back to its own lookup and shows "unavailable".
     */
    winnerBadge(): ComponentType<{ team: string }> {
      return (winnerBadge ??= winnerBadgeFor(() => {
        try {
          return this.ensReader();
        } catch {
          return undefined;
        }
      }));
    },
    venueMap(): ComponentType<VenueMapProps> {
      return flags.router === "stub" ? StubVenueMap : VenueMap;
    },
  };
}

export type Providers = ReturnType<typeof createProviders>;
export const providers: Providers = createProviders();
