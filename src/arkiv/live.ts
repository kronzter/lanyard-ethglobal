// Live updates without trusting events as data (B1.3-R5). Events only invalidate: each one triggers
// a debounced refresh that re-reads current rows. A periodic bounded rescan catches anything the
// watcher missed, and each refresh gets the current head so expired records are swept locally
// (Arkiv emits no expiry event). If the watcher or a refresh fails, status turns "paused" with the
// screen message "live updates paused", the watcher is re-subscribed after a delay and state is
// rebuilt by a full refresh; nothing old is fabricated in between.
import type { ArkivReader, BlockRef } from "./api";

export const LIVE_PAUSED = "live updates paused";

export type LiveStatus =
  | { state: "starting" }
  | { state: "live"; head: bigint; refreshedAtMs: number }
  | { state: "paused"; message: typeof LIVE_PAUSED; reason: string };

export type LiveOptions = {
  reader: ArkivReader;
  /** Re-read everything the screen shows; gets the head so it can drop expired rows. */
  refresh: (head: BlockRef) => Promise<void>;
  onStatus: (status: LiveStatus) => void;
  rescanMs?: number;
  debounceMs?: number;
  retryMs?: number;
  now?: () => number;
};

/** Drop records whose physical expiry has passed (no event announces it). */
export const sweepExpired = <T extends { expiresAt: bigint }>(records: T[], head: { number: bigint }) =>
  records.filter((r) => r.expiresAt > head.number);

export function createLiveCore(o: LiveOptions) {
  const rescanMs = o.rescanMs ?? 30_000;
  const debounceMs = o.debounceMs ?? 500;
  const retryMs = o.retryMs ?? 5_000;
  const now = o.now ?? Date.now;
  let unwatch: (() => void) | null = null;
  let rescan: ReturnType<typeof setInterval> | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let running: Promise<void> | null = null;

  const pause = (reason: string) => {
    o.onStatus({ state: "paused", message: LIVE_PAUSED, reason });
    unwatch?.();
    unwatch = null;
    if (!stopped && !retry)
      retry = setTimeout(() => {
        retry = null;
        subscribe();
        void refreshNow();
      }, retryMs);
  };

  const refreshNow = async () => {
    if (stopped) return;
    if (running) return running;
    running = (async () => {
      try {
        const head = await o.reader.head();
        await o.refresh(head);
        if (!stopped && unwatch) o.onStatus({ state: "live", head: head.number, refreshedAtMs: now() });
      } catch (e) {
        pause((e as Error).message);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  const schedule = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void refreshNow();
    }, debounceMs);
  };

  const subscribe = () => {
    if (stopped || unwatch) return;
    unwatch = o.reader.watch({ onEvent: schedule, onError: (e) => pause(e.message) });
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      o.onStatus({ state: "starting" });
      subscribe();
      rescan = setInterval(() => void refreshNow(), rescanMs);
      void refreshNow();
    },
    stop() {
      stopped = true;
      unwatch?.();
      unwatch = null;
      for (const t of [pending, retry]) if (t) clearTimeout(t);
      if (rescan) clearInterval(rescan);
      pending = retry = rescan = null;
    },
    refreshNow,
  };
}
