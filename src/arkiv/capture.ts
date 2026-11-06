// Operator-attested capture (B1.3-R8; plans/01-evidence-and-interfaces.md §1).
//
// `captureForEvent` runs one bounded, key-ordered scan of the edition's live records and appends an
// observation for every readonly record it has not retained yet: raw typed attributes, creator,
// owner, flags, creation/update/expiry blocks, creation timestamp, the block (and hash) the page
// was read at, and the network's reset identity. It never relabels an observation as state at an
// earlier block and never claims an atomic snapshot. Mutable drafts are excluded from evidence.
//
// It fails closed: an exhausted page budget is an incomplete pass, a reset identity that differs
// from the configured one stops capture, and conflicting bytes for one readonly key or a malformed
// observation throw. A known key that later disappears keeps its retained bytes and is marked gone
// (deleted, or past its expiry) at the first block a scan missed it.
import {
  CapturedObservationSchema,
  dedupeObservations,
  type CapturedObservation,
} from "@/shared/evidence/observation";
import type { Hex } from "@/shared/types/primitives";
import { MAX_PAGE, type ArkivReader, type BlockRef, type StoredEntity } from "./api";
import { APP } from "./kinds";

export type GoneMark = { key: Hex; atBlock: bigint; reason: "deleted" | "expired" };

/** Append-only storage for observations; implementations never rewrite an earlier line. */
export interface ObservationStore {
  append(observation: CapturedObservation): Promise<void>;
  markGone(mark: GoneMark): Promise<void>;
  load(): Promise<{ observations: CapturedObservation[]; gone: GoneMark[] }>;
}

export function memoryObservationStore(): ObservationStore {
  const observations: CapturedObservation[] = [];
  const gone: GoneMark[] = [];
  return {
    append: async (o) => void observations.push(o),
    markGone: async (m) => void gone.push(m),
    load: async () => ({ observations: [...observations], gone: [...gone] }),
  };
}

/** One JSONL line per observation or gone-mark; bigints as decimal strings. */
export const encodeLine = (
  entry: { type: "observation"; observation: CapturedObservation } | ({ type: "gone" } & GoneMark),
) => JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export function decodeLines(text: string): { observations: CapturedObservation[]; gone: GoneMark[] } {
  const observations: CapturedObservation[] = [];
  const gone: GoneMark[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const e = JSON.parse(line) as { type: string } & Record<string, unknown>;
    if (e.type === "observation") observations.push(CapturedObservationSchema.parse(e.observation));
    else if (e.type === "gone")
      gone.push({
        key: e.key as Hex,
        atBlock: BigInt(e.atBlock as string),
        reason: e.reason as GoneMark["reason"],
      });
  }
  return { observations, gone };
}

export class CaptureError extends Error {
  constructor(message: string) {
    super(`capture stopped: ${message}`);
    this.name = "CaptureError";
  }
}

export type CaptureReport = {
  complete: boolean;
  gaps: string[];
  pages: { blockNumber: bigint; count: number }[];
  observedNow: number;
  retainedTotal: number;
  newlyRetained: number;
  excludedMutable: number;
  newlyGone: GoneMark[];
};

const attrValue = (v: { type: string; value: unknown }) =>
  typeof v.value === "string" && v.type !== "str" ? v.value.toLowerCase() : String(v.value);

