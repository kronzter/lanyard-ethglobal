// Disposable read cache for the SepoliaEnsReader (A2.4-R4). Keys carry chain, reset identity,
// query and block hash, so a reorged block can never serve a stale answer; the reader only caches
// reads at or below the finalized block. Storage is bounded. Runtime-neutral: the AsyncStorage
// adapter takes the storage object as an argument instead of importing it.
export interface EnsCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** Bounded in-memory LRU. */
export class MemoryEnsCache implements EnsCache {
  private readonly map = new Map<string, string>();
  constructor(private readonly maxEntries = 5_000) {
    if (maxEntries < 1) throw new Error("cache needs room for at least one entry");
  }
  async get(key: string): Promise<string | undefined> {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value!);
  }
  get size(): number {
    return this.map.size;
  }
}

/** The subset of @react-native-async-storage/async-storage the cache uses. */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * Memory in front of persistent storage (the app passes AsyncStorage). Persistent entries are
 * bounded by a FIFO index; any storage failure degrades to a miss, never to a wrong answer.
 */
export class PersistentEnsCache implements EnsCache {
  private readonly memory: MemoryEnsCache;
  private index: string[] | null = null;
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly prefix = "lanyard.ens.v1",
    private readonly maxEntries = 2_000,
  ) {
    this.memory = new MemoryEnsCache(maxEntries);
  }
  private async loadIndex(): Promise<string[]> {
    if (this.index) return this.index;
    try {
      const raw = await this.storage.getItem(`${this.prefix}:index`);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      this.index = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      this.index = [];
    }
    return this.index;
  }
  async get(key: string): Promise<string | undefined> {
    const hit = await this.memory.get(key);
    if (hit !== undefined) return hit;
    try {
      const v = await this.storage.getItem(`${this.prefix}:${key}`);
      if (v === null) return undefined;
      await this.memory.set(key, v);
      return v;
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: string): Promise<void> {
    await this.memory.set(key, value);
    try {
      const index = await this.loadIndex();
      if (!index.includes(key)) index.push(key);
      while (index.length > this.maxEntries)
        await this.storage.removeItem(`${this.prefix}:${index.shift()!}`);
      await this.storage.setItem(`${this.prefix}:${key}`, value);
      await this.storage.setItem(`${this.prefix}:index`, JSON.stringify(index));
    } catch {
      // A cache that cannot persist is still correct; it is only slower.
    }
  }
}
