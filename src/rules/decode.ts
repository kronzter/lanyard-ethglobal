// Decode a captured observation's attributes into typed values (B2.2).
//
// Capture keeps every attribute exactly as read: its Arkiv type tag and canonical string value
// (bytes columns too; the observation payload is "0x"). Decoding is strict: a value that does not
// match its declared type makes the record undecodable, so it is shown with a reason and never
// counts. Nothing here trusts the record's own claims about who wrote it.
import type { CapturedObservation } from "@/shared/evidence/observation";
import { isAddress, isHex, type Address, type Hex } from "@/shared/types/primitives";

export type AttrValue =
  | { type: "str" | "dec"; value: string }
  | { type: "u64" | "u256" | "i32"; value: bigint }
  | { type: "bool"; value: boolean }
  | { type: "addr"; value: Address }
  | { type: "key" | "bytes"; value: Hex };

export type DecodedRecord = {
  readonly obs: CapturedObservation;
  readonly key: Hex;
  readonly kind: string;
  readonly creator: Address;
  /** The writer's claimed label; descriptive for authority kinds, a badge for badge kinds. */
  readonly byLabel: string | undefined;
  readonly attrs: ReadonlyMap<string, AttrValue>;
};

export type DecodeResult = { ok: true; record: DecodedRecord } | { ok: false; reason: string };

const UNSIGNED = /^(0|[1-9][0-9]*)$/;
const SIGNED = /^(0|-?[1-9][0-9]*)$/;
const U64_MAX = (1n << 64n) - 1n;
const U256_MAX = (1n << 256n) - 1n;
const lower = (s: string) => s === s.toLowerCase();

function decodeOne(type: string, raw: string): AttrValue | null {
  switch (type) {
    case "str":
    case "dec":
      return { type, value: raw };
    case "u64":
    case "u256": {
      if (!UNSIGNED.test(raw)) return null;
      const v = BigInt(raw);
      return v <= (type === "u64" ? U64_MAX : U256_MAX) ? { type, value: v } : null;
    }
    case "i32": {
      if (!SIGNED.test(raw)) return null;
      const v = BigInt(raw);
      return v >= -(1n << 31n) && v < 1n << 31n ? { type, value: v } : null;
    }
    case "bool":
      return raw === "true" || raw === "false" ? { type, value: raw === "true" } : null;
    case "addr":
      return isAddress(raw) && lower(raw) ? { type, value: raw } : null;
    case "key":
      return isHex(raw, 32) && lower(raw) ? { type, value: raw } : null;
    case "bytes":
      return isHex(raw) && lower(raw) && raw.length % 2 === 0 ? { type, value: raw } : null;
    default:
      return null;
  }
}

export function decodeRecord(obs: CapturedObservation): DecodeResult {
  const attrs = new Map<string, AttrValue>();
  for (const a of obs.attributes) {
    const v = decodeOne(a.type, a.value);
    if (v === null) return { ok: false, reason: `attribute ${a.name} is not a valid ${a.type}` };
    attrs.set(a.name, v);
  }
  const by = attrs.get("by_label");
  if (by !== undefined && by.type !== "str") return { ok: false, reason: "by_label is not a string" };
  return {
    ok: true,
    record: {
      obs,
      key: obs.key,
      kind: obs.kind,
      creator: obs.creator,
      byLabel: by?.value as string | undefined,
      attrs,
    },
  };
}

// Typed accessors: undefined when the attribute is missing or has another type.
export const str = (r: DecodedRecord, name: string): string | undefined => {
  const v = r.attrs.get(name);
  return v?.type === "str" ? v.value : undefined;
};
export const u64 = (r: DecodedRecord, name: string): bigint | undefined => {
  const v = r.attrs.get(name);
  return v?.type === "u64" ? v.value : undefined;
};
export const addr = (r: DecodedRecord, name: string): Address | undefined => {
  const v = r.attrs.get(name);
  return v?.type === "addr" ? v.value : undefined;
};
export const ref = (r: DecodedRecord, name: string): Hex | undefined => {
  const v = r.attrs.get(name);
  return v?.type === "key" ? v.value : undefined;
};
export const bytes = (r: DecodedRecord, name: string): Hex | undefined => {
  const v = r.attrs.get(name);
  return v?.type === "bytes" ? v.value : undefined;
};
