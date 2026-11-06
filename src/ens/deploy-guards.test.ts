import { describe, expect, it } from "vitest";
import { ROLE, admin } from "./ensv2-abi";
import { HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES } from "./issuance-plan";
import { fixedResolverRoleProblems, type FixedResolverInventory } from "./deploy-guards";

const goodHackers: FixedResolverInventory = {
  kind: "hackers",
  rootCounts: HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  organizerRoot: HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  registrarRoot: 0n,
  registrarCoin60: ROLE.REGISTRAR, // ROLE_SET_ADDRESS is bit 0
  coin60Counts: 1n,
  urlCounts: 16n,
};
const goodStaff: FixedResolverInventory = { ...goodHackers, kind: "staff", urlCounts: 0n };

describe("fixed resolver role inventory (A1-D7)", () => {
  it("accepts the exact inventory deploy-resolvers.ts creates", () => {
    expect(fixedResolverRoleProblems(goodHackers)).toEqual([]);
    expect(fixedResolverRoleProblems(goodStaff)).toEqual([]);
  });

  it("rejects an extra ROLE_UPGRADE holder, naming it", () => {
    const p = fixedResolverRoleProblems({
      ...goodHackers,
      rootCounts: goodHackers.rootCounts + ROLE.UPGRADE,
    });
    expect(p.join(" ")).toMatch(/ROLE_UPGRADE/);
  });

  it("rejects an extra UPGRADE admin holder", () => {
    const p = fixedResolverRoleProblems({
      ...goodStaff,
      rootCounts: goodStaff.rootCounts + admin(ROLE.UPGRADE),
    });
    expect(p.join(" ")).toMatch(/ROLE_UPGRADE/);
  });

  it("rejects any other extra root role or admin", () => {
    expect(
      fixedResolverRoleProblems({ ...goodHackers, rootCounts: goodHackers.rootCounts + admin(1n << 28n) })
        .length,
    ).toBeGreaterThan(0);
    expect(
      fixedResolverRoleProblems({ ...goodHackers, rootCounts: goodHackers.rootCounts + 16n }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects an organizer whose own root roles drifted", () => {
    expect(fixedResolverRoleProblems({ ...goodStaff, organizerRoot: 1n }).length).toBeGreaterThan(0);
  });

  it("requires the registrar's coin-60 address setter, and nothing on the root", () => {
    expect(fixedResolverRoleProblems({ ...goodHackers, registrarCoin60: 0n }).join(" ")).toMatch(
      /registrar.*coin-60/,
    );
    expect(fixedResolverRoleProblems({ ...goodHackers, registrarRoot: 1n }).join(" ")).toMatch(
      /registrar.*root/,
    );
  });

  it("rejects extra holders of the coin-60 or url resources", () => {
    expect(fixedResolverRoleProblems({ ...goodHackers, coin60Counts: 2n }).length).toBeGreaterThan(0);
    expect(fixedResolverRoleProblems({ ...goodHackers, urlCounts: 32n }).length).toBeGreaterThan(0);
    expect(fixedResolverRoleProblems({ ...goodStaff, urlCounts: 16n }).length).toBeGreaterThan(0);
  });
});
