import { describe, expect, it } from "vitest";
import { FlagError, parseFlags } from "./flags";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { createProviders } from "./providers";
import { GridRouter } from "@/venue/grid-router";

describe("parseFlags", () => {
  it("defaults to Sepolia ENS and the grid router", () => {
    expect(parseFlags({})).toEqual({ ens: "sepolia", router: "grid", arkiv: "rabdi" });
    expect(parseFlags({ ens: "", router: "" })).toEqual({ ens: "sepolia", router: "grid", arkiv: "rabdi" });
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
});
