// The shipped B2 kinds (B2.2-R3) and the engine's screening, context and snapshot guarantees.
import { describe, expect, it } from "vitest";
import { KINDS } from "@/arkiv/kinds";
import { EnsReadError } from "@/shared/interfaces/ens-reader";
import { createFixtureEnsReader } from "@/shared/mocks/fixtures";
import {
  ContextError,
  evaluate,
  prepare,
  RULES,
  RulesConfigError,
  RulesVersionError,
  UnpreparedRead,
} from "@/rules";
import { CONFIG_HASH, context, frozen, key, obs, persona, run, RULES_VERSION } from "./harness";

const organizer = persona("organizer");
const AT = 9_022_000n;
const seat = (creator: string, byLabel: string, hackerLabel: string, hackerAddress: string) =>
  obs({
    kind: "seat_assignment",
    creator: creator as `0x${string}`,
    byLabel,
    at: AT,
    attrs: {
      hacker_label: ["str", hackerLabel],
      hacker_address: ["addr", hackerAddress],
      seat: ["str", "w1"],
      venue: ["key", key(999n)],
    },
  });

describe("organizer-only kinds", () => {
  it("counts a venue from the organizer and rejects one from anyone else", async () => {
    const good = obs({ kind: "venue", creator: organizer.address, byLabel: "organizer", at: AT });
    const bad = obs({
      kind: "venue",
      creator: persona("priya").address,
      byLabel: "priya.volunteers",
      at: AT,
    });
    const { verdict } = await run([good, bad]);
    expect(verdict(good).counts).toBe(true);
    expect(verdict(bad)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/not the organizer wallet/),
    });
  });

  it("a seat assignment counts only from the organizer with hacker_label owned by hacker_address", async () => {
    const a = persona("zkpay-a");
    const good = seat(organizer.address, "organizer", "zkpay-a.hackers", a.address);
    const byVolunteer = seat(persona("ravi").address, "ravi.volunteers", "zkpay-a.hackers", a.address);
    const mismatched = seat(organizer.address, "organizer", "zkpay-a.hackers", persona("zkpay-b").address);
    const notHacker = seat(organizer.address, "organizer", "ravi.volunteers", persona("ravi").address);
    const { verdict } = await run([good, byVolunteer, mismatched, notHacker]);
    expect(verdict(good).counts).toBe(true);
    expect(verdict(byVolunteer)).toMatchObject({ counts: false, reason: expect.stringMatching(/organizer/) });
    expect(verdict(mismatched)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/not hacker_address/),
    });
    expect(verdict(notHacker)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/not a hackers badge/),
    });
  });

  it("a forged seat assignment creates no ENS read during preparation", async () => {
    const forged = seat(
      persona("ravi").address,
      "ravi.volunteers",
      "zkpay-c.hackers",
      persona("ravi").address,
    );
    const { prepared, verdict } = await run([forged]);
    expect(verdict(forged).counts).toBe(false);
    expect(prepared.ens.filter((e) => e.label === "zkpay-c.hackers")).toEqual([]);
  });

  it("acceptance needs the organizer and a configured track", async () => {
    const attrs = (track: string) => ({
      submission: ["key", key(77n)] as ["key", string],
      track: ["str", track] as ["str", string],
    });
    const good = obs({
      kind: "acceptance",
      creator: organizer.address,
      byLabel: "organizer",
      at: AT,
      attrs: attrs("main"),
    });
    const unknown = obs({
      kind: "acceptance",
      creator: organizer.address,
      byLabel: "organizer",
      at: AT,
      attrs: attrs("defi"),
    });
    const { verdict } = await run([good, unknown]);
    expect(verdict(good).counts).toBe(true);
    expect(verdict(unknown)).toMatchObject({ counts: false, reason: expect.stringMatching(/unknown track/) });
  });
});

