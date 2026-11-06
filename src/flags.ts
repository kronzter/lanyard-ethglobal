// App feature flags (plans/00-README.md › Feature flags). Expo inlines EXPO_PUBLIC_* values at
// build time, so each one must be read as a literal `process.env.EXPO_PUBLIC_…` member access.
// Every value here is public. Defaults stay mock/stub so neither track depends on the other.

export const ENS_MODES = ["mock", "sepolia"] as const;
export const ROUTER_MODES = ["stub", "grid"] as const;
export type EnsMode = (typeof ENS_MODES)[number];
export type RouterMode = (typeof ROUTER_MODES)[number];
export type Flags = { ens: EnsMode; router: RouterMode };

export class FlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlagError";
  }
}

function pick<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === "") return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new FlagError(`${name}=${JSON.stringify(value)} is not one of ${allowed.join(" | ")}`);
}

/** Parse flag values; unknown values fail loudly instead of silently picking a mode. */
export function parseFlags(env: { ens?: string; router?: string }): Flags {
  return {
    ens: pick("EXPO_PUBLIC_LANYARD_ENS", env.ens, ENS_MODES, "mock"),
    router: pick("EXPO_PUBLIC_LANYARD_ROUTER", env.router, ROUTER_MODES, "stub"),
  };
}

export const flags: Flags = parseFlags({
  ens: process.env.EXPO_PUBLIC_LANYARD_ENS,
  router: process.env.EXPO_PUBLIC_LANYARD_ROUTER,
});
