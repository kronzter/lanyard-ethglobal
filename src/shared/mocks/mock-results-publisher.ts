// MockResultsPublisher (plans/P0-foundation.md › P0.3-R3). Every mutation becomes a mock
// transaction recorded in the store before its outcome is known; only a confirmed receipt
// changes publication state, and a pending one is re-validated when it settles, just as a real
// transaction would revert against a changed contract. State therefore survives a new instance
// (a CLI restart), including a crash right after broadcast.
import { canonicalHash } from "../canonical";
import {
  AlreadyPublishedError,
  DuplicateDeclarationError,
  LockedError,
  PublicationPendingError,
  PublicationRevertedError,
  StateMismatchError,
  UnknownTransactionError,
  emptyPublicationState,
  samePublicationState,
  type ConfirmedTx,
  type PublicationInput,
  type PublicationState,
  type ResultsPublisher,
  type WinnerInput,
} from "../interfaces/results-publisher";
import { isTeamLabel } from "../labels";
import type { Hex } from "../types/primitives";
import type { MockTx, PersistedPublisher, PublisherOp, PublisherStore } from "./publisher-store";

export type ReceiptOutcome = "success" | "revert" | "pending" | "crash-after-broadcast";

/** The process died after broadcasting; the journal kept `txHash`, the receipt was never seen. */
export class PublisherCrashError extends Error {
  constructor(readonly txHash: Hex) {
    super(`simulated crash after broadcasting ${txHash}`);
    this.name = "PublisherCrashError";
  }
}

export type MockResultsPublisherOptions = {
  store: PublisherStore;
  /** Outcome of each new submission (default: every transaction succeeds). */
  outcome?: () => ReceiptOutcome;
};

const PUBLICATION_FIELDS = ["event", "resultsKey", "resultsHash", "bundleHash", "bundleUri"] as const;
const initial = (): PersistedPublisher => ({
  schemaVersion: 1,
  state: emptyPublicationState(),
  txs: [],
  nextSeq: 0,
  nextBlock: 1n,
});
const confirmedTx = (tx: MockTx): ConfirmedTx => ({
  txHash: tx.hash,
  blockNumber: tx.blockNumber!,
  blockHash: tx.blockHash!,
});

export class MockResultsPublisher implements ResultsPublisher {
  constructor(private readonly opts: MockResultsPublisherOptions) {}

  private async load(): Promise<PersistedPublisher> {
    return (await this.opts.store.load()) ?? initial();
  }

  /** Throws if `op` may not apply to `data` now. Overridable only by deliberately broken test doubles. */
  protected validate(op: PublisherOp, data: PersistedPublisher): void {
    const { state } = data;
    if (state.locked) throw new LockedError();
    const pending = data.txs.filter((t) => t.status === "pending");
    switch (op.kind) {
      case "setEventResults":
        if (state.eventResults) throw new AlreadyPublishedError("an event pointer is already set");
        if (pending.some((t) => t.op.kind === "setEventResults"))
          throw new AlreadyPublishedError("a publication is pending");
        return;
      case "declareWinner": {
        if (!state.eventResults)
          throw new StateMismatchError("declare winners only after the event results are published");
        for (const f of PUBLICATION_FIELDS) {
          if (op.input[f] !== state.eventResults[f])
            throw new StateMismatchError(`winner ${op.input.team} has a different ${f}`);
        }
        if (!isTeamLabel(op.input.team))
          throw new StateMismatchError(`${JSON.stringify(op.input.team)} is not a team label`);
        if (op.input.prizes.length === 0 || op.input.prizes.some((p) => p.trim() === "")) {
          throw new StateMismatchError(`winner ${op.input.team} needs at least one prize`);
        }
        const dup = (t: MockTx) => t.op.kind === "declareWinner" && t.op.input.team === op.input.team;
        if (state.winners[op.input.team] || pending.some(dup))
          throw new DuplicateDeclarationError(op.input.team);
        return;
      }
      case "lockResults":
        if (!state.eventResults)
          throw new StateMismatchError("nothing to lock: the event results are not published");
        if (pending.length > 0) throw new StateMismatchError("reconcile pending transactions before locking");
        if (!samePublicationState(op.expected, state))
          throw new StateMismatchError("the on-chain state differs from the expected state");
        return;
    }
  }

  private apply(op: PublisherOp, state: PublicationState): PublicationState {
    switch (op.kind) {
      case "setEventResults":
        return { ...state, eventResults: op.input };
      case "declareWinner":
        return { ...state, winners: { ...state.winners, [op.input.team]: op.input } };
      case "lockResults":
        return { ...state, locked: true };
    }
  }

  /** Confirm `tx` against the current state, or revert it if it no longer validates. */
  private confirm(data: PersistedPublisher, tx: MockTx): void {
    try {
      this.validate(tx.op, { ...data, txs: data.txs.filter((t) => t !== tx) });
    } catch {
      tx.status = "reverted";
      return;
    }
    data.state = this.apply(tx.op, data.state);
    tx.status = "confirmed";
    tx.blockNumber = data.nextBlock;
    tx.blockHash = canonicalHash({ mockBlock: data.nextBlock });
    data.nextBlock += 1n;
  }

  private async submit(op: PublisherOp): Promise<ConfirmedTx> {
    const data = await this.load();
    this.validate(op, data);
    const seq = data.nextSeq++;
    const tx: MockTx = {
      hash: canonicalHash({ seq, op }),
      seq,
      op,
      status: "pending",
      blockNumber: null,
      blockHash: null,
    };
    data.txs.push(tx);
    const outcome = this.opts.outcome?.() ?? "success";
    if (outcome === "success" || outcome === "crash-after-broadcast") this.confirm(data, tx);
    if (outcome === "revert") tx.status = "reverted";
    await this.opts.store.save(data);
    if (outcome === "crash-after-broadcast") throw new PublisherCrashError(tx.hash);
    if (tx.status === "reverted") throw new PublicationRevertedError(tx.hash);
    if (tx.status === "pending") throw new PublicationPendingError(tx.hash);
    return confirmedTx(tx);
  }

  async state(): Promise<PublicationState> {
    return structuredClone((await this.load()).state);
  }

  setEventResults(input: PublicationInput): Promise<ConfirmedTx> {
    return this.submit({ kind: "setEventResults", input: structuredClone(input) });
  }

  declareWinner(input: WinnerInput): Promise<ConfirmedTx> {
    return this.submit({ kind: "declareWinner", input: structuredClone(input) });
  }

  lockResults(expected: PublicationState): Promise<ConfirmedTx> {
    return this.submit({ kind: "lockResults", expected: structuredClone(expected) });
  }

  async reconcile(txHash: Hex): Promise<"pending" | "reverted" | ConfirmedTx> {
    const tx = (await this.load()).txs.find((t) => t.hash === txHash.toLowerCase());
    if (!tx) throw new UnknownTransactionError(txHash);
    return tx.status === "confirmed" ? confirmedTx(tx) : tx.status;
  }

  /** Test hook: mine or drop a pending transaction. */
  async settle(txHash: Hex, outcome: "success" | "revert"): Promise<void> {
    const data = await this.load();
    const tx = data.txs.find((t) => t.hash === txHash.toLowerCase());
    if (!tx) throw new UnknownTransactionError(txHash);
    if (tx.status !== "pending")
      throw new StateMismatchError(`transaction ${txHash} is already ${tx.status}`);
    if (outcome === "success") this.confirm(data, tx);
    else tx.status = "reverted";
    await this.opts.store.save(data);
  }
}
