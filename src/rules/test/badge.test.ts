// Steps 3–4 (badge ownership, expiry, permission notes, cutoff continuity) through a test-only
// rule set, since the shipped B2 kinds are all authority-written. B3/B4 kinds use the same paths.
import { describe, expect, it } from "vitest";
import historyJson from "../../../fixtures/ens-history.json";
import { parseEnsHistory } from "@/shared/fixtures/ens-history";
import { MockEnsReader } from "@/shared/mocks/mock-ens-reader";
import { fixtureTimeline } from "@/shared/mocks/fixtures";
import { ok, type Engine, type KindRule } from "@/rules";
import { obs, persona, run, tsOf } from "./harness";

const R = { readonly: true, permissionlessExtension: false } as const;
const volunteer = (label: string) => label.endsWith(".volunteers") && label.split(".").length === 2;
const judge = (label: string) =>
  (label.endsWith(".judges") && label.split(".").length === 2) ||
  /^[a-z0-9-]+\.judges\.[a-z0-9-]+\.partners$/.test(label);

const rule = (writers: KindRule["writers"]): KindRule => ({ flags: R, writers, check: () => ok });
const engine: Engine = {
  version: `0x${"ab".repeat(32)}`,
  rules: {
    t_volunteer: rule([{ via: "badge", applies: volunteer, describe: "a volunteer badge" }]),
    t_lead: rule([
      { via: "badge", applies: volunteer, describe: "a lead badge", permission: "shift-manager" },
    ]),
    t_score: rule([{ via: "badge", applies: judge, describe: "a judge badge", continuousToCutoff: true }]),
  },
};

const by = (id: string, kind: string, at: bigint, extra: Partial<Parameters<typeof obs>[0]> = {}) => {
  const p = persona(id);
  return obs({ kind, creator: p.address, byLabel: p.by, at, ...extra });
};

describe("badge belonged to the writer (owner, never the address record)", () => {
  it("rejects a record whose by_label's address record points at the creator but is owned by someone else", async () => {
    const forged = obs({
      kind: "t_volunteer",
      creator: persona("ravi").address,
      byLabel: "anita.volunteers",
      at: 9_022_000n,
    });
    const real = by("anita", "t_volunteer", 9_022_000n);
    const { verdict } = await run([forged, real], { engine });
    expect(verdict(forged)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/owned by .*not the creator/),
    });
    expect(verdict(real).counts).toBe(true);
  });

  it("counts one block before an unregister and rejects at the unregister block", async () => {
    const before = by("kabir", "t_volunteer", 9_030_599n);
    const at = by("kabir", "t_volunteer", 9_030_600n);
    const after = by("kabir", "t_volunteer", 9_030_601n); // reissued to Kabir
    const { verdict } = await run([before, at, after], { engine });
    expect(verdict(before).counts).toBe(true);
    expect(verdict(at)).toMatchObject({ counts: false, reason: expect.stringMatching(/not a registered/) });
    expect(verdict(after).counts).toBe(true);
  });

  it("keeps old records tied to the old owner after the label is re-registered to someone else", async () => {
    const history = parseEnsHistory(historyJson);
    const ravi = history.events.find((e) => e.type === "register" && e.label === "ravi.volunteers")!;
    const eve = "0x00000000000000000000000000000000000000e1";
    history.events.push({ type: "unregister", block: 9_032_000n, label: "ravi.volunteers" }, {
      ...ravi,
      block: 9_032_001n,
      owner: eve,
      resource: `0x${"e1".repeat(32)}`,
    } as typeof ravi);
    history.events.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
    const reader = new MockEnsReader({ history, timeline: fixtureTimeline() });
    const old = by("ravi", "t_volunteer", 9_025_000n);
    const late = by("ravi", "t_volunteer", 9_032_100n);
    const { verdict } = await run([old, late], { engine, reader });
    expect(verdict(old).counts).toBe(true);
    expect(verdict(late)).toMatchObject({ counts: false, reason: expect.stringMatching(/owned by 0x0+e1/) });
  });
});

