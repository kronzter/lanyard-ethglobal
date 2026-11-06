import { z } from "zod";

/** Lowercase or mixed-case `0x` hex string. Canonical encoding lowercases it. */
export type Hex = `0x${string}`;
/** 20-byte EVM address. Stored and compared lowercase. */
export type Address = `0x${string}`;
/** Canonical ENS label relative to the edition, e.g. `priya.volunteers`; `""` is the edition itself. */
export type Label = string;
/** A block identified by number, hash and timestamp (Unix seconds). */
export type BlockRef = { number: bigint; hash: Hex; timestamp: bigint };

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export const isHex = (v: unknown, bytes?: number): v is Hex =>
  typeof v === "string" &&
  (bytes === undefined ? /^0x([0-9a-fA-F]{2})*$/ : new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`)).test(v);

export const isAddress = (v: unknown): v is Address => isHex(v, 20);

/** Any even-length hex string, lowercased. */
export const HexSchema = z
  .string()
  .refine((v) => isHex(v), "expected 0x-prefixed even-length hex")
  .transform((v) => v.toLowerCase() as Hex);

/** A 32-byte hex value (hashes, entity keys, registration IDs), lowercased. */
export const Bytes32Schema = z
  .string()
  .refine((v) => isHex(v, 32), "expected 32-byte 0x hex")
  .transform((v) => v.toLowerCase() as Hex);

/** An address, lowercased. Zero is allowed here; live deployment schemas reject it. */
export const AddressSchema = z
  .string()
  .refine(isAddress, "expected a 20-byte 0x address")
  .transform((v) => v.toLowerCase() as Address);

/** A nonzero address, lowercased. */
export const NonZeroAddressSchema = AddressSchema.refine((v) => v !== ZERO_ADDRESS, "zero address");

/** Unix seconds as a bigint (accepts bigint, safe integer or base-10 string). */
export const UnixSecondsSchema = z
  .union([z.bigint(), z.number().int().nonnegative(), z.string().regex(/^(0|[1-9][0-9]*)$/)])
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n, "negative time");
