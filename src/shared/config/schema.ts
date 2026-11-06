// Event config shape (plans/P0-foundation.md › P0.2-R1). Times are Unix seconds (bigint).
import { z } from "zod";
import { AddressSchema, Bytes32Schema, UnixSecondsSchema } from "../types/primitives";
import { gated } from "./unmeasured";

export const SEPOLIA_CHAIN_ID = 11155111;
export const RABDI_CHAIN_ID = 7794095;

export const SCORE_CIPHER_SUITE = "x25519-hkdf-sha256-aes-256-gcm";
export const SHIFT_WRITE_PROFILES = ["linked-create", "confirmed-sequential"] as const;
export const FUNDING_PROFILES = ["faucet-contract", "desk-wallet"] as const;

const ChainPolicy = <C extends number>(chainId: C) =>
  z
    .object({
      chainId: z.literal(chainId),
      /** Blocks to wait before a read or receipt counts as confirmed (S10 for Rabdi, S7 for Sepolia). */
      confirmations: gated(z.number().int().positive()),
      /** Genesis/reset fingerprint, not the chain ID alone (S10). */
      resetId: gated(Bytes32Schema),
    })
    .strict();

export const EventTimesSchema = z
  .object({
    eventStart: UnixSecondsSchema,
    submissionDeadline: UnixSecondsSchema,
    judgingEnd: UnixSecondsSchema,
    /** Earliest publication time; the freeze cutoff window starts here (inclusive). */
    results: UnixSecondsSchema,
    /** Exclusive latest freeze cutoff. Judge badges expire here. */
    freezeDeadline: UnixSecondsSchema,
    /** Volunteer and partner-staff badges expire here. */
    eventEnd: UnixSecondsSchema,
  })
  .strict();

export const EventConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Edition label, e.g. `mumbai2026`. */
    edition: z.string(),
    /** Base name, e.g. `lanyard.eth`. */
    baseName: z.string(),
    partners: z.array(z.object({ id: z.string(), name: z.string().min(1) }).strict()),
    /** One track per partner plus exactly one non-partner track (`partner: null`). */
    tracks: z.array(
      z.object({ id: z.string(), name: z.string().min(1), partner: z.string().nullable() }).strict(),
    ),
    times: EventTimesSchema,
    /** Independently configured authority wallets; they need no badge. */
    authorities: z
      .object({
        organizer: AddressSchema,
        results: AddressSchema,
        partners: z.record(z.string(), AddressSchema),
      })
      .strict(),
    chains: z.object({ sepolia: ChainPolicy(SEPOLIA_CHAIN_ID), rabdi: ChainPolicy(RABDI_CHAIN_ID) }).strict(),
    venue: z.object({ cellSizeMm: z.number().int().positive() }).strict(),
    /** Public score-encryption parameters from S11. The private key never appears here. */
    scoreCipher: gated(
      z
        .object({
          suite: z.literal(SCORE_CIPHER_SUITE),
          keyId: z.string().min(1),
          publicKey: Bytes32Schema,
          implementation: z.string().min(1),
        })
        .strict(),
    ),
    shiftWriteProfile: gated(z.enum(SHIFT_WRITE_PROFILES)),
    fundingProfile: gated(z.enum(FUNDING_PROFILES)),
    /** First-time gas the desk sends each new wallet, in wei of tGLM (B1.1-R7). */
    funding: z.object({ dripWei: z.bigint().positive() }).strict().optional(),
    evidenceSchemaVersion: z.literal(1),
  })
  .strict();

export type EventConfigInput = z.input<typeof EventConfigSchema>;
export type EventConfig = z.output<typeof EventConfigSchema>;
export type EventTimes = EventConfig["times"];
export type ShiftWriteProfile = (typeof SHIFT_WRITE_PROFILES)[number];
export type FundingProfile = (typeof FUNDING_PROFILES)[number];
