// React binding for the live core: `const { data, status } = useArkivLive(reader, load)`.
// `load(head)` re-reads what the screen shows; while paused the last good data stays on screen
// next to the "live updates paused" status rather than being cleared or invented.
import { useEffect, useRef, useState } from "react";
import type { ArkivReader, BlockRef } from "./api";
import { createLiveCore, type LiveStatus } from "./live";

export function useArkivLive<T>(
  reader: ArkivReader,
  load: (head: BlockRef) => Promise<T>,
  opts: { rescanMs?: number; enabled?: boolean } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LiveStatus>({ state: "starting" });
  const loadRef = useRef(load);
  loadRef.current = load;
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const core = createLiveCore({
      reader,
      refresh: async (head) => setData(await loadRef.current(head)),
      onStatus: setStatus,
      rescanMs: opts.rescanMs,
    });
    core.start();
    return () => core.stop();
  }, [reader, enabled, opts.rescanMs]);

  return { data, status };
}
