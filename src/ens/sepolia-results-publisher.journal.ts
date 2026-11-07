// A durable file-backed PublisherJournalIO for SepoliaResultsPublisher (I4). Node only, for the local
// freeze CLI's composition root; app code never imports it (sepolia-results-publisher.boundary.test.ts).
//
// The journal holds raw signed transactions saved before broadcast, so losing or silently resetting it
// could allow a replacement transaction after an unknown outcome. Therefore:
// - write() replaces the file atomically: write a fresh temporary file, fsync it, rename it over the
//   journal, then fsync the directory so the rename itself survives a crash. A crash at any point
//   leaves either the old or the new journal, never a torn one.
// - read() returns null only when the file does not exist. An empty, truncated or non-JSON file is
//   refused with CorruptJournalError; it is never treated as a fresh journal. Restore it from a backup
//   or reconcile manually.
//
// Windows cannot fsync a directory handle (EPERM); there the directory sync is skipped and the
// rename's durability rests on NTFS metadata journaling.
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { parseJsonStrict } from "../shared/canonical";
import type { PublisherJournalIO } from "./sepolia-results-publisher";

export class CorruptJournalError extends Error {
  constructor(
    readonly file: string,
    reason: string,
  ) {
    super(
      `publisher journal ${file} is unreadable (${reason}); refusing to reset it. Restore or reconcile it.`,
    );
    this.name = "CorruptJournalError";
  }
}

function checkJson(file: string, text: string): void {
  if (text.trim() === "") throw new CorruptJournalError(file, "empty");
  let value: unknown;
  try {
    value = parseJsonStrict(text);
  } catch (e) {
    throw new CorruptJournalError(file, (e as Error).message);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CorruptJournalError(file, "not a JSON object");
}

async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, "r");
    await handle.sync();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR" || code === "EINVAL")) return;
    throw e;
  } finally {
    await handle?.close();
  }
}

let counter = 0;

/** Replace `file` with `text` atomically and durably (temp file → fsync → rename → fsync dir). */
export async function durableReplace(file: string, text: string): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${counter++}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (e) {
    await unlink(temporary).catch(() => undefined);
    throw e;
  }
  await syncDirectory(dir);
}

/** The publisher journal stored in one JSON file. */
export function fileJournal(file: string): PublisherJournalIO {
  const resolved = path.resolve(file);
  return {
    async read() {
      let text: string;
      try {
        text = await readFile(resolved, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
      checkJson(resolved, text);
      return text;
    },
    async write(text) {
      checkJson(resolved, text); // never persist bytes a later read() would refuse
      await durableReplace(resolved, text);
    },
  };
}
