import type { Address } from "viem";
import { ROLE } from "./ensv2-abi";

export type IssuanceConfig = {
  hackersResolver: Address;
  staffResolver: Address;
  headJudge: Address;
  baseName: string;
};

export function issuanceMismatches(actual: IssuanceConfig, expected: IssuanceConfig): string[] {
  const mismatches: string[] = [];
  for (const key of ["hackersResolver", "staffResolver", "headJudge"] as const) {
    if (actual[key].toLowerCase() !== expected[key].toLowerCase())
      mismatches.push(`${key} is ${actual[key]}, expected ${expected[key]}`);
  }
  if (actual.baseName !== expected.baseName)
    mismatches.push(
      `baseName is ${JSON.stringify(actual.baseName)}, expected ${JSON.stringify(expected.baseName)}`,
    );
  return mismatches;
}

/** Resolver pointers are fixed for every book, with only hackers using its dedicated resolver. */
export function resolverForBook(
  book: string,
  config: Pick<IssuanceConfig, "hackersResolver" | "staffResolver">,
): Address {
  return book === "hackers" ? config.hackersResolver : config.staffResolver;
}

/** Managed book root role count includes the extra head-judge unregister role. */
export function expectedBookRoleCount(book: string): bigint {
  return (
    2n * ROLE.REGISTRAR +
    (book === "judges" ? 2n : 1n) * ROLE.UNREGISTER +
    2n * ROLE.RENEW +
    ROLE.SET_RESOLVER
  );
}

export const HACKERS_STAFF_ORGANIZER_RESOLVER_ROLES = 1n | (1n << 128n) | (16n << 128n);
export const PUBLICATION_ORGANIZER_RESOLVER_ROLES =
  16n | (1n << 28n) | (1n << 124n) | (16n << 128n) | ((1n << 28n) << 128n) | ((1n << 124n) << 128n);

export function issuanceConfigurationState(
  phase: "created" | "bootstrapped" | "sealed" | null,
  actual: IssuanceConfig | null,
  expected: IssuanceConfig,
): { configured: boolean; mismatches: string[] } {
  if (!actual) return { configured: false, mismatches: [] };
  const mismatches = issuanceMismatches(actual, expected);
  if (phase !== "created" && mismatches.length > 0) {
    return {
      configured: false,
      mismatches: [`configured issuance cannot be changed after bootstrap: ${mismatches.join("; ")}`],
    };
  }
  return { configured: mismatches.length === 0, mismatches };
}