describe("badge allowed it (expiry)", () => {
  it("rejects a record at exactly the badge's expiry second and counts one second before", async () => {
    const deadline = fixtureTimeline().times.submissionDeadline; // Leela's expiry, on a block boundary
    const atExpiry = by("leela", "t_volunteer", deadline.block);
    const justBefore = by("leela", "t_volunteer", deadline.block - 1n, { offset: 11n });
    const { verdict } = await run([atExpiry, justBefore], { engine });
    expect(atExpiry.createdAtTimestamp).toBe(deadline.timestamp);
    expect(verdict(atExpiry).counts).toBe(false);
    expect(verdict(justBefore).counts).toBe(true);
  });

  it("rejects when expiry falls between the mapped block and the record's own timestamp", async () => {
    const history = parseEnsHistory(historyJson);
    const ravi = history.events.find((e) => e.type === "register" && e.label === "ravi.volunteers")!;
    (ravi as { expiry: bigint }).expiry = tsOf(9_025_000n) + 5n;
    const reader = new MockEnsReader({ history, timeline: fixtureTimeline() });
    const r = by("ravi", "t_volunteer", 9_025_000n, { offset: 7n }); // maps to 9_025_000, whose ts < expiry
    const { verdict } = await run([r], { engine, reader });
    expect(verdict(r)).toMatchObject({ counts: false, reason: expect.stringMatching(/expired/) });
  });
});

describe("registration-bound permission notes", () => {
  it("counts a lead while the note is present and rejects after it is removed", async () => {
    const during = by("priya", "t_lead", 9_022_000n);
    const after = by("priya", "t_lead", 9_028_000n);
    const { verdict } = await run([during, after], { engine });
    expect(verdict(during).counts).toBe(true);
    expect(verdict(after)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/no shift-manager note/),
    });
  });

  it("a stale note on a reissued badge grants nothing; the old registration's actions still reproduce", async () => {
    const old = by("kabir", "t_lead", 9_022_000n);
    const reissued = by("kabir", "t_lead", 9_031_000n);
    const { verdict } = await run([old, reissued], { engine });
    expect(verdict(old).counts).toBe(true);
    expect(verdict(reissued)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/no shift-manager/),
    });
  });

  it("renewal and role changes keep the registration, so the note stays valid", async () => {
    const rahul = by("rahul", "t_lead", 9_023_000n); // renewed at 9_022_800
    const meera = by("meera", "t_lead", 9_023_200n); // roles changed at 9_023_100
    const { verdict } = await run([rahul, meera], { engine });
    expect(verdict(rahul).counts).toBe(true);
    expect(verdict(meera).counts).toBe(true);
  });

  it("a volunteer without a note is not a lead", async () => {
    const ravi = by("ravi", "t_lead", 9_022_000n);
    const { verdict } = await run([ravi], { engine });
    expect(verdict(ravi).counts).toBe(false);
  });
});

describe("continuous registration through the cutoff", () => {
  it("excludes a judge unregistered before the cutoff and keeps one unregistered after it", async () => {
    const ben = by("ben", "t_score", 9_035_000n); // unregistered at 9_036_000, before the cutoff
    const gita = by("gita", "t_score", 9_035_000n); // unregistered at 9_037_500, after the cutoff
    const ana = by("ana", "t_score", 9_035_000n);
    const { verdict } = await run([ben, gita, ana], { engine });
    expect(verdict(ben)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/unregistered between/),
    });
    expect(verdict(gita).counts).toBe(true);
    expect(verdict(ana).counts).toBe(true);
  });
});

describe("writer paths that don't apply", () => {
  it("names the expected writers when the by_label claims no applicable badge", async () => {
    const r = by("zkpay-a", "t_volunteer", 9_022_000n);
    const { verdict } = await run([r], { engine });
    expect(verdict(r)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/is not a volunteer badge/),
    });
  });
});
