// MockEnsReader (plans/P0-foundation.md › P0.3-R1): answers EnsReader calls by replaying
// fixtures/ens-history.json up to the requested block on the fixtures/timeline.json mock chain.
// Reads are block-end state. Until I2 it stands in for A2.4's SepoliaEnsReader, and both must
// pass runEnsReaderConformance.
import { registrationIdOf } from "../ens/registration-id";
import { ancestorsOf, registryOf, type EnsEvent, type EnsHistory } from "../fixtures/ens-history";
import { blockAtTimestamp, timestampOfBlock, type Timeline } from "../fixtures/timeline";
import { EnsReadError, type AtBlock, type EnsReader } from "../interfaces/ens-reader";
import { normalizeLabel } from "../labels";
import type { Address, Hex, Label } from "../types/primitives";

type Registration = { owner: Address; expiry: bigint; resource: Hex };
type NameState = { registration: Registration | null; addr: Address | null; text: Map<string, string> };

export type MockEnsReaderOptions = {
  history: EnsHistory;
  timeline: Timeline;
  /** Make a method fail like a broken RPC (conformance and error-path tests). */
  fail?: (method: keyof EnsReader) => boolean;
};

export class MockEnsReader implements EnsReader {
  private readonly byLabel = new Map<string, EnsEvent[]>();

  constructor(private readonly opts: MockEnsReaderOptions) {
    for (const e of opts.history.events) {
      const list = this.byLabel.get(e.label) ?? [];
      list.push(e);
      this.byLabel.set(e.label, list);
    }
  }

  private guard(method: keyof EnsReader, block?: bigint): void {
    if (this.opts.fail?.(method)) throw new EnsReadError(method, "mock RPC failure");
    if (block !== undefined && block > this.opts.timeline.head) {
      throw new EnsReadError(method, `block ${block} is beyond the head ${this.opts.timeline.head}`);
    }
    if (block !== undefined && block < this.opts.timeline.genesis.block) {
      throw new EnsReadError(method, `block ${block} is before genesis`);
    }
  }

  private stateAt(label: Label, block: bigint): NameState {
    const state: NameState = { registration: null, addr: null, text: new Map() };
    for (const e of this.byLabel.get(label) ?? []) {
      if (e.block > block) break;
      switch (e.type) {
        case "register":
          state.registration = { owner: e.owner, expiry: e.expiry, resource: e.resource };
          break;
        case "renew":
          if (state.registration) state.registration = { ...state.registration, expiry: e.expiry };
          break;
        case "unregister":
          state.registration = null;
          break;
        case "setText":
          if (e.value === null) state.text.delete(e.key);
          else state.text.set(e.key, e.value);
          break;
        case "setAddr":
          state.addr = e.address;
          break;
        case "setRoles":
          break; // roles never change ownership or registration identity
      }
    }
    return state;
  }

  /** Registered and unexpired at the block's timestamp: a name is invalid at exactly its expiry. */
  private live(label: Label, block: bigint): Registration | null {
    const reg = this.stateAt(label, block).registration;
    return reg && reg.expiry > timestampOfBlock(this.opts.timeline, block) ? reg : null;
  }

  private ownerAt(label: Label, block: bigint): Address | null {
    const reg = this.live(label, block);
    if (!reg) return null;
    for (const ancestor of ancestorsOf(label)) if (!this.live(ancestor, block)) return null;
    return reg.owner;
  }

  async owner(label: Label, at: AtBlock): Promise<Address | null> {
    this.guard("owner", at.sepoliaBlock);
    return this.ownerAt(normalizeLabel(label), at.sepoliaBlock);
  }

  async address(label: Label, at: AtBlock): Promise<Address | null> {
    this.guard("address", at.sepoliaBlock);
    const l = normalizeLabel(label);
    return this.ownerAt(l, at.sepoliaBlock) ? this.stateAt(l, at.sepoliaBlock).addr : null;
  }

  async text(label: Label, key: string, at: AtBlock): Promise<string | null> {
    this.guard("text", at.sepoliaBlock);
    const l = normalizeLabel(label);
    // Resolver text survives reissue: an old note stays readable but its binding no longer matches.
    return this.ownerAt(l, at.sepoliaBlock) ? (this.stateAt(l, at.sepoliaBlock).text.get(key) ?? null) : null;
  }

  async expiry(label: Label, at: AtBlock): Promise<bigint | null> {
    this.guard("expiry", at.sepoliaBlock);
    return this.stateAt(normalizeLabel(label), at.sepoliaBlock).registration?.expiry ?? null;
  }

  async registrationId(label: Label, at: AtBlock): Promise<Hex | null> {
    this.guard("registrationId", at.sepoliaBlock);
    const l = normalizeLabel(label);
    if (!this.ownerAt(l, at.sepoliaBlock)) return null;
    const reg = this.stateAt(l, at.sepoliaBlock).registration!;
    return registrationIdOf({
      chainId: this.opts.history.chainId,
      registry: registryOf(this.opts.history, l),
      resource: reg.resource,
    });
  }

  async unregisteredBetween(label: Label, from: bigint, to: bigint): Promise<boolean> {
    this.guard("unregisteredBetween", to >= from ? to : undefined);
    if (from > to) return false;
    const events = this.byLabel.get(normalizeLabel(label)) ?? [];
    let registered = false;
    for (const e of events) {
      const inRange = e.block >= from && e.block <= to;
      if (e.type === "unregister") {
        if (inRange) return true;
        registered = false;
      } else if (e.type === "register") {
        if (inRange && registered) return true; // re-registration over a live registration is a new identity
        registered = true;
      }
    }
    return false;
  }

  async sepoliaBlockAt(unixSeconds: bigint): Promise<bigint> {
    this.guard("sepoliaBlockAt");
    let block: bigint;
    try {
      block = blockAtTimestamp(this.opts.timeline, unixSeconds);
    } catch (e) {
      throw new EnsReadError("sepoliaBlockAt", (e as Error).message);
    }
    return block > this.opts.timeline.head ? this.opts.timeline.head : block;
  }

  async headBlock(): Promise<bigint> {
    this.guard("headBlock");
    return this.opts.timeline.head;
  }
}
