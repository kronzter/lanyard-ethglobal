import { describe, expect, it } from "vitest";
import { RABDI_CHAIN_ID, SEPOLIA_CHAIN_ID } from "@/shared/config/schema";
import { RABDI_PUBLIC_RPC, parseWalletEnv, walletChains } from "./chains";

describe("parseWalletEnv", () => {
  it("names every missing value instead of throwing", () => {
    expect(parseWalletEnv({})).toEqual({
      ok: false,
      missing: ["EXPO_PUBLIC_REOWN_PROJECT_ID", "EXPO_PUBLIC_SEPOLIA_RPC_URL"],
    });
    expect(parseWalletEnv({ projectId: "p", sepoliaRpc: "" })).toEqual({
      ok: false,
      missing: ["EXPO_PUBLIC_SEPOLIA_RPC_URL"],
    });
  });

  it("falls back to the keyless Rabdi RPC", () => {
    expect(parseWalletEnv({ projectId: "p", sepoliaRpc: "https://s" })).toEqual({
      ok: true,
      projectId: "p",
      sepoliaRpc: "https://s",
      rabdiRpc: RABDI_PUBLIC_RPC,
    });
    expect(parseWalletEnv({ projectId: "p", sepoliaRpc: "https://s", rabdiRpc: "https://r" })).toMatchObject({
      rabdiRpc: "https://r",
    });
  });
});

describe("walletChains", () => {
  it("is Sepolia then Rabdi, each on its configured RPC", () => {
    const [sepolia, rabdi] = walletChains({ sepoliaRpc: "https://s", rabdiRpc: "https://r" });
    expect(sepolia.id).toBe(SEPOLIA_CHAIN_ID);
    expect(sepolia.rpcUrls.default.http).toEqual(["https://s"]);
    expect(rabdi.id).toBe(RABDI_CHAIN_ID);
    expect(rabdi.rpcUrls.default.http).toEqual(["https://r"]);
    expect(rabdi.nativeCurrency.symbol).toBe("tGLM");
  });
});
