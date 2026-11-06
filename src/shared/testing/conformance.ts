// Conformance suites are lists of checks, so the same checks can be registered as vitest tests
// (runXConformance) or evaluated programmatically, which lets a self-test assert that a
// deliberately broken implementation fails without failing the outer test run (P0.3-R5).
import { describe, it } from "vitest";

export type Check<S> = { name: string; run: (subject: S) => Promise<void> };
export type CheckFailure = { name: string; error: string };

export class ConformanceAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceAssertionError";
  }
}

export function expectThat(ok: boolean, message: string): void {
  if (!ok) throw new ConformanceAssertionError(message);
}

/** JSON with bigints written as `123n`, so nested values compare and print deterministically. */
export const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? `${x}n` : x)) ?? String(v);

export const same = (a: unknown, b: unknown): boolean => show(a) === show(b);

export function expectEqual(actual: unknown, expected: unknown, what: string): void {
  if (!same(actual, expected))
    throw new ConformanceAssertionError(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

export async function expectRejects(fn: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new ConformanceAssertionError(`${what}: expected a thrown error, but it resolved`);
}

/** Run every check against a fresh subject; return the failures (empty when conformant). */
export async function evaluateConformance<S>(
  checks: Check<S>[],
  factory: () => S | Promise<S>,
): Promise<CheckFailure[]> {
  const failures: CheckFailure[] = [];
  for (const check of checks) {
    try {
      await check.run(await factory());
    } catch (e) {
      failures.push({ name: check.name, error: (e as Error).message });
    }
  }
  return failures;
}

/** Register every check as a vitest test under `suite`. */
export function registerConformance<S>(
  suite: string,
  checks: Check<S>[],
  factory: () => S | Promise<S>,
): void {
  describe(suite, () => {
    for (const check of checks) it(check.name, async () => check.run(await factory()));
  });
}
