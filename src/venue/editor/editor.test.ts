import { describe, expect, it } from "vitest";
import mumbaiJson from "../../../fixtures/venue.mumbai.json";
import { eventConfig } from "@/shared/event.config";
import { parseVenue } from "@/shared/types/venue";
import {
  addZone,
  commit,
  createState,
  fromVenue,
  newHistory,
  paintRect,
  paintWalkable,
  paintZone,
  placePoi,
  placeSeat,
  removeSeatAt,
  toVenue,
  undo,
} from "./model";
import { validateVenue } from "./validate";

const meta = {
  id: "t",
  name: "Test",
  image: { uri: "t.png", widthPx: 100, heightPx: 100 },
  cellSizeMm: 1000,
  cellSizePx: 10,
  originPx: { x: 0, y: 0 },
};
const cfg = { partners: [{ id: "arkiv" }, { id: "ens" }] };

/** A valid small venue: one zone, a help desk and a table per partner. */
function good() {
  let s = createState(meta, 10, 10);
  s = addZone(s, { id: "hall", name: "Hall" });
  s = paintRect(s, { x: 0, y: 0 }, { x: 9, y: 9 }, true);
  s = paintZone(s, [{ x: 0, y: 0 }], "hall");
  s = placePoi(s, { x: 0, y: 0 }, "help-desk", "Desk");
  s = placePoi(s, { x: 1, y: 0 }, "partner-table", "Arkiv", { partner: "arkiv", zone: "hall" });
  s = placePoi(s, { x: 2, y: 0 }, "partner-table", "ENS", { partner: "ens", zone: "hall" });
  s = placeSeat(s, { x: 5, y: 5 }, "hall");
  return s;
}
const rules = (r: { rule: string }[]) => r.map((i) => i.rule);

describe("editing model", () => {
  it("numbers seats and keeps IDs stable (R5)", () => {
    let s = good();
    s = placeSeat(s, { x: 6, y: 5 }, "hall");
    s = placeSeat(s, { x: 7, y: 5 }, "hall");
    expect(s.seats.map((x) => x.id)).toEqual(["s001", "s002", "s003"]);
    s = removeSeatAt(s, { x: 6, y: 5 });
    s = placeSeat(s, { x: 8, y: 5 }, "hall");
    expect(s.seats.map((x) => x.id)).toEqual(["s001", "s003", "s004"]);
    // Reload from venue.json: existing IDs unchanged, new ones continue after the max.
    const again = placeSeat(fromVenue(toVenue(s)), { x: 9, y: 5 }, "hall");
    expect(again.seats.map((x) => x.id)).toEqual(["s001", "s003", "s004", "s005"]);
  });

  it("paints, erases and undoes", () => {
    let h = newHistory(createState(meta, 5, 5));
    h = commit(h, paintWalkable(h.present, { x: 2, y: 2 }, true, 3));
    expect(h.present.mask.reduce((a, b) => a + b, 0)).toBe(9);
    h = commit(h, paintWalkable(h.present, { x: 2, y: 2 }, false));
    expect(h.present.mask.reduce((a, b) => a + b, 0)).toBe(8);
    h = undo(undo(h));
    expect(h.present.mask.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("moves seats into a painted zone", () => {
    let s = good();
    s = addZone(s, { id: "b", name: "B" });
    s = paintZone(s, [{ x: 5, y: 5 }], "b");
    expect(s.seats[0]!.zone).toBe("b");
  });
});

describe("export round-trip (R1, R2)", () => {
  it("round-trips random editor states through venue.json", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let iter = 0; iter < 60; iter++) {
      const cols = 4 + rnd(30);
      const rows = 4 + rnd(30);
      let s = addZone(addZone(createState(meta, cols, rows), { id: "a", name: "A" }), { id: "b", name: "B" });
      for (let k = 0; k < 40; k++)
        s = paintRect(s, { x: rnd(cols), y: rnd(rows) }, { x: rnd(cols), y: rnd(rows) }, rnd(3) > 0);
      for (let k = 0; k < 30; k++) s = placeSeat(s, { x: rnd(cols), y: rnd(rows) }, rnd(2) ? "a" : "b");
      for (let k = 0; k < 6; k++)
        s = placePoi(s, { x: rnd(cols), y: rnd(rows) }, "stage", "Stage", { zone: "a" });
      s = placePoi(s, { x: rnd(cols), y: rnd(rows) }, "partner-table", "T", { partner: "arkiv", zone: "b" });
      const v = toVenue(s);
      const back = JSON.parse(JSON.stringify(v));
      expect(back).toEqual(v);
      const loaded = fromVenue(back);
      expect(Array.from(loaded.mask)).toEqual(Array.from(s.mask));
      expect(toVenue(loaded)).toEqual(v);
    }
  });

  it("exported valid venue passes the P0.2 schema", () => {
    const v = toVenue(good());
    expect(parseVenue(JSON.parse(JSON.stringify(v)))).toEqual(v);
    expect(validateVenue(v, cfg).errors).toEqual([]);
  });
});

describe("validateVenue", () => {
  it("R3: seat with no walkable cell within 3", () => {
    let s = createState(meta, 12, 12);
    s = addZone(s, { id: "hall", name: "Hall" });
    s = paintRect(s, { x: 0, y: 0 }, { x: 1, y: 1 }, true);
    s = placePoi(s, { x: 0, y: 0 }, "help-desk", "Desk", { zone: "hall" });
    s = placeSeat(s, { x: 4, y: 1 }, "hall"); // distance 3: ok for R3
    s = placeSeat(s, { x: 8, y: 8 }, "hall"); // far from any walkable cell
    const r = validateVenue(toVenue(s), { partners: [] });
    expect(r.errors.filter((e) => e.rule === "R3").map((e) => e.message)).toEqual([
      expect.stringContaining("s002"),
    ]);
  });

  it("R4: warns above 120 KiB without blocking", () => {
    let s = good();
    for (let i = 0; i < 3000; i++)
      s = {
        ...s,
        pois: [
          ...s.pois,
          { id: `x-${i}`, kind: "other", name: "Some long name here", cell: { x: 3, y: 3 }, zone: "hall" },
        ],
      };
    const r = validateVenue(toVenue(s), cfg);
    expect(rules(r.warnings)).toEqual(["R4"]);
    expect(rules(r.errors)).not.toContain("R4");
    expect(validateVenue(toVenue(good()), cfg).warnings).toEqual([]);
  });

  it("R6: zone without a help desk", () => {
    const s = addZone(good(), { id: "empty", name: "Empty" });
    const r = validateVenue(toVenue(s), cfg);
    expect(r.errors).toEqual([
      expect.objectContaining({ rule: "R6", message: expect.stringContaining("empty") }),
    ]);
  });

  it("R7: missing and unknown partners", () => {
    const missing = validateVenue(toVenue(good()), { partners: [...cfg.partners, { id: "other" }] });
    expect(missing.errors).toEqual([
      expect.objectContaining({ rule: "R7", message: expect.stringContaining("other") }),
    ]);
    const unknown = validateVenue(toVenue(good()), { partners: [{ id: "arkiv" }] });
    expect(unknown.errors).toEqual([
      expect.objectContaining({ rule: "R7", message: expect.stringContaining("ens") }),
    ]);
  });
});

describe("committed Mumbai fixture", () => {
  it("passes validation against event.config partners", () => {
    const v = parseVenue(mumbaiJson);
    const r = validateVenue(v, eventConfig);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
