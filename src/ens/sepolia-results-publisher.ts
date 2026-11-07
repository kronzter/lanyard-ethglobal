// SepoliaResultsPublisher (A4.2): the real ResultsPublisher over WinnerRegistrar. For the local freeze
// CLI only; app code never imports it (enforced by sepolia-results-publisher.boundary.test.ts).
//
// - state() is rebuilt from contract views at one block, so a new instance (a CLI restart) sees exactly
//   what is on chain.
// - Every write validates against that state, simulates, signs locally with the results wallet, and
//   saves the exact raw transaction, its hash and nonce to the injected journal BEFORE broadcasting.
//   It then waits for a successful receipt with the configured confirmations.
// - A missing receipt never authorizes a resend: a journalled transaction without a final receipt
//   blocks every write it could conflict with until reconcile() settles it. reconcile() reads the chain
//   and the journal and never sends anything; rebroadcast() may resend only the identical saved bytes.
// - Prizes: the input must already be canonical (non-empty, sorted, duplicate-free subset of
//   `runner-up`, `winner`). Unsorted input is rejected rather than reordered, so the declared payload
//   hash, the frozen bundle's prize input and state() all hold the exact bytes the caller passed.
// - Prepared publication (PreparedResultsPublisher, for the resumable freeze job): prepare() runs the
//   same validation, then signs and journals without broadcasting; asking again for an identical
//   unresolved operation returns the saved bytes/hash/nonce. broadcastPrepared() sends only those
//   journalled bytes, adopts a confirmed receipt and refuses pending, tampered or unknown ones.
// - lockResults(expected) compares `expected` with the on-chain state, then passes the contract the
//   state hash computed locally from `expected`; the contract refuses if its own state differs.
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseTransaction,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from "viem";
import { z } from "zod";
import { canonicalJson, parseJsonStrict } from "../shared/canonical";
import {
  AlreadyPublishedError,
  DuplicateDeclarationError,
  LockedError,
  PublicationError,
  PublicationPendingError,
  PublicationRevertedError,
  StateMismatchError,
  UnknownTransactionError,
  samePublicationState,
  type ConfirmedTx,
  type PreparedPublication,
  type PreparedResultsPublisher,
  type PublicationInput,
  type PublicationOperation,
  type PublicationState,
  type WinnerInput,
} from "../shared/interfaces/results-publisher";
import { isTeamLabel } from "../shared/labels";
import {
  PRIZES,
  declarationHashOf,
  eventHashOf,
  stateHashOf,
  toChainPublication,
  toChainWinner,
  winnerRegistrarAbi,
} from "./winner-registrar-abi";

/** Durable text storage for the journal; the CLI backs it with a file it fsyncs. */
export type PublisherJournalIO = {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
};

type Op = "setEventResults" | "declareWinner" | "lockResults";
/** signed: saved, maybe not broadcast. broadcast: the node accepted it. dropped: its nonce was used by another transaction. */
type Status = "signed" | "broadcast" | "confirmed" | "reverted" | "dropped";
const OPEN: readonly Status[] = ["signed", "broadcast"];

const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const EntrySchema = z
  .object({
    hash: hex32,
    nonce: z.number().int().nonnegative(),
    raw: z.string().regex(/^0x[0-9a-f]+$/),
    op: z.enum(["setEventResults", "declareWinner", "lockResults"]),
    team: z.string().nullable(),
    /** eventHash, declarationHash or the expected stateHash: the complete payload commitment. */
    payloadHash: hex32,
    status: z.enum(["signed", "broadcast", "confirmed", "reverted", "dropped"]),
    blockNumber: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .nullable(),
    blockHash: hex32.nullable(),
  })
  .strict();
const JournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    chainId: z.number().int().positive(),
    contract: z.string().regex(/^0x[0-9a-f]{40}$/),
    wallet: z.string().regex(/^0x[0-9a-f]{40}$/),
    entries: z.array(EntrySchema),
  })
  .strict();
type Entry = z.infer<typeof EntrySchema>;
type Journal = z.infer<typeof JournalSchema>;

