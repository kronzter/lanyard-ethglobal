import { describe, expect, it } from "vitest";
import { ArgError } from "./cli-args";
import {
  appendHistory,
  decideRevive,
  decideRevoke,
  historyEvent,
  parseReviveArgs,
  parseRevokeArgs,
  targetName,
} from "./revive-plan";

describe("parseRevokeArgs", () => {
  it("takes a global book, defaulting to the other signer", () => {
    expect(parseRevokeArgs(["--book", "hackers", "--label", "priya"])).toEqual({
      target: { kind: "book", book: "hackers", label: "priya" },
      as: "other",
      fork: false,
      dryRun: false,
    });
  });
  it("takes a partner sub-book and flags", () => {
    const r = parseRevokeArgs([
      "--partner",
      "arkiv",
      "--sub",
      "staff",
      "--label",
      "kai",
      "--as",
      "organizer",
      "--fork",
      "--dry-run",
    ]);
    expect(r.target).toEqual({ kind: "partner", partner: "arkiv", sub: "staff", label: "kai" });
    expect(r).toMatchObject({ as: "organizer", fork: true, dryRun: true });
  });
  it("rejects bad addressing", () => {
    const bad = (a: string[]) => expect(() => parseRevokeArgs(a)).toThrow(ArgError);
    bad(["--label", "x"]);
    bad(["--book", "hackers"]);
    bad(["--book", "partners", "--label", "x"]);
    bad(["--book", "hackers", "--partner", "a", "--sub", "staff", "--label", "x"]);
    bad(["--partner", "a", "--label", "x"]);
    bad(["--partner", "a", "--sub", "hackers", "--label", "x"]);
    bad(["--book", "hackers", "--sub", "staff", "--label", "x"]);
    bad(["--book", "hackers", "--label", "a.b"]);
    bad(["--book", "hackers", "--label", "x", "--as", "root"]);
    bad(["--book", "hackers", "--label", "x", "--nope"]);
  });
});

describe("parseReviveArgs", () => {
  it("parses an optional expiry", () => {
    expect(parseReviveArgs(["--book", "judges", "--label", "j"]).expiry).toBeNull();
    expect(parseReviveArgs(["--book", "judges", "--label", "j", "--expiry", "1900000000"]).expiry).toBe(
      1900000000n,
    );
  });
  it("rejects non-numeric, negative and oversized expiry", () => {
    for (const e of ["soon", "-5", "1.5", "18446744073709551616"])
      expect(() => parseReviveArgs(["--book", "judges", "--label", "j", "--expiry", e])).toThrow(ArgError);
  });
});

describe("decideRevoke", () => {
  it("acts on a registered badge, skips anything else", () => {
    expect(decideRevoke({ status: 2 }).action).toBe("act");
    expect(decideRevoke({ status: 0 }).action).toBe("skip");
    expect(decideRevoke({ status: 1 }).action).toBe("skip");
  });
});

describe("decideRevive", () => {
  const o = { status: 0, currentExpiry: 1000n, hasOwner: true, namespaceExpiry: 5000n, now: 2000n };
  it("revives an expired badge to a future expiry", () => {
    expect(decideRevive(o, 3000n, false).action).toBe("act");
  });
  it("blocks when there is no owner to restore", () => {
    expect(decideRevive({ ...o, hasOwner: false }, 3000n, false).action).toBe("blocked");
  });
  it("blocks above the namespace expiry", () => {
    expect(decideRevive(o, 5001n, true)).toMatchObject({
      action: "blocked",
      reason: expect.stringMatching(/namespaceExpiry/),
    });
    expect(decideRevive(o, 5000n, true).action).toBe("act");
  });
  it("blocks an expiry in the past", () => {
    expect(decideRevive(o, 2000n, true).action).toBe("blocked");
  });
  it("blocks a reduction, skips an equal live expiry", () => {
    const live = { ...o, status: 2, currentExpiry: 4000n };
    expect(decideRevive(live, 3000n, true)).toMatchObject({
      action: "blocked",
      reason: expect.stringMatching(/reduce/),
    });
    expect(decideRevive(live, 4000n, true).action).toBe("skip");
    expect(decideRevive(live, 4500n, true).action).toBe("act");
  });
  it("skips a live badge already past the default policy expiry", () => {
    expect(decideRevive({ ...o, status: 2, currentExpiry: 4000n }, 3000n, false).action).toBe("skip");
  });
});

describe("history", () => {
  const t = { kind: "partner", partner: "arkiv", sub: "staff", label: "kai" } as const;
  const ev = historyEvent("revive", t, 123n, "0xabc", new Date("2026-01-02T03:04:05Z"));
  it("records the target, block and time", () => {
    expect(targetName(t)).toBe("kai.staff.arkiv.partners");
    expect(ev).toEqual({
      action: "revive",
      name: "kai.staff.arkiv.partners",
      label: "kai",
      partner: "arkiv",
      sub: "staff",
      block: "123",
      txHash: "0xabc",
      at: "2026-01-02T03:04:05.000Z",
    });
  });
  it("appends to an array and refuses a foreign shape", () => {
    expect(appendHistory(undefined, ev)).toEqual([ev]);
    expect(appendHistory([ev], ev)).toHaveLength(2);
    expect(() => appendHistory({ events: [] }, ev)).toThrow();
  });
});
