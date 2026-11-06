import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureForEvent } from "../src/arkiv/capture";
import { FakeArkiv } from "../src/arkiv/fake";
import { buildCreate } from "../src/arkiv/writers";
import { eventConfig } from "../src/shared/event.config";
import { jsonlObservationStore } from "./capture";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("JSONL observation store", () => {
  it("appends observations and gone-marks, and reloads them across instances", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lanyard-capture-"));
    dirs.push(dir);
    const file = path.join(dir, "mumbai2026", "observations.jsonl");
    const f = new FakeArkiv(eventConfig.times.eventStart - 10_000n);
    const owner = "0x00000000000000000000000000000000000000a1";
    const [k] = (
      await f.writer(owner).write({
        creates: [
          buildCreate(
            "ticket",
            { edition: eventConfig.edition, byLabel: "zkpay-a.hackers", times: eventConfig.times },
            { seat: "S001", venue: `0x${"1".repeat(64)}`, category: "wifi" },
          ),
        ],
      })
    ).created;
    const network = { chainId: 7794095, resetId: (await f.block(0n)).hash };
    await captureForEvent({
      reader: f,
      edition: eventConfig.edition,
      network,
      store: jsonlObservationStore(file),
    });
    await f.writer(owner).write({ deletes: [{ entityKey: k! }] });
    await captureForEvent({
      reader: f,
      edition: eventConfig.edition,
      network,
      store: jsonlObservationStore(file),
    });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(["observation", "gone"]);
    const reloaded = await jsonlObservationStore(file).load();
    expect(reloaded.observations[0]!.key).toBe(k);
    expect(reloaded.gone[0]!.reason).toBe("deleted");
  });
});
