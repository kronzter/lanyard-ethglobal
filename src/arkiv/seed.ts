// The demo event for fake mode (development only): what the organizer, leads and hackers would
// have written by event start + 2 h. Four leads schedule ten volunteers across the two zones of the
// small venue; some are already clocked in with a lead pass, others are due to self-start. Every
// hacker has a seat, and three have open tickets (one for the Arkiv booth).
//
// Each persona writes as itself through FakeArkiv, so the same rules decide what counts.
import personasJson from "../../fixtures/personas.json";
import venueJson from "../../fixtures/venue.small.json";
import type { EventConfig } from "@/shared/config/schema";
import { parsePersonas } from "@/shared/fixtures/personas";
import type { Address, Hex } from "@/shared/types/primitives";
import type { FakeArkiv } from "./fake";
import type { Kind } from "./kinds";
import { seedJudging } from "./judging-seed";
import { buildCreate, type KindInputs } from "./writers";

export type Seeded = { venue: Hex; shifts: Record<string, Hex> };

const HOUR = 3_600n;

/** Who schedules whom: [volunteer, lead, zone, start offset, length, clocked in by the lead]. */
const SHIFTS: [string, string, string, bigint, bigint, boolean][] = [
  ["dev", "priya", "west", 0n, 6n * HOUR, true],
  ["vikram", "meera", "west", HOUR, 5n * HOUR, true],
  ["ravi", "priya", "west", 2n * HOUR + 1_800n, 4n * HOUR, false], // can self-start now
  ["omar", "meera", "west", 3n * HOUR, 4n * HOUR, false],
  ["arjun", "priya", "west", 4n * HOUR, 4n * HOUR, false],
  ["anita", "rahul", "east", 0n, 6n * HOUR, true],
  ["nisha", "kabir", "east", HOUR, 5n * HOUR, true],
  ["isha", "rahul", "east", 2n * HOUR + 1_800n, 4n * HOUR, false],
  ["leela", "rahul", "east", 3n * HOUR, 4n * HOUR, false],
  ["zoya", "kabir", "east", 4n * HOUR, 4n * HOUR, false],
];

export async function seedFakeEvent(fake: FakeArkiv, config: EventConfig): Promise<Seeded> {
  const personas = parsePersonas(personasJson).personas;
  const who = (id: string) => {
    const p = personas.find((x) => x.id === id);
    if (!p) throw new Error(`no persona ${id}`);
    return { address: p.address as Address, by: p.by };
  };
  const write = async <K extends Kind>(id: string, items: [K, KindInputs[K]][]) => {
    const p = who(id);
    const ctx = { edition: config.edition, byLabel: p.by, times: config.times };
    const r = await fake.writer(p.address).write({
      creates: items.map(([kind, input]) => buildCreate(kind, ctx, input)),
    });
    return r.created;
  };

  const start = config.times.eventStart;
  const [venue] = await write("organizer", [["venue", { version: "small-v1", venue: venueJson }]]);
  const shifts: Record<string, Hex> = {};
  for (const [id, lead, zone, offset, length] of SHIFTS) {
    const volunteer = who(id).by;
    const [key] = await write(lead, [
      ["shift", { volunteer, zone, startsAt: start + offset, endsAt: start + offset + length }],
    ]);
    shifts[id] = key!;
  }
  for (const [id, lead, , offset, length, clocked] of SHIFTS) {
    if (!clocked) continue;
    const volunteer = who(id).by;
    await write(lead, [
      ["clock", { volunteer, shift: shifts[id]!, action: "in" }],
      ["duty_pass", { volunteer, shift: shifts[id]!, endsAt: start + offset + length }],
    ]);
  }
  // Every hacker has an assigned seat (prefilled on their ticket form).
  const seats = ["w1", "w2", "w3", "w4", "e1", "e2", "e3", "e4", "w5", "w6", "e5", "e6-walled"];
  const hackers = personas.filter((p) => p.role === "hacker");
  await write(
    "organizer",
    hackers.map((h, i) => [
      "seat_assignment",
      { hackerAddress: h.address as Address, hackerLabel: h.by, seat: seats[i]!, venue: venue! },
    ]),
  );
  // Hackers already waiting for help: one per zone, and one for the Arkiv booth.
  await write("zkpay-b", [["ticket", { seat: "w3", venue: venue!, category: "wifi" }]]);
  await write("chainchat-a", [["ticket", { seat: "e1", venue: venue!, category: "power" }]]);
  await write("seatsense-a", [["ticket", { seat: "w5", venue: venue!, category: "partner:arkiv" }]]);
  await seedJudging(fake, config);
  return { venue: venue!, shifts };
}