describe("rubric", () => {
  const rubric = (creator: string, byLabel: string, track: string) =>
    obs({
      kind: "rubric",
      creator: creator as `0x${string}`,
      byLabel,
      at: AT,
      attrs: { track: ["str", track], payload: ["bytes", "0x00"] },
    });
  const arkiv = persona("partner-arkiv");

  it("the organizer may write any track, including main", async () => {
    const main = rubric(organizer.address, "organizer", "main");
    const ens = rubric(organizer.address, "organizer", "ens");
    const { verdict } = await run([main, ens]);
    expect(verdict(main).counts).toBe(true);
    expect(verdict(ens).counts).toBe(true);
  });

  it("a partner may write only its own track, never main", async () => {
    const own = rubric(arkiv.address, arkiv.by, "arkiv");
    const other = rubric(arkiv.address, arkiv.by, "ens");
    const main = rubric(arkiv.address, arkiv.by, "main");
    const { verdict } = await run([own, other, main]);
    expect(verdict(own).counts).toBe(true);
    expect(verdict(other)).toMatchObject({
      counts: false,
      reason: expect.stringMatching(/only write its own track/),
    });
    expect(verdict(main).counts).toBe(false);
  });

  it("a partner judge's badge is not a partner authority", async () => {
    const ana = persona("ana");
    const r = rubric(ana.address, ana.by, "arkiv");
    const { verdict } = await run([r]);
    expect(verdict(r).counts).toBe(false);
  });
});

describe("results and drip", () => {
  it("results count only from the results wallet", async () => {
    const flags = { readonly: true, permissionlessExtension: true };
    const attrs = { summary: ["bytes", "0x01"] as ["bytes", string] };
    const good = obs({
      kind: "results",
      creator: persona("results").address,
      byLabel: "results",
      at: AT,
      flags,
      attrs,
    });
    const bad = obs({
      kind: "results",
      creator: organizer.address,
      byLabel: "organizer",
      at: AT,
      flags,
      attrs,
    });
    const { verdict } = await run([good, bad]);
    expect(verdict(good).counts).toBe(true);
    expect(verdict(bad).counts).toBe(false);
  });

  it("drip counts only from the configured desk wallet, not the desk persona", async () => {
    const attrs = {
      recipient: ["addr", persona("zkpay-a").address] as ["addr", string],
      tx: ["str", "0x1"] as ["str", string],
    };
    const desk = frozen.authorities.desk!;
    const good = obs({ kind: "drip", creator: desk, byLabel: "desk", at: AT, attrs });
    const persona_ = obs({ kind: "drip", creator: persona("desk").address, byLabel: "desk", at: AT, attrs });
    const { verdict } = await run([good, persona_]);
    expect(verdict(good).counts).toBe(true);
    expect(verdict(persona_)).toMatchObject({ counts: false, reason: expect.stringMatching(/desk wallet/) });
  });
});

describe("screening", () => {
  const venue = (extra: Partial<Parameters<typeof obs>[0]> = {}) =>
    obs({ kind: "venue", creator: organizer.address, byLabel: "organizer", at: AT, ...extra });

  it("rejects wrong flags, missing or non-canonical by_label, wrong event and undecodable attributes", async () => {
    const mutable = venue({ flags: { readonly: false, permissionlessExtension: false } });
    const noLabel = venue({ byLabel: undefined });
    const upper = venue({ byLabel: "Organizer" });
    const otherEvent = venue({ event: "berlin2027" });
    const junk = venue({ attrs: { version: ["u64", "1.5"] } });
    const { verdict } = await run([mutable, noLabel, upper, otherEvent, junk]);
    expect(verdict(mutable).reason).toMatch(/requires readonly=true/);
    expect(verdict(noLabel).reason).toMatch(/missing by_label/);
    expect(verdict(upper).reason).toMatch(/not canonical/);
    expect(verdict(otherEvent).reason).toMatch(/not a lanyard record for mumbai2026/);
    expect(verdict(junk).reason).toMatch(/not a valid u64/);
  });

  it("keeps kinds without a rule visible and never counted", async () => {
    const shift = obs({
      kind: "shift",
      creator: persona("priya").address,
      byLabel: "priya.volunteers",
      at: AT,
    });
    const { verdict } = await run([shift]);
    expect(verdict(shift)).toMatchObject({ counts: false, reason: "no rule registered for kind 'shift'" });
  });

  it("excludes records observed after the Arkiv cutoff or captured on another network", async () => {
    const late = venue({ observedAtBlock: 1_000_001n });
    const elsewhere = venue({ resetId: `0x${"77".repeat(32)}` });
    const { verdict } = await run([late, elsewhere]);
    expect(verdict(late).reason).toMatch(/after the Arkiv cutoff/);
    expect(verdict(elsewhere).reason).toMatch(/different Arkiv network/);
  });

  it("returns one verdict per record, in evidence order, regardless of input order", async () => {
    const records = [venue({ at: 9_030_000n }), venue({ at: 9_021_700n }), venue({ at: 9_025_000n })];
    const a = await run(records);
    const b = await run([...records].reverse());
    expect(a.output).toEqual(b.output);
    expect(a.output.verdicts.map((v) => v.key)).toEqual([records[1]!.key, records[2]!.key, records[0]!.key]);
  });
});

