// A tiny persisted key-value store for journals and queues. Platform code supplies the backing:
// memory (tests), localStorage (web), AsyncStorage (native) or a file (Node CLI). Values are JSON
// text; bigint fields are encoded as decimal strings by the callers that need them.
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function memoryStore(
  initial: Record<string, string> = {},
): KeyValueStore & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

/** Browser storage; throws early when localStorage is unavailable rather than losing intents. */
export function localStorageStore(prefix: string): KeyValueStore {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) throw new Error("localStorage is not available in this runtime");
  return {
    get: async (k) => ls.getItem(prefix + k),
    set: async (k, v) => ls.setItem(prefix + k, v),
    delete: async (k) => ls.removeItem(prefix + k),
  };
}
