// Fake mode (development only) seeds a demo event that the real rules accept end to end.
import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import { createFixtureEnsReader, fixtureTimeline } from "@/shared/mocks/fixtures";
import { fakeArkiv } from "../app-arkiv";
import { evaluateCurrent } from "../evaluate-current";

describe("fake mode", () => {
  it("seeds a venue, seats, shifts, clock-ins and tickets that all count", async () => {
    const app = fakeArkiv(eventConfig, fixtureTimeline());
    await app.fake!.seeded;
    const { output, view } = await evaluateCurrent({
      reader: app.reader,
      ens: createFixtureEnsReader(),
      config: eventConfig,
    });
    expect(output.verdicts.filter((v) => !v.counts)).toEqual([]);
    expect(view.onDuty("dev.volunteers", undefined, "west")).toBe(true);
    expect(view.onDuty("ravi.volunteers")).toBe(false); // scheduled, not clocked in
    expect(view.ticketsAt().map((t) => [t.zone, t.state.state])).toEqual([
      ["west", "open"],
      ["east", "open"],
      ["west", "open"],
    ]);
  });
});
