import { describe, expect, it } from "vitest";
import { assertLoopbackUrl, chooseOrganizer, redactUrls } from "./safety";

describe("assertLoopbackUrl", () => {
  it.each([
    "http://127.0.0.1:8545",
    "http://localhost:8546",
    "http://localhost",
    "http://[::1]:8545",
    "https://127.0.0.1:8545/path",
  ])("accepts %s", (url) => {
    expect(() => assertLoopbackUrl(url)).not.toThrow();
  });

  it.each([
    "https://eth-sepolia.g.alchemy.com/v2/abc",
    "http://192.168.1.10:8545",
    "http://0.0.0.0:8545",
    "http://localhost.evil.com:8545",
    "http://127.0.0.1.evil.com",
  ])("rejects %s", (url) => {
    expect(() => assertLoopbackUrl(url)).toThrow(/localhost|valid URL/);
  });

  it("rejects text that is not a URL", () => {
    expect(() => assertLoopbackUrl("not a url")).toThrow(/valid URL/);
  });
});

describe("redactUrls", () => {
  it("removes a known URL, including one with a key in the path", () => {
    const url = "https://rpc.example/v2/SECRETKEY";
    const out = redactUrls(`request to ${url} failed`, [url]);
    expect(out).toBe("request to <rpc-url> failed");
    expect(out).not.toContain("SECRETKEY");
  });

  it("removes unknown http, https, ws and wss URLs too", () => {
    const text = "a http://x.io/k1 b HTTPS://y.io/k2?token=1 c wss://z.io/k3 d ws://w.io/k4";
    const out = redactUrls(text);
    expect(out).toBe("a <rpc-url> b <rpc-url> c <rpc-url> d <rpc-url>");
  });

  it("leaves text without URLs alone and ignores empty known entries", () => {
    expect(redactUrls("execution reverted", ["", "https://a.b"])).toBe("execution reverted");
  });
});

describe("chooseOrganizer", () => {
  const config = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"; // the mock organizer in event.config.ts
  const real = "0x36b7C556c584d65bd44Ae57656B64b68Bb88E2cF";
  const other = "0x141c4D64A4eeCb1a1780B24b184EFf748aC36D6d";

  it("a fork run accepts any key, or falls back to the configured organizer", () => {
    expect(chooseOrganizer({ fork: true, key: other, config }).organizer.toLowerCase()).toBe(
      other.toLowerCase(),
    );
    expect(chooseOrganizer({ fork: true, key: null, config }).organizer.toLowerCase()).toBe(config);
  });

  it("a live run without the override still requires the configured organizer's key", () => {
    expect(() => chooseOrganizer({ fork: false, key: real, config })).toThrow(/LANYARD_LIVE_ORGANIZER/);
    expect(chooseOrganizer({ fork: false, key: null, config }).organizer.toLowerCase()).toBe(config);
  });

  it("the override names the live organizer and warns that the config is behind", () => {
    const out = chooseOrganizer({ fork: false, key: real, config, override: real.toLowerCase() });
    expect(out.organizer).toBe(real);
    expect(out.warning).toMatch(/authorities\.organizer/);
  });

  it("a read-only live run uses the override even without a key", () => {
    expect(chooseOrganizer({ fork: false, key: null, config, override: real }).organizer).toBe(real);
  });

  it("the override must match the key exactly, so it cannot authorize another wallet", () => {
    expect(() => chooseOrganizer({ fork: false, key: other, config, override: real })).toThrow(
      /does not match LANYARD_LIVE_ORGANIZER/,
    );
  });

  it("rejects a malformed override", () => {
    expect(() => chooseOrganizer({ fork: false, key: real, config, override: "0x1234" })).toThrow(
      /LANYARD_LIVE_ORGANIZER/,
    );
  });

  it("an override equal to the config is accepted without a warning", () => {
    expect(chooseOrganizer({ fork: false, key: config, config, override: config }).warning).toBeUndefined();
  });
});
