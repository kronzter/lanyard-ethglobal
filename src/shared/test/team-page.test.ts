import { describe, expect, it } from "vitest";
import pages from "../../../fixtures/team-pages.json";
import {
  TeamPageError,
  TeamPageStateSchema,
  isEthglobalLink,
  isSafeLink,
  requireEthglobalForSeal,
  teamPageUrl,
  validateTeamPageContent,
  type TeamPageContent,
} from "../types/team-page";

const content = (): TeamPageContent => structuredClone(pages.populated.content);

describe("team page fixtures", () => {
  it("cover the four distinct page states and all validate", () => {
    const states = Object.values(pages).map((p) => TeamPageStateSchema.parse(p).status);
    expect(states).toEqual(["published", "awaiting-submission", "unknown-team", "unavailable"]);
  });
});

describe("teamPageUrl", () => {
  it("builds the deterministic page URL", () => {
    expect(teamPageUrl("zkpay", "https://mumbai2026.lanyard.example")).toBe(
      "https://mumbai2026.lanyard.example/teams/zkpay",
    );
    expect(teamPageUrl("zkpay", "http://localhost:8081")).toBe("http://localhost:8081/teams/zkpay");
  });

  it.each([
    ["a non-team label", () => teamPageUrl("priya.volunteers", "https://x.example")],
    ["a book name", () => teamPageUrl("judges", "https://x.example")],
    ["an uppercase label", () => teamPageUrl("ZkPay", "https://x.example")],
    ["an origin with a path", () => teamPageUrl("zkpay", "https://x.example/app")],
    ["a non-local http origin", () => teamPageUrl("zkpay", "http://x.example")],
  ])("rejects %s", (_name, call) => {
    expect(call).toThrow(TeamPageError);
  });
});

describe("content bounds", () => {
  const rejects = (mutate: (c: TeamPageContent) => void, message: RegExp) => {
    const c = content();
    mutate(c);
    expect(() => validateTeamPageContent(c)).toThrow(message);
  };

  it("accepts the fixture and omits missing optional links", () => {
    expect(validateTeamPageContent(content()).title).toBe("zkPay");
    expect(validateTeamPageContent({ ...content(), links: {} }).links).toEqual({});
  });

  it("enforces title, description and member limits", () => {
    rejects((c) => (c.title = ""), /title/);
    rejects((c) => (c.title = "x".repeat(121)), /title/);
    rejects((c) => (c.description = "x".repeat(4001)), /description/);
    rejects((c) => (c.members = ["a", "b", "c", "d", "e"]), /four members/);
    rejects((c) => (c.members = ["x".repeat(81)]), /member names/);
    expect(() => validateTeamPageContent({ ...content(), title: "🦄".repeat(120) })).not.toThrow();
  });

  it("rejects unknown link kinds", () =>
    rejects((c) => Object.assign(c.links, { twitter: "https://x.com/a" }), /twitter|Unrecognized/i));
});

describe("link rules", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://github.com/example/zkpay",
    "https://user:pass@github.com/example",
    "//github.com/example",
    `https://example.com/${"a".repeat(2048)}`,
  ])("rejects %s", (url) => {
    expect(isSafeLink(url)).toBe(false);
  });

  it("accepts ordinary https links", () => {
    expect(isSafeLink("https://github.com/example/zkpay")).toBe(true);
  });

  it.each([
    ["https://ethglobal.com/showcase/x", true],
    ["https://www.ethglobal.com/showcase/x", true],
    ["https://ethglobal.com.evil.example/showcase/x", false],
    ["https://evil-ethglobal.com/showcase/x", false],
    ["https://showcase.ethglobal.com/x", false],
    ["https://ethglobal.com:8443/x", false],
    ["http://ethglobal.com/showcase/x", false],
  ])("ETHGlobal host check: %s → %s", (url, ok) => {
    expect(isEthglobalLink(url)).toBe(ok);
  });

  it("puts the ETHGlobal rule on the ethglobal link only", () => {
    const c = content();
    c.links.ethglobal = "https://github.com/example/zkpay";
    expect(() => validateTeamPageContent(c)).toThrow(/ethglobal\.com/);
  });
});

describe("sealing", () => {
  it("requires an ETHGlobal link to seal, not to draft", () => {
    const draft = validateTeamPageContent({
      ...content(),
      links: { repository: "https://github.com/example/zkpay" },
    });
    expect(() => requireEthglobalForSeal(draft)).toThrow(/ETHGlobal/);
    expect(requireEthglobalForSeal(content())).toBeTruthy();
  });
});