describe("evaluate's guarantees", () => {
  const records = [obs({ kind: "venue", creator: organizer.address, byLabel: "organizer", at: AT })];

  it("refuses an unavailable rules version", async () => {
    const { ens } = await prepare(records, createFixtureEnsReader(), context(), frozen);
    expect(() => evaluate(records, ens, context(), frozen, `0x${"12".repeat(32)}`)).toThrow(
      RulesVersionError,
    );
  });

  it("refuses a config that does not match the context's configHash", async () => {
    const { ens } = await prepare(records, createFixtureEnsReader(), context(), frozen);
    const tampered = {
      ...frozen,
      authorities: { ...frozen.authorities, organizer: persona("priya").address },
    };
    expect(() => evaluate(records, ens, context(), tampered, RULES_VERSION)).toThrow(RulesConfigError);
  });

  it("refuses a context for another event or chain reset", () => {
    expect(() => evaluate(records, [], context({ event: "berlin2027" }), frozen, RULES_VERSION)).toThrow(
      ContextError,
    );
    expect(() =>
      evaluate(records, [], context({ arkivResetId: `0x${"11".repeat(32)}` }), frozen, RULES_VERSION),
    ).toThrow(ContextError);
  });

  it("throws on a read that was not prepared instead of guessing", async () => {
    const r = seat(organizer.address, "organizer", "zkpay-a.hackers", persona("zkpay-a").address);
    const { ens } = await prepare([r], createFixtureEnsReader(), context(), frozen);
    const withoutOwner = ens.filter((e) => e.query !== "owner");
    expect(() => evaluate([r], withoutOwner, context(), frozen, RULES_VERSION)).toThrow(UnpreparedRead);
  });

  it("prepare fails loudly when a read fails", async () => {
    const r = seat(organizer.address, "organizer", "zkpay-a.hackers", persona("zkpay-a").address);
    const reader = createFixtureEnsReader({ fail: (m) => m === "owner" });
    await expect(prepare([r], reader, context(), frozen)).rejects.toThrow(EnsReadError);
  });

  it("deduplicates identical reads and reports cache hits", async () => {
    const a = persona("zkpay-a");
    const rs = [1n, 2n, 3n].map(() => seat(organizer.address, "organizer", "zkpay-a.hackers", a.address));
    const { stats } = await prepare(rs, createFixtureEnsReader(), context(), frozen);
    expect(stats).toMatchObject({ declared: 3, fetched: 1, cacheHits: 2, timeMappings: 1 });
  });

  it("uses the frozen config's hash", () => expect(context().configHash).toBe(CONFIG_HASH));
});

describe("flags agree with the B1 kind definitions", () => {
  it.each(Object.keys(RULES))("%s", (kind) => {
    const def = KINDS[kind as keyof typeof KINDS].flags as {
      readonly: boolean;
      permissionlessExtension?: boolean;
    };
    expect(RULES[kind]!.flags).toEqual({
      readonly: def.readonly,
      permissionlessExtension: def.permissionlessExtension ?? false,
    });
  });
});
