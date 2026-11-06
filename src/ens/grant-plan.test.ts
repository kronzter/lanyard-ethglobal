import { describe, expect, it } from "vitest";
import {
  approvalViolations,
  decideCoordinator,
  decidePartner,
  headJudgeProblems,
  lifetimeProblems,
  parseGrantArgs,
  ROLE_SET_TEXT,
  ROLE_UNREGISTER,
} from "./grant-plan";

const A = "0x1111111111111111111111111111111111110001" as const;
const B = "0x1111111111111111111111111111111111110002" as const;
const C = "0x1111111111111111111111111111111111110003" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const defaults = { partners: { arkiv: A, ens: B }, partnerIds: ["arkiv", "ens"] };

describe("parseGrantArgs", () => {
  it("defaults partners to the config and takes a coordinator", () => {
    expect(parseGrantArgs(["--coordinator", C, "--fork"], defaults)).toMatchObject({
      coordinator: C,
      partners: { arkiv: A, ens: B },
      headJudge: null,
      fork: true,
    });
  });

  it("overrides partners and lowercases wallets", () => {
    const upper = "0x" + C.slice(2).toUpperCase();
    expect(parseGrantArgs(["--partners", `arkiv=${upper}`], defaults).partners).toEqual({ arkiv: C });
  });

  it.each<[string, string[]]>([
    ["an unknown partner", ["--partners", `sponsor=${C}`]],
    ["a malformed entry", ["--partners", "arkiv"]],
    ["a zero coordinator", ["--coordinator", ZERO]],
    ["a coordinator who is also a partner", ["--coordinator", A]],
    ["a repeated partner", ["--partners", `arkiv=${A},arkiv=${C}`]],
  ])("rejects %s", (_, argv) => expect(() => parseGrantArgs(argv, defaults)).toThrow());
});

describe("grant decisions", () => {
  it("grants the coordinator only when the perms-key text role is missing", () => {
    expect(decideCoordinator(0n).action).toBe("act");
    expect(decideCoordinator(ROLE_SET_TEXT).action).toBe("skip");
  });

  it("onboards a partner once and never changes its wallet", () => {
    expect(decidePartner(ZERO, A).action).toBe("act");
    expect(decidePartner(A, A).action).toBe("skip");
    expect(decidePartner(A, B).action).toBe("blocked");
  });

  it("verifies the head judge holds exactly UNREGISTER on the judges book", () => {
    const ok = { configured: A, expected: A, judgesRootRoles: ROLE_UNREGISTER };
    expect(headJudgeProblems(ok)).toEqual([]);
    expect(headJudgeProblems({ ...ok, expected: B })).toHaveLength(1);
    expect(headJudgeProblems({ ...ok, judgesRootRoles: ROLE_UNREGISTER | 1n })).toHaveLength(1);
    expect(headJudgeProblems({ configured: ZERO, expected: null, judgesRootRoles: 0n })).toHaveLength(2);
  });

  it("flags a structural name that expires before the namespace", () => {
    expect(lifetimeProblems([{ name: "arkiv.partners", expiry: 10n }], 10n)).toEqual([]);
    expect(lifetimeProblems([{ name: "staff.arkiv.partners", expiry: 9n }], 10n)).toHaveLength(1);
  });

  it("reports only approvals that are still set", () => {
    const e = { registry: A, account: B, operator: C };
    expect(
      approvalViolations([
        { ...e, approved: true },
        { ...e, approved: false },
      ]),
    ).toEqual([]);
    expect(approvalViolations([{ ...e, approved: true }])).toHaveLength(1);
  });
});
