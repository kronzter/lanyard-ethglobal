// Historical ENS reads (plans/01-evidence-and-interfaces.md §3). Implemented by the mock here
// and by A2.4's SepoliaEnsReader; both must pass runEnsReaderConformance.
import type { Address, Hex, Label } from "../types/primitives";

/** A point in Sepolia history. Reads are block-end state: they include that block's events. */
export type AtBlock = { sepoliaBlock: bigint };

export interface EnsReader {
  /**
   * Registry owner of `label`, following the registry hierarchy: null unless the name and every
   * ancestor is registered and unexpired at the block. Never uses resolver address records.
   */
  owner(label: Label, at: AtBlock): Promise<Address | null>;
  /** Forward-resolved address record. For display only; never authorization. */
  address(label: Label, at: AtBlock): Promise<Address | null>;
  text(label: Label, key: string, at: AtBlock): Promise<string | null>;
  /** Expiry (Unix seconds) of the label's current registration; a name is invalid at exactly its expiry. */
  expiry(label: Label, at: AtBlock): Promise<bigint | null>;
  /**
   * Stable identity of the current registration: null whenever `owner` is null. Changes on
   * unregister/re-registration, never on renewal or role changes. Never the mutable token ID.
   */
  registrationId(label: Label, at: AtBlock): Promise<Hex | null>;
  /**
   * True if the label was unregistered or re-registered in blocks `[from, to]`, both endpoints
   * inclusive. An empty interval (`from > to`) is false. RPC or log-range failures throw.
   */
  unregisteredBetween(label: Label, from: bigint, to: bigint): Promise<boolean>;
  /** Latest block whose timestamp is at or before `unixSeconds`. */
  sepoliaBlockAt(unixSeconds: bigint): Promise<bigint>;
  headBlock(): Promise<bigint>;
}

/** Thrown for any failed read. Readers never turn a failure into "no name". */
export class EnsReadError extends Error {
  constructor(
    readonly method: string,
    cause: string,
  ) {
    super(`EnsReader.${method} failed: ${cause}`);
    this.name = "EnsReadError";
  }
}
