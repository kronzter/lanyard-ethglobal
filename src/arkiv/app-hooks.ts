// React glue for the field screens (B3): the current evaluation, and a write queue for the
// connected account. App-only: imports React Native and the shell, so Node code never imports it.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useMemo, useState } from "react";
import { Platform } from "react-native";
import { providers } from "@/providers";
import { useSession } from "@/shell/session";
import { useWallet } from "@/shell/wallet/useWallet";
import type { BlockRef } from "@/shared/types/primitives";
import { evaluateCurrent, type CurrentEvaluation } from "./evaluate-current";
import { FAKE_BLOCK_SECONDS } from "./fake";
import { WriteQueue } from "./queue";
import { localStorageStore, memoryStore, type KeyValueStore } from "./store";
import { useArkivLive } from "./useArkivLive";
import type { WriteContext } from "./writers";

const PREFIX = "lanyard:";

function asyncStorageStore(prefix: string): KeyValueStore {
  return {
    get: (k) => AsyncStorage.getItem(prefix + k),
    set: (k, v) => AsyncStorage.setItem(prefix + k, v),
    delete: (k) => AsyncStorage.removeItem(prefix + k),
  };
}

let store: KeyValueStore | undefined;
/**
 * Where write intents and replacement journals persist across restarts (B1.3-R1, B3.1-R5). The
 * development fake is rebuilt on every launch, so its journals stay in memory with it.
 */
export function appStore(): KeyValueStore {
  return (store ??=
    providers.arkiv().mode === "fake"
      ? memoryStore()
      : Platform.OS === "web"
        ? localStorageStore(PREFIX)
        : asyncStorageStore(PREFIX));
}

type Loaded = { ok: true; value: CurrentEvaluation } | { ok: false; error: string };

/** The current observations evaluated by the rules, refreshed on every Arkiv change. */
export function useEvaluation() {
  const arkiv = providers.arkiv();
  const load = useCallback(async (): Promise<Loaded> => {
    if (arkiv.fake) await arkiv.fake.seeded;
    try {
      return {
        ok: true,
        value: await evaluateCurrent({
          reader: arkiv.reader,
          ens: providers.ensReader(),
          config: providers.config,
        }),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message.split("\n")[0]! };
    }
  }, [arkiv]);
  const [generation, setGeneration] = useState(0);
  const { data, status } = useArkivLive(arkiv.reader, load, { restartKey: generation });
  const fake = arkiv.fake?.arkiv;
  return {
    evaluation: data?.ok ? data.value : null,
    error: data && !data.ok ? data.error : null,
    status,
    mode: arkiv.mode,
    /** Re-read now (after a write, or after moving the fake clock). */
    refresh: () => setGeneration((g) => g + 1),
    /** Fake mode only: advance the development chain by whole blocks. */
    advance: fake
      ? (seconds: bigint) => {
          fake.advance(seconds / FAKE_BLOCK_SECONDS);
          setGeneration((g) => g + 1);
        }
      : undefined,
  };
}

/** A write queue for the connected account, and the write context for its active badge. */
export function useWriter() {
  const session = useSession();
  const wallet = useWallet();
  const arkiv = providers.arkiv();
  const address = session.address;
  const byLabel = session.active?.kind === "badge" ? session.active.label : null;
  const queue = useMemo(
    () =>
      address
        ? new WriteQueue({
            store: appStore(),
            reader: arkiv.reader,
            writer: (onTxHash) => arkiv.writer(address, wallet.provider, onTxHash),
            account: address,
          })
        : null,
    [address, arkiv, wallet.provider],
  );
  const context = useCallback(
    (head?: BlockRef): WriteContext | null =>
      byLabel
        ? {
            edition: providers.config.edition,
            byLabel,
            times: providers.config.times,
            ...(head ? { head } : {}),
          }
        : null,
    [byLabel],
  );
  return { address, byLabel, queue, context, store: appStore() };
}
