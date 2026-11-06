// Values only the P0.6 spike can measure (confirmation depths, reset identities, the score
// cipher, the shift-write and funding profiles) are typed now but stored as `unmeasured`.
// Nothing may guess them (plans/P0-foundation.md › Fallbacks): code that needs one calls
// requireMeasured(), which throws BlockedCapabilityError naming the spike check.
import { z } from "zod";

export const SPIKE_CHECKS = [
  "P0.6-S1",
  "P0.6-S2",
  "P0.6-S3",
  "P0.6-S4",
  "P0.6-S5",
  "P0.6-S6",
  "P0.6-S7",
  "P0.6-S8",
  "P0.6-S9",
  "P0.6-S10",
  "P0.6-S11",
  "P0.6-S12",
] as const;
export type SpikeCheck = (typeof SPIKE_CHECKS)[number];

export type Measured<T> = { status: "measured"; value: T; evidence: string };
export type Unmeasured = { status: "unmeasured"; gate: SpikeCheck };
export type Gated<T> = Measured<T> | Unmeasured;

export const unmeasured = (gate: SpikeCheck): Unmeasured => ({ status: "unmeasured", gate });
export const measured = <T>(value: T, evidence: string): Measured<T> => ({
  status: "measured",
  value,
  evidence,
});

/** zod schema for a gated value whose measured form matches `inner`. */
export const gated = <T extends z.ZodType>(inner: T) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("unmeasured"), gate: z.enum(SPIKE_CHECKS) }).strict(),
    z.object({ status: z.literal("measured"), value: inner, evidence: z.string().min(1) }).strict(),
  ]);

/** A capability is blocked until its spike check records evidence. */
export class BlockedCapabilityError extends Error {
  constructor(
    readonly gate: string,
    readonly what: string,
  ) {
    super(`${what} is blocked until ${gate} records evidence in plans/TRACKER.md (no guessed values).`);
    this.name = "BlockedCapabilityError";
  }
}

export function requireMeasured<T>(field: Gated<T>, what: string): T {
  if (field.status === "unmeasured") throw new BlockedCapabilityError(field.gate, what);
  return field.value;
}

export const isMeasured = <T>(field: Gated<T>): field is Measured<T> => field.status === "measured";
