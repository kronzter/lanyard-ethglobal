import { describe, expect, it } from "vitest";
import { decideTeamUrl, parseTeamUrlArgs } from "./team-url-plan";

const HACKERS = "0xD62FB6197921392e65DD2bbE894660a186cfA7B8" as const;
const OTHER = "0x5AcF42b6507C7a6cDb20B0032136De56a97d6836" as const;
const ctx = {
  hackersResolver: HACKERS,
  publicAppOrigin: "https://lanyard-eth.vercel.app",
  repair: false,
} as const;
const URL = "https://lanyard-eth.vercel.app/teams/zkpay";
const base = { label: "zkpay", status: 2, resolver: HACKERS, currentUrl: "" } as const;

describe("parseTeamUrlArgs", () => {
  it("takes one team or --all", () => {
    expect(parseTeamUrlArgs(["--team", "zkpay"]).teams).toEqual({ kind: "one", label: "zkpay" });
    expect(parseTeamUrlArgs(["--all", "--fork", "--dry-run"])).toMatchObject({
      teams: { kind: "all" },
      fork: true,
      dryRun: true,
      repair: false,
    });
  });

  it.each([[[]], [["--all", "--team", "zkpay"]], [["--team", "hackers"]], [["--team"]], [["--bogus"]]])(
    "rejects %j",
    (argv) => expect(() => parseTeamUrlArgs(argv)).toThrow(),
  );
});

describe("decideTeamUrl", () => {
  it("writes the canonical page URL when none is set", () => {
    expect(decideTeamUrl(base, ctx)).toEqual({ action: "write", url: URL });
  });

  it("does nothing when the URL already matches", () => {
    expect(decideTeamUrl({ ...base, currentUrl: URL }, ctx)).toEqual({ action: "skip", url: URL });
  });

  it("reports a different URL unless --repair", () => {
    const o = { ...base, currentUrl: "https://evil.example/teams/zkpay" };
    expect(decideTeamUrl(o, ctx).action).toBe("blocked");
    expect(decideTeamUrl(o, { ...ctx, repair: true })).toEqual({ action: "write", url: URL });
  });

  it("never writes when the lead repointed the resolver, even with --repair", () => {
    const o = { ...base, resolver: OTHER };
    expect(decideTeamUrl(o, { ...ctx, repair: true })).toMatchObject({ action: "blocked" });
  });

  it("refuses an unregistered team", () => {
    expect(decideTeamUrl({ ...base, status: 0 }, ctx).action).toBe("blocked");
  });

  it("gives two teams distinct URLs", () => {
    const a = decideTeamUrl(base, ctx);
    const b = decideTeamUrl({ ...base, label: "nightowls" }, ctx);
    expect(a.action === "write" && b.action === "write" && a.url !== b.url).toBe(true);
  });
});
