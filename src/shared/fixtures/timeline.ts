// fixtures/timeline.json (plans/P0-foundation.md › P0.4-R4): mock Sepolia blocks at a fixed
// 12 s cadence from a fixed genesis, with the event's key times mapped onto them.
import { z } from "zod";
import { SEPOLIA_CHAIN_ID } from "../config/schema";

const big = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((v) => BigInt(v));

export const TIMELINE_TIMES = [
  "eventStart",
  "submissionDeadline",
  "judgingEnd",
  "results",
  "eventEnd",
  "freezeDeadline",
] as const;

export const TimelineSchema = z
  .object({
    schemaVersion: z.literal(1),
    chainId: z.literal(SEPOLIA_CHAIN_ID),
    secondsPerBlock: z.literal(12),
    genesis: z.object({ block: big, timestamp: big }).strict(),
    /** The mock chain's head block: every scripted event and test block is at or before it. */
    head: big,
    times: z.object(
      Object.fromEntries(
        TIMELINE_TIMES.map((k) => [k, z.object({ timestamp: big, block: big }).strict()]),
      ) as Record<(typeof TIMELINE_TIMES)[number], z.ZodObject<{ timestamp: typeof big; block: typeof big }>>,
    ),
  })
  .strict();

export type Timeline = z.output<typeof TimelineSchema>;
export const parseTimeline = (value: unknown): Timeline => TimelineSchema.parse(value);

/** Timestamp of a mock block. */
export const timestampOfBlock = (t: Timeline, block: bigint): bigint =>
  t.genesis.timestamp + (block - t.genesis.block) * BigInt(t.secondsPerBlock);

/** Latest mock block at or before `unixSeconds`; throws before genesis. */
export function blockAtTimestamp(t: Timeline, unixSeconds: bigint): bigint {
  if (unixSeconds < t.genesis.timestamp) throw new Error(`${unixSeconds} is before the mock genesis`);
  return t.genesis.block + (unixSeconds - t.genesis.timestamp) / BigInt(t.secondsPerBlock);
}