export type SepoliaResultsPublisherOptions = {
  client: PublicClient;
  /** The configured results wallet; it signs locally so the raw bytes can be journalled first. */
  account: LocalAccount;
  /** The deployed WinnerRegistrar. */
  contract: Address;
  journal: PublisherJournalIO;
  /** Block depth a receipt needs before it counts as confirmed (event config's Sepolia confirmations). */
  confirmations: number;
  /** How long a write waits for its confirmed receipt before throwing PublicationPendingError. */
  receiptTimeoutMs?: number;
  /** Delay between receipt polls (default 4 s). */
  pollingIntervalMs?: number;
  /** Expected chain (default Sepolia, 11155111). */
  chainId?: number;
  /** Gas limit = estimate × (100 + margin) / 100 (default 25). */
  gasMarginPercent?: number;
};

/** A canonical, non-empty, duplicate-free, sorted subset of the two prizes, or the reason it is not. */
export function prizeProblem(prizes: readonly string[]): string | null {
  if (prizes.length === 0) return "needs at least one prize";
  for (const p of prizes)
    if (!(PRIZES as readonly string[]).includes(p))
      return `has unknown prize ${JSON.stringify(p)} (only ${PRIZES.join(", ")})`;
  for (let i = 1; i < prizes.length; i++)
    if (PRIZES.indexOf(prizes[i] as never) <= PRIZES.indexOf(prizes[i - 1] as never))
      return `prizes must be sorted and duplicate-free (${PRIZES.join(" before ")})`;
  return null;
}

const PUBLICATION_FIELDS = ["event", "resultsKey", "resultsHash", "bundleHash", "bundleUri"] as const;
const lower = (a: string) => a.toLowerCase() as Hex;

type Current = { state: PublicationState; open: Entry[] };
/** A validated operation: what the journal records about it, plus its calldata. */
type Planned = { op: Op; team: string | null; payloadHash: Hex; data: Hex };

/** The journal identity of an operation: its kind, team and complete payload commitment. */
function identify(op: PublicationOperation): Omit<Planned, "data"> {
  switch (op.kind) {
    case "setEventResults":
      return { op: op.kind, team: null, payloadHash: eventHashOf(op.input) };
    case "declareWinner":
      return { op: op.kind, team: op.input.team, payloadHash: declarationHashOf(op.input) };
    case "lockResults":
      return { op: op.kind, team: null, payloadHash: stateHashOf(op.expected) };
  }
}

const preparedOf = (e: Entry): PreparedPublication => ({
  rawTransaction: e.raw as Hex,
  txHash: e.hash as Hex,
  nonce: BigInt(e.nonce),
});

export class SepoliaResultsPublisher implements PreparedResultsPublisher {
  private readonly contract: Address;
  private readonly chainId: number;

  constructor(private readonly opts: SepoliaResultsPublisherOptions) {
    if (!Number.isInteger(opts.confirmations) || opts.confirmations < 1)
      throw new Error("confirmations must be a positive integer");
    this.contract = getAddress(opts.contract);
    this.chainId = opts.chainId ?? 11_155_111;
  }

  // ── Journal ────────────────────────────────────────────────────────────────

  private async loadJournal(): Promise<Journal> {
    const text = await this.opts.journal.read();
    const fresh: Journal = {
      schemaVersion: 1,
      chainId: this.chainId,
      contract: lower(this.contract),
      wallet: lower(this.opts.account.address),
      entries: [],
    };
    if (text === null) return fresh;
    const j = JournalSchema.parse(parseJsonStrict(text));
    if (j.chainId !== fresh.chainId || j.contract !== fresh.contract || j.wallet !== fresh.wallet)
      throw new PublicationError(
        "journal-mismatch",
        "the publisher journal belongs to another chain, contract or results wallet",
      );
    return j;
  }

