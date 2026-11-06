import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import {
  TIMELINE_TIMES,
  blockAtTimestamp,
  parseTimeline,
  timestampOfBlock,
} from "@/shared/fixtures/timeline";
import raw from "../timeline.json";

const timeline = parseTimeline(raw);

describe("timeline.json (P0.4-R4)", () => {
  it("maps every key event time from the config onto the 12 s mock chain", () => {
    for (const key of TIMELINE_TIMES) {
      const entry = timeline.times[key];
      expect(entry.timestamp, key).toBe(eventConfig.times[key]);
      expect(entry.block, key).toBe(blockAtTimestamp(timeline, entry.timestamp));
    }
  });

  it("puts genesis before the event and the head after the freeze deadline", () => {
    expect(timeline.genesis.timestamp).toBeLessThan(eventConfig.times.eventStart);
    expect(timeline.head).toBeGreaterThan(timeline.times.freezeDeadline.block);
  });

  it("uses the earlier block for a timestamp between blocks", () => {
    const b = timeline.times.eventStart.block;
    const ts = timestampOfBlock(timeline, b);
    expect(blockAtTimestamp(timeline, ts)).toBe(b);
    expect(blockAtTimestamp(timeline, ts + 11n)).toBe(b);
    expect(blockAtTimestamp(timeline, ts + 12n)).toBe(b + 1n);
    expect(blockAtTimestamp(timeline, ts - 1n)).toBe(b - 1n);
    expect(() => blockAtTimestamp(timeline, timeline.genesis.timestamp - 1n)).toThrow(
      /before the mock genesis/,
    );
  });
});