function toObservation(
  e: StoredEntity,
  created: BlockRef,
  observed: BlockRef,
  network: { chainId: number; resetId: Hex },
): CapturedObservation {
  const attributes = Object.entries(e.attributes)
    .map(([name, a]) => ({ name, type: a.value.type, indexed: a.indexed, value: attrValue(a.value) }))
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  const parsed = CapturedObservationSchema.safeParse({
    key: e.key,
    kind: String(e.attributes.kind?.value.value ?? "unknown"),
    creator: e.creator,
    owner: e.owner,
    flags: e.flags,
    createdAtBlock: e.createdAt,
    updatedAtBlock: e.updatedAt,
    expiresAtBlock: e.expiresAt,
    createdAtTimestamp: created.timestamp,
    observedAtBlock: observed.number,
    observedAtBlockHash: observed.hash,
    network,
    attributes,
    payload: "0x",
  });
  if (!parsed.success)
    throw new CaptureError(
      `${e.key} is malformed evidence: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  return parsed.data;
}

export async function captureForEvent(o: {
  reader: ArkivReader;
  edition: string;
  network: { chainId: number; resetId: Hex };
  store: ObservationStore;
  maxPages?: number;
}): Promise<CaptureReport> {
  const genesis = await o.reader.block(0n);
  if (genesis.hash.toLowerCase() !== o.network.resetId.toLowerCase())
    throw new CaptureError(`reset identity ${genesis.hash} differs from the configured ${o.network.resetId}`);

  const prior = await o.store.load();
  const retained = new Map(prior.observations.map((x) => [x.key, x]));
  const alreadyGone = new Set(prior.gone.map((g) => g.key));
  const blocks = new Map<bigint, Promise<BlockRef>>();
  const block = (n: bigint) => {
    if (!blocks.has(n)) blocks.set(n, o.reader.block(n));
    return blocks.get(n)!;
  };

  const report: CaptureReport = {
    complete: false,
    gaps: [],
    pages: [],
    observedNow: 0,
    retainedTotal: retained.size,
    newlyRetained: 0,
    excludedMutable: 0,
    newlyGone: [],
  };
  const seen = new Set<Hex>();
  const fresh: CapturedObservation[] = [];
  let afterKey: Hex | undefined;
  for (let i = 0; i < (o.maxPages ?? 50); i++) {
    const page = await o.reader.query({
      equals: { app: { type: "str", value: APP }, event: { type: "str", value: o.edition } } as never,
      afterKey,
      limit: MAX_PAGE,
    });
    report.pages.push({ blockNumber: page.blockNumber, count: page.entities.length });
    const observed = await block(page.blockNumber);
    for (const e of page.entities) {
      seen.add(e.key);
      report.observedNow++;
      if (!e.flags.readonly) {
        report.excludedMutable++;
        continue;
      }
      const obs = toObservation(e, await block(e.createdAt), observed, o.network);
      const earlier = retained.get(e.key);
      if (earlier)
        dedupeObservations([earlier, obs]); // throws ConflictingCaptureError on different bytes
      else fresh.push(obs);
    }
    if (page.entities.length < MAX_PAGE) {
      report.complete = true;
      break;
    }
    afterKey = page.entities.at(-1)!.key;
  }
  if (!report.complete)
    report.gaps.push(`page budget of ${o.maxPages ?? 50} exhausted before the scan finished`);

  for (const obs of fresh) await o.store.append(obs);
  report.newlyRetained = fresh.length;
  report.retainedTotal = retained.size + fresh.length;

  // Only a complete pass can say a known key is gone; an incomplete one proves nothing.
  if (report.complete) {
    const head = report.pages[0]!.blockNumber;
    for (const [key, obs] of retained) {
      if (seen.has(key) || alreadyGone.has(key)) continue;
      const mark: GoneMark = {
        key,
        atBlock: head,
        reason: obs.expiresAtBlock <= head ? "expired" : "deleted",
      };
      await o.store.markGone(mark);
      report.newlyGone.push(mark);
    }
  }
  return report;
}

/** Retain bytes actually read after an invalidation; the event itself is never evidence. */
export async function retainObservedEntity(
  reader: ArkivReader,
  store: ObservationStore,
  entity: StoredEntity,
  network: { chainId: number; resetId: Hex },
) {
  if (!entity.flags.readonly) return;
  const observed = await reader.head();
  const created = await reader.block(entity.createdAt);
  await store.append(toObservation(entity, created, observed, network));
}
