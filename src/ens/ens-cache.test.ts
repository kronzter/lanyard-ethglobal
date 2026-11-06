import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryEnsCache, PersistentEnsCache, type KeyValueStorage } from "./ens-cache";

function memoryStorage(fail = false): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const guard = () => {
    if (fail) throw new Error("storage unavailable");
  };
  return {
    data,
    getItem: async (k) => (guard(), data.get(k) ?? null),
    setItem: async (k, v) => void (guard(), data.set(k, v)),
    removeItem: async (k) => void (guard(), data.delete(k)),
  };
}

describe("MemoryEnsCache", () => {
  it("evicts the least recently used entry beyond its bound", async () => {
    const c = new MemoryEnsCache(2);
    await c.set("a", "1");
    await c.set("b", "2");
    await c.get("a");
    await c.set("c", "3");
    expect([await c.get("a"), await c.get("b"), await c.get("c")]).toEqual(["1", undefined, "3"]);
    expect(c.size).toBe(2);
  });
});

describe("PersistentEnsCache", () => {
  it("survives a restart through storage and stays bounded", async () => {
    const storage = memoryStorage();
    const first = new PersistentEnsCache(storage, "t", 2);
    await first.set("a", "1");
    await first.set("b", "2");
    await first.set("c", "3");
    const second = new PersistentEnsCache(storage, "t", 2);
    expect([await second.get("a"), await second.get("b"), await second.get("c")]).toEqual([
      undefined,
      "2",
      "3",
    ]);
    expect([...storage.data.keys()].filter((k) => k !== "t:index")).toHaveLength(2);
  });

  it("degrades to a miss when storage fails, never to a wrong value", async () => {
    const c = new PersistentEnsCache(memoryStorage(true), "t", 2);
    await c.set("a", "1");
    expect(await c.get("a")).toBe("1"); // memory still answers
    expect(await new PersistentEnsCache(memoryStorage(true)).get("a")).toBeUndefined();
  });
});

describe("reader modules", () => {
  it.each([
    "ens-cache.ts",
    "logs.ts",
    "registry-read.ts",
    "sepolia-ens-reader.ts",
    "sepolia-identity-directory.ts",
  ])("%s imports nothing Node-only (A2.4-R6)", (file) => {
    const src = readFileSync(resolve(__dirname, file), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(
      imports.filter((i) => i.startsWith("node:") || ["fs", "path", "os", "child_process"].includes(i)),
    ).toEqual([]);
    expect(imports.every((i) => i === "viem" || i === "viem/chains" || i.startsWith("."))).toBe(true);
  });
});
