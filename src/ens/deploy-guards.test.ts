import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { ROLE, admin } from "./ensv2-abi";
import {
  HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  PUBLICATION_ORGANIZER_RESOLVER_ROLES,
} from "./issuance-plan";
import {
  fixedResolverRoleProblems,
  publicationResolverProblems,
  winnerRegistrarProblems,
  type FixedResolverInventory,
  type PublicationResolverInventory,
} from "./deploy-guards";

const A = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}` as Address;

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

const recorded = A(0x50);
const goodPublication: PublicationResolverInventory = {
  target: recorded,
  recorded,
  hackers: A(1),
  staff: A(2),
  hasCode: true,
  supportsInterface: true,
  rootCounts: PUBLICATION_ORGANIZER_RESOLVER_ROLES,
  organizerRoot: PUBLICATION_ORGANIZER_RESOLVER_ROLES,
  registrarRoot: 0n,
};

describe("publication resolver target (A1-D8)", () => {
  it("accepts the recorded, correctly permissioned resolver", () => {
    expect(publicationResolverProblems(goodPublication)).toEqual([]);
  });
  it("rejects every deviation", () => {
    const bad = (patch: Partial<PublicationResolverInventory>) =>
      publicationResolverProblems({ ...goodPublication, ...patch }).length;
    expect(bad({ target: A(0x99) })).toBeGreaterThan(0);
    expect(bad({ hasCode: false })).toBeGreaterThan(0);
    expect(bad({ supportsInterface: false })).toBeGreaterThan(0);
    expect(bad({ target: A(1), recorded: A(1) })).toBeGreaterThan(0);
    expect(bad({ target: A(2), recorded: A(2) })).toBeGreaterThan(0);
    expect(bad({ rootCounts: goodPublication.rootCounts + ROLE.UPGRADE })).toBeGreaterThan(0);
    expect(bad({ organizerRoot: 0n })).toBeGreaterThan(0);
    expect(bad({ registrarRoot: 16n })).toBeGreaterThan(0);
  });
});

describe("winner registrar target (A1-D8)", () => {
  const base = { target: A(0x70), registrar: A(0x10), organizer: A(0x20), hasCode: true };
  it("refuses while no WinnerRegistrar exists unless explicitly overridden", () => {
    expect(winnerRegistrarProblems({ ...base, pointsBack: null, allowUnverified: false }).join(" ")).toMatch(
      /--allow-unverified-winner-registrar/,
    );
    expect(winnerRegistrarProblems({ ...base, pointsBack: null, allowUnverified: true })).toEqual([]);
  });
  it("verifies the back-pointer when the target exposes one", () => {
    expect(winnerRegistrarProblems({ ...base, pointsBack: base.registrar, allowUnverified: false })).toEqual(
      [],
    );
    expect(winnerRegistrarProblems({ ...base, pointsBack: A(0x11), allowUnverified: true }).length).toBe(1);
  });
  it("always rejects no code, the registrar itself, and the organizer", () => {
    expect(
      winnerRegistrarProblems({ ...base, hasCode: false, pointsBack: null, allowUnverified: true }).length,
    ).toBe(1);
    expect(
      winnerRegistrarProblems({ ...base, target: base.registrar, pointsBack: null, allowUnverified: true })
        .length,
    ).toBe(1);
    expect(
      winnerRegistrarProblems({ ...base, target: base.organizer, pointsBack: null, allowUnverified: true })
        .length,
    ).toBe(1);
  });
});
