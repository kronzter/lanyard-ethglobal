import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { KeyValueStore } from "./store";

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lanyard-score-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Lanyard tabs to update local score storage"));
    request.onsuccess = () => resolve(request.result);
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = action(tx.objectStore("drafts"));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error("Local save aborted"));
    tx.onerror = () => reject(tx.error);
  });
}
export function scoreDraftStore(): KeyValueStore {
  return Platform.OS === "web"
    ? {
        get: async (k) => ((await transaction("readonly", (s) => s.get(k))) as string | undefined) ?? null,
        set: async (k, v) => {
          await transaction("readwrite", (s) => s.put(v, k));
        },
        delete: async (k) => {
          await transaction("readwrite", (s) => s.delete(k));
        },
      }
    : {
        get: (k) => AsyncStorage.getItem(k),
        set: (k, v) => AsyncStorage.setItem(k, v),
        delete: (k) => AsyncStorage.removeItem(k),
      };
}
