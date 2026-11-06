// Results publication on ENS (plans/01-evidence-and-interfaces.md §5). Used only by the local
// freeze CLI; the app never imports a publisher. MockResultsPublisher stands in until A4.2's
// SepoliaResultsPublisher, and both must pass runResultsPublisherConformance.
import { canonicalJson } from "../canonical";
import type { Hex } from "../types/primitives";

export type PublicationInput = {
  event: string;
  /** The 32-byte Arkiv `results` entity key (not a private key). */
  resultsKey: Hex;
  resultsHash: Hex;
  bundleHash: Hex;
  /** HTTPS retrieval hint for the evidence bundle; never a trust root. */
  bundleUri: string;
};
export type WinnerInput = PublicationInput & { team: string; prizes: string[] };
export type PublicationState = {
  eventResults: PublicationInput | null;
  winners: Record<string, WinnerInput>;
  locked: boolean;
};
/** A successful canonical receipt with the configured confirmations, not just a hash. */
export type ConfirmedTx = { txHash: Hex; blockNumber: bigint; blockHash: Hex };

export interface ResultsPublisher {
  /** The on-chain publication state; survives a new publisher instance. */
  state(): Promise<PublicationState>;
  setEventResults(input: PublicationInput): Promise<ConfirmedTx>;
  declareWinner(input: WinnerInput): Promise<ConfirmedTx>;
  /** Atomically locks the event pointer and every winner record, if the state equals `expected`. */
  lockResults(expected: PublicationState): Promise<ConfirmedTx>;
  /** The outcome of a previously broadcast transaction. Never authorizes a resend by itself. */
  reconcile(txHash: Hex): Promise<"pending" | "reverted" | ConfirmedTx>;
}

export const emptyPublicationState = (): PublicationState => ({
  eventResults: null,
  winners: {},
  locked: false,
});

/** Canonical equality of two publication states (winner order does not matter). */
export const samePublicationState = (a: PublicationState, b: PublicationState): boolean =>
  canonicalJson(a) === canonicalJson(b);

export class PublicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicationError";
  }
}
/** A second event publication, matching or conflicting, or one while another is pending. */
export class AlreadyPublishedError extends PublicationError {
  constructor(detail: string) {
    super("already-published", `event results are already published: ${detail}`);
  }
}
export class DuplicateDeclarationError extends PublicationError {
  constructor(team: string) {
    super("duplicate-declaration", `team ${team} is already declared (or its declaration is pending)`);
  }
}
export class LockedError extends PublicationError {
  constructor() {
    super("locked", "results are locked; no further publication is possible");
  }
}
export class StateMismatchError extends PublicationError {
  constructor(detail: string) {
    super("state-mismatch", detail);
  }
}
export class PublicationRevertedError extends PublicationError {
  constructor(readonly txHash: Hex) {
    super("reverted", `transaction ${txHash} reverted`);
  }
}
export class PublicationPendingError extends PublicationError {
  constructor(readonly txHash: Hex) {
    super(
      "pending",
      `transaction ${txHash} was broadcast but is not confirmed yet; reconcile it, never resend`,
    );
  }
}
export class UnknownTransactionError extends PublicationError {
  constructor(readonly txHash: Hex) {
    super("unknown-transaction", `no transaction ${txHash} is known`);
  }
}

/** Local publication preparation, required by the resumable freeze operator. */
export type PublicationOperation =
  | { kind: "setEventResults"; input: PublicationInput }
  | { kind: "declareWinner"; input: WinnerInput }
  | { kind: "lockResults"; expected: PublicationState };
export type PreparedPublication = { rawTransaction: Hex; txHash: Hex; nonce: bigint };
export interface PreparedResultsPublisher extends ResultsPublisher {
  pendingTransactions(): Promise<Hex[]>;
  prepare(op: PublicationOperation): Promise<PreparedPublication>;
  broadcastPrepared(tx: PreparedPublication): Promise<ConfirmedTx>;
  preparedStatus(txHash: Hex): Promise<"prepared" | "pending" | "reverted" | ConfirmedTx>;
}
