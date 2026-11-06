// Rules engine types (B2.2; plans/01-evidence-and-interfaces.md §2).
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import type { RulesConfig } from "./config";
import type { DecodedRecord } from "./decode";
import type { EnsRead, EnsSnapshot } from "./snapshot";
import type { TimeMap } from "./time";

/** Whether one record counts, and why not when it doesn't. */
export type Verdict = { key: Hex; kind: string; counts: boolean; reason?: string };
export type RuleResult = { counts: true } | { counts: false; reason: string };

export const ok: RuleResult = { counts: true };
export const reject = (reason: string): RuleResult => ({ counts: false, reason });

/** Independently configured wallets that need no badge. */
export type AuthorityName = "organizer" | "results" | "desk" | "headJudge";

/** Who may write a kind. A record counts only through one writer that fully checks out. */
export type Writer =
  | { via: "authority"; authority: AuthorityName }
  /** Any configured partner authority wallet; the kind rule sees which partner. */
  | { via: "partner" }
  | {
      via: "badge";
      /** Which labels this writer path applies to, e.g. `x.volunteers`. */
      applies: (label: string) => boolean;
      /** Human description for reasons, e.g. "a volunteer badge". */
      describe: string;
      /** A `lanyard.perms` permission bound to the badge's registration and holder at creation. */
      permission?: string;
      /** Also require the same registration, still owned and unexpired, through the cutoff. */
      continuousToCutoff?: boolean;
    };

/** The writer path a record passed through. */
export type WriterMatch =
  | { via: "authority"; authority: AuthorityName }
  | { via: "partner"; partner: string }
  /** `permission` names the permission the matched badge path required, if any (e.g. a lead path). */
  | { via: "badge"; label: string; permission?: string };

/** What a rule may read when declaring its extra ENS reads (`prepare`). */
export type ReadScope = {
  record: DecodedRecord;
  writer: WriterMatch;
  creationBlock: bigint;
  cutoffBlock: bigint;
  config: RulesConfig;
};

/** What a kind rule may see. Everything is prepared; nothing here touches a clock or network. */
export type RuleCtx = ReadScope & {
  context: EvaluationContext;
  ens: EnsSnapshot;
  time: TimeMap;
  /** Every record under evaluation (sorted, decoded), for cross-record rules (B3/B4). */
  records: readonly DecodedRecord[];
  /** The final verdict of an earlier record (in evaluation order); undefined for later ones. */
  verdictOf(key: Hex): Verdict | undefined;
};

export type KindRule = {
  /** Creation flags every counted record of this kind must carry. */
  flags: { readonly: boolean; permissionlessExtension: boolean };
  writers: readonly Writer[];
  /** Extra historical reads, declared only for records that passed the writer checks. */
  reads?: (scope: ReadScope) => EnsRead[];
  check: (record: DecodedRecord, ctx: RuleCtx) => RuleResult;
};

/** Kind → rule. Built explicitly, never by import-order side effects. */
export type RuleSet = Readonly<Record<string, KindRule>>;

export type RulesOutput = {
  schemaVersion: 1;
  event: string;
  ruleVersion: Hex;
  configHash: Hex;
  /** One verdict per input record, in evidence order (creation block, then key). */
  verdicts: Verdict[];
};
