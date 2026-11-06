// On-duty rules (B3.1-R1, R2) through the B3 bug-hunt checklist.
import { describe, expect, it } from "vitest";
import type { CapturedObservation } from "@/shared/evidence/observation";
import type { Hex } from "@/shared/types/primitives";
import { obs, persona, run, tsOf, venueObs, viewAt } from "./harness";

const VENUE = venueObs(9_021_650n);
const START = 9_022_500n; // shift start (Sepolia block); 300 blocks = 1 h
const END = 9_023_700n;

function shift(
  o: {
    lead?: string;
    volunteer?: string;
    zone?: string;
    at?: bigint;
    start?: bigint;
    end?: bigint;
    supersedes?: Hex;
  } = {},
) {
  const lead = persona(o.lead ?? "priya");
  return obs({
    kind: "shift",
    creator: lead.address,
    byLabel: lead.by,
    at: o.at ?? 9_022_000n,
    attrs: {
      volunteer: ["str", o.volunteer ?? "ravi.volunteers"],
      zone: ["str", o.zone ?? "west"],
      starts_at: ["u64", tsOf(o.start ?? START).toString()],
      ends_at: ["u64", tsOf(o.end ?? END).toString()],
      ...(o.supersedes ? { supersedes: ["key", o.supersedes] as ["key", string] } : {}),
    },
  });
}

function clock(
  writer: string,
  s: CapturedObservation,
  at: bigint,
  o: { action?: "in" | "out"; offset?: bigint; volunteer?: string; statedAt?: bigint } = {},
) {
  const w = persona(writer);
  return obs({
    kind: "clock",
    creator: w.address,
    byLabel: w.by,
    at,
    offset: o.offset,
    attrs: {
      volunteer: ["str", o.volunteer ?? "ravi.volunteers"],
      shift: ["key", s.key],
      action: ["str", o.action ?? "in"],
      ...(o.statedAt !== undefined ? { stated_at: ["u64", o.statedAt.toString()] as ["u64", string] } : {}),
    },
  });
}

describe("self clock-in window", () => {
  it.each([
    ["61 min early", START, -3660n, false],
    ["60 min early", START, -3600n, true],
    ["15 min late", START, 900n, true],
    ["16 min late", START, 960n, false],
  ])("%s", async (_, at, offset, counts) => {
    const s = shift();
    const c = clock("ravi", s, at, { offset });
    const { verdict } = await run([VENUE, s, c]);
    expect(verdict(s).counts).toBe(true);
    expect(verdict(c).counts).toBe(counts);
    if (!counts) expect(verdict(c).reason).toMatch(/ask a lead/);
  });

  it("an early self-start does not activate duty before the shift starts", async () => {
    const s = shift();
    const c = clock("ravi", s, START - 100n);
    expect((await viewAt([VENUE, s, c], START - 50n)).view.onDuty("ravi.volunteers")).toBe(false);
    expect((await viewAt([VENUE, s, c], START + 10n)).view.onDuty("ravi.volunteers")).toBe(true);
  });
});

describe("lead actions", () => {
  it("a non-lead cannot clock someone else in", async () => {
    const s = shift({ volunteer: "dev.volunteers" });
    const c = clock("ravi", s, START + 10n, { volunteer: "dev.volunteers" });
    const { verdict } = await run([VENUE, s, c]);
    expect(verdict(c)).toMatchObject({ counts: false, reason: expect.stringMatching(/only a lead/) });
  });

  it("two leads clocking the same volunteer in one block: one session, no error", async () => {
    const s = shift();
    const a = clock("priya", s, START + 10n);
    const b = clock("rahul", s, START + 10n);
    const { verdict, view } = await viewAt([VENUE, s, a, b], START + 20n);
    expect([verdict(a).counts, verdict(b).counts].sort()).toEqual([false, true]);
    expect(view.sessionsOf("ravi.volunteers")).toHaveLength(1);
  });

  it("a clock-out with no clock-in is ignored", async () => {
    const s = shift();
    const out = clock("priya", s, START + 10n, { action: "out" });
    const { verdict, view } = await viewAt([VENUE, s, out], START + 20n);
    expect(verdict(out)).toMatchObject({ counts: false, reason: expect.stringMatching(/ignored/) });
    expect(view.onDuty("ravi.volunteers")).toBe(false);
  });

  it("a lead clock-in counts only while the shift covers it; stated_at never moves duty", async () => {
    const s = shift();
    const early = clock("priya", s, START - 10n);
    const late = clock("priya", s, START + 100n, { statedAt: tsOf(START - 200n) });
    const { verdict, view } = await viewAt([VENUE, s, early, late], START + 150n);
    expect(verdict(early).counts).toBe(false);
    expect(verdict(late).counts).toBe(true);
    expect(view.sessionsOf("ravi.volunteers")[0]!.start).toBe(tsOf(START + 100n)); // block time
  });

  it("a lead's note removed at block N: shifts before N count, after N don't", async () => {
    const before = shift({ at: 9_027_500n, start: 9_027_800n, end: 9_028_400n });
    const after = shift({ at: 9_027_700n, start: 9_027_800n, end: 9_028_400n });
    const { verdict } = await run([VENUE, before, after]);
    expect(verdict(before).counts).toBe(true);
    expect(verdict(after)).toMatchObject({ counts: false, reason: expect.stringMatching(/shift-manager/) });
  });

  it("a reissued lead badge without a fresh note cannot write shifts", async () => {
    const before = shift({ lead: "kabir", at: 9_030_500n, start: 9_031_000n, end: 9_031_600n });
    const after = shift({ lead: "kabir", at: 9_030_700n, start: 9_031_000n, end: 9_031_600n });
    const { verdict } = await run([VENUE, before, after]);
    expect(verdict(before).counts).toBe(true);
    expect(verdict(after).counts).toBe(false);
  });
});

