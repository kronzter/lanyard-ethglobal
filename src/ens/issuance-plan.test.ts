import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { ROLE, admin } from "./ensv2-abi";
import {
  expectedBookRoleCount,
  HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES,
  issuanceConfigurationState,
  issuanceMismatches,
  PUBLICATION_ORGANIZER_RESOLVER_ROLES,
  resolverForBook,
  type IssuanceConfig,
} from "./issuance-plan";

const expected: IssuanceConfig = {
  hackersResolver: "0x0000000000000000000000000000000000000001" as Address,
  staffResolver: "0x0000000000000000000000000000000000000002" as Address,
  headJudge: "0x0000000000000000000000000000000000000003" as Address,
  baseName: "lanyard.eth",
};

describe("issuance plan", () => {
  it("plans configuration after deploy and before bootstrap, then resumes deterministically", async () => {
    const { planEditionSteps } = await import("./edition-plan");
    const base = {
      lanyardOwnedByOrganizer: true,
      lanyardExpiry: 100n,
      namespaceExpiry: 100n,
      baseRegistryDeployed: true,
      baseAttachedToLanyard: true,
      baseParentSet: true,
      baseParentLocked: true,
      registrarPhase: "created" as const,
      editionNameAttached: false,
    };
    expect(planEditionSteps({ ...base, issuanceConfigured: false })).toEqual({
      status: "ready",
      steps: ["configure-issuance", "bootstrap-edition", "attach-edition-name", "seal-edition"],
    });
    expect(planEditionSteps({ ...base, issuanceConfigured: true })).toEqual({
      status: "ready",
      steps: ["bootstrap-edition", "attach-edition-name", "seal-edition"],
    });
  });

  it("reports a missing configuration and every mismatched field", () => {
    expect(issuanceConfigurationState("created", null, expected)).toEqual({
      configured: false,
      mismatches: [],
    });
    expect(
      issuanceMismatches(
        { ...expected, staffResolver: expected.hackersResolver, headJudge: expected.hackersResolver },
        expected,
      ),
    ).toHaveLength(2);
    expect(
      issuanceConfigurationState("sealed", { ...expected, baseName: "wrong.eth" }, expected).mismatches,
    ).toEqual([expect.stringContaining("cannot be changed after bootstrap")]);
  });

  it("pins book resolver choice, organizer permission bitmaps, and role counts", () => {
    expect(resolverForBook("hackers", expected)).toBe(expected.hackersResolver);
    expect(resolverForBook("judges", expected)).toBe(expected.staffResolver);
    expect(HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES).toBe(1n | admin(1n) | admin(16n));
    expect(HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES & 16n).toBe(0n);
    expect(PUBLICATION_ORGANIZER_RESOLVER_ROLES).toBe(
      16n | (1n << 28n) | ROLE.UPGRADE | admin(16n) | admin(1n << 28n) | admin(ROLE.UPGRADE),
    );
    expect(expectedBookRoleCount("hackers")).toBe(
      2n * ROLE.REGISTRAR + ROLE.UNREGISTER + 2n * ROLE.RENEW + ROLE.SET_RESOLVER,
    );
    expect(expectedBookRoleCount("judges") - expectedBookRoleCount("hackers")).toBe(ROLE.UNREGISTER);
  });

  it("authorizes publication text setters and their admin, without interface-record authority", () => {
    // Pinned PermissionedResolverLib uses nybble 1 for text and nybble 4 for interface records.
    // These permissions must match the actual resolver initialized by deploy-resolvers.ts.
    expect(PUBLICATION_ORGANIZER_RESOLVER_ROLES & 16n).toBe(16n);
    expect(PUBLICATION_ORGANIZER_RESOLVER_ROLES & (16n << 128n)).toBe(16n << 128n);
    expect(PUBLICATION_ORGANIZER_RESOLVER_ROLES & 65536n).toBe(0n);
    expect(PUBLICATION_ORGANIZER_RESOLVER_ROLES & (65536n << 128n)).toBe(0n);
  });
});
