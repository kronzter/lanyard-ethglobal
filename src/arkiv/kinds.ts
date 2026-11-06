// Lanyard's Arkiv record kinds (plans/B1-arkiv-data.md › Record kinds). Every record carries the
// four common attributes `app`, `event`, `kind` and `by_label` (the writer's relative ENS label;
// Arkiv reserves `by`). Schemas are untagged (`defineSchema(columns)`), so no `arkiv.schema`
// attribute uses up one of the 32 slots; `app`/`event`/`kind` are explicit indexed columns that
// every reader filters on. Retention (physical expiry) comes from the event's times and is never
// a business deadline: tickets, leases and duty use logical deadlines computed from creation time.
import { ExpirationTime, type Expiry } from "@arkiv-network/sdk";
import { addr, defineSchema, str } from "@arkiv-network/sdk/schema";
import { SECONDS_PER_DAY } from "@/shared/config/validate";
import type { EventTimes } from "@/shared/config/schema";

export const APP = "lanyard";

export const commonColumns = {
  app: str().indexed(),
  event: str().indexed(),
  kind: str().indexed(),
  by_label: str().indexed(),
} as const;

/** Retention deadline from an absolute Unix time, placed against the chain's current block. */
export const retainUntil = (unixSeconds: bigint): Expiry =>
  ExpirationTime.atDate(new Date(Number(unixSeconds) * 1000));

export const days = (n: number) => BigInt(n) * SECONDS_PER_DAY;

type KindDef = {
  schema: ReturnType<typeof defineSchema>;
  flags: { readonly: boolean; permissionlessExtension?: boolean };
  /** Physical retention for a record of this kind. */
  retention: (t: EventTimes) => Expiry;
};

export const KINDS = {
  /** Desk-wallet funding fallback (P0.6-S6): one readonly record per first-time tGLM send. */
  drip: {
    schema: defineSchema({ ...commonColumns, recipient: addr().indexed(), tx: str() }),
    flags: { readonly: true },
    retention: (t) => retainUntil(t.eventEnd + days(7)),
  },
} satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;