describe("sessions", () => {
  it("a scheduled but unclocked shift is off duty; a session ends at shift end", async () => {
    const s = shift();
    expect((await viewAt([VENUE, s], START + 10n)).view.onDuty("ravi.volunteers")).toBe(false);
    const c = clock("priya", s, START + 10n);
    expect((await viewAt([VENUE, s, c], END - 1n)).view.onDuty("ravi.volunteers")).toBe(true);
    expect((await viewAt([VENUE, s, c], END)).view.onDuty("ravi.volunteers")).toBe(false);
  });

  it("overlapping shifts: on duty is their union, per zone", async () => {
    const a = shift({ volunteer: "dev.volunteers", start: START, end: START + 300n });
    const b = shift({ volunteer: "dev.volunteers", zone: "east", start: START + 200n, end: START + 600n });
    const ca = clock("priya", a, START + 10n, { volunteer: "dev.volunteers" });
    const cb = clock("priya", b, START + 210n, { volunteer: "dev.volunteers" });
    const records = [VENUE, a, b, ca, cb];
    const both = (await viewAt(records, START + 250n)).view;
    expect(both.sessionsOf("dev.volunteers")).toHaveLength(2);
    const later = (await viewAt(records, START + 400n)).view;
    expect(later.onDuty("dev.volunteers", undefined, "east")).toBe(true);
    expect(later.onDuty("dev.volunteers", undefined, "west")).toBe(false);
  });

  it("a replacement closes the old session at once and stays inactive until its clock-in", async () => {
    const s = shift();
    const c = clock("priya", s, START + 10n);
    const r = shift({ at: START + 100n, end: END + 300n, supersedes: s.key });
    const pending = (await viewAt([VENUE, s, c, r], START + 150n)).view;
    expect(pending.onDuty("ravi.volunteers")).toBe(false);
    expect(pending.shiftsOf("ravi.volunteers")[0]!.effectiveEnd).toBe(tsOf(START + 100n));
    const c2 = clock("priya", r, START + 200n);
    const active = (await viewAt([VENUE, s, c, r, c2], END + 100n)).view;
    expect(active.onDuty("ravi.volunteers")).toBe(true);
  });

  it("a replacement for another volunteer is rejected", async () => {
    const s = shift();
    const r = shift({ volunteer: "dev.volunteers", at: START + 100n, supersedes: s.key });
    expect((await run([VENUE, s, r])).verdict(r).counts).toBe(false);
  });

  it("a lead-written pass and a self-start show the same deadline; only the lead path has a pass", async () => {
    const lead = shift();
    const self = shift({ volunteer: "dev.volunteers" });
    const pass = obs({
      kind: "duty_pass",
      creator: persona("priya").address,
      byLabel: "priya.volunteers",
      at: START + 10n,
      attrs: {
        volunteer: ["str", "ravi.volunteers"],
        shift: ["key", lead.key],
        ends_at: ["u64", tsOf(END).toString()],
      },
    });
    const records = [VENUE, lead, self, clock("priya", lead, START + 10n), pass];
    records.push(clock("dev", self, START + 20n, { volunteer: "dev.volunteers" }));
    const { view, verdict } = await viewAt(records, START + 30n);
    expect(verdict(pass).counts).toBe(true);
    const [l] = view.shiftsOf("ravi.volunteers");
    const [d] = view.shiftsOf("dev.volunteers");
    expect(l!.pass).toBeDefined();
    expect(d!.pass).toBeUndefined();
    expect(view.sessionsOf("ravi.volunteers")[0]!.end).toBe(view.sessionsOf("dev.volunteers")[0]!.end);
  });

  it("a badge revoked while on duty ends duty", async () => {
    const s = shift({ volunteer: "vikram.volunteers", at: 9_032_000n, start: 9_032_500n, end: 9_033_500n });
    const c = clock("priya", s, 9_032_600n, { volunteer: "vikram.volunteers" });
    // Priya's note is gone after +20 h; Rahul is still a lead.
    const s2 = shift({
      lead: "rahul",
      volunteer: "vikram.volunteers",
      at: 9_032_000n,
      start: 9_032_500n,
      end: 9_033_500n,
    });
    const c2 = clock("rahul", s2, 9_032_600n, { volunteer: "vikram.volunteers" });
    const records = [VENUE, s, c, s2, c2];
    expect((await viewAt(records, 9_032_900n)).view.onDuty("vikram.volunteers")).toBe(true);
    expect((await viewAt(records, 9_033_100n)).view.onDuty("vikram.volunteers")).toBe(false);
  });
});
