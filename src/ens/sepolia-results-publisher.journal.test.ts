import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorruptJournalError, fileJournal } from "./sepolia-results-publisher.journal";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>();
  return { ...real, rename: vi.fn(real.rename) };
});

const v1 = '{"schemaVersion":1,"entries":[]}';
const v2 = '{"schemaVersion":1,"entries":[{"hash":"0x01"}]}';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lanyard-journal-"));
  file = join(dir, "nested", "publisher-journal.json");
});

describe("fileJournal", () => {
  it("reads null only when the file does not exist, then round-trips writes", async () => {
    const j = fileJournal(file);
    expect(await j.read()).toBeNull();
    await j.write(v1);
    expect(await j.read()).toBe(v1);
    await j.write(v2);
    expect(await fileJournal(file).read()).toBe(v2); // a new instance, as after a restart
    expect(readdirSync(join(dir, "nested"))).toEqual(["publisher-journal.json"]); // no temp files left
  });

  it.each([
    ["empty", ""],
    ["truncated", v2.slice(0, 20)],
    ["not an object", "[]"],
    ["duplicate keys", '{"a":1,"a":2}'],
  ])("refuses a %s journal instead of resetting it", async (_what, text) => {
    const j = fileJournal(file);
    await j.write(v1);
    writeFileSync(file, text);
    await expect(j.read()).rejects.toBeInstanceOf(CorruptJournalError);
    expect(readFileSync(file, "utf8")).toBe(text); // left for the operator to inspect
  });

  it("never writes bytes a later read would refuse", async () => {
    const j = fileJournal(file);
    await j.write(v1);
    await expect(j.write('{"schemaVersion":')).rejects.toBeInstanceOf(CorruptJournalError);
    expect(await j.read()).toBe(v1);
  });

  it("keeps the previous journal when a write crashes before the rename", async () => {
    const j = fileJournal(file);
    await j.write(v1);
    vi.mocked(rename).mockRejectedValueOnce(new Error("simulated crash"));
    await expect(j.write(v2)).rejects.toThrow(/simulated crash/);
    expect(await j.read()).toBe(v1);
    expect(readdirSync(join(dir, "nested"))).toEqual(["publisher-journal.json"]);
  });

  it("ignores a stale temporary file left by an earlier crash", async () => {
    const j = fileJournal(file);
    await j.write(v1);
    writeFileSync(`${file}.999.0.0.tmp`, v2.slice(0, 10));
    expect(await j.read()).toBe(v1);
    await j.write(v2);
    expect(await j.read()).toBe(v2);
  });
});
