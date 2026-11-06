// CLI feature flags (plans/00-README.md › Feature flags): LANYARD_ENS flips at I2 and
// LANYARD_RESULTS at I4. ENS defaults to Sepolia after I2; results stay mock until I4.

export const CLI_MODES = ["mock", "sepolia"] as const;
export type CliMode = (typeof CLI_MODES)[number];
export type CliFlags = { ens: CliMode; results: CliMode };

export class CliFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliFlagError";
  }
}

function pick(name: string, value: string | undefined, fallback: CliMode): CliMode {
  if (value === undefined || value === "") return fallback;
  if ((CLI_MODES as readonly string[]).includes(value)) return value as CliMode;
  throw new CliFlagError(`${name}=${JSON.stringify(value)} is not one of ${CLI_MODES.join(" | ")}`);
}

export const parseCliFlags = (env: Record<string, string | undefined>): CliFlags => ({
  ens: pick("LANYARD_ENS", env.LANYARD_ENS, "sepolia"),
  results: pick("LANYARD_RESULTS", env.LANYARD_RESULTS, "mock"),
});
