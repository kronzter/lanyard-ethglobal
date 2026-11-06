// Help tickets (B3.2-R1–R3, B3.3-R6) through the B3 bug-hunt checklist.
import { describe, expect, it } from "vitest";
import type { CapturedObservation } from "@/shared/evidence/observation";
import type { Hex } from "@/shared/types/primitives";
import { key, obs, persona, run, tsOf, venueObs, viewAt } from "./harness";

const VENUE = venueObs(9_021_650n);
const START = 9_022_500n;
const END = START + 3_000n; // 10 h shift; 75 blocks = 15 min, 1,200 blocks = 4 h

const shift = (lead: string, volunteer: string, zone: string, start = START, end = END, at = 9_022_000n) =>
  obs({
    kind: "shift",
    creator: persona(lead).address,
    byLabel: persona(lead).by,
    at,
    attrs: {
      volunteer: ["str", `${volunteer}.volunteers`],
      zone: ["str", zone],
      starts_at: ["u64", tsOf(start).toString()],
      ends_at: ["u64", tsOf(end).toString()],
    },
  });
const clockIn = (lead: string, volunteer: string, s: CapturedObservation, at = START + 10n) =>
  obs({
    kind: "clock",
    creator: persona(lead).address,
    byLabel: persona(lead).by,
    at,
    attrs: { volunteer: ["str", `${volunteer}.volunteers`], shift: ["key", s.key], action: ["str", "in"] },
  });

/** Ravi on duty in west, Anita in east, Dev scheduled in west but never clocked in. */
const RAVI = shift("priya", "ravi", "west");
const ANITA = shift("rahul", "anita", "east");
const DEV = shift("priya", "dev", "west");
const DUTY = [VENUE, RAVI, ANITA, DEV, clockIn("priya", "ravi", RAVI), clockIn("rahul", "anita", ANITA)];

const ticket = (
  hacker: string,
  at: bigint,
  o: { seat?: string; venue?: Hex; category?: string; k?: Hex } = {},
) =>
  obs({
    kind: "ticket",
    creator: persona(hacker).address,
    byLabel: persona(hacker).by,
    at,
    ...(o.k ? { key: o.k } : {}),
    attrs: {
      seat: ["str", o.seat ?? "w1"],
      venue: ["key", o.venue ?? VENUE.key],
      category: ["str", o.category ?? "wifi"],
    },
  });
const claim = (helper: string, t: CapturedObservation, at: bigint, k?: Hex) =>
  obs({
    kind: "ticket_claim",
    creator: persona(helper).address,
    byLabel: persona(helper).by,
    at,
    ...(k ? { key: k } : {}),
    attrs: { ticket: ["key", t.key] },
  });
const resolve = (helper: string, t: CapturedObservation, c: { key: Hex }, at: bigint, seat = "w1") =>
  obs({
    kind: "ticket_resolution",
    creator: persona(helper).address,
    byLabel: persona(helper).by,
    at,
    attrs: { ticket: ["key", t.key], claim: ["key", c.key], seat: ["str", seat] },
  });

const T0 = START + 100n;

