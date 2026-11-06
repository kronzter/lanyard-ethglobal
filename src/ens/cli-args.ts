// A small, strict argv parser shared by the A2 operator scripts: every flag at most once, every
// value flag needs a value, and anything unknown is an error rather than ignored.
export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgError";
  }
}

export type ParsedArgs = { flags: Set<string>; values: Map<string, string> };

export function parseArgs(
  argv: readonly string[],
  spec: { flags: readonly string[]; values: readonly string[] },
): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]!;
    if (spec.flags.includes(arg)) {
      if (flags.has(arg)) throw new ArgError(`${arg} given twice`);
      flags.add(arg);
    } else if (spec.values.includes(arg)) {
      if (values.has(arg)) throw new ArgError(`${arg} given twice`);
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new ArgError(`${arg} needs a value`);
      values.set(arg, value);
    } else throw new ArgError(`unknown argument ${arg}`);
  }
  return { flags, values };
}
