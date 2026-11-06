import { describe, expect, it } from "vitest";
import { FlagError, parseFlags } from "./flags";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { ProviderNotWiredError, createProviders } from "./providers";

describe("parseFlags", () => {
  it("defaults to mock ENS and the stub router", () => {
    expect(parseFlags({})).toEqual({ ens: "mock", router: "stub", arkiv: "rabdi" });
    expect(parseFlags({ ens: "", router: "" })).toEqual({ ens: "mock", router: "stub", arkiv: "rabdi" });
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
  it("exposes the config, the live Rabdi deployment and the mock Sepolia one", () => {
    const p = createProviders({ ens: "mock", router: "stub", arkiv: "rabdi" });
    expect(p.config.edition).toBe("mumbai2026");
    expect(p.deployments.rabdi.mode).toBe("live");
    expect(p.deployments.sepolia.mode).toBe("live");
  });

  it("fails loudly for providers that are not wired yet, naming where they land", () => {
    const live = createProviders({ ens: "sepolia", router: "grid", arkiv: "rabdi" });
    expect(() => live.ensReader()).toThrow(/A2\.4, switched on at I2/);
    expect(() => live.identityDirectory()).toThrow(/A2\.4, switched on at I2/);
    expect(() => live.router()).toThrow(ProviderNotWiredError);
    expect(() => live.router()).toThrow(/A3\.2, switched on at I3/);
    expect(() => live.venueMap()).toThrow(/A3\.3, switched on at I3/);
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
