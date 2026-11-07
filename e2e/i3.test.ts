// I3 · real venue and router (plans/I3-real-venue.md steps 4–5).
//
// The ticket flow runs on the Mumbai venue with A3's GridRouter and B's rules over FakeArkiv, so it
// is deterministic and runs in CI. FakeArkiv mines one block per write, so the "race" is two claims a
// block apart: the rules' earliest-eligible-claim order decides it, as on Rabdi. The live part
// (`pnpm e2e:i3`, LANYARD_I3=1) reads the published venue back from Rabdi.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, type Address, type Hex } from "viem";
import personasJson from "../fixtures/personas.json";
import venueMumbai from "../fixtures/venue.mumbai.json";
import { freezeConfig } from "../src/shared/config/hash";
import { createArkivReader } from "../src/arkiv/client";
import { evaluateCurrent } from "../src/arkiv/evaluate-current";
import { FAKE_BLOCK_SECONDS, FakeArkiv } from "../src/arkiv/fake";
import type { Kind } from "../src/arkiv/kinds";
import { buildCreate, type KindInputs } from "../src/arkiv/writers";
import { eventConfig as config } from "../src/shared/event.config";
import { parsePersonas } from "../src/shared/fixtures/personas";
import { DEFAULT_ALPHA_MM_PER_MINUTE } from "../src/shared/interfaces/router";
import { createFixtureEnsReader, fixtureTimeline } from "../src/shared/mocks/fixtures";
import { decodeWalkable, parseVenue, type CellRef } from "../src/shared/types/venue";
import { GridRouter } from "../src/venue/grid-router";
import { mumbaiVenue, SEPOLIA_VENUE_FILE, VENUE_VERSION } from "./i3-venue";

const ROOT = resolve(import.meta.dirname, "..");
const venue = parseVenue(venueMumbai);
const router = new GridRouter();
const MINUTE = 60n;
const cellOf = (seat: string): CellRef => venue.seats.find((s) => s.id === seat)!.cell;

/** A fresh fake event on the Mumbai venue: venue, seats, two north volunteers on duty, tickets. */
async function mumbaiEvent() {
  const resetId = freezeConfig(config).chains.rabdi.resetId;
  const start = fixtureTimeline().times.eventStart.timestamp + 7_200n;
  const fake = new FakeArkiv(start - 1_000n * FAKE_BLOCK_SECONDS, 1_000n, resetId);
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
  const evaluate = () => evaluateCurrent({ reader: fake, ens: createFixtureEnsReader(), config });

  const [venueKey] = await write("organizer", [["venue", { version: VENUE_VERSION, venue: venueMumbai }]]);
  await write(
    "organizer",
    (
      [
        ["zkpay-a", "s014"],
        ["zkpay-b", "s015"],
        ["zkpay-c", "s016"],
      ] as const
    ).map(([id, seat]) => [
      "seat_assignment",
      { hackerAddress: who(id).address, hackerLabel: who(id).by, seat, venue: venueKey! },
    ]),
  );
  const now = (await fake.head()).timestamp;
  for (const id of ["dev", "anita"]) {
    const [shift] = await write("priya", [
      ["shift", { volunteer: who(id).by, zone: "north", startsAt: now, endsAt: now + 360n * MINUTE }],
    ]);
    await write("priya", [
      ["clock", { volunteer: who(id).by, shift: shift!, action: "in" }],
      ["duty_pass", { volunteer: who(id).by, shift: shift!, endsAt: now + 360n * MINUTE }],
    ]);
  }
  const [wifi] = await write("zkpay-a", [["ticket", { seat: "s014", venue: venueKey!, category: "wifi" }]]);
  const [power] = await write("zkpay-c", [["ticket", { seat: "s016", venue: venueKey!, category: "power" }]]);
  const [partner] = await write("zkpay-b", [
    ["ticket", { seat: "s015", venue: venueKey!, category: "partner:arkiv" }],
  ]);
  return {
    fake,
    who,
    write,
    evaluate,
    venueKey: venueKey!,
    tickets: { wifi: wifi!, power: power!, partner: partner! },
  };
}

/** Every step moves to a neighbouring walkable cell (8-way, no corner cutting through walls). */
function followsWalls(path: readonly CellRef[]): boolean {
  const mask = decodeWalkable(venue.walkable, venue.grid.cols, venue.grid.rows);
  const open = (c: CellRef) => mask[c.y * venue.grid.cols + c.x] === 1;
  return path.every((c, i) => {
    if (!open(c)) return false;
    if (i === 0) return true;
    const p = path[i - 1]!;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
    return dx === 0 || dy === 0 || (open({ x: p.x + dx, y: p.y }) && open({ x: p.x, y: p.y + dy }));
  });
}

