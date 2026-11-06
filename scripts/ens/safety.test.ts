import { describe, expect, it } from "vitest";
import { assertLoopbackUrl, redactUrls } from "./safety";

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
