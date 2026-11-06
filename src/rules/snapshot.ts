// The prepared ENS snapshot as the rules see it (B2.2-R5).
//
// `prepare` fetches every historical read the rules will need and records it as a
// `PreparedEnsEntry`; evaluation only looks entries up. A read that was not prepared throws
// `UnpreparedRead`: the rules never guess, and current state never stands in for a historical one.
import type { PreparedEnsEntry } from "@/shared/evidence/bundle";
import { isAddress, isHex, type Address, type Hex } from "@/shared/types/primitives";

/** One read the rules need. `unregisteredBetween` is keyed by its inclusive `[from, to]` range. */
export type EnsRead =
  | { query: "owner" | "expiry" | "registrationId" | "address"; label: string; block: bigint }
  | { query: "text"; label: string; block: bigint; key: string }
  | { query: "unregisteredBetween"; label: string; from: bigint; to: bigint };

export class UnpreparedRead extends Error {
  constructor(readonly read: EnsRead) {
    super(`ENS read ${describeRead(read)} was not prepared`);
    this.name = "UnpreparedRead";
  }
}

export class MalformedSnapshot extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedSnapshot";
  }
}

export const describeRead = (r: EnsRead): string =>
  r.query === "unregisteredBetween"
    ? `unregisteredBetween(${r.label}, ${r.from}, ${r.to})`
    : r.query === "text"
      ? `text(${r.label}, ${r.key}) at ${r.block}`
      : `${r.query}(${r.label}) at ${r.block}`;

/** The entry coordinates of a read: `(label, block, query, key)`. */
export function entryCoordinates(r: EnsRead): Pick<PreparedEnsEntry, "label" | "block" | "query" | "key"> {
  switch (r.query) {
    case "unregisteredBetween":
      return { label: r.label, block: r.from, query: r.query, key: r.to.toString() };
    case "text":
      return { label: r.label, block: r.block, query: r.query, key: r.key };
    default:
      return { label: r.label, block: r.block, query: r.query, key: "" };
  }
}

const idOf = (c: Pick<PreparedEnsEntry, "label" | "block" | "query" | "key">) =>
  `${c.query}\u0000${c.label}\u0000${c.block}\u0000${c.key}`;
export const readId = (r: EnsRead): string => idOf(entryCoordinates(r));

/** Encode a reader's answer as an entry `result`. */
export function encodeResult(r: EnsRead, value: Address | Hex | bigint | string | boolean | null) {
  if (value === null) return null;
  if (r.query === "expiry") return (value as bigint).toString();
  if (r.query === "owner" || r.query === "address" || r.query === "registrationId")
    return (value as string).toLowerCase();
  return value as string | boolean;
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function checkResult(e: PreparedEnsEntry): void {
  const bad = (what: string) => new MalformedSnapshot(`${e.query}(${e.label}) at ${e.block}: ${what}`);
  const r = e.result;
  switch (e.query) {
    case "owner":
    case "address":
      if (r !== null && !(typeof r === "string" && isAddress(r) && r === r.toLowerCase()))
        throw bad("result must be a lowercase address or null");
      break;
    case "registrationId":
      if (r !== null && !(typeof r === "string" && isHex(r, 32) && r === r.toLowerCase()))
        throw bad("result must be lowercase 32-byte hex or null");
      break;
    case "expiry":
      if (r !== null && !(typeof r === "string" && DECIMAL.test(r)))
        throw bad("result must be a decimal string or null");
      break;
    case "text":
      if (r !== null && typeof r !== "string") throw bad("result must be a string or null");
      break;
    case "unregisteredBetween":
      if (typeof r !== "boolean" || !DECIMAL.test(e.key))
        throw bad("result must be a boolean over [block, key]");
      break;
    case "sepoliaBlockAt":
      break; // read by TimeMap
  }
}

/** A lookup view over prepared entries. */
export class EnsSnapshot {
  private constructor(private readonly byId: ReadonlyMap<string, PreparedEnsEntry["result"]>) {}

  static from(entries: readonly PreparedEnsEntry[]): EnsSnapshot {
    const map = new Map<string, PreparedEnsEntry["result"]>();
    for (const e of entries) {
      if (e.query === "sepoliaBlockAt") continue;
      checkResult(e);
      const id = idOf(e);
      if (map.has(id) && map.get(id) !== e.result)
        throw new MalformedSnapshot(`conflicting entries for ${e.query}(${e.label}) at ${e.block}`);
      map.set(id, e.result);
    }
    return new EnsSnapshot(map);
  }

  private get(r: EnsRead): PreparedEnsEntry["result"] {
    const id = readId(r);
    if (!this.byId.has(id)) throw new UnpreparedRead(r);
    return this.byId.get(id)!;
  }

  owner(label: string, block: bigint): Address | null {
    return this.get({ query: "owner", label, block }) as Address | null;
  }
  expiry(label: string, block: bigint): bigint | null {
    const v = this.get({ query: "expiry", label, block });
    return v === null ? null : BigInt(v as string);
  }
  registrationId(label: string, block: bigint): Hex | null {
    return this.get({ query: "registrationId", label, block }) as Hex | null;
  }
  text(label: string, key: string, block: bigint): string | null {
    return this.get({ query: "text", label, block, key }) as string | null;
  }
  unregisteredBetween(label: string, from: bigint, to: bigint): boolean {
    return this.get({ query: "unregisteredBetween", label, from, to }) as boolean;
  }
}
