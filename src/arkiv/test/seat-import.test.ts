import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { parseSeatCsv, venueProblems } from "../seat-import";

const A = "0x1aac82773cb722166d7da0d5b0fa35b0307dd99d";
const B = "0x2bbb82773cb722166d7da0d5b0fa35b0307dd99d";

describe("seat CSV and venue checks", () => {
  it("accepts good rows and reports every bad one", () => {
    const venue = fixtureVenue();
    expect(
      parseSeatCsv(`hacker_address,hacker_label,seat\n${A},zkpay-a.hackers,w1`, venue).rows,
    ).toHaveLength(1);
    const bad = parseSeatCsv(
      `${A},zkpay-a.hackers,w1\n${A},ravi.volunteers,z9\n${B},zkpay-b.hackers,w1`,
      venue,
    );
    expect(bad.rows).toEqual([]);
    expect(bad.errors).toEqual([
      "line 2: ravi.volunteers is not a hackers badge label (x.hackers)",
      "line 2: seat z9 is not in venue small",
      `line 2: ${A} already has a seat on line 1`,
      "line 3: seat w1 is already given on line 1",
    ]);
  });

  it("requires a help desk per zone and a table per configured partner before publishing", () => {
    const venue = fixtureVenue();
    expect(venueProblems(venue, eventConfig).problems).toEqual([]);
    const noTables = { ...venue, pois: venue.pois.filter((p) => p.kind !== "partner-table") };
    expect(venueProblems(noTables, eventConfig).problems).toEqual([
      "partner arkiv has no partner table",
      "partner ens has no partner table",
    ]);
  });
});
