import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { BadgeArgError, bookHash, decideBadge, parseBadgeArgs } from "./badge-plan";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ok = ["--book", "hackers", "--label", "priya", "--owner", OWNER];

describe("parseBadgeArgs", () => {
  it("accepts a valid request and lowercases the owner", () => {
    expect(parseBadgeArgs(ok)).toEqual({
      book: "hackers",
      label: "priya",
      owner: OWNER.toLowerCase(),
      fork: false,
      dryRun: false,
    });
  });

  it("reads --fork and --dry-run", () => {
    expect(parseBadgeArgs([...ok, "--fork", "--dry-run"])).toMatchObject({ fork: true, dryRun: true });
  });

  it.each(["judges", "volunteers"])("accepts the %s book", (book) => {
    expect(parseBadgeArgs(["--book", book, "--label", "a1", "--owner", OWNER]).book).toBe(book);
  });

  it.each<[string, string[], RegExp]>([
    ["a missing owner", ["--book", "hackers", "--label", "priya"], /required/],
    ["the partners book", ["--book", "partners", "--label", "arkiv", "--owner", OWNER], /A2\.2/],
    ["an unknown book", ["--book", "sponsors", "--label", "x1", "--owner", OWNER], /unknown book/],
    ["a dotted label", ["--book", "hackers", "--label", "a.b", "--owner", OWNER], /no dots/],
    ["an uppercase label", ["--book", "hackers", "--label", "Priya", "--owner", OWNER], /not canonical/],
    ["a trailing space", ["--book", "hackers", "--label", "priya ", "--owner", OWNER], /./],
    ["a leading hyphen", ["--book", "hackers", "--label", "-zk", "--owner", OWNER], /inner hyphens/],
    ["an emoji", ["--book", "hackers", "--label", "🙂", "--owner", OWNER], /./],
    ["a bad owner", ["--book", "hackers", "--label", "priya", "--owner", "0x123"], /not an address/],
    [
      "the zero owner",
      ["--book", "hackers", "--label", "priya", "--owner", "0x0000000000000000000000000000000000000000"],
      /zero address/,
    ],
    ["an unknown flag", [...ok, "--force"], /unknown argument/],
    ["a repeated option", [...ok, "--book", "judges"], /twice/],
    ["a flag without a value", ["--book"], /needs a value/],
  ])("rejects %s", (_name, argv, message) => {
    expect(() => parseBadgeArgs(argv)).toThrow(BadgeArgError);
    expect(() => parseBadgeArgs(argv)).toThrow(message);
  });
});

describe("bookHash", () => {
  it("is the label hash the registrar uses", () => {
    expect(bookHash("hackers")).toBe(keccak256(toHex("hackers")));
  });
});

describe("decideBadge", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  it("issues when the label is free", () => {
    expect(decideBadge({ currentOwner: zero, wantedOwner: OWNER })).toEqual({ action: "issue" });
  });
  it("skips when the same owner already holds it (idempotent re-run)", () => {
    expect(
      decideBadge({ currentOwner: OWNER.toLowerCase() as `0x${string}`, wantedOwner: OWNER }).action,
    ).toBe("skip");
  });
  it("never overwrites someone else's badge", () => {
    const other = "0x00000000000000000000000000000000000000aa";
    expect(decideBadge({ currentOwner: other, wantedOwner: OWNER }).action).toBe("blocked");
  });
});