describe("raising tickets", () => {
  it("needs a valid hackers badge; a volunteer's ticket is greyed out and never offered", async () => {
    const good = ticket("zkpay-a", T0);
    const bad = ticket("ravi", T0);
    const { verdict, view } = await viewAt([...DUTY, good, bad], T0 + 10n);
    expect(verdict(good).counts).toBe(true);
    expect(verdict(bad)).toMatchObject({ counts: false, reason: expect.stringMatching(/hackers badge/) });
    expect(view.ticketsAt().map((t) => t.record.key)).toEqual([good.key]);
  });

  it("binds the venue current at creation, a seat in it and a configured category", async () => {
    const later = venueObs(T0 - 10n);
    const stale = ticket("zkpay-a", T0, { venue: VENUE.key });
    const noSeat = ticket("zkpay-b", T0, { venue: later.key, seat: "z9" });
    const medical = ticket("zkpay-c", T0, { venue: later.key, category: "medical" });
    const { verdict } = await run([...DUTY, later, stale, noSeat, medical]);
    expect(verdict(stale).reason).toMatch(/not the current one/);
    expect(verdict(noSeat).reason).toMatch(/not in the ticket's venue/);
    expect(verdict(medical).reason).toMatch(/unknown ticket category/);
  });

  it("five tickets from one hacker: only the earliest three are live until one resolves", async () => {
    const ts = [0n, 1n, 2n, 3n, 4n].map((i) => ticket("zkpay-a", T0 + i));
    const c = claim("ravi", ts[0]!, T0 + 10n);
    const r = resolve("ravi", ts[0]!, c, T0 + 20n);
    const late = claim("ravi", ts[3]!, T0 + 15n);
    const { verdict, view } = await viewAt([...DUTY, ...ts, c, late], T0 + 16n);
    expect(view.ticketsAt().map((t) => t.state.state)).toEqual([
      "claimed",
      "open",
      "open",
      "over-capacity",
      "over-capacity",
    ]);
    expect(verdict(late).reason).toMatch(/three open tickets/);
    const after = (await viewAt([...DUTY, ...ts, c, r], T0 + 30n)).view.ticketsAt();
    expect(after.map((t) => t.state.state)).toEqual(["resolved", "open", "open", "open", "over-capacity"]);
  });
});

describe("the claim race", () => {
  it("two claims in one block: the lowest key wins, the other loses for good", async () => {
    const t = ticket("zkpay-a", T0);
    const hi = claim("ravi", t, T0 + 10n, key(0xffff_0000n));
    // A second on-duty west helper claims in the same block with a lower key.
    const meera = shift("priya", "meera", "west");
    const records = [...DUTY, meera, clockIn("priya", "meera", meera), t, hi];
    records.push(claim("meera", t, T0 + 10n, key(0x0fff_0000n)));
    const { verdict } = await run(records);
    expect(verdict(records.at(-1)!).counts).toBe(true);
    expect(verdict(hi)).toMatchObject({ counts: false, reason: expect.stringMatching(/lost to claim/) });
  });

  it("an unresolved claim lets the ticket reopen after 15 min; the loser never becomes a winner", async () => {
    const t = ticket("zkpay-a", T0);
    const first = claim("ravi", t, T0 + 10n);
    const meera = shift("priya", "meera", "west");
    const loser = claim("meera", t, T0 + 50n);
    const records = [...DUTY, meera, clockIn("priya", "meera", meera), t, first, loser];
    const reopened = await viewAt(records, T0 + 10n + 75n);
    expect(reopened.view.ticketsAt()[0]!.state.state).toBe("open");
    expect(reopened.verdict(loser).counts).toBe(false);
    const next = claim("meera", t, T0 + 10n + 75n);
    expect((await run([...records, next])).verdict(next).counts).toBe(true);
  });

  it("an off-duty or scheduled-only volunteer's claim is ignored; a ticket in another zone goes to that zone", async () => {
    const west = ticket("zkpay-a", T0);
    const east = ticket("zkpay-b", T0, { seat: "e1" });
    const byDev = claim("dev", west, T0 + 10n);
    const byAnitaWest = claim("anita", west, T0 + 11n);
    const byAnitaEast = claim("anita", east, T0 + 12n);
    const { verdict } = await run([...DUTY, west, east, byDev, byAnitaWest, byAnitaEast]);
    expect(verdict(byDev).reason).toMatch(/not on duty/);
    expect(verdict(byAnitaWest).reason).toMatch(/not on duty in zone west/);
    expect(verdict(byAnitaEast).counts).toBe(true);
  });

  it("a badge revoked while on duty: later claims are rejected", async () => {
    const s = shift("rahul", "vikram", "west", 9_032_500n, 9_034_000n, 9_032_000n);
    const records = [VENUE, s, clockIn("rahul", "vikram", s, 9_032_600n)];
    const before = ticket("zkpay-a", 9_032_700n);
    const after = ticket("zkpay-b", 9_033_050n);
    records.push(before, after, claim("vikram", before, 9_032_710n), claim("vikram", after, 9_033_060n));
    const { verdict } = await run(records);
    expect(verdict(records.at(-2)!).counts).toBe(true);
    expect(verdict(records.at(-1)!).counts).toBe(false);
  });
});

describe("resolution and deadlines", () => {
  it("a resolution inside the lease closes the ticket for good, even after the lease ends", async () => {
    const t = ticket("zkpay-a", T0);
    const c = claim("ravi", t, T0 + 10n);
    const r = resolve("ravi", t, c, T0 + 80n); // 70 blocks = 14 min
    const { verdict, view } = await viewAt([...DUTY, t, c, r], T0 + 500n);
    expect(verdict(r).counts).toBe(true);
    expect(view.ticketsAt()[0]!.state.state).toBe("resolved");
  });

  it("rejects a resolution at the lease end, by someone else, or at another seat", async () => {
    const t = ticket("zkpay-a", T0);
    const c = claim("ravi", t, T0 + 10n);
    const atEnd = resolve("ravi", t, c, T0 + 85n);
    const other = resolve("dev", t, c, T0 + 20n);
    const seat = resolve("ravi", t, c, T0 + 21n, "w2");
    const { verdict } = await run([...DUTY, t, c, atEnd, other, seat]);
    expect(verdict(atEnd).reason).toMatch(/lease ended/);
    expect(verdict(other).reason).toMatch(/winning claimer/);
    expect(verdict(seat).reason).toMatch(/seat/);
  });

  it("a claim at exactly the ticket's 4 h close is rejected", async () => {
    const t = ticket("zkpay-a", T0);
    const closing = claim("ravi", t, T0 + 1_200n);
    const records = [...DUTY, t, closing];
    const { verdict } = await run(records);
    expect(verdict(closing).reason).toMatch(/closed/);
  });

  it("a resolution whose claim is missing from the capture makes the ticket unverifiable, not open", async () => {
    const t = ticket("zkpay-a", T0);
    const r = resolve("ravi", t, { key: key(0xdead_beefn) }, T0 + 20n);
    const { verdict, view } = await viewAt([...DUTY, t, r], T0 + 200n);
    expect(verdict(r).reason).toMatch(/unverifiable/);
    expect(view.ticketsAt()[0]!.state.state).toBe("unverifiable");
  });

  it("only the ticket's hacker confirms its resolution", async () => {
    const t = ticket("zkpay-a", T0);
    const c = claim("ravi", t, T0 + 10n);
    const r = resolve("ravi", t, c, T0 + 20n);
    const confirm = (hacker: string, at: bigint) =>
      obs({
        kind: "ticket_confirmation",
        creator: persona(hacker).address,
        byLabel: persona(hacker).by,
        at,
        attrs: { ticket: ["key", t.key], resolution: ["key", r.key] },
      });
    const byOther = confirm("zkpay-b", T0 + 30n);
    const mine = confirm("zkpay-a", T0 + 31n);
    const { verdict, view } = await viewAt([...DUTY, t, c, r, byOther, mine], T0 + 40n);
    expect(verdict(byOther).counts).toBe(false);
    expect(verdict(mine).counts).toBe(true);
    expect(view.ticketsAt()[0]!.state.state).toBe("confirmed");
  });
});

describe("helper position", () => {
  it("a helper who just clocked in starts at their zone's help desk", async () => {
    const { view } = await viewAt(DUTY, START + 20n);
    expect(view.helperStart("ravi.volunteers")?.id).toBe("desk-west");
    expect(view.helperStart("anita.volunteers")?.id).toBe("desk-east");
    expect(view.helperStart("dev.volunteers")).toBeUndefined();
  });
});

describe("partner tickets (B3.3-R3)", () => {
  const partnerTicket = (at: bigint, hacker = "zkpay-a") =>
    ticket(hacker, at, { seat: "e1", category: "partner:arkiv" });

  it("only that partner's staff answer, without shifts; volunteers, judges and other partners cannot", async () => {
    const t = partnerTicket(T0);
    const byVolunteer = claim("anita", t, T0 + 10n);
    const byJudge = claim("ana", t, T0 + 11n);
    const byOtherStaff = claim("uma", t, T0 + 12n);
    const bySam = claim("sam", t, T0 + 13n);
    const r = resolve("sam", t, bySam, T0 + 20n, "e1");
    const { verdict } = await run([...DUTY, t, byVolunteer, byJudge, byOtherStaff, bySam, r]);
    expect(verdict(byVolunteer).reason).toMatch(/only by arkiv staff/);
    expect(verdict(byJudge).reason).toMatch(/partner staff badge/);
    expect(verdict(byOtherStaff).reason).toMatch(/only by arkiv staff/);
    expect(verdict(bySam).counts).toBe(true);
    expect(verdict(r).counts).toBe(true);
  });

  it("revoked partner staff: a claim before counts, the resolution after does not", async () => {
    const t = partnerTicket(9_032_900n);
    const c = claim("tara", t, 9_032_950n);
    const r = resolve("tara", t, c, 9_033_010n, "e1");
    const { verdict } = await run([VENUE, t, c, r]);
    expect(verdict(c).counts).toBe(true);
    expect(verdict(r).counts).toBe(false);
  });

  it("staff start at their partner's table", async () => {
    const { view } = await viewAt(DUTY, START + 20n);
    expect(view.helperStart("sam.staff.arkiv.partners")?.id).toBe("table-arkiv");
    expect(view.helperStart("uma.staff.ens.partners")?.id).toBe("table-ens");
  });
});

describe("seats (B3.3-R6)", () => {
  const assign = (seat: string, at: bigint) =>
    obs({
      kind: "seat_assignment",
      creator: persona("organizer").address,
      byLabel: "organizer",
      at,
      attrs: {
        hacker_address: ["addr", persona("zkpay-a").address],
        hacker_label: ["str", "zkpay-a.hackers"],
        seat: ["str", seat],
        venue: ["key", VENUE.key],
      },
    });

  it("the latest assignment wins and a reassignment never moves an existing ticket", async () => {
    const first = assign("w1", T0 - 50n);
    const t = ticket("zkpay-a", T0, { seat: "w1" });
    const moved = assign("w2", T0 + 10n);
    const { view } = await viewAt([...DUTY, first, t, moved], T0 + 20n);
    expect(view.seatOf(persona("zkpay-a").address)?.key).toBe(moved.key);
    expect(view.seatOf(persona("zkpay-a").address, tsOf(T0))?.key).toBe(first.key);
    expect(view.ticketsAt()[0]!.seat).toBe("w1");
  });
});