describe("I3 · tickets on the Mumbai venue (FakeArkiv + rules + GridRouter)", () => {
  it("publishes a venue record that round-trips and stays under 128 KiB", () => {
    const { bytes, hash } = mumbaiVenue();
    expect(bytes.length).toBeLessThan(128 * 1024);
    expect(keccak256(bytes)).toBe(hash);
    expect(parseVenue(JSON.parse(new TextDecoder().decode(bytes)))).toEqual(venue);
  });

  it("two volunteers claim one ticket: exactly one wins, and the loser never wins later", async () => {
    const e = await mumbaiEvent();
    const [first] = await e.write("dev", [["ticket_claim", { ticket: e.tickets.wifi }]]);
    const [second] = await e.write("anita", [["ticket_claim", { ticket: e.tickets.wifi }]]);
    const { view } = await e.evaluate();
    const wifi = view.ticketsAt().find((t) => t.record.key === e.tickets.wifi)!;
    expect(wifi.zone).toBe("north");
    expect(wifi.state.state).toBe("claimed");
    if (wifi.state.state !== "claimed") return;
    expect(wifi.state.claim.key).toBe(first);
    expect(wifi.state.claim.creator.toLowerCase()).toBe(e.who("dev").address.toLowerCase());

    // The loser is offered another open ticket in their zone, never the one they lost.
    const open = view
      .ticketsAt()
      .filter((t) => t.state.state === "open" && t.zone === "north" && !t.category.startsWith("partner:"))
      .map((t) => ({
        key: t.record.key,
        cell: cellOf(t.seat),
        createdAtSeconds: t.record.obs.createdAtTimestamp,
      }));
    const start = view.helperStart(e.who("anita").by)!;
    const offer = router.nextTicket(venue, start.cell, open, view.now, DEFAULT_ALPHA_MM_PER_MINUTE);
    expect(offer?.key).toBe(e.tickets.power);

    // Past the 15 min lease without a resolution the ticket reopens; the losing claim stays lost.
    e.fake.advance((20n * MINUTE) / FAKE_BLOCK_SECONDS);
    const later = (await e.evaluate()).view.ticketsAt().find((t) => t.record.key === e.tickets.wifi)!;
    expect(later.state.state).toBe("open");
    expect(second).not.toBe(first);
  });

  it("resolve, then the next ticket is offered from the seat and its path follows real walls", async () => {
    const e = await mumbaiEvent();
    const [claim] = await e.write("dev", [["ticket_claim", { ticket: e.tickets.wifi }]]);
    const before = (await e.evaluate()).view;
    const desk = before.helperStart(e.who("dev").by)!;
    const toSeat = router.path(venue, desk.cell, cellOf("s014"));
    expect(toSeat).not.toBeNull();
    expect(followsWalls(toSeat!)).toBe(true);

    await e.write("dev", [["ticket_resolution", { ticket: e.tickets.wifi, claim: claim!, seat: "s014" }]]);
    const { view } = await e.evaluate();
    expect(view.ticketsAt().find((t) => t.record.key === e.tickets.wifi)!.state.state).toBe("resolved");

    const open = view
      .ticketsAt()
      .filter((t) => t.state.state === "open" && t.zone === "north" && !t.category.startsWith("partner:"))
      .map((t) => ({
        key: t.record.key,
        cell: cellOf(t.seat),
        createdAtSeconds: t.record.obs.createdAtTimestamp,
      }));
    const next = router.nextTicket(venue, cellOf("s014"), open, view.now, DEFAULT_ALPHA_MM_PER_MINUTE);
    expect(next?.key).toBe(e.tickets.power);
    const path = router.path(venue, cellOf("s014"), next!.cell);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual(cellOf("s014"));
    expect(followsWalls(path!)).toBe(true);
  });

  it("a partner-help ticket is answered only by Arkiv partner staff, starting at the Arkiv booth", async () => {
    const e = await mumbaiEvent();
    await e.write("dev", [["ticket_claim", { ticket: e.tickets.partner }]]);
    const afterVolunteer = (await e.evaluate()).view;
    expect(afterVolunteer.ticketsAt().find((t) => t.record.key === e.tickets.partner)!.state.state).toBe(
      "open",
    );

    const [staffClaim] = await e.write("sam", [["ticket_claim", { ticket: e.tickets.partner }]]);
    const { view } = await e.evaluate();
    const partner = view.ticketsAt().find((t) => t.record.key === e.tickets.partner)!;
    expect(partner.state.state).toBe("claimed");
    if (partner.state.state === "claimed") expect(partner.state.claim.key).toBe(staffClaim);
    const booth = view.helperStart(e.who("sam").by)!;
    expect(booth).toMatchObject({ kind: "partner-table", partner: "arkiv" });
    const path = router.path(venue, booth.cell, cellOf("s015"));
    expect(path && followsWalls(path)).toBe(true);
  });

  it("an unreachable cell gets no route instead of a wrong one", () => {
    const mask = decodeWalkable(venue.walkable, venue.grid.cols, venue.grid.rows);
    const blocked = mask.findIndex((m) => m === 0);
    const wall = { x: blocked % venue.grid.cols, y: Math.floor(blocked / venue.grid.cols) };
    expect(router.path(venue, cellOf("s014"), wall)).toBeNull();
  });
});

describe.skipIf(process.env.LANYARD_I3 !== "1")("I3 · live Rabdi venue record", () => {
  it("reads back byte-identical to fixtures/venue.mumbai.json", async () => {
    const recorded = JSON.parse(readFileSync(resolve(ROOT, SEPOLIA_VENUE_FILE), "utf8")) as {
      key: Hex;
      canonicalHash: Hex;
      bytes: number;
    };
    const { hash, bytes } = mumbaiVenue();
    expect(recorded.canonicalHash).toBe(hash);
    expect(recorded.bytes).toBe(bytes.length);
    const arkiv = createArkivReader({
      rpcUrl: process.env.RABDI_RPC_URL,
      accessKey: process.env.RABDI_ACCESS_KEY,
    });
    const stored = await arkiv.get(recorded.key);
    expect(stored?.flags.readonly).toBe(true);
    expect(stored?.creator.toLowerCase()).toBe(
      (await import("../src/shared/live-event.config")).sepoliaEventConfig.authorities.organizer,
    );
    const raw = stored?.attributes.payload?.value.value as unknown;
    const hex =
      typeof raw === "string" ? raw : raw instanceof Uint8Array ? Buffer.from(raw).toString("hex") : "";
    expect(keccak256((hex.startsWith("0x") ? hex : `0x${hex}`) as Hex)).toBe(hash);
  }, 120_000);
});
