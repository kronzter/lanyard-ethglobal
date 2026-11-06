import { describe, expect, it } from "vitest";
import { dnsEncodeName } from "./dns-name";

describe("dnsEncodeName", () => {
  it("encodes length-prefixed labels with a final zero", () => {
    expect(dnsEncodeName("ab.eth")).toBe("0x0261620365746800");
    expect(dnsEncodeName("")).toBe("0x00");
  });
  it("rejects empty and non-ASCII labels", () => {
    expect(() => dnsEncodeName("a..eth")).toThrow();
    expect(() => dnsEncodeName("café.eth")).toThrow();
  });
});
