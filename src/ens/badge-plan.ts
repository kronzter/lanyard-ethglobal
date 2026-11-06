// Argument parsing and the issue/skip decision for scripts/ens/issue-badge.ts. Pure, so it is tested
// without a chain. The registrar enforces the real policy; this only keeps typos from reaching it.
import { isAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from "viem";
import { normalizeLabel } from "../shared/labels";

/** Books that issue badges now. `partners` stays closed until A2.2. */
export const ISSUABLE_BOOKS = ["hackers", "judges", "volunteers"] as const;
export type IssuableBook = (typeof ISSUABLE_BOOKS)[number];

export type BadgeRequest = {
  book: IssuableBook;
  /** A single canonical label, e.g. `priya`. */
  label: string;
  owner: Address;
  fork: boolean;
  dryRun: boolean;
};

export class BadgeArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeArgError";
  }
}

export const USAGE =
  "usage: issue-badge.ts --book <hackers|judges|volunteers> --label <label> --owner <0x address> [--fork] [--dry-run]";

/** `argv` without the node/script entries. */
export function parseBadgeArgs(argv: string[]): BadgeRequest {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--fork" || arg === "--dry-run") {
      flags.add(arg);
    } else if (arg === "--book" || arg === "--label" || arg === "--owner") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new BadgeArgError(`${arg} needs a value`);
      if (values.has(arg)) throw new BadgeArgError(`${arg} given twice`);
      values.set(arg, value);
    } else {
      throw new BadgeArgError(`unknown argument ${arg}`);
    }
  }

  const book = values.get("--book");
  const label = values.get("--label");
  const owner = values.get("--owner");
  if (!book || !label || !owner) throw new BadgeArgError("--book, --label and --owner are required");

  if (book === "partners") throw new BadgeArgError("the partners book issues no badges until A2.2");
  if (!(ISSUABLE_BOOKS as readonly string[]).includes(book)) {
    throw new BadgeArgError(
      `unknown book ${JSON.stringify(book)}; expected one of ${ISSUABLE_BOOKS.join(", ")}`,
    );
  }
  if (label.includes(".")) throw new BadgeArgError("a badge label is one label: no dots");
  if (label === "") throw new BadgeArgError("--label is empty");
  try {
    normalizeLabel(label);
  } catch (e) {
    throw new BadgeArgError(e instanceof Error ? e.message : String(e));
  }
  if (!isAddress(owner, { strict: false })) throw new BadgeArgError(`--owner ${owner} is not an address`);
  if (owner.toLowerCase() === zeroAddress) throw new BadgeArgError("--owner is the zero address");

  return {
    book: book as IssuableBook,
    label,
    owner: owner.toLowerCase() as Address,
    fork: flags.has("--fork"),
    dryRun: flags.has("--dry-run"),
  };
}

/** The `bytes32 book` argument the registrar expects: the label hash. */
export const bookHash = (book: IssuableBook): Hex => keccak256(toHex(book));

export type BadgeDecision =
  { action: "issue" } | { action: "skip"; reason: string } | { action: "blocked"; reason: string };

/** Re-running with the same arguments is a no-op; a label held by someone else is never overwritten. */
export function decideBadge(args: { currentOwner: Address; wantedOwner: Address }): BadgeDecision {
  const current = args.currentOwner.toLowerCase();
  if (current === zeroAddress) return { action: "issue" };
  if (current === args.wantedOwner.toLowerCase())
    return { action: "skip", reason: "already issued to this owner" };
  return { action: "blocked", reason: `label is held by ${args.currentOwner}` };
}
