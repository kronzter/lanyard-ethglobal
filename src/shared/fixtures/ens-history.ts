// fixtures/ens-history.json (plans/P0-foundation.md › P0.4-R3/R5): a scripted day of ENS
// registry and resolver events at mock Sepolia blocks, replayed by MockEnsReader.
import { z } from "zod";
import { SEPOLIA_CHAIN_ID } from "../config/schema";
import { isCanonicalLabel } from "../labels";
import { AddressSchema, Bytes32Schema } from "../types/primitives";

const big = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((v) => BigInt(v));
const label = z.string().refine(isCanonicalLabel, 'expected a canonical label ("" is the edition)');
const base = { block: big, label, note: z.string().min(1).optional() };

export const EnsEventSchema = z.discriminatedUnion("type", [
  /** A new registration: a fresh EAC `resource`, hence a new registration ID. */
  z
    .object({
      type: z.literal("register"),
      ...base,
      owner: AddressSchema,
      expiry: big,
      resource: Bytes32Schema,
    })
    .strict(),
  /** Renewal (including revival after expiry): same registration, new expiry. */
  z.object({ type: z.literal("renew"), ...base, expiry: big }).strict(),
  z.object({ type: z.literal("unregister"), ...base }).strict(),
  /** Resolver text record; `null` removes it. */
  z
    .object({ type: z.literal("setText"), ...base, key: z.string().min(1), value: z.string().nullable() })
    .strict(),
  /** Resolver address record (display only); `null` removes it. */
  z.object({ type: z.literal("setAddr"), ...base, address: AddressSchema.nullable() }).strict(),
  /** A registry role change on the name. It never changes ownership or registration identity. */
  z
    .object({
      type: z.literal("setRoles"),
      ...base,
      account: AddressSchema,
      roles: z.array(z.string().min(1)),
    })
    .strict(),
]);

/** `@base` is the registry holding the edition itself; every other key is a parent label. */
export const BASE_REGISTRY_KEY = "@base";

export const EnsHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    chainId: z.literal(SEPOLIA_CHAIN_ID),
    /** Registry address that holds the children of each parent label. */
    registries: z.record(z.string(), AddressSchema),
    events: z.array(EnsEventSchema),
  })
  .strict()
  .superRefine((h, ctx) => {
    for (let i = 1; i < h.events.length; i++) {
      if (h.events[i]!.block < h.events[i - 1]!.block) {
        ctx.addIssue({
          code: "custom",
          message: `events must be in block order (event ${i})`,
          path: ["events", i],
        });
      }
    }
    for (const key of Object.keys(h.registries)) {
      if (key !== BASE_REGISTRY_KEY && !isCanonicalLabel(key)) {
        ctx.addIssue({
          code: "custom",
          message: `registry key ${JSON.stringify(key)} is not a label`,
          path: ["registries"],
        });
      }
    }
  });

export type EnsEvent = z.output<typeof EnsEventSchema>;
export type EnsHistory = z.output<typeof EnsHistorySchema>;
export const parseEnsHistory = (value: unknown): EnsHistory => EnsHistorySchema.parse(value);

/** The parent of a relative label: `priya.volunteers` → `volunteers`, `volunteers` → `""`, `""` → `@base`. */
export function parentLabel(label: string): string {
  if (label === "") return BASE_REGISTRY_KEY;
  const dot = label.indexOf(".");
  return dot === -1 ? "" : label.slice(dot + 1);
}

/** Every ancestor of a label, nearest first, ending with the edition `""`. */
export function ancestorsOf(label: string): string[] {
  const out: string[] = [];
  let l = label;
  while (l !== "") {
    l = parentLabel(l);
    out.push(l);
  }
  return out;
}

/** The registry that holds `label`. */
export function registryOf(history: EnsHistory, label: string): `0x${string}` {
  const r = history.registries[parentLabel(label)];
  if (!r) throw new Error(`no registry for the parent of ${JSON.stringify(label)}`);
  return r;
}