  private async saveJournal(j: Journal): Promise<void> {
    await this.opts.journal.write(canonicalJson(j));
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  private read<T>(functionName: string, args: readonly unknown[], blockNumber: bigint): Promise<T> {
    return this.opts.client.readContract({
      address: this.contract,
      abi: winnerRegistrarAbi,
      functionName,
      args,
      blockNumber,
    } as never) as Promise<T>;
  }

  async state(): Promise<PublicationState> {
    const block = await this.opts.client.getBlockNumber({ cacheTime: 0 });
    const [[set, e], teams, locked] = await Promise.all([
      this.read<
        [boolean, { edition: string; resultsKey: Hex; resultsHash: Hex; bundleHash: Hex; bundleUri: string }]
      >("eventResults", [], block),
      this.read<readonly string[]>("declaredTeams", [], block),
      this.read<boolean>("locked", [], block),
    ]);
    const winners: Record<string, WinnerInput> = {};
    for (const team of teams) {
      const w = await this.read<{
        edition: string;
        resultsKey: Hex;
        resultsHash: Hex;
        bundleHash: Hex;
        bundleUri: string;
        team: string;
        prizes: readonly string[];
      }>("winner", [team], block);
      winners[team] = {
        event: w.edition,
        resultsKey: lower(w.resultsKey),
        resultsHash: lower(w.resultsHash),
        bundleHash: lower(w.bundleHash),
        bundleUri: w.bundleUri,
        team: w.team,
        prizes: [...w.prizes],
      };
    }
    return {
      eventResults: set
        ? {
            event: e.edition,
            resultsKey: lower(e.resultsKey),
            resultsHash: lower(e.resultsHash),
            bundleHash: lower(e.bundleHash),
            bundleUri: e.bundleUri,
          }
        : null,
      winners,
      locked,
    };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async setEventResults(input: PublicationInput): Promise<ConfirmedTx> {
    return this.write({ kind: "setEventResults", input });
  }

  async declareWinner(input: WinnerInput): Promise<ConfirmedTx> {
    return this.write({ kind: "declareWinner", input });
  }

  async lockResults(expected: PublicationState): Promise<ConfirmedTx> {
    return this.write({ kind: "lockResults", expected });
  }

  /** Validate, sign and journal, then broadcast and wait: the one-call path. */
  private async write(op: PublicationOperation): Promise<ConfirmedTx> {
    const planned = this.validate(op, await this.current());
    const { journal, entry } = await this.sign(planned);
    return this.send(journal, entry);
  }

  /** Refuses `op` unless it may apply to the current state with nothing conflicting pending. */
  private validate(op: PublicationOperation, { state, open }: Current): Planned {
    switch (op.kind) {
      case "setEventResults": {
        const { input } = op;
        if (state.eventResults) throw new AlreadyPublishedError("an event pointer is already set");
        if (open.some((e) => e.op === "setEventResults"))
          throw new AlreadyPublishedError("a publication is pending; reconcile it");
        if (input.event.length === 0) throw new StateMismatchError("the publication names no event");
        const data = encodeFunctionData({
          abi: winnerRegistrarAbi,
          functionName: "setEventResults",
          args: [toChainPublication(input)],
        });
        return { ...identify(op), data };
      }
      case "declareWinner": {
        const { input } = op;
        if (!state.eventResults)
          throw new StateMismatchError("declare winners only after the event results are published");
        for (const f of PUBLICATION_FIELDS)
          if (input[f] !== state.eventResults[f])
            throw new StateMismatchError(`winner ${input.team} has a different ${f}`);
        if (!isTeamLabel(input.team))
          throw new StateMismatchError(`${JSON.stringify(input.team)} is not a team label`);
        const problem = prizeProblem(input.prizes);
        if (problem) throw new PublicationError("invalid-prizes", `winner ${input.team} ${problem}`);
        if (state.winners[input.team] || open.some((e) => e.op === "declareWinner" && e.team === input.team))
          throw new DuplicateDeclarationError(input.team);
        for (const prize of input.prizes) {
          const holder = Object.values(state.winners).find((w) => w.prizes.includes(prize));
          if (holder) throw new StateMismatchError(`prize ${prize} is already awarded to ${holder.team}`);
        }
        const data = encodeFunctionData({
          abi: winnerRegistrarAbi,
          functionName: "declare",
          args: [toChainWinner(input)],
        });
        return { ...identify(op), data };
      }
      case "lockResults": {
        const { expected } = op;
        if (!state.eventResults)
          throw new StateMismatchError("nothing to lock: the event results are not published");
        if (open.length > 0) throw new StateMismatchError("reconcile pending transactions before locking");
        for (const [team, w] of Object.entries(expected.winners))
          if (w.team !== team)
            throw new StateMismatchError(`expected winner record ${team} names team ${w.team}`);
        if (expected.locked || !samePublicationState({ ...expected, locked: false }, state))
          throw new StateMismatchError("the on-chain state differs from the expected state");
        const planned = identify(op);
        const data = encodeFunctionData({
          abi: winnerRegistrarAbi,
          functionName: "lockResults",
          args: [planned.payloadHash],
        });
        return { ...planned, data };
      }
    }
  }

  /** Current state plus the journal entries without a final outcome, after refreshing them from chain. */
  private async current(): Promise<Current> {
    await this.checkChain();
    const journal = await this.loadJournal();
    await this.refreshOpen(journal);
    const state = await this.state();
    if (state.locked) throw new LockedError();
    return { state, open: journal.entries.filter((e) => OPEN.includes(e.status)) };
  }

  private async checkChain(): Promise<void> {
    const chainId = await this.opts.client.getChainId();
    if (chainId !== this.chainId) throw new PublicationError("wrong-chain", `RPC reports chain ${chainId}`);
  }

  private async refreshOpen(journal: Journal): Promise<void> {
    let changed = false;
    for (const e of journal.entries) {
      if (!OPEN.includes(e.status)) continue;
      const before = e.status;
      await this.refresh(e);
      changed ||= e.status !== before;
    }
    if (changed) await this.saveJournal(journal);
  }

  /** Simulate, sign locally and journal the exact bytes. Nothing leaves this machine. */
  private async sign({ op, team, payloadHash, data }: Planned): Promise<{ journal: Journal; entry: Entry }> {
    const { client, account } = this.opts;
    await this.simulate(data, team); // a revert here signs nothing
    const journal = await this.loadJournal();
    const [gas, fees, chainNonce] = await Promise.all([
      client.estimateGas({ account: account.address, to: this.contract, data }),
      client.estimateFeesPerGas(),
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    ]);
    const journalNonce = journal.entries
      .filter((e) => OPEN.includes(e.status))
      .reduce((n, e) => Math.max(n, e.nonce + 1), 0);
    const nonce = Math.max(chainNonce, journalNonce);
    const raw = await account.signTransaction({
      type: "eip1559",
      chainId: this.chainId,
      to: this.contract,
      data,
      nonce,
      gas: (gas * BigInt(100 + (this.opts.gasMarginPercent ?? 25))) / 100n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const entry: Entry = {
      hash: keccak256(raw),
      nonce,
      raw: lower(raw),
      op,
      team,
      payloadHash,
      status: "signed",
      blockNumber: null,
      blockHash: null,
    };
    journal.entries.push(entry);
    await this.saveJournal(journal); // durable before the bytes can leave this machine
    return { journal, entry };
  }

  private async simulate(data: Hex, team: string | null): Promise<void> {
    try {
      await this.opts.client.call({ account: this.opts.account.address, to: this.contract, data });
    } catch (err) {
      throw mapRevert(err, team);
    }
  }

  /** Broadcast a journalled `signed` entry's saved bytes and wait for its confirmed receipt. */
  private async send(journal: Journal, entry: Entry): Promise<ConfirmedTx> {
    const { client } = this.opts;
    const hash = entry.hash as Hex;
    try {
      const accepted = await client.request({ method: "eth_sendRawTransaction", params: [entry.raw as Hex] });
      if (lower(accepted) !== hash) throw new Error(`node returned hash ${accepted}, expected ${hash}`);
    } catch {
      // The node may or may not have the transaction: never resend, reconcile it.
      throw new PublicationPendingError(hash);
    }
    entry.status = "broadcast";
    await this.saveJournal(journal);

    // Poll the receipt directly rather than watching for new blocks: a node that mines on demand (or
    // stalls) produces no later block, and the outcome is decided by reconcile() either way.
    const deadline = Date.now() + (this.opts.receiptTimeoutMs ?? 30 * 60_000);
    let outcome = await this.reconcile(hash);
    while (outcome === "pending" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.opts.pollingIntervalMs ?? 4_000));
      outcome = await this.reconcile(hash);
    }
    if (outcome === "pending") throw new PublicationPendingError(hash);
    if (outcome === "reverted") throw new PublicationRevertedError(hash);
    return outcome;
  }

  // ── Prepared publication (the resumable freeze job) ────────────────────────

  /** Journalled transactions without a final outcome: signed-but-unsent, or broadcast-but-unconfirmed. */
  async pendingTransactions(): Promise<Hex[]> {
    await this.checkChain();
    const journal = await this.loadJournal();
    await this.refreshOpen(journal);
    return journal.entries.filter((e) => OPEN.includes(e.status)).map((e) => e.hash as Hex);
  }

  /**
   * Sign and journal `op` without broadcasting. If an identical operation is already journalled and
   * unresolved, return its saved bytes, hash and nonce instead: a restart never allocates a new nonce.
   */
  async prepare(op: PublicationOperation): Promise<PreparedPublication> {
    const ctx = await this.current();
    const { op: kind, team, payloadHash } = identify(op);
    const same = ctx.open.find((e) => e.op === kind && e.team === team && e.payloadHash === payloadHash);
    if (same) return preparedOf(same);
    const { entry } = await this.sign(this.validate(op, ctx));
    return preparedOf(entry);
  }

  /**
   * Broadcast exactly the journalled bytes of `tx`. A confirmed entry is adopted without sending; a
   * broadcast-but-unconfirmed one throws PublicationPendingError (reconcile it, never resend); bytes,
   * hash or nonce that differ from the journal are refused before anything is sent.
   */
  async broadcastPrepared(tx: PreparedPublication): Promise<ConfirmedTx> {
    const hash = lower(tx.txHash);
    if (!/^0x([0-9a-fA-F]{2})+$/.test(tx.rawTransaction) || keccak256(tx.rawTransaction) !== hash)
      throw new StateMismatchError("prepared publication bytes do not hash to its transaction hash");
    await this.checkChain();
    const journal = await this.loadJournal();
    const entry = journal.entries.find((e) => e.hash === hash);
    if (!entry || entry.raw !== lower(tx.rawTransaction) || BigInt(entry.nonce) !== tx.nonce)
      throw new StateMismatchError("prepared publication bytes/hash/nonce differ from the journal");
    const before = entry.status;
    await this.refresh(entry);
    if (entry.status !== before) await this.saveJournal(journal);
    switch (entry.status) {
      case "confirmed": {
        const r = await this.receiptOutcome(hash);
        if (typeof r === "object") return r;
        throw new PublicationPendingError(hash);
      }
      case "reverted":
      case "dropped":
        throw new PublicationRevertedError(hash);
      case "broadcast":
        throw new PublicationPendingError(hash);
      case "signed":
        await this.simulate(parseTransaction(entry.raw as Hex).data ?? "0x", entry.team);
        return this.send(journal, entry);
    }
  }

  async preparedStatus(txHash: Hex): Promise<"prepared" | "pending" | "reverted" | ConfirmedTx> {
    const hash = lower(txHash);
    await this.checkChain();
    const journal = await this.loadJournal();
    const entry = journal.entries.find((e) => e.hash === hash);
    if (!entry) throw new UnknownTransactionError(txHash);
    const before = entry.status;
    await this.refresh(entry);
    if (entry.status !== before) await this.saveJournal(journal);
    switch (entry.status) {
      case "signed":
        return "prepared";
      case "broadcast":
        return "pending";
      case "reverted":
      case "dropped":
        return "reverted";
      case "confirmed": {
        const r = await this.receiptOutcome(hash);
        return typeof r === "object" ? r : "pending";
      }
    }
  }

  // ── Reconciliation ─────────────────────────────────────────────────────────

  /** Update a journal entry's status from the chain. Never sends anything. */
  private async refresh(e: Entry): Promise<void> {
    const r = await this.receiptOutcome(e.hash as Hex);
    if (r === "unknown") {
      // Not mined and not in the node's pool: dropped only if its nonce is used by another transaction.
      const mined = await this.opts.client.getTransactionCount({
        address: this.opts.account.address,
        blockTag: "latest",
      });
      if (mined > e.nonce) e.status = "dropped";
      return;
    }
    if (r === "pending") {
      if (e.status === "signed") e.status = "broadcast";
      return;
    }
    if (r === "reverted") e.status = "reverted";
    else {
      e.status = "confirmed";
      e.blockNumber = r.blockNumber.toString();
      e.blockHash = r.blockHash;
    }
  }

  private async receiptOutcome(hash: Hex): Promise<"unknown" | "pending" | "reverted" | ConfirmedTx> {
    const { client } = this.opts;
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (!receipt) {
      const tx = await client.getTransaction({ hash }).catch(() => null);
      return tx ? "pending" : "unknown";
    }
    if (receipt.status !== "success") return "reverted";
    const head = await client.getBlockNumber({ cacheTime: 0 });
    if (head - receipt.blockNumber + 1n < BigInt(this.opts.confirmations)) return "pending";
    // Still canonical: the block at that height is the receipt's block.
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (lower(block.hash) !== lower(receipt.blockHash)) return "pending";
    return { txHash: lower(hash), blockNumber: receipt.blockNumber, blockHash: lower(receipt.blockHash) };
  }

  async reconcile(txHash: Hex): Promise<"pending" | "reverted" | ConfirmedTx> {
    const hash = lower(txHash);
    const journal = await this.loadJournal();
    const entry = journal.entries.find((e) => e.hash === hash);
    if (!entry) {
      // Not ours: report only what the chain proves.
      const r = await this.receiptOutcome(hash);
      if (r === "unknown") throw new UnknownTransactionError(txHash);
      return r;
    }
    const before = entry.status;
    await this.refresh(entry);
    if (entry.status !== before) await this.saveJournal(journal);
    switch (entry.status) {
      case "confirmed": {
        const r = await this.receiptOutcome(hash);
        return r === "unknown" ? "pending" : r;
      }
      case "reverted":
      case "dropped":
        return "reverted";
      default:
        return "pending";
    }
  }

  /**
   * Re-broadcast the identical saved bytes of an unresolved journal entry (same nonce, same hash), e.g.
   * after the node forgot it. This is never a new transaction, so it cannot double-publish.
   */
  async rebroadcast(txHash: Hex): Promise<void> {
    const journal = await this.loadJournal();
    const entry = journal.entries.find((e) => e.hash === lower(txHash));
    if (!entry) throw new UnknownTransactionError(txHash);
    if (!OPEN.includes(entry.status))
      throw new StateMismatchError(`transaction ${txHash} is already ${entry.status}`);
    await this.opts.client.request({ method: "eth_sendRawTransaction", params: [entry.raw as Hex] });
    entry.status = "broadcast";
    await this.saveJournal(journal);
  }
}

/** Map a simulation revert to the shared error classes. */
function mapRevert(err: unknown, team: string | null): Error {
  const revert =
    err instanceof BaseError
      ? (err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null)
      : null;
  let name = revert?.data?.errorName;
  if (!name && err instanceof BaseError) {
    const data = (
      err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null
    )?.data;
    if (data) {
      try {
        name = decodeErrorResult({ abi: winnerRegistrarAbi, data }).errorName;
      } catch {
        // not one of ours
      }
    }
  }
  const detail = err instanceof BaseError ? err.shortMessage : String(err);
  switch (name) {
    case "ResultsLocked":
      return new LockedError();
    case "EventResultsAlreadySet":
      return new AlreadyPublishedError("the contract already holds an event pointer");
    case "AlreadyDeclared":
      return new DuplicateDeclarationError(team ?? "?");
    case "EventResultsNotSet":
    case "PublicationMismatch":
    case "StateMismatch":
    case "PrizeAlreadyAwarded":
    case "WrongEdition":
      return new StateMismatchError(`simulation reverted with ${name}`);
    default:
      return new PublicationError("simulation-reverted", `simulation reverted: ${name ?? detail}`);
  }
}
