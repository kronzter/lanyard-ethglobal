// The Mumbai hall, traced from the ETHGlobal Mumbai venue map onto a 1 m grid (A3.1).
//
// Assumptions, flagged until measured on site:
//   - the hall is ~96 × 60 m (the map's outer wall, 1.64 : 1). Areas are traced on an 80 × 50
//     grid over the map, then scaled by 1.2 so the hacking spaces hold about 800 seats;
//   - the hacking spaces are packed with seat · table · seat rows instead of the map's few
//     tables, as requested; the outline of each space follows the map;
//   - restrooms sit outside the hall, so their POIs mark the doorways on the south wall;
//   - the map has one help desk; every other zone gets a small help point where helpers start;
//   - 8 partner booths: booths 1–2 are the configured partners (arkiv, ens); 3–8 are
//     placeholders until their partners are added to event.config.ts, then become partner-tables.
// The branded map itself is not shipped; image.uri names a floor-plan file that does not exist yet.
import type { Poi } from "@/shared/types/venue";
import { type Layout, scaleLayout } from "../layout";

const r = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

const poi = (
  id: string,
  kind: Poi["kind"],
  name: string,
  x: number,
  y: number,
  zone: string,
  partner?: string,
): Poi => ({ id, kind, name, cell: { x, y }, zone, ...(partner ? { partner } : {}) });

const booth = (n: number, x: number, y: number, partner?: string): Poi =>
  partner
    ? poi(`booth-${n}`, "partner-table", `Partner booth ${n} · ${partner}`, x, y, "east", partner)
    : poi(`booth-${n}`, "other", `Partner booth ${n} (unassigned)`, x, y, "east");

