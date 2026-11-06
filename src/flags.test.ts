import { describe, expect, it } from "vitest";
import { FlagError, parseFlags } from "./flags";
import { ProviderNotWiredError, createProviders } from "./providers";

describe("parseFlags", () => {
  it("defaults to mock ENS and the stub router", () => {
    expect(parseFlags({})).toEqual({ ens: "mock", router: "stub" });
    expect(parseFlags({ ens: "", router: "" })).toEqual({ ens: "mock", router: "stub" });
  });

  it("accepts the integration values", () => {
    expect(parseFlags({ ens: "sepolia", router: "grid" })).toEqual({ ens: "sepolia", router: "grid" });
  });

  it.each([{ ens: "Sepolia" }, { ens: "live" }, { router: "real" }])("rejects unknown values %j", (env) => {
    expect(() => parseFlags(env)).toThrow(FlagError);
  });
});

describe("createProviders", () => {
  it("exposes the config and mock-mode deployments", () => {
    const p = createProviders({ ens: "mock", router: "stub" });
    expect(p.config.edition).toBe("mumbai2026");
    expect(p.deployments.rabdi.mode).toBe("mock");
    expect(p.deployments.sepolia.mode).toBe("mock");
  });

  it("fails loudly for providers that are not wired yet, naming where they land", () => {
    const mock = createProviders({ ens: "mock", router: "stub" });
    expect(() => mock.ensReader()).toThrow(ProviderNotWiredError);
    expect(() => mock.ensReader()).toThrow(/P0\.3/);
    const live = createProviders({ ens: "sepolia", router: "grid" });
    expect(() => live.ensReader()).toThrow(/A2\.4, switched on at I2/);
    expect(() => live.router()).toThrow(/A3\.2, switched on at I3/);
  });
});
