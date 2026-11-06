import { describe, expect, it } from "vitest";
import { grantsPermission, SHIFT_MANAGER } from "../shared/ens/permission-envelope";
import { bindingChanged, decidePerms, parsePermsArgs } from "./perms-plan";

const STAFF = "0x5AcF42b6507C7a6cDb20B0032136De56a97d6836" as const;
const HACKERS = "0xD62FB6197921392e65DD2bbE894660a186cfA7B8" as const;
const OWNER = "0x1111111111111111111111111111111111110001" as const;
const OTHER = "0x1111111111111111111111111111111111110002" as const;
const RID = `0x${"ab".repeat(32)}` as const;
const RID2 = `0x${"cd".repeat(32)}` as const;
const binding = { registrationId: RID, owner: OWNER };
const base = { binding, make: true, resolver: STAFF, staffResolver: STAFF, current: null };

describe("parsePermsArgs", () => {
  it("takes one volunteer and make or unmake", () => {
    expect(parsePermsArgs(["--volunteer", "priya", "--make"])).toEqual({
      label: "priya",
      make: true,
      fork: false,
      dryRun: false,
    });
    expect(parsePermsArgs(["--volunteer", "priya", "--unmake", "--fork"]).make).toBe(false);
  });

  it.each([
    [["--volunteer", "priya"]],
    [["--volunteer", "priya", "--make", "--unmake"]],
    [["--volunteer", "priya.volunteers", "--make"]],
    [["--volunteer", "Priya", "--make"]],
    [["--make"]],
  ])("rejects %j", (argv) => expect(() => parsePermsArgs(argv)).toThrow());
});

describe("decidePerms", () => {
  it("writes an envelope that grants shift-manager to exactly this binding", () => {
    const d = decidePerms(base);
    expect(d.action).toBe("write");
    const value = d.action === "write" ? d.value : null;
    expect(grantsPermission(value, binding, SHIFT_MANAGER)).toBe(true);
    expect(grantsPermission(value, { registrationId: RID2, owner: OWNER }, SHIFT_MANAGER)).toBe(false);
    expect(grantsPermission(value, { registrationId: RID, owner: OTHER }, SHIFT_MANAGER)).toBe(false);
  });

  it("unmakes with an empty list for the current binding", () => {
    const d = decidePerms({ ...base, make: false });
    expect(d.action === "write" && grantsPermission(d.value, binding, SHIFT_MANAGER)).toBe(false);
    expect(d.action === "write" && JSON.parse(d.value).permissions).toEqual([]);
  });

  it("skips when the note already matches", () => {
    const first = decidePerms(base);
    expect(first.action === "write" && decidePerms({ ...base, current: first.value }).action).toBe("skip");
  });

  it("rewrites a stale note left on a reissued badge", () => {
    const stale = decidePerms({ ...base, binding: { registrationId: RID2, owner: OWNER } });
    const d = decidePerms({ ...base, current: stale.action === "write" ? stale.value : null });
    expect(d.action).toBe("write");
  });

  it("refuses a dead badge or a badge on another resolver", () => {
    expect(decidePerms({ ...base, binding: { registrationId: null, owner: null } }).action).toBe("blocked");
    expect(decidePerms({ ...base, resolver: HACKERS }).action).toBe("blocked");
  });
});

describe("bindingChanged", () => {
  it("detects a concurrent reissue or holder change, ignoring case", () => {
    expect(bindingChanged(binding, { registrationId: RID, owner: OWNER.toUpperCase() as never })).toBe(false);
    expect(bindingChanged(binding, { registrationId: RID2, owner: OWNER })).toBe(true);
    expect(bindingChanged(binding, { registrationId: RID, owner: OTHER })).toBe(true);
  });
});
