import { Suspense, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { FlagError, parseFlags } from "./flags";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { createProviders } from "./providers";
import { GridRouter } from "@/venue/grid-router";

describe("parseFlags", () => {
  it("defaults to Sepolia ENS and the stub router", () => {
    expect(parseFlags({})).toEqual({ ens: "sepolia", router: "stub", arkiv: "rabdi" });
    expect(parseFlags({ ens: "", router: "" })).toEqual({ ens: "sepolia", router: "stub", arkiv: "rabdi" });
  });

  it("accepts the integration values", () => {
    expect(parseFlags({ ens: "sepolia", router: "grid", arkiv: "fake" })).toEqual({
      ens: "sepolia",
      router: "grid",
      arkiv: "fake",
    });
  });

  it.each([{ ens: "Sepolia" }, { ens: "live" }, { router: "real" }, { arkiv: "mainnet" }])(
    "rejects unknown values %j",
    (env) => {
      expect(() => parseFlags(env)).toThrow(FlagError);
    },
  );
});

describe("createProviders", () => {
  it("exposes the config, the live Rabdi and Sepolia deployments", () => {
    const p = createProviders({ ens: "mock", router: "stub", arkiv: "rabdi" });
    expect(p.config.edition).toBe("mumbai2026");
    expect(p.deployments.rabdi.mode).toBe("live");
    expect(p.deployments.sepolia.mode).toBe("live");
  });

  it("serves A3's GridRouter and real venue map in grid mode, without loading native modules", () => {
    const live = createProviders({ ens: "sepolia", router: "grid", arkiv: "rabdi" });
    expect(live.router()).toBeInstanceOf(GridRouter);
    expect(live.router()).toBe(live.router());
    expect(live.venueMap()).toBe(live.venueMap());
    expect(live.venueMap()).not.toBe(
      createProviders({ ens: "mock", router: "stub", arkiv: "rabdi" }).venueMap(),
    );
  });

  it("wires one live reader and directory using the configured RPC", () => {
    const p = createProviders(
      { ens: "sepolia", router: "stub", arkiv: "rabdi" },
      { sepoliaRpcUrl: "http://127.0.0.1:8545" },
    );
    expect(p.ensReader()).toBe(p.ensReader());
    expect(p.identityDirectory()).toBe(p.identityDirectory());
  });

  it("serves the stub venue map in stub mode without loading react-native-svg", () => {
    const p = createProviders({ ens: "mock", router: "stub", arkiv: "rabdi" });
    expect(typeof p.venueMap()).toBe("function");
    expect(p.venueMap()).toBe(p.venueMap());
  });

  it("serves the fixture ENS reader, directory and stub router in mock mode, one instance each", async () => {
    const p = createProviders({ ens: "mock", router: "stub", arkiv: "rabdi" });
    expect(p.ensReader()).toBe(p.ensReader());
    expect(await p.ensReader().headBlock()).toBeGreaterThan(0n);
    expect(p.router()).toBe(p.router());
    expect(p.router().path(fixtureVenue(), { x: 0, y: 0 }, { x: 1, y: 1 })).toHaveLength(2);
    expect(
      await p
        .identityDirectory()
        .labelsFor("0x000000000000000000000000000000000000dead", { sepoliaBlock: 9_021_610n }),
    ).toEqual([]);
  });

  describe("winnerBadge", () => {
    // Calling the adapter as a plain function returns its element tree without rendering, so the
    // lazily loaded react-native badge is never imported here.
    const child = (p: ReturnType<typeof createProviders>, team: string) => {
      const Badge = p.winnerBadge() as (props: { team: string }) => ReactElement<{
        children: ReactElement<{ label: string; reader?: unknown }>;
      }>;
      const el = Badge({ team });
      expect(el.type).toBe(Suspense);
      return el.props.children.props;
    };

    it("passes the team label and the provider's fixture reader in mock mode, one component", () => {
      const p = createProviders({ ens: "mock", router: "stub", arkiv: "rabdi" });
      expect(p.winnerBadge()).toBe(p.winnerBadge());
      expect(child(p, "zkpay")).toEqual({ label: "zkpay", reader: p.ensReader() });
    });

    it("passes the live reader in sepolia mode", () => {
      const p = createProviders(
        { ens: "sepolia", router: "stub", arkiv: "rabdi" },
        { sepoliaRpcUrl: "http://127.0.0.1:8545" },
      );
      expect(child(p, "zkpay").reader).toBe(p.ensReader());
    });

    it("leaves the reader to the badge's own fallback when no RPC is configured", () => {
      vi.stubEnv("EXPO_PUBLIC_SEPOLIA_RPC_URL", "");
      try {
        const p = createProviders({ ens: "sepolia", router: "stub", arkiv: "rabdi" });
        expect(child(p, "zkpay")).toEqual({ label: "zkpay", reader: undefined });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