/** Traced on an 80 × 50 grid laid over the map. */
const traced: Layout = {
  id: "mumbai",
  name: "ETHGlobal Mumbai hall",
  cols: 80,
  rows: 50,
  cellSizeMm: 1000,
  image: { uri: "venue.mumbai.png", widthPx: 1600, heightPx: 1000 },
  cellSizePx: 20,
  zones: [
    { id: "north", name: "North hacking space" },
    { id: "west", name: "West hacking space and entry" },
    { id: "centre", name: "Centre hacking space" },
    { id: "south", name: "South hacking space" },
    { id: "east", name: "Partners, stage and judging" },
  ],
  seating: [
    { name: "North hacking space", rect: r(46, 1, 79, 11), zone: "north", crossAisleEvery: 9 },
    { name: "West hacking space", rect: r(12, 15, 34, 26), zone: "west", crossAisleEvery: 8 },
    {
      name: "Centre hacking space",
      rect: r(41, 15, 60, 36),
      zone: "centre",
      crossAisleEvery: 7,
      cutCorner: 5,
    },
    { name: "South hacking space", rect: r(18, 31, 34, 38), zone: "south", crossAisleEvery: 8 },
  ],
  blocked: [
    // North wall, left to right
    { name: "Meal catering", rect: r(1, 1, 20, 11) },
    { name: "Snacks & beverages (west)", rect: r(9, 13, 20, 13) },
    { name: "Hacker bag storage", rect: r(22, 1, 26, 11) },
    { name: "Female chill space", rect: r(28, 1, 32, 11) },
    { name: "Workshop room 1 / unisex chill", rect: r(34, 1, 37, 11) },
    { name: "Workshop room 2 / unisex chill", rect: r(39, 1, 44, 11) },
    { name: "Snacks & beverages (north)", rect: r(57, 1, 68, 2) },
    // West side
    { name: "Lounge tables", rect: r(1, 23, 5, 34) },
    { name: "Carrom", rect: r(6, 23, 8, 27) },
    { name: "Photobooth", rect: r(9, 31, 12, 34) },
    { name: "Help desk", rect: r(1, 36, 4, 40) },
    { name: "General registration & swag", rect: r(1, 41, 4, 45) },
    { name: "VIP registration", rect: r(13, 36, 16, 45) },
    // Middle
    { name: "Lantern (west)", rect: r(14, 27, 16, 29) },
    { name: "Activities", rect: r(19, 27, 28, 30) },
    { name: "Lantern (east)", rect: r(36, 27, 38, 29) },
    { name: "Spotlight (west)", rect: r(18, 41, 22, 42) },
    { name: "Snacks & beverages (south)", rect: r(24, 41, 28, 42) },
    { name: "Spotlight (east)", rect: r(30, 41, 34, 42) },
    { name: "Seating (south)", rect: r(18, 44, 34, 47) },
    // East side
    { name: "Partners strip", rect: r(63, 16, 64, 32) },
    { name: "Main stage", rect: r(66, 14, 77, 34) },
    { name: "Mentor station", rect: r(40, 40, 44, 42) },
    { name: "Partners table", rect: r(46, 40, 55, 42) },
    { name: "Seating (south-east)", rect: r(38, 44, 55, 47) },
    { name: "Pragma / judging rooms", rect: r(57, 37, 77, 47) },
  ],
  pois: [
    // Help desk and help points: one per zone, where helpers start a shift.
    poi("help-desk", "help-desk", "Help desk", 5, 38, "west"),
    poi("help-north", "help-desk", "Help point · north", 45, 8, "north"),
    poi("help-centre", "help-desk", "Help point · centre", 40, 25, "centre"),
    poi("help-south", "help-desk", "Help point · south", 17, 34, "south"),
    poi("help-east", "help-desk", "Help point · east", 62, 34, "east"),
    // Entry and exit
    poi("entry", "entrance", "Entry (Pavilion 2)", 3, 49, "west"),
    poi("exit", "entrance", "Exit", 14, 49, "west"),
    // Food
    poi("meal-catering", "food", "Meal catering", 5, 12, "west"),
    poi("snacks-west", "food", "Snacks & beverages", 8, 13, "west"),
    poi("snacks-north", "food", "Snacks & beverages", 56, 2, "north"),
    poi("snacks-south", "food", "Snacks & beverages", 26, 40, "south"),
    // Rooms along the north wall
    poi("bag-storage", "other", "Hacker bag storage", 24, 12, "north"),
    poi("female-chill", "other", "Female chill space", 30, 12, "north"),
    poi("workshop-1", "other", "Workshop room 1 / unisex chill", 36, 12, "north"),
    poi("workshop-2", "other", "Workshop room 2 / unisex chill", 41, 12, "north"),
    // West and middle
    poi("lounge", "other", "Lounge", 4, 18, "west"),
    poi("carrom", "other", "Carrom", 9, 25, "west"),
    poi("photobooth", "other", "Photobooth", 8, 33, "west"),
    poi("registration", "other", "General registration & swag", 5, 43, "west"),
    poi("vip-registration", "other", "VIP registration", 12, 40, "west"),
    poi("activities", "other", "Activities", 29, 28, "south"),
    poi("spotlight-west", "other", "Spotlight", 20, 40, "south"),
    poi("spotlight-east", "other", "Spotlight", 32, 40, "south"),
    // Restroom doorways on the south wall
    poi("restroom-exit", "restroom", "Restroom (by the exit)", 22, 49, "south"),
    poi("restrooms", "restroom", "Restrooms", 36, 49, "south"),
    // East: stage, mentors, judging, partner booths
    poi("main-stage", "stage", "Main stage", 71, 35, "east"),
    poi("mentor-station", "other", "Mentor station", 42, 39, "east"),
    poi("judging-rooms", "other", "Pragma (Friday) / judging rooms (Saturday)", 62, 36, "east"),
    booth(1, 62, 18, "arkiv"),
    booth(2, 62, 22, "ens"),
    booth(3, 62, 26),
    booth(4, 62, 30),
    booth(5, 46, 39),
    booth(6, 49, 39),
    booth(7, 52, 39),
    booth(8, 55, 39),
  ],
};

/** The hall at its estimated real size, ~96 × 60 m. */
export const MUMBAI_SCALE = 1.2;
export const mumbaiLayout: Layout = scaleLayout(traced, MUMBAI_SCALE);
