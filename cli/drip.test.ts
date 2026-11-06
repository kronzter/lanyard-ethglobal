import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jsonFileStore } from "./drip";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("drip journal file", () => {
  it("persists intents across store instances and deletes them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lanyard-drip-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "drip-journal.json");
    await jsonFileStore(file).set("drip:x:0xabc", '{"status":"sent"}');
    expect(await jsonFileStore(file).get("drip:x:0xabc")).toBe('{"status":"sent"}');
    await jsonFileStore(file).delete("drip:x:0xabc");
    expect(await jsonFileStore(file).get("drip:x:0xabc")).toBeNull();
  });
});
