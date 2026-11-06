// The part of the frozen event config the rules read (B2.2-R1).
//
// The bundle carries the whole frozen config and `context.configHash` commits to it, so evaluation
// first checks that hash, then reads only these fields: edition, times, tracks, partners, chain
// identities and the independently configured authority wallets. Unknown extra fields are allowed here because the
// hash, not this schema, is what pins the config.
import { z } from "zod";
import { canonicalHash } from "@/shared/canonical";
import { EventTimesSchema } from "@/shared/config/schema";
import { AddressSchema, Bytes32Schema, type Hex } from "@/shared/types/primitives";

export const RulesConfigSchema = z.object({
  edition: z.string().min(1),
  times: EventTimesSchema,
  partners: z.array(z.object({ id: z.string(), name: z.string() })),
  tracks: z.array(z.object({ id: z.string(), name: z.string(), partner: z.string().nullable() })),
  authorities: z.object({
    organizer: AddressSchema,
    results: AddressSchema,
    partners: z.record(z.string(), AddressSchema),
    desk: AddressSchema.optional(),
  }),
  chains: z.object({
    sepolia: z.object({ chainId: z.number().int(), resetId: Bytes32Schema }),
    rabdi: z.object({ chainId: z.number().int(), resetId: Bytes32Schema }),
  }),
});

export type RulesConfig = z.output<typeof RulesConfigSchema>;

export class RulesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesConfigError";
  }
}

/** Check the frozen config against its committed hash, then extract what the rules use. */
export function rulesConfigOf(frozen: unknown, expectedHash: Hex): RulesConfig {
  if (canonicalHash(frozen) !== expectedHash.toLowerCase())
    throw new RulesConfigError("the config does not match context.configHash");
  const parsed = RulesConfigSchema.safeParse(frozen);
  if (!parsed.success)
    throw new RulesConfigError(`the frozen config is unusable: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
