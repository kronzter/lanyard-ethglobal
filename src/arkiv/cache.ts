// A bounded device cache in front of an ArkivReader (B1.3-R7): repeated screen reads inside a
// short TTL reuse one RPC answer, so the app stays well inside the measured public-RPC limits
// (P0.6-S8: ~200 reads/min with no errors). Live events and rescans call `invalidate()`; nothing
// here outlives the TTL, and receipts and heads are never cached.
import type { ArkivReader, QueryFilter, QueryPage, StoredEntity } from "./api";

export type CachedReader = ArkivReader & { invalidate(): void; readonly size: number };

export function cachedReader(
  reader: ArkivReader,
  opts: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): CachedReader {
  const ttl = opts.ttlMs ?? 5_000;
  const max = opts.maxEntries ?? 200;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<QueryPage | StoredEntity | null> }>();
  const keyOf = (f: QueryFilter) => JSON.stringify(f, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  const remember = <T extends QueryPage | StoredEntity | null>(
    k: string,
    load: () => Promise<T>,
  ): Promise<T> => {
    const hit = entries.get(k);
    if (hit && now() - hit.at < ttl) {
      entries.delete(k);
      entries.set(k, hit); // most recently used last
      return hit.value as Promise<T>;
    }
    const value = load();
    entries.set(k, { at: now(), value });
    value.catch(() => entries.delete(k));
    while (entries.size > max) entries.delete(entries.keys().next().value!);
    return value;
  };
  return {
    ...reader,
    get: (key) => remember(`get:${key}`, () => reader.get(key)),
    query: (filter) => remember(`query:${keyOf(filter)}`, () => reader.query(filter)),
    head: () => reader.head(),
    block: (n) => reader.block(n),
    balance: (a) => reader.balance(a),
    receipt: (h) => reader.receipt(h),
    watch: (h) => reader.watch(h),
    invalidate: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}
